#!/usr/bin/env python3
"""
Kalshi Strategy Backtester
==========================
Tests simple trading rules against settled Kalshi markets, using the prices
you could actually have traded at (the hourly best bid and ask before close),
after Kalshi's fees. Rules are chosen on an earlier period and then checked on
a later one, and confidence intervals resample whole events, because the
markets in one event (e.g. twenty strikes of one Bitcoin price) move together.

    python backtest.py collect --start 2026-07-28 --end 2026-09-26
    python backtest.py evaluate
    python backtest.py collect --historical --start 2026-06-01 --end 2026-07-28 --data-dir data/holdout
    python backtest.py h1 --data-dir data/holdout

Collected data is cached under data/ so collection can be resumed.
"""

import argparse
import hashlib
import json
import os
import random
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import requests

from arbitrage_scanner import (BASE_URL, DEFAULT_TAKER_FEE_RATE, KNOWN_FEE_TYPES, parse_time,
                               price_cents, taker_fee_cents, to_decimal)


DATA_DIR = "data"
MIN_VOLUME = Decimal(50)          # contracts traded over the market's life
PER_SERIES_PER_DAY = 15           # sample cap, so a few huge series don't dominate
LOOKBACK_HOURS = 48
HORIZONS = (1, 2, 4, 8, 24)       # hours before close at which a rule may enter
MOMENTUM_LOOKBACK_HOURS = 8       # momentum compares the 1h-before mid with this one
MOVE_BUCKETS = ((-100, -15), (-15, -5), (-5, 5), (5, 15), (15, 101))
PRICE_BINS = ((1, 5), (5, 10), (10, 20), (20, 30), (30, 40), (40, 50), (50, 60),
              (60, 70), (70, 80), (80, 90), (90, 95), (95, 100))
FEE_ORDER_SIZE = 100              # fees are rounded per order; assume 100-lot orders


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------

class RateLimitedClient:
    """Thread-safe public API client that stays under Kalshi's basic read limit."""

    def __init__(self, base_url: str = BASE_URL, per_second: float = 12.0):
        self.base_url = base_url
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next_slot = 0.0
        self.local = threading.local()

    def _session(self) -> requests.Session:
        if not hasattr(self.local, "session"):
            self.local.session = requests.Session()
            self.local.session.headers.update({"Accept": "application/json"})
        return self.local.session

    def get(self, path: str, params: dict) -> dict:
        delay = 1.0
        for attempt in range(6):
            with self.lock:
                wait = self.next_slot - time.monotonic()
                self.next_slot = max(self.next_slot, time.monotonic()) + self.interval
            if wait > 0:
                time.sleep(wait)
            try:
                response = self._session().get(f"{self.base_url}{path}", params=params, timeout=60)
            except requests.exceptions.RequestException:
                if attempt == 5:
                    raise
                time.sleep(delay)
                delay *= 2
                continue
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(delay)
                delay *= 2
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError("unreachable")


def sample_rank(ticker: str) -> str:
    """Stable pseudo-random order, so re-running collects the same sample."""
    return hashlib.sha1(ticker.encode()).hexdigest()


def usable_market(m: dict):
    """Compact record for a settled yes/no market with enough volume, else None."""
    volume = to_decimal(m.get("volume_fp")) or to_decimal(m.get("volume")) or Decimal(0)
    close = parse_time(m.get("close_time"))
    if m.get("result") not in ("yes", "no") or volume < MIN_VOLUME or not close:
        return None
    record = {"ticker": m["ticker"], "event_ticker": m["event_ticker"],
              "series": m["event_ticker"].split("-")[0], "result": m["result"],
              "close_ts": int(close.timestamp()), "volume": float(volume),
              "strike_type": m.get("strike_type"), "title": m.get("title", "")}
    record.update(schedule_fields(m))
    return record


def schedule_fields(m: dict) -> dict:
    """Timing known before trading: whether the market may close early (e.g. the
    moment a player scores) and when the underlying event was scheduled."""
    def ts(name):
        t = parse_time(m.get(name))
        return int(t.timestamp()) if t else None
    return {"can_close_early": m.get("can_close_early"),
            "occurrence_ts": ts("occurrence_datetime"),
            "expected_expiration_ts": ts("expected_expiration_time")}


def sample_per_series(markets: list) -> list:
    by_series = defaultdict(list)
    for m in markets:
        by_series[m["series"]].append(m)
    sample = []
    for group in by_series.values():
        sample += sorted(group, key=lambda m: sample_rank(m["ticker"]))[:PER_SERIES_PER_DAY]
    return sample


def settled_markets_for_day(client: RateLimitedClient, day: datetime) -> list:
    start = int(day.timestamp())
    markets, cursor = [], None
    while True:
        params = {"status": "settled", "min_settled_ts": start, "max_settled_ts": start + 86400,
                  "limit": 1000, "mve_filter": "exclude"}
        if cursor:
            params["cursor"] = cursor
        data = client.get("/markets", params)
        markets += [u for u in map(usable_market, data.get("markets") or []) if u]
        cursor = data.get("cursor")
        if not cursor:
            break
    return sample_per_series(markets)


def historical_markets_by_day(client: RateLimitedClient, start: datetime, end: datetime) -> dict:
    """Markets settled before Kalshi's historical cutoff, bucketed by close day.

    The historical listing has no date filter and comes back roughly newest
    first, so page until a whole page closed more than two days before `start`.
    """
    by_day, cursor = defaultdict(list), None
    floor_ts = int((start - timedelta(days=2)).timestamp())
    while True:
        params = {"limit": 1000, "mve_filter": "exclude"}
        if cursor:
            params["cursor"] = cursor
        data = client.get("/historical/markets", params)
        page = data.get("markets") or []
        for m in page:
            u = usable_market(m)
            if u and start.timestamp() <= u["close_ts"] < end.timestamp():
                day = datetime.fromtimestamp(u["close_ts"], timezone.utc).strftime("%Y-%m-%d")
                by_day[day].append(u)
        closes = [parse_time(m.get("close_time")) for m in page]
        closes = [c.timestamp() for c in closes if c]
        cursor = data.get("cursor")
        if not cursor or not page or (closes and max(closes) < floor_ts):
            break
    return {day: sample_per_series(ms) for day, ms in by_day.items()}


def candles_for(client: RateLimitedClient, markets: list) -> dict:
    """Hourly (end_ts, yes_bid, yes_ask) in cents for each market's final hours."""
    out = {}
    for i in range(0, len(markets), 100):
        batch = markets[i:i + 100]
        end = max(m["close_ts"] for m in batch)
        start = min(m["close_ts"] for m in batch) - LOOKBACK_HOURS * 3600
        data = client.get("/markets/candlesticks", {
            "market_tickers": ",".join(m["ticker"] for m in batch),
            "start_ts": start, "end_ts": end, "period_interval": 60,
            "include_latest_before_start": "true"})
        for entry in data.get("markets") or []:
            points = []
            for c in entry.get("candlesticks") or []:
                bid = price_cents(c.get("yes_bid") or {}, "close")
                ask = price_cents(c.get("yes_ask") or {}, "close")
                points.append([c["end_period_ts"],
                               float(bid) if bid is not None else None,
                               float(ask) if ask is not None else None])
            out[entry["market_ticker"]] = points
    return out


def close_time_batches(markets: list, size: int = 100, max_spread_hours: int = 24) -> list:
    """Batches of markets closing near each other, so one request's window
    (48h lookback + spread) stays under Kalshi's 10,000-candle cap."""
    batches, batch = [], []
    for m in sorted(markets, key=lambda m: m["close_ts"]):
        if batch and (len(batch) == size
                      or m["close_ts"] - batch[0]["close_ts"] > max_spread_hours * 3600):
            batches.append(batch)
            batch = []
        batch.append(m)
    return batches + ([batch] if batch else [])


def collect_day(client: RateLimitedClient, day: datetime, data_dir: str = DATA_DIR,
                markets: list = None) -> str:
    path = os.path.join(data_dir, "days", f"{day:%Y-%m-%d}.jsonl")
    if os.path.exists(path):
        return f"{day:%Y-%m-%d} cached"
    if markets is None:
        markets = settled_markets_for_day(client, day)
    candles = {}
    for batch in close_time_batches(markets):
        candles.update(candles_for(client, batch))
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        for m in markets:
            m["candles"] = candles.get(m["ticker"], [])
            f.write(json.dumps(m) + "\n")
    os.replace(tmp, path)
    return f"{day:%Y-%m-%d} {len(markets)} markets"


def collect_series(client: RateLimitedClient, series_tickers: set,
                   data_dir: str = DATA_DIR) -> None:
    path = os.path.join(data_dir, "series.json")
    known = json.load(open(path)) if os.path.exists(path) else {}
    missing = sorted(series_tickers - set(known))

    def fetch(ticker):
        try:
            s = client.get(f"/series/{ticker}", {}).get("series") or {}
        except requests.exceptions.RequestException:
            return ticker, None
        return ticker, {"category": s.get("category") or "Unknown",
                        "fee_type": s.get("fee_type"),
                        "fee_multiplier": s.get("fee_multiplier")}

    with ThreadPoolExecutor(max_workers=4) as pool:
        for ticker, info in pool.map(fetch, missing):
            if info:
                known[ticker] = info
    with open(path, "w") as f:
        json.dump(known, f, indent=1)


def load_days(data_dir: str = DATA_DIR) -> list:
    folder = os.path.join(data_dir, "days")
    markets = []
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if name.endswith(".jsonl"):
            with open(os.path.join(folder, name)) as f:
                markets += [json.loads(line) for line in f]
    return markets


def cmd_collect(args) -> int:
    os.makedirs(os.path.join(args.data_dir, "days"), exist_ok=True)
    client = RateLimitedClient(per_second=args.rate)
    start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    days = [start + timedelta(days=i) for i in range((end - start).days)]
    listed = {}
    if args.historical:
        listed = historical_markets_by_day(client, start, end)
        print(f"listed {sum(map(len, listed.values()))} historical markets", flush=True)

    def collect(day):
        markets = listed.get(f"{day:%Y-%m-%d}", []) if args.historical else None
        return collect_day(client, day, args.data_dir, markets)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for line in pool.map(collect, days):
            print(line, flush=True)
    collect_series(client, {m["series"] for m in load_days(args.data_dir)}, args.data_dir)
    print("series details saved", flush=True)
    return 0


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def fee_per_contract(price: float, multiplier: Decimal) -> float:
    fee = taker_fee_cents(Decimal(str(price)), FEE_ORDER_SIZE, DEFAULT_TAKER_FEE_RATE * multiplier)
    return float(fee) / FEE_ORDER_SIZE


def quote_at(candles: list, ts: int):
    """Latest (bid, ask) from candles that ended at or before `ts`."""
    best = None
    for end_ts, bid, ask in sorted(candles, key=lambda c: c[0]):
        if end_ts <= ts:
            best = (bid, ask)
        else:
            break
    return best


def entry_reference_ts(m: dict):
    """The time entries are counted back from, using only what was known in advance.

    Markets that cannot close early close on schedule, so their close time is
    fair to use. Markets that can close early (a player prop closes the moment
    he scores) are timed from the scheduled event time instead: counting back
    from their actual close would peek at when, and so whether, the event
    happened. Markets whose timing is unknown are skipped.
    """
    if m.get("can_close_early") is False:
        return m["close_ts"]
    if m.get("can_close_early") and m.get("occurrence_ts"):
        return m["occurrence_ts"]
    return None


def trades_for(markets: list, series: dict, fixed_close_only: bool = False) -> list:
    """Every possible entry: (side, horizon, price, pnl, cost, market) per market."""
    trades = []
    for m in markets:
        reference = entry_reference_ts(m)
        if reference is None or (fixed_close_only and m.get("can_close_early") is not False):
            continue
        info = series.get(m["series"])
        if not info or (info["fee_type"] not in KNOWN_FEE_TYPES and info["fee_type"] is not None):
            continue
        multiplier = to_decimal(info.get("fee_multiplier"))
        if multiplier is None or multiplier <= 0:
            continue
        earlier = quote_at(m["candles"], reference - MOMENTUM_LOOKBACK_HOURS * 3600)
        for h in HORIZONS:
            entry_ts = reference - h * 3600
            if entry_ts >= m["close_ts"]:
                continue                  # already closed: nothing to buy at that time
            quote = quote_at(m["candles"], entry_ts)
            if not quote:
                continue
            bid, ask = quote
            move = None
            if h == 1 and earlier and None not in (bid, ask, *earlier):
                move = (bid + ask) / 2 - (earlier[0] + earlier[1]) / 2
            for side, price in (("yes", ask), ("no", 100 - bid if bid is not None else None)):
                if price is None or not 0 < price < 100:
                    continue
                fee = fee_per_contract(price, multiplier)
                payout = 100.0 if m["result"] == side else 0.0
                spread = ask - bid if None not in (bid, ask) else None
                trades.append({"side": side, "horizon": h, "price": price, "move": move,
                               "spread": spread, "early_close": bool(m.get("can_close_early")),
                               "pnl": payout - price - fee, "cost": price + fee,
                               "event": m["event_ticker"], "close_ts": m["close_ts"],
                               "category": info["category"], "series": m["series"]})
    return trades


def price_bin(price: float):
    for low, high in PRICE_BINS:
        if low <= price < high:
            return f"{low:02d}-{high:02d}c"
    return None


def roi(trades: list) -> float:
    cost = sum(t["cost"] for t in trades)
    return sum(t["pnl"] for t in trades) / cost if cost else 0.0


def event_bootstrap(trades: list, rounds: int = 400, seed: int = 7) -> tuple:
    """95% interval for ROI, resampling whole events."""
    by_event = defaultdict(list)
    for t in trades:
        by_event[t["event"]].append(t)
    groups = list(by_event.values())
    rng = random.Random(seed)
    stats = []
    for _ in range(rounds):
        pnl = cost = 0.0
        for _ in range(len(groups)):
            for t in groups[rng.randrange(len(groups))]:
                pnl += t["pnl"]
                cost += t["cost"]
        stats.append(pnl / cost if cost else 0.0)
    stats.sort()
    return stats[int(0.025 * rounds)], stats[int(0.975 * rounds) - 1]


def binomial_cdf(k: int, n: int, p: float) -> float:
    term, total = (1 - p) ** n, 0.0
    for i in range(k + 1):
        total += term
        term *= (n - i) / (i + 1) * p / (1 - p) if p < 1 else 0
    return total


def loss_rate_upper(losses: int, n: int, confidence: float = 0.95) -> float:
    """One-sided Clopper-Pearson upper bound on the true loss rate."""
    if losses >= n:
        return 1.0
    low, high = losses / n, 1.0
    for _ in range(60):
        mid = (low + high) / 2
        if binomial_cdf(losses, n, mid) > 1 - confidence:
            low = mid
        else:
            high = mid
    return high


def worst_case_roi(trades: list) -> float:
    """ROI if the loss rate were at its 95% upper bound.

    Bootstrapping cannot invent losses a sample never saw, so for expensive
    contracts, where one loss erases dozens of wins, this is the honest check.
    """
    losses = sum(t["pnl"] < 0 for t in trades)
    bound = loss_rate_upper(losses, len(trades))
    cost = sum(t["cost"] for t in trades) / len(trades)
    win_pnl = sum(t["pnl"] for t in trades if t["pnl"] > 0) / max(1, len(trades) - losses)
    return ((1 - bound) * win_pnl - bound * cost) / cost


def evaluate(trades: list, split_ts: int, min_events: int = 30) -> list:
    """Price rules: buy a side in a price band some hours before close."""
    rules = defaultdict(list)
    for t in trades:
        b = price_bin(t["price"])
        if b is None:
            continue
        for category in ("All", t["category"]):
            rules[(t["side"], b, t["horizon"], category)].append(t)
    return evaluate_rules(rules, split_ts, min_events)


def momentum_rules(trades: list) -> dict:
    """Buy a side 1h before close depending on how its YES price moved since 8h before.

    For NO entries the move is flipped, so "up" always means toward the side bought.
    """
    rules = defaultdict(list)
    for t in trades:
        if t["horizon"] != 1 or t.get("move") is None:
            continue
        move = t["move"] if t["side"] == "yes" else -t["move"]
        for low, high in MOVE_BUCKETS:
            if low <= move < high:
                bucket = f"{low:+d}..{high:+d}c"
                for category in ("All", t["category"]):
                    rules[("momentum", bucket, 1, category)].append(t)
    return rules


def credit_value(trades: list) -> list:
    """Withdrawable profit per $1 of promotional credit, by price band.

    Kalshi lets you withdraw only the profit made with credits: a win returns
    payout - cost, a loss costs you nothing of your own.
    """
    rows = []
    for low, high in PRICE_BINS:
        band = [t for t in trades if t["horizon"] == 1 and low <= t["price"] < high]
        if len(band) < 200:
            continue
        per_dollar = sum(max(t["pnl"], 0.0) / t["cost"] for t in band) / len(band)
        win_rate = sum(t["pnl"] > 0 for t in band) / len(band)
        rows.append((f"{low:02d}-{high:02d}c", per_dollar, win_rate, len(band)))
    return rows


def evaluate_rules(rules: dict, split_ts: int, min_events: int = 30) -> list:
    """Split each rule's trades by time; keep rules with enough events on both sides."""
    results = []
    for key, group in rules.items():
        train = [t for t in group if t["close_ts"] < split_ts]
        test = [t for t in group if t["close_ts"] >= split_ts]
        train_events = len({t["event"] for t in train})
        test_events = len({t["event"] for t in test})
        if train_events < min_events or test_events < min_events:
            continue
        results.append({"rule": key, "train_roi": roi(train), "train_n": len(train),
                        "train_events": train_events, "test_roi": roi(test),
                        "test_n": len(test), "test_events": test_events,
                        "train": train, "test": test})
    return results


def h1_trades(trades: list) -> list:
    """Pre-registered rule H1 (2026-09-26): buy YES at a 40-69.99c ask, spread <= 2c,
    1h before close."""
    return [t for t in trades if t["side"] == "yes" and t["horizon"] == 1
            and 40 <= t["price"] < 70 and t["spread"] is not None and t["spread"] <= 2]


def cmd_h1(args) -> int:
    markets = load_days(args.data_dir)
    series = json.load(open(os.path.join(args.data_dir, "series.json")))
    trades = h1_trades(trades_for(markets, series))
    if not trades:
        print("No H1 entries in this data.")
        return 1
    low, high = event_bootstrap(trades, rounds=1000)
    wins = sum(t["pnl"] > 0 for t in trades)
    first = datetime.fromtimestamp(min(t["close_ts"] for t in trades), timezone.utc)
    last = datetime.fromtimestamp(max(t["close_ts"] for t in trades), timezone.utc)
    print(f"H1 on {args.data_dir}: {len(trades)} entries in {len({t['event'] for t in trades})} "
          f"events, {first:%Y-%m-%d} to {last:%Y-%m-%d}")
    print(f"  won {wins / len(trades):.1%}, avg cost {sum(t['cost'] for t in trades) / len(trades):.1f}c, "
          f"ROI {roi(trades):+.2%}  95% interval by event [{low:+.2%}, {high:+.2%}]")
    by_category = defaultdict(list)
    for t in trades:
        by_category[t["category"]].append(t)
    for category, group in sorted(by_category.items(), key=lambda kv: -len(kv[1])):
        print(f"  {category:24} {len(group):6} entries  ROI {roi(group):+.2%}")
    return 0


def cmd_evaluate(args) -> int:
    markets = load_days(args.data_dir)
    series = json.load(open(os.path.join(args.data_dir, "series.json")))
    trades = trades_for(markets, series, args.fixed_close_only)
    if args.max_spread is not None:
        trades = [t for t in trades if t["spread"] is not None and t["spread"] <= args.max_spread]
    if not trades:
        print("No data. Run: python backtest.py collect --start YYYY-MM-DD --end YYYY-MM-DD")
        return 1
    closes = sorted(t["close_ts"] for t in trades)
    split_ts = closes[int(len(closes) * args.train_fraction)]
    split = datetime.fromtimestamp(split_ts, timezone.utc)
    if args.max_spread is not None:
        print(f"Only entries where the bid-ask spread was at most {args.max_spread:g}c.")
    print(f"{len(markets)} markets, {len(trades)} possible entries; "
          f"train before {split:%Y-%m-%d %H:%M} UTC, test after.\n")

    results = evaluate(trades, split_ts, args.min_events)

    print("Everything, by side and price (entry 1-24h before close, all categories):")
    print(f"  {'side':4} {'price':7} {'horizon':>7}  {'train ROI':>9} {'test ROI':>9} {'test events':>11}")
    for r in sorted((r for r in results if r["rule"][3] == "All" and r["rule"][2] in (1, 24)),
                    key=lambda r: (r["rule"][0], r["rule"][1], r["rule"][2])):
        side, b, h, _ = r["rule"]
        print(f"  {side:4} {b:7} {h:>6}h  {r['train_roi']:>+9.1%} {r['test_roi']:>+9.1%} "
              f"{r['test_events']:>11}")

    print("\nMomentum: buy 1h before close, by how far the side's price moved since 8h before:")
    momentum = evaluate_rules(momentum_rules(trades), split_ts, args.min_events)
    for r in sorted((r for r in momentum if r["rule"][3] == "All"), key=lambda r: r["rule"][1]):
        print(f"  moved {r['rule'][1]:>11}  train {r['train_roi']:+.1%}  test {r['test_roi']:+.1%}  "
              f"({r['test_events']} test events)")
    results += momentum

    print("\nPromotional credit: withdrawable profit per $1 of credit, by price (1h before close):")
    for band, per_dollar, win_rate, n in credit_value(trades):
        print(f"  {band:7}  ${per_dollar:.3f} per $1   wins {win_rate:.0%}   ({n} entries)")

    # Rules that were clearly profitable on training data (lower CI > 0), then tested.
    candidates = []
    for r in results:
        if r["train_roi"] <= 0:
            continue
        low, high = event_bootstrap(r["train"])
        if low > 0:
            r["train_ci"] = (low, high)
            candidates.append(r)
    print(f"\n{len(results)} rules had enough data; {len(candidates)} were profitable on "
          f"training data with a 95% interval above zero. Their out-of-sample results:")
    survivors = 0
    for r in sorted(candidates, key=lambda r: -r["test_roi"]):
        low, high = event_bootstrap(r["test"])
        worst = worst_case_roi(r["test"])
        ok = low > 0 and worst > 0
        survivors += ok
        side, b, h, cat = r["rule"]
        what = f"momentum {b}" if side == "momentum" else f"buy {side.upper():3} at {b}"
        print(f"  {'PASS' if ok else 'fail'}  {what} {h:>2}h before close, "
              f"{cat[:22]:22} train {r['train_roi']:+.1%}  test {r['test_roi']:+.1%} "
              f"[{low:+.1%}, {high:+.1%}]  worst case {worst:+.1%}  "
              f"{sum(t['pnl'] < 0 for t in r['test'])}/{len(r['test'])} lost  {r['test_events']} events")
    print(f"\n{survivors} rule(s) held up out of sample (test 95% interval above zero, and still "
          f"profitable at the 95% upper bound on the loss rate).")
    print("Several hundred rules were tried, so expect a few to pass by chance; forward-test before using any.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("collect", help="download settled markets and their final prices")
    c.add_argument("--start", required=True, help="first settlement day, YYYY-MM-DD (UTC)")
    c.add_argument("--end", required=True, help="day after the last settlement day")
    c.add_argument("--rate", type=float, default=12.0, help="max requests per second")
    c.add_argument("--workers", type=int, default=4)
    c.add_argument("--historical", action="store_true",
                   help="use Kalshi's historical endpoints (markets settled before its cutoff)")
    e = sub.add_parser("evaluate", help="test rules on the collected data")
    e.add_argument("--train-fraction", type=float, default=0.65)
    e.add_argument("--min-events", type=int, default=30)
    e.add_argument("--fixed-close-only", action="store_true",
                   help="only markets that cannot close early (close time known in advance)")
    e.add_argument("--max-spread", type=float, default=None,
                   help="only enter when the bid-ask spread is at most this many cents")
    h = sub.add_parser("h1", help="score the pre-registered H1 rule")
    for p in (c, e, h):
        p.add_argument("--data-dir", default=DATA_DIR)
    args = parser.parse_args(argv)
    return {"collect": cmd_collect, "evaluate": cmd_evaluate, "h1": cmd_h1}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
