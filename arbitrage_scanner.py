#!/usr/bin/env python3
"""
Kalshi Arbitrage Scanner
========================
Scans Kalshi's public market data (Kalshi is the exchange behind Robinhood's
prediction markets) for sets of contracts whose combined cost, after fees, is
below the amount they are guaranteed to pay at settlement. Buying every leg of
such a set locks in a profit however the event resolves.

Three structures are checked:

1. NO basket (mutually exclusive events): at most one market in the event can
   resolve YES, so buying NO on k of its markets pays at least (k - 1) x $1.
2. YES basket (mutually exclusive events): if the markets cover every possible
   outcome, exactly one resolves YES, so buying YES on all of them pays $1.
   The API cannot tell us whether the outcomes are exhaustive, so these are
   flagged for a manual rules check.
3. Strike ladder (e.g. "BTC above $X" at several strikes, same expiry): YES on
   a lower strike plus NO on a higher strike pays at least $1 wherever the
   price lands.

Only public, unauthenticated endpoints are used. Nothing here places orders.

Usage:
    python arbitrage_scanner.py --closing-within-hours 24
    python arbitrage_scanner.py --fixture tests/fixtures/sample_markets.json
"""

import argparse
import json
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation
from itertools import combinations
from typing import Optional

import requests


BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

HUNDRED = Decimal(100)

# Kalshi taker fee per order: round_up(M x rate x C x P x (1 - P)) to the next
# cent, with P the price in dollars, C the number of contracts and M the
# series' fee multiplier (1 by default; e.g. 0.5 for S&P 500 index markets).
DEFAULT_TAKER_FEE_RATE = Decimal("0.07")

# Series fee_type values priced by the formula above. Makers may also pay a fee
# under "quadratic_with_maker_fees", but this scanner only ever takes.
KNOWN_FEE_TYPES = {"quadratic", "quadratic_with_maker_fees"}

# Market statuses that accept orders ("open" is the query filter name,
# "active" is what market objects report).
OPEN_STATUSES = {"active", "open"}

# YES pays when the underlying ends above floor_strike / below cap_strike.
ABOVE_STRIKE_TYPES = {"greater", "greater_or_equal"}
BELOW_STRIKE_TYPES = {"less", "less_or_equal"}


# ---------------------------------------------------------------------------
# Prices and fees
# ---------------------------------------------------------------------------

def to_decimal(value) -> Optional[Decimal]:
    """Parse a number or numeric string, returning None when absent/invalid."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def price_cents(raw: dict, name: str) -> Optional[Decimal]:
    """Read a price field in cents, preferring the `<name>_dollars` string."""
    dollars = to_decimal(raw.get(f"{name}_dollars"))
    if dollars is not None:
        return dollars * HUNDRED
    return to_decimal(raw.get(name))


def tradable(price: Optional[Decimal]) -> bool:
    """A quote of 0 or 100 cents means there is no real order at that price."""
    return price is not None and 0 < price < HUNDRED


def taker_fee_cents(price: Decimal, contracts: int,
                    rate: Decimal = DEFAULT_TAKER_FEE_RATE,
                    extra_per_contract: Decimal = Decimal(0)) -> Decimal:
    """Fee in cents for a single order of `contracts` at `price` cents."""
    if contracts <= 0 or not tradable(price):
        return Decimal(0)
    exchange_fee = rate * contracts * price * (HUNDRED - price) / HUNDRED
    return exchange_fee.to_integral_value(rounding=ROUND_CEILING) + extra_per_contract * contracts


def dollars(cents: Decimal) -> str:
    return f"${cents / HUNDRED:,.2f}"


def num(value: Decimal) -> str:
    """Plain decimal text without trailing zeros: 55.0000 -> 55, 45.50 -> 45.5."""
    return format(value.normalize(), "f")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Quote:
    """Top-of-book snapshot for one market."""
    ticker: str
    event_ticker: str
    title: str
    status: str
    yes_bid: Optional[Decimal]
    yes_ask: Optional[Decimal]
    no_bid: Optional[Decimal]
    no_ask: Optional[Decimal]
    close_time: Optional[datetime]
    strike_type: Optional[str]
    floor_strike: Optional[Decimal]
    cap_strike: Optional[Decimal]

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES


def parse_time(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_quote(raw: dict) -> Quote:
    yes_bid = price_cents(raw, "yes_bid")
    yes_ask = price_cents(raw, "yes_ask")
    no_bid = price_cents(raw, "no_bid")
    no_ask = price_cents(raw, "no_ask")
    # YES and NO share one book: a NO ask is the complement of the best YES bid.
    if no_ask is None and yes_bid is not None:
        no_ask = HUNDRED - yes_bid
    if no_bid is None and yes_ask is not None:
        no_bid = HUNDRED - yes_ask

    return Quote(
        ticker=raw.get("ticker", ""),
        event_ticker=raw.get("event_ticker", ""),
        title=raw.get("title") or raw.get("subtitle") or "",
        status=raw.get("status", ""),
        yes_bid=yes_bid,
        yes_ask=yes_ask,
        no_bid=no_bid,
        no_ask=no_ask,
        close_time=parse_time(raw.get("close_time")),
        strike_type=raw.get("strike_type"),
        floor_strike=to_decimal(raw.get("floor_strike")),
        cap_strike=to_decimal(raw.get("cap_strike")),
    )


@dataclass
class Leg:
    ticker: str
    side: str                        # "yes" or "no"
    price: Decimal                   # cents per contract
    fee: Decimal = Decimal(0)        # cents for the whole order
    depth: Optional[Decimal] = None  # contracts offered at `price`, once checked


@dataclass
class Opportunity:
    kind: str
    event_ticker: str
    title: str
    legs: list
    payout_per_set: Decimal          # guaranteed minimum payout per set, cents
    contracts: int                   # sets to buy (one contract per leg per set)
    close_time: Optional[datetime]
    caveat: str = ""
    depth_checked: bool = False

    @property
    def cost(self) -> Decimal:
        return sum((leg.price * self.contracts + leg.fee for leg in self.legs), Decimal(0))

    @property
    def payout(self) -> Decimal:
        return self.payout_per_set * self.contracts

    @property
    def profit(self) -> Decimal:
        return self.payout - self.cost

    @property
    def return_pct(self) -> Decimal:
        return self.profit / self.cost * HUNDRED if self.cost else Decimal(0)

    def hours_to_close(self, now: datetime) -> Optional[float]:
        if not self.close_time:
            return None
        return (self.close_time - now).total_seconds() / 3600

    def to_dict(self, now: datetime) -> dict:
        return {
            "kind": self.kind,
            "event_ticker": self.event_ticker,
            "title": self.title,
            "contracts": self.contracts,
            "legs": [
                {"ticker": leg.ticker, "side": leg.side, "price_cents": num(leg.price),
                 "fee_cents": num(leg.fee),
                 "depth": num(leg.depth) if leg.depth is not None else None}
                for leg in self.legs
            ],
            "cost_cents": num(self.cost),
            "guaranteed_payout_cents": num(self.payout),
            "profit_cents": num(self.profit),
            "return_pct": f"{self.return_pct:.2f}",
            "close_time": self.close_time.isoformat() if self.close_time else None,
            "hours_to_close": self.hours_to_close(now),
            "depth_checked": self.depth_checked,
            "caveat": self.caveat,
        }


@dataclass
class FeeModel:
    rate: Decimal = DEFAULT_TAKER_FEE_RATE
    extra_per_contract: Decimal = Decimal(0)
    multiplier: Decimal = Decimal(1)

    def fee(self, price: Decimal, contracts: int) -> Decimal:
        return taker_fee_cents(price, contracts, self.rate * self.multiplier,
                               self.extra_per_contract)

    def priced(self, opp: Opportunity, contracts: int) -> Opportunity:
        """Return `opp` sized to `contracts` with every leg's fee recomputed."""
        legs = [replace(leg, fee=self.fee(leg.price, contracts)) for leg in opp.legs]
        return replace(opp, legs=legs, contracts=contracts)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

def find_no_basket(event_ticker: str, title: str, quotes: list, contracts: int,
                   fees: FeeModel) -> Optional[Opportunity]:
    """NO on several markets of a mutually exclusive event.

    At most one of the k markets bought can resolve YES, so the basket pays at
    least (k - 1) x $1. Profit = sum over legs of ((100 - no_ask) x C - fee)
    minus 100 x C, so only legs whose term is positive are worth including.
    """
    legs = []
    for q in quotes:
        if not q.is_open or not tradable(q.no_ask):
            continue
        fee = fees.fee(q.no_ask, contracts)
        if (HUNDRED - q.no_ask) * contracts - fee > 0:
            legs.append(Leg(q.ticker, "no", q.no_ask, fee))
    if len(legs) < 2:
        return None
    opp = Opportunity(
        kind="no_basket",
        event_ticker=event_ticker,
        title=title,
        legs=legs,
        payout_per_set=(len(legs) - 1) * HUNDRED,
        contracts=contracts,
        close_time=_latest_close(quotes),
        caveat="Relies on the event being mutually exclusive (at most one YES).",
    )
    return opp if opp.profit > 0 else None


def find_yes_basket(event_ticker: str, title: str, quotes: list, contracts: int,
                    fees: FeeModel) -> Optional[Opportunity]:
    """YES on every market of a mutually exclusive event.

    `quotes` must be the event's complete market list. Pays $1 only if the
    markets cover every possible outcome, which the API does not report.
    """
    if len(quotes) < 2 or any(not q.is_open or not tradable(q.yes_ask) for q in quotes):
        return None
    legs = [Leg(q.ticker, "yes", q.yes_ask, fees.fee(q.yes_ask, contracts)) for q in quotes]
    opp = Opportunity(
        kind="yes_basket",
        event_ticker=event_ticker,
        title=title,
        legs=legs,
        payout_per_set=HUNDRED,
        contracts=contracts,
        close_time=_latest_close(quotes),
        caveat=("Risk-free ONLY if these markets cover every possible outcome "
                "(no unlisted 'other' result). Read the event rules first."),
    )
    return opp if opp.profit > 0 else None


def find_strike_ladders(event_ticker: str, title: str, quotes: list, contracts: int,
                        fees: FeeModel) -> list:
    """YES on the looser strike plus NO on the stricter one, same expiry.

    For "above" markets with strikes a < b: YES(>a) pays when the value is
    above a, NO(>b) pays when it is at or below b, so one always pays.
    For "below" markets with a < b: YES(<b) and NO(<a) cover everything.
    """
    groups = defaultdict(list)
    for q in quotes:
        if q.is_open and q.strike_type in ABOVE_STRIKE_TYPES | BELOW_STRIKE_TYPES:
            groups[(q.strike_type, q.close_time)].append(q)

    found = []
    for (strike_type, close_time), group in groups.items():
        above = strike_type in ABOVE_STRIKE_TYPES
        keyed = [(q.floor_strike if above else q.cap_strike, q) for q in group]
        keyed = sorted(((k, q) for k, q in keyed if k is not None), key=lambda kq: kq[0])
        for (low_strike, low), (high_strike, high) in combinations(keyed, 2):
            if low_strike >= high_strike:
                continue
            yes_q, no_q = (low, high) if above else (high, low)
            if not (tradable(yes_q.yes_ask) and tradable(no_q.no_ask)):
                continue
            opp = Opportunity(
                kind="strike_ladder",
                event_ticker=event_ticker,
                title=title,
                legs=[Leg(yes_q.ticker, "yes", yes_q.yes_ask, fees.fee(yes_q.yes_ask, contracts)),
                      Leg(no_q.ticker, "no", no_q.no_ask, fees.fee(no_q.no_ask, contracts))],
                payout_per_set=HUNDRED,
                contracts=contracts,
                close_time=close_time,
                caveat="Both legs must settle on the same underlying value (same event and expiry).",
            )
            if opp.profit > 0:
                found.append(opp)
    return found


def fee_multiplier(event: dict, client, series_cache: dict) -> Optional[Decimal]:
    """Taker fee multiplier for an event: its own override, else its series'.

    Returns None when the multiplier cannot be confirmed, so no opportunity is
    ever reported as locked-in profit on a guessed fee.
    """
    override = to_decimal(event.get("fee_multiplier_override"))
    if override is not None:
        return override
    series_ticker = event.get("series_ticker")
    if not series_ticker:
        return None
    if series_ticker not in series_cache:
        try:
            series_cache[series_ticker] = client.get_series(series_ticker)
        except requests.exceptions.RequestException:
            series_cache[series_ticker] = {}
    series = series_cache[series_ticker]
    fee_type = series.get("fee_type")
    if fee_type is not None and fee_type not in KNOWN_FEE_TYPES:
        return None
    multiplier = to_decimal(series.get("fee_multiplier"))
    return multiplier if multiplier is not None and multiplier >= 0 else None


def _latest_close(quotes: list) -> Optional[datetime]:
    times = [q.close_time for q in quotes if q.close_time]
    return max(times) if times else None


def basket_prescreen(quotes: list) -> bool:
    """Cheap pre-fee check so we only fetch event details for plausible baskets."""
    open_quotes = [q for q in quotes if q.is_open]
    if len(open_quotes) < 2:
        return False
    no_edge = sum((HUNDRED - q.no_ask for q in open_quotes if tradable(q.no_ask)), Decimal(0))
    if no_edge > HUNDRED:
        return True
    yes_asks = [q.yes_ask for q in open_quotes]
    return all(tradable(p) for p in yes_asks) and sum(yes_asks) < HUNDRED


# ---------------------------------------------------------------------------
# Order book depth
# ---------------------------------------------------------------------------

def best_bid(levels) -> Optional[tuple]:
    """Highest (price_cents, quantity) among [[price, qty], ...] levels."""
    parsed = []
    for level in levels or []:
        if len(level) < 2:
            continue
        price, qty = to_decimal(level[0]), to_decimal(level[1])
        if price is not None and qty is not None and qty > 0:
            parsed.append((price, qty))
    return max(parsed, key=lambda pq: pq[0]) if parsed else None


def best_ask_from_orderbook(orderbook_response: dict, side: str) -> Optional[tuple]:
    """(ask_cents, quantity) for buying `side`, derived from the opposite side's bids.

    Kalshi books list bids only: buying YES at p means matching a NO bid at 100 - p.
    Handles both integer-cent levels ("yes"/"no") and dollar-string levels
    ("yes_dollars"/"no_dollars").
    """
    book = orderbook_response.get("orderbook") or orderbook_response.get("orderbook_fp") or {}
    opposite = "no" if side == "yes" else "yes"
    dollar_levels = book.get(f"{opposite}_dollars")
    if dollar_levels:
        top = best_bid(dollar_levels)
        top = (top[0] * HUNDRED, top[1]) if top else None
    else:
        top = best_bid(book.get(opposite))
    if not top:
        return None
    return HUNDRED - top[0], top[1]


def check_depth(opp: Opportunity, client, fees: FeeModel) -> Optional[Opportunity]:
    """Re-price every leg from its live order book and size to available depth.

    Uses only the best price level, so the size is conservative. Returns None
    when a leg has no offers or the set is no longer profitable.
    """
    legs = []
    for leg in opp.legs:
        ask = best_ask_from_orderbook(client.get_orderbook(leg.ticker), leg.side)
        if ask is None or not tradable(ask[0]):
            return None
        legs.append(replace(leg, price=ask[0], depth=ask[1]))

    max_sets = int(min(leg.depth for leg in legs).to_integral_value(rounding=ROUND_FLOOR))
    size = min(opp.contracts, max_sets)
    if size <= 0:
        return None
    checked = fees.priced(replace(opp, legs=legs, depth_checked=True), size)
    return checked if checked.profit > 0 else None


# ---------------------------------------------------------------------------
# API clients
# ---------------------------------------------------------------------------

class KalshiPublicClient:
    """Read-only client for Kalshi's public market data endpoints."""

    def __init__(self, base_url: str = BASE_URL, pause: float = 0.1, retries: int = 4):
        self.base_url = base_url
        self.pause = pause
        self.retries = retries
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "PredictionMarketAnalyzer/1.0",
        })

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        delay = 1.0
        for attempt in range(self.retries + 1):
            response = self.session.get(f"{self.base_url}{path}", params=params, timeout=30)
            if response.status_code == 429 and attempt < self.retries:
                time.sleep(delay)
                delay *= 2
                continue
            response.raise_for_status()
            time.sleep(self.pause)
            return response.json()
        raise RuntimeError("unreachable")

    def get_open_markets(self, max_close_ts: Optional[int] = None, max_pages: int = 20) -> list:
        markets, cursor = [], None
        for _ in range(max_pages):
            params = {"status": "open", "limit": 1000, "mve_filter": "exclude"}
            if max_close_ts:
                params["max_close_ts"] = max_close_ts
            if cursor:
                params["cursor"] = cursor
            data = self._get("/markets", params)
            markets.extend(data.get("markets") or [])
            cursor = data.get("cursor")
            if not cursor:
                break
        return markets

    def get_event(self, event_ticker: str) -> dict:
        data = self._get(f"/events/{event_ticker}", {"with_nested_markets": "true"})
        event = dict(data.get("event") or {})
        if not event.get("markets") and data.get("markets"):
            event["markets"] = data["markets"]
        return event

    def get_series(self, series_ticker: str) -> dict:
        return self._get(f"/series/{series_ticker}").get("series") or {}

    def get_orderbook(self, ticker: str) -> dict:
        return self._get(f"/markets/{ticker}/orderbook")


class FixtureClient:
    """Serves the same calls from a saved JSON file, for offline runs and tests."""

    def __init__(self, data: dict):
        self.data = data

    @classmethod
    def from_file(cls, path: str) -> "FixtureClient":
        with open(path) as f:
            return cls(json.load(f))

    def get_open_markets(self, max_close_ts: Optional[int] = None, max_pages: int = 20) -> list:
        markets = self.data.get("markets", [])
        if max_close_ts is None:
            return markets
        return [m for m in markets
                if (t := parse_time(m.get("close_time"))) and t.timestamp() <= max_close_ts]

    def get_event(self, event_ticker: str) -> dict:
        return self.data.get("events", {}).get(event_ticker, {})

    def get_series(self, series_ticker: str) -> dict:
        return self.data.get("series", {}).get(series_ticker, {})

    def get_orderbook(self, ticker: str) -> dict:
        return self.data.get("orderbooks", {}).get(ticker, {})


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

def scan(client, contracts: int = 10, fees: Optional[FeeModel] = None,
         closing_within_hours: Optional[float] = None, max_pages: int = 20,
         depth_check: bool = True, now: Optional[datetime] = None,
         skipped: Optional[list] = None) -> list:
    """Return profitable opportunities, best first.

    Events whose fee multiplier cannot be confirmed are left out and their
    tickers appended to `skipped`, if given.
    """
    fees = fees or FeeModel()
    no_fees = FeeModel(rate=Decimal(0))
    now = now or datetime.now(timezone.utc)
    max_close_ts = None
    if closing_within_hours is not None:
        max_close_ts = int((now + timedelta(hours=closing_within_hours)).timestamp())

    by_event = defaultdict(list)
    for raw in client.get_open_markets(max_close_ts=max_close_ts, max_pages=max_pages):
        quote = parse_quote(raw)
        if quote.close_time and quote.close_time <= now:
            continue
        by_event[quote.event_ticker].append(quote)

    candidates, event_fees, series_cache = [], {}, {}
    for event_ticker, quotes in by_event.items():
        title = quotes[0].title
        # Pre-fee screens first, so event and series details are only fetched
        # for the few events that could possibly pay.
        maybe_ladder = bool(find_strike_ladders(event_ticker, title, quotes, contracts, no_fees))
        maybe_basket = basket_prescreen(quotes)
        if not (maybe_ladder or maybe_basket):
            continue

        event = client.get_event(event_ticker)
        multiplier = fee_multiplier(event, client, series_cache)
        if multiplier is None:
            if skipped is not None:
                skipped.append(event_ticker)
            continue
        event_fees[event_ticker] = replace(fees, multiplier=multiplier)
        title = event.get("title") or title
        found = []

        if maybe_ladder:
            found += find_strike_ladders(event_ticker, title, quotes, contracts,
                                         event_fees[event_ticker])
        if maybe_basket and event.get("mutually_exclusive"):
            found.append(find_no_basket(event_ticker, title, quotes, contracts,
                                        event_fees[event_ticker]))
            # A YES basket is only safe over the event's complete market list, which
            # `quotes` may not be (time window, page limit), so use the event's own.
            all_quotes = [parse_quote(m) for m in event.get("markets") or []]
            found.append(find_yes_basket(event_ticker, title, all_quotes, contracts,
                                         event_fees[event_ticker]))
        candidates += [opp for opp in found if opp]

    if depth_check:
        candidates = [c for c in (check_depth(c, client, event_fees[c.event_ticker])
                                  for c in candidates) if c]

    candidates.sort(key=lambda o: (o.kind == "yes_basket", -o.profit))
    return candidates


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def format_opportunity(rank: int, opp: Opportunity, now: datetime) -> str:
    hours = opp.hours_to_close(now)
    closes = f"{hours:.1f}h" if hours is not None else "unknown"
    lines = [
        f"#{rank} [{opp.kind}] {opp.event_ticker} - {opp.title}",
        f"    Buy {opp.contracts} of each leg"
        + ("" if opp.depth_checked else " (order book depth NOT checked)") + ":",
    ]
    for leg in opp.legs:
        depth = f", {num(leg.depth)} available" if leg.depth is not None else ""
        lines.append(f"      {leg.side.upper():3} {leg.ticker} @ {num(leg.price)}c "
                     f"(fee {dollars(leg.fee)}{depth})")
    lines += [
        f"    Cost {dollars(opp.cost)} -> guaranteed payout {dollars(opp.payout)} "
        f"= profit {dollars(opp.profit)} ({opp.return_pct:.2f}%), closes in {closes}",
        f"    Caveat: {opp.caveat}",
    ]
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--contracts", type=int, default=10,
                        help="sets to size each opportunity for (default 10)")
    parser.add_argument("--fee-rate", type=Decimal, default=DEFAULT_TAKER_FEE_RATE,
                        help="Kalshi taker fee coefficient (default 0.07)")
    parser.add_argument("--extra-fee-cents", type=Decimal, default=Decimal(0),
                        help="broker fee per contract on top of Kalshi's, in cents")
    parser.add_argument("--closing-within-hours", type=float, default=None,
                        help="only markets that close within this many hours")
    parser.add_argument("--max-pages", type=int, default=20,
                        help="pages of 1000 markets to fetch (default 20)")
    parser.add_argument("--no-depth-check", action="store_true",
                        help="skip re-pricing candidates from live order books")
    parser.add_argument("--base-url", default=BASE_URL,
                        help=f"Kalshi API base URL (default {BASE_URL})")
    parser.add_argument("--fixture", help="read market data from a JSON file instead of the API")
    parser.add_argument("--json", dest="json_path", help="also write results to this JSON file")
    args = parser.parse_args(argv)

    client = (FixtureClient.from_file(args.fixture) if args.fixture
              else KalshiPublicClient(base_url=args.base_url))
    fees = FeeModel(rate=args.fee_rate, extra_per_contract=args.extra_fee_cents)
    now = datetime.now(timezone.utc)

    skipped = []
    try:
        opportunities = scan(client, contracts=args.contracts, fees=fees,
                             closing_within_hours=args.closing_within_hours,
                             max_pages=args.max_pages, depth_check=not args.no_depth_check,
                             now=now, skipped=skipped)
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Kalshi data: {e}", file=sys.stderr)
        return 1

    print("=" * 80)
    print(f"KALSHI ARBITRAGE SCAN - {now.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Fees: series multiplier x {args.fee_rate} x C x P x (1-P), rounded up per order"
          + (f", plus {args.extra_fee_cents}c/contract broker fee" if args.extra_fee_cents else ""))
    print("=" * 80)
    if not opportunities:
        print("No fee-adjusted arbitrage found. That is the normal result: these gaps are")
        print("rare and close fast. Re-run near busy periods or when markets are about to close.")
    for rank, opp in enumerate(opportunities, 1):
        print()
        print(format_opportunity(rank, opp, now))
    if skipped:
        print(f"\nSkipped {len(skipped)} possible event(s) whose fee multiplier could not be "
              f"confirmed: {', '.join(skipped[:10])}{' ...' if len(skipped) > 10 else ''}")

    if args.json_path:
        with open(args.json_path, "w") as f:
            json.dump({"scanned_at": now.isoformat(),
                       "opportunities": [o.to_dict(now) for o in opportunities],
                       "skipped_unconfirmed_fees": skipped}, f, indent=2)
        print(f"\nSaved to {args.json_path}")

    print("\nPrices move between the scan and your order. Place limit orders at the")
    print("listed prices, fill the thinnest leg first, and never leave a set half-filled.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
