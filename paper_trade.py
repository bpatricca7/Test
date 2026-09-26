#!/usr/bin/env python3
"""
Kalshi Paper Trader
===================
Forward-tests a rule on live markets without placing orders: every few
minutes it records a hypothetical buy for each market that meets the rule,
then scores those entries once the markets settle.

A rule buys one side at the ask when the market is a set time from its end,
the ask is in a price band and the spread is tight. As in backtest.py, markets
that can close early (e.g. a prop that closes the moment a player scores) are
timed from their scheduled event time, never from their close time.

    python paper_trade.py --name weather-no --side no --min-ask 80 --max-ask 90 \
        --hours-before 24 --category "Climate and Weather"
    python paper_trade.py --name weather-no --report

Entries are logged to data/paper/<name>.jsonl. Nothing here places orders.

History: rule H1 (YES at 40-70c, 1h before close) was retracted on 2026-09-26.
Its backtest counted back from sports markets' actual close, which leaks
when (and so whether) the event happened.
"""

import argparse
import json
import os
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import requests

from arbitrage_scanner import (DEFAULT_TAKER_FEE_RATE, KalshiPublicClient, fee_multiplier,
                               parse_quote, parse_time, taker_fee_cents, tradable)


FEE_ORDER_SIZE = 100
WINDOW_MINUTES = 5          # enter within +/- this many minutes of the target time


@dataclass
class Rule:
    side: str = "yes"
    min_ask: Decimal = Decimal(40)
    max_ask: Decimal = Decimal(70)
    max_spread: Decimal = Decimal(2)
    hours_before: float = 1.0
    category: Optional[str] = None


def side_prices(quote, side: str):
    """(ask, bid) in cents for buying `side`."""
    if side == "yes":
        return quote.yes_ask, quote.yes_bid
    return quote.no_ask, quote.no_bid


def reference_time(raw: dict, quote):
    """What entries count back from: the close for markets that close on schedule,
    the scheduled event time for markets that can close early, else None."""
    if raw.get("can_close_early") is False:
        return quote.close_time
    if raw.get("can_close_early"):
        return parse_time(raw.get("occurrence_datetime"))
    return None


def rule_entry(raw: dict, quote, rule: Rule, multiplier: Decimal, now: datetime):
    """The hypothetical entry for this market, or None if the rule does not apply."""
    reference = reference_time(raw, quote)
    if not quote.is_open or not reference:
        return None
    minutes = (reference - now).total_seconds() / 60
    if abs(minutes - rule.hours_before * 60) > WINDOW_MINUTES:
        return None
    ask, bid = side_prices(quote, rule.side)
    if not (tradable(ask) and tradable(bid)):
        return None
    if not (rule.min_ask <= ask < rule.max_ask and ask - bid <= rule.max_spread):
        return None
    fee = taker_fee_cents(ask, FEE_ORDER_SIZE, DEFAULT_TAKER_FEE_RATE * multiplier)
    return {"ticker": quote.ticker, "event_ticker": quote.event_ticker, "title": quote.title,
            "side": rule.side, "entry_ts": int(now.timestamp()),
            "reference_ts": int(reference.timestamp()), "ask": float(ask), "bid": float(bid),
            "fee": float(fee) / FEE_ORDER_SIZE, "result": None}


def log_path(name: str) -> str:
    return os.path.join("data", "paper", f"{name}.jsonl")


def load(path: str) -> list:
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f]


def save(entries: list, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    os.replace(tmp, path)


def pnl(entry: dict) -> float:
    payout = 100.0 if entry["result"] == entry.get("side", "yes") else 0.0
    return payout - entry["ask"] - entry["fee"]


def summarize(entries: list, rounds: int = 400) -> str:
    settled = [e for e in entries if e["result"] in ("yes", "no")]
    lines = [f"{len(entries)} entries, {len(settled)} settled"]
    if not settled:
        return lines[0]
    cost = sum(e["ask"] + e["fee"] for e in settled)
    total = sum(pnl(e) for e in settled)
    wins = sum(pnl(e) > 0 for e in settled)
    by_event = defaultdict(list)
    for e in settled:
        by_event[e["event_ticker"]].append(e)
    groups = list(by_event.values())
    rng, stats = random.Random(7), []
    for _ in range(rounds):
        sample = [e for _ in groups for e in groups[rng.randrange(len(groups))]]
        c = sum(e["ask"] + e["fee"] for e in sample)
        stats.append(sum(pnl(e) for e in sample) / c if c else 0.0)
    stats.sort()
    lines.append(f"won {wins}/{len(settled)} ({wins / len(settled):.1%}), avg cost "
                 f"{cost / len(settled):.1f}c, P&L {total / 100:+.2f} per 1-contract entries "
                 f"= {total / cost:+.1%} [{stats[int(.025 * rounds)]:+.1%}, "
                 f"{stats[int(.975 * rounds) - 1]:+.1%}] over {len(groups)} events")
    return "\n".join(lines)


def candidate_markets(client: KalshiPublicClient, rule: Rule, now: datetime) -> list:
    """Open markets that may hit the rule's entry time now.

    Markets closing on schedule are found by close time. Markets that can close
    early list a far-off latest close, so they are scanned among everything
    closing within the following days and filtered by their event time.
    """
    target = now + timedelta(hours=rule.hours_before)
    windows = [(target - timedelta(minutes=WINDOW_MINUTES), target + timedelta(minutes=WINDOW_MINUTES)),
               (target, target + timedelta(days=3))]
    markets = {}
    for low, high in windows:
        cursor = None
        while True:
            params = {"status": "open", "limit": 1000, "mve_filter": "exclude",
                      "min_close_ts": int(low.timestamp()), "max_close_ts": int(high.timestamp())}
            if cursor:
                params["cursor"] = cursor
            data = client._get("/markets", params)
            for m in data.get("markets") or []:
                markets[m["ticker"]] = m
            cursor = data.get("cursor")
            if not cursor:
                break
    return list(markets.values())


def scan_once(client: KalshiPublicClient, rule: Rule, entries: list, events: dict,
              series: dict, now: datetime) -> int:
    """Record new entries for `rule`; return how many were added."""
    seen = {e["ticker"] for e in entries}
    added = 0
    for raw in candidate_markets(client, rule, now):
        quote = parse_quote(raw)
        if quote.ticker in seen:
            continue
        # Cheap timing and price check before any event/series lookups.
        if not rule_entry(raw, quote, rule, Decimal(1), now):
            continue
        if quote.event_ticker not in events:
            try:
                events[quote.event_ticker] = client.get_event(quote.event_ticker)
            except requests.exceptions.RequestException:
                continue
        event = events[quote.event_ticker]
        if rule.category and series_category(client, event, series) != rule.category:
            continue
        multiplier = fee_multiplier(event, client, series)
        if multiplier is None:
            continue
        entry = rule_entry(raw, quote, rule, multiplier, now)
        if entry:
            entries.append(entry)
            seen.add(entry["ticker"])
            added += 1
    return added


def series_category(client: KalshiPublicClient, event: dict, series: dict) -> Optional[str]:
    ticker = event.get("series_ticker")
    if not ticker:
        return None
    if ticker not in series:
        try:
            series[ticker] = client.get_series(ticker)
        except requests.exceptions.RequestException:
            return None
    return series[ticker].get("category")


def settle(client: KalshiPublicClient, entries: list, now: datetime) -> int:
    """Fill in results for entries whose markets have settled; return how many."""
    pending = [e for e in entries if e["result"] is None
               and e.get("reference_ts", e.get("close_ts", 0)) < now.timestamp()]
    done = 0
    for i in range(0, len(pending), 100):
        batch = {e["ticker"]: e for e in pending[i:i + 100]}
        data = client._get("/markets", {"tickers": ",".join(batch), "limit": 100})
        for m in data.get("markets") or []:
            entry = batch.get(m.get("ticker"))
            if entry and m.get("result") in ("yes", "no", "scalar"):
                entry["result"] = m["result"]
                done += 1
    return done


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--name", required=True, help="log name, e.g. weather-no")
    parser.add_argument("--side", choices=("yes", "no"), default="yes")
    parser.add_argument("--min-ask", type=Decimal, default=Decimal(40))
    parser.add_argument("--max-ask", type=Decimal, default=Decimal(70))
    parser.add_argument("--max-spread", type=Decimal, default=Decimal(2))
    parser.add_argument("--hours-before", type=float, default=1.0,
                        help="hours before the close (or scheduled event, for early-close markets)")
    parser.add_argument("--category", help="only this series category, e.g. 'Climate and Weather'")
    parser.add_argument("--report", action="store_true", help="print results so far and exit")
    parser.add_argument("--every", type=float, default=240, help="seconds between scans")
    args = parser.parse_args(argv)

    path = log_path(args.name)
    entries = load(path)
    if args.report:
        print(summarize(entries))
        return 0

    rule = Rule(args.side, args.min_ask, args.max_ask, args.max_spread, args.hours_before,
                args.category)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    client = KalshiPublicClient()
    events, series = {}, {}
    print(f"Paper-trading {args.name}: {rule}. No orders are placed.")
    try:
        while True:
            now = datetime.now(timezone.utc)
            try:
                added = scan_once(client, rule, entries, events, series, now)
                settled = settle(client, entries, now)
            except requests.exceptions.RequestException as e:
                print(f"{now:%H:%M} UTC  request failed: {e}")
                added = settled = 0
            if added or settled:
                save(entries, path)
                print(f"{now:%Y-%m-%d %H:%M} UTC  +{added} entries, {settled} settled | "
                      + summarize(entries).replace("\n", " | "))
            if len(events) > 5000:
                events.clear()
            time.sleep(args.every)
    except KeyboardInterrupt:
        save(entries, path)
        print("\nStopped.\n" + summarize(entries))
    return 0


if __name__ == "__main__":
    sys.exit(main())
