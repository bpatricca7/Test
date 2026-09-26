#!/usr/bin/env python3
"""
Kalshi Liquidity Reward Bot
===========================
Earns rewards from Kalshi's Liquidity Incentive Program by completing the
empty side of "pinned" markets.

Kalshi pays each liquidity program's pool to resting orders near the top of
the book, but a snapshot only counts when BOTH sides have at least the
program's Target Size resting. In fast hourly markets (e.g. Miami temperature)
many strikes are pinned: one side is bid at 97-98c and the other side is empty,
so no snapshot counts and the pool goes unpaid. A cheap post-only bid at 1c on
the empty side, sized just above the Target, makes those snapshots count. Under
the published scoring (help.kalshi.com article 13823851), the only order on a
side receives that side's whole score: half the pool.

Everything here is a DRY RUN unless you pass --live. Order placement uses your
own Kalshi API key (kalshi.com/account/profile -> API Keys -> Create New API Key;
the private key downloads as a .txt file); nothing is ever sent without it.

    python3 lip_bot.py plan                                 # what it would do now (no key needed)
    python3 lip_bot.py run --key-id ID --key-file key.txt   # checks the key, then a dry run
    python3 lip_bot.py run --key-id ID --key-file key.txt --live         # real money

(On Windows type "py" instead of "python3". --demo needs a separate account and key
created at demo.kalshi.co: production keys do not work there.)

Safeguards:
  * post-only orders only, each with an exchange-side expiry at its program's end;
  * resting collateral never exceeds min(--max-capital, fill budget left), so even
    if every resting order filled at once, spend stays within --max-fill-spend;
  * fills count against --max-fill-spend for the whole UTC day, across restarts;
  * it manages only its own orders (client_order_id prefix "lipbot-") in the
    series it runs, and cancels them on exit, Ctrl-C, SIGTERM, SIGHUP or Ctrl-Break.
Kalshi can change or end the program, or revoke participants it judges abusive,
at any time.
"""

import argparse
import base64
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import requests

from arbitrage_scanner import parse_time, to_decimal


PROD_URL = "https://api.elections.kalshi.com/trade-api/v2"
DEMO_URL = "https://external-api.demo.kalshi.co/trade-api/v2"
ORDER_PREFIX = "lipbot-"
ONE_CENT = Decimal("0.01")


# ---------------------------------------------------------------------------
# API access
# ---------------------------------------------------------------------------

class Signer:
    """Signs requests the way Kalshi expects: base64 signature of
    f"{timestamp_ms}{METHOD}{/trade-api/v2/... path without query}", using
    RSA-PSS/SHA-256 for RSA keys or Ed25519 directly."""

    def __init__(self, sign_bytes):
        self.sign_bytes = sign_bytes

    @classmethod
    def from_pem_file(cls, path: str) -> "Signer":
        with open(path, "rb") as f:          # a missing file is reported before any import
            pem = f.read()
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        key = serialization.load_pem_private_key(pem, password=None)
        if isinstance(key, Ed25519PrivateKey):
            return cls(key.sign)
        return cls(lambda message: key.sign(
            message,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256()))

    @staticmethod
    def message(timestamp_ms: int, method: str, path: str) -> bytes:
        return f"{timestamp_ms}{method.upper()}{path.split('?')[0]}".encode()

    def headers(self, key_id: str, method: str, path: str, timestamp_ms: int = None) -> dict:
        timestamp_ms = timestamp_ms or int(time.time() * 1000)
        signature = self.sign_bytes(self.message(timestamp_ms, method, path))
        return {"KALSHI-ACCESS-KEY": key_id,
                "KALSHI-ACCESS-TIMESTAMP": str(timestamp_ms),
                "KALSHI-ACCESS-SIGNATURE": base64.b64encode(signature).decode()}


class KalshiClient:
    """Minimal Kalshi API client: public reads, plus signed portfolio calls."""

    def __init__(self, base_url: str = PROD_URL, key_id: str = None, signer: Signer = None,
                 pause: float = 0.12):
        self.base_url = base_url.rstrip("/")
        self.prefix = "/" + self.base_url.split("/", 3)[3]      # "/trade-api/v2"
        self.key_id = key_id
        self.signer = signer
        self.pause = pause
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})

    def request(self, method: str, path: str, params: dict = None, body: dict = None,
                signed: bool = False) -> dict:
        headers = {}
        if signed:
            if not (self.key_id and self.signer):
                raise RuntimeError("this call needs --key-id and --key-file")
            headers = self.signer.headers(self.key_id, method, self.prefix + path)
        delay = 1.0
        for attempt in range(5):
            response = self.session.request(method, self.base_url + path, params=params,
                                            json=body, headers=headers, timeout=30)
            if response.status_code == 429 and attempt < 4:
                time.sleep(delay)
                delay *= 2
                if signed:
                    headers = self.signer.headers(self.key_id, method, self.prefix + path)
                continue
            if response.status_code >= 400:
                raise requests.exceptions.HTTPError(
                    f"{response.status_code} {method} {path}: {response.text[:300]}",
                    response=response)
            time.sleep(self.pause)
            return response.json() if response.content else {}
        raise RuntimeError("unreachable")

    def paged(self, path: str, params: dict, key: str, signed: bool = False) -> list:
        items, cursor = [], None
        while True:
            page = dict(params, cursor=cursor) if cursor else dict(params)
            data = self.request("GET", path, page, signed=signed)
            items += data.get(key) or []
            cursor = data.get("cursor") or data.get("next_cursor")
            if not cursor:
                return items

    # Public data
    def liquidity_programs(self) -> list:
        return self.paged("/incentive_programs",
                          {"status": "active", "type": "liquidity", "limit": 10000},
                          "incentive_programs")

    def orderbook(self, ticker: str) -> dict:
        data = self.request("GET", f"/markets/{ticker}/orderbook")
        return data.get("orderbook_fp") or data.get("orderbook") or {}

    # Signed portfolio calls
    def balance(self) -> Decimal:
        """Cash available on the default exchange (index 0), where these markets trade."""
        data = self.request("GET", "/portfolio/balance", {"exchange_index": 0}, signed=True)
        dollars = to_decimal(data.get("balance_dollars"))
        return dollars if dollars is not None else Decimal(data.get("balance") or 0) / 100

    def resting_orders(self) -> list:
        return self.paged("/portfolio/orders", {"status": "resting", "limit": 1000}, "orders",
                          signed=True)

    def orders_since(self, min_ts: int) -> list:
        """Orders of any status created since min_ts (resting, canceled or executed)."""
        return self.paged("/portfolio/orders", {"min_ts": min_ts, "limit": 1000}, "orders",
                          signed=True)

    def create_order(self, ticker: str, book_side: str, price: Decimal, count: int,
                     client_order_id: str, expiration_ts: int = None) -> dict:
        body = {"ticker": ticker, "client_order_id": client_order_id, "side": book_side,
                "count": f"{count}.00", "price": f"{price:.4f}",
                "time_in_force": "good_till_canceled", "post_only": True,
                "self_trade_prevention_type": "taker_at_cross", "cancel_order_on_pause": True}
        if expiration_ts:
            body["expiration_time"] = int(expiration_ts)
        return self.request("POST", "/portfolio/events/orders", body=body, signed=True)

    def cancel_order(self, order_id: str, ticker: str) -> dict:
        return self.request("DELETE", f"/portfolio/events/orders/{order_id}",
                            {"market_ticker": ticker}, signed=True)

    def fills(self, min_ts: int) -> list:
        return self.paged("/portfolio/fills", {"min_ts": min_ts, "limit": 1000}, "fills",
                          signed=True)


# ---------------------------------------------------------------------------
# Decisions (pure functions, no I/O)
# ---------------------------------------------------------------------------

@dataclass
class Config:
    series: tuple = ("KXTEMPMIAH",)
    pin_threshold: Decimal = Decimal("0.97")   # other side's best bid must be at least this
    # Order size is target x (1 + buffer). Small 99c bids (10-40 contracts seen) fill
    # against our order; the buffer keeps the side at Target until the next top-up.
    size_buffer: float = 0.05
    # Each completion order ties up about $10.50 (1,050 contracts at 1c), and resting
    # collateral must fit in both caps, so the defaults allow two orders at once.
    max_capital: Decimal = Decimal(25)         # dollars of collateral in resting bot orders
    max_fill_spend: Decimal = Decimal(25)      # dollars that may be spent through fills per UTC day
    end_buffer_s: int = 60                     # stop quoting this long before a program ends


@dataclass
class Program:
    ticker: str
    target: int
    reward_per_hour: Decimal
    start: datetime
    end: datetime

    @classmethod
    def from_api(cls, raw: dict) -> Optional["Program"]:
        start, end = parse_time(raw.get("start_date")), parse_time(raw.get("end_date"))
        target = to_decimal(raw.get("target_size_fp"))
        reward = to_decimal(raw.get("period_reward"))
        if not (start and end and target and reward is not None and end > start):
            return None
        hours = Decimal(str((end - start).total_seconds() / 3600))
        return cls(raw["market_ticker"], int(target), reward / 10000 / hours, start, end)


@dataclass
class BotOrder:
    order_id: str
    ticker: str
    outcome: str          # "yes" or "no": which side of the book it rests on
    price: Decimal        # price of that outcome, e.g. 0.01
    remaining: int

    @property
    def collateral(self) -> Decimal:
        return self.price * self.remaining

    @classmethod
    def from_api(cls, raw: dict) -> Optional["BotOrder"]:
        if not (raw.get("client_order_id") or "").startswith(ORDER_PREFIX):
            return None
        outcome = raw.get("outcome_side") or ("yes" if raw.get("book_side") == "bid" else "no")
        price = to_decimal(raw.get(f"{outcome}_price_dollars"))
        remaining = to_decimal(raw.get("remaining_count_fp")) or Decimal(0)
        return cls(raw["order_id"], raw["ticker"], outcome, price, int(remaining))


@dataclass
class Action:
    kind: str                 # "place" or "cancel"
    ticker: str
    outcome: str = ""
    price: Decimal = ONE_CENT
    count: int = 0
    order_id: str = ""
    reason: str = ""
    expires_ts: int = 0       # exchange-side expiry for placements

    @property
    def cost(self) -> Decimal:
        return self.price * self.count

    def describe(self) -> str:
        if self.kind == "place":
            return (f"PLACE {self.ticker}: bid {self.count} {self.outcome.upper()} @ "
                    f"{self.price * 100:.0f}c (${self.cost:.2f} collateral) - {self.reason}")
        return f"CANCEL {self.ticker} order {self.order_id[:8]} - {self.reason}"


def side_levels(book: dict, outcome: str) -> list:
    """[(price_dollars, size)] best (highest) first for YES or NO bids."""
    raw = book.get(f"{outcome}_dollars") or book.get(outcome) or []
    levels = []
    for level in raw:
        if isinstance(level, (list, tuple)) and len(level) >= 2:
            price, size = to_decimal(level[0]), to_decimal(level[1])
            if price is not None and size:
                levels.append((price if price < 1 else price / 100, size))
    return sorted(levels, reverse=True)


def plan_market(program: Program, book: dict, mine: list, config: Config,
                now: datetime) -> list:
    """Actions for one market: complete a pinned empty side, top up, or stand down."""
    actions = []
    ending = (program.end - now).total_seconds() <= config.end_buffer_s
    expires_ts = int(program.end.timestamp()) - config.end_buffer_s
    for outcome, other in (("yes", "no"), ("no", "yes")):
        my_orders = [o for o in mine if o.outcome == outcome]
        my_size = sum(o.remaining for o in my_orders)
        levels = side_levels(book, outcome)
        # Liquidity priced above our 1c bid reaches the Target first; other 1c
        # completers only share the side with us, so they are no reason to leave.
        better_depth = sum(size for price, size in levels if price > ONE_CENT)
        other_levels = side_levels(book, other)
        other_best = other_levels[0][0] if other_levels else None
        # Pinned: the other side is at least pin_threshold but still leaves room for a
        # 1c bid on this side without crossing (other side <= 98c).
        pinned = (other_best is not None and config.pin_threshold <= other_best <= 1 - 2 * ONE_CENT
                  and sum(size for _, size in other_levels) >= program.target)
        wanted = int(program.target * (1 + config.size_buffer) + 0.999)

        if ending or not pinned or better_depth >= program.target:
            reason = ("program ending" if ending else "no longer pinned" if not pinned
                      else "side complete without us")
            actions += [Action("cancel", program.ticker, outcome, order_id=o.order_id, reason=reason)
                        for o in my_orders]
            continue
        if my_size < wanted:
            actions.append(Action("place", program.ticker, outcome, ONE_CENT, wanted - my_size,
                                  reason=f"{outcome.upper()} side has {better_depth:.0f} of "
                                         f"{program.target} above 1c while {other.upper()} is "
                                         f"bid {other_best * 100:.0f}c",
                                  expires_ts=expires_ts))
    return actions


def budget(config: Config, fill_spend: Decimal) -> Decimal:
    """Most collateral that may rest at once. Every resting order could fill before
    the next check, so resting collateral must also fit in the fill budget left."""
    return max(Decimal(0), min(config.max_capital, config.max_fill_spend - fill_spend))


def over_budget(resting: list, limit: Decimal) -> list:
    """Orders to cancel, largest first, until resting collateral fits the limit."""
    total = sum((o.collateral for o in resting), Decimal(0))
    cancels = []
    for o in sorted(resting, key=lambda o: o.collateral, reverse=True):
        if total <= limit:
            break
        cancels.append(Action("cancel", o.ticker, o.outcome, order_id=o.order_id,
                              reason="over budget"))
        total -= o.collateral
    return cancels


def fits(placements: list, resting_collateral: Decimal, limit: Decimal):
    """Split placements into (allowed, refused) so collateral stays within the limit."""
    allowed, refused, total = [], [], resting_collateral
    for a in placements:
        if total + a.cost > limit:
            refused.append(a)
        else:
            allowed.append(a)
            total += a.cost
    return allowed, refused


def fill_spend(fills: list, bot_order_ids: set) -> Decimal:
    """Money spent buying contracts through fills of the bot's own orders."""
    total = Decimal(0)
    for f in fills:
        if f.get("order_id") not in bot_order_ids:
            continue
        outcome = f.get("outcome_side") or ("yes" if f.get("book_side") == "bid" else "no")
        price = to_decimal(f.get(f"{outcome}_price_dollars")) or Decimal(0)
        total += price * (to_decimal(f.get("count_fp")) or Decimal(0))
    return total


def estimated_reward_per_hour(programs: dict, resting: list) -> Decimal:
    """Upper-bound estimate: half a program's pool for each side where the bot's orders
    reach the Target (a side below Target scores nothing)."""
    sizes = {}
    for o in resting:
        sizes[(o.ticker, o.outcome)] = sizes.get((o.ticker, o.outcome), 0) + o.remaining
    return sum((programs[t].reward_per_hour / 2 for (t, _), size in sizes.items()
                if t in programs and size >= programs[t].target), Decimal(0))


def start_of_utc_day(ts: float) -> int:
    return int(ts) // 86400 * 86400


# ---------------------------------------------------------------------------
# Loop
# ---------------------------------------------------------------------------

@dataclass
class Bot:
    client: KalshiClient
    config: Config
    live: bool = False
    fill_spend: Decimal = Decimal(0)
    # Fills are counted from the start of the UTC day, so a restart cannot reset the cap.
    started_ts: int = field(default_factory=lambda: start_of_utc_day(time.time()))
    bot_order_ids: set = field(default_factory=set)
    log: object = print
    program_refresh_s: int = 60
    retry_pause: float = 2.0
    shutdown_verified: bool = True
    _refused_logged: set = field(default_factory=set)
    _raw_programs: list = field(default_factory=list)
    _fetched_at: Optional[datetime] = None
    _programs: dict = field(default_factory=dict)

    def say(self, message: str) -> None:
        """Logging must never stop the bot (e.g. a closed pipe while shutting down)."""
        try:
            self.log(message)
        except Exception:
            pass

    def in_scope(self, ticker: str) -> bool:
        return ticker.startswith(self.config.series)

    def programs(self, now: datetime) -> dict:
        """Active programs in scope. The full list is large and changes a few minutes
        past each hour, so it is re-downloaded at most once per program_refresh_s."""
        if self._fetched_at is None or (now - self._fetched_at).total_seconds() >= self.program_refresh_s:
            self._raw_programs = self.client.liquidity_programs()
            self._fetched_at = now
        found = {}
        for raw in self._raw_programs:
            if not self.in_scope(raw.get("market_ticker", "")):
                continue
            program = Program.from_api(raw)
            if program and program.start <= now < program.end and program.target > 0:
                found[program.ticker] = program
        self._programs = found
        return found

    def my_orders(self) -> list:
        """This series' resting bot orders (orders from other series are left alone)."""
        if not (self.client.key_id and self.client.signer):
            return []
        orders = [o for o in map(BotOrder.from_api, self.client.resting_orders()) if o]
        return [o for o in orders if self.in_scope(o.ticker)]

    def track_fills(self, resting: list) -> None:
        """Money spent through fills of any bot order since start, including orders that
        filled completely or whose create response was lost."""
        self.bot_order_ids.update(o.order_id for o in resting)
        if not self.live:
            return
        for raw in self.client.orders_since(self.started_ts):
            order = BotOrder.from_api(raw)
            if order and self.in_scope(order.ticker):
                self.bot_order_ids.add(order.order_id)
        if self.bot_order_ids:
            self.fill_spend = fill_spend(self.client.fills(self.started_ts), self.bot_order_ids)

    def execute(self, action: Action) -> bool:
        """Carry out one action; returns True if it succeeded (always True in a dry run)."""
        self.say(("" if self.live else "[dry run] ") + action.describe())
        if not self.live:
            return True
        try:
            if action.kind == "place":
                book_side = "bid" if action.outcome == "yes" else "ask"
                price = action.price if action.outcome == "yes" else 1 - action.price
                created = self.client.create_order(action.ticker, book_side, price, action.count,
                                                   f"{ORDER_PREFIX}{uuid.uuid4()}", action.expires_ts)
                if created.get("order_id"):
                    self.bot_order_ids.add(created["order_id"])
            else:
                self.client.cancel_order(action.order_id, action.ticker)
            return True
        except requests.exceptions.RequestException as e:
            self.say(f"  failed: {e}")
            return False

    def step(self, now: datetime) -> dict:
        programs = self.programs(now)
        resting = self.my_orders()
        self.track_fills(resting)
        mine_by_ticker = {}
        for o in resting:
            mine_by_ticker.setdefault(o.ticker, []).append(o)

        actions, books = [], {}
        for ticker, program in programs.items():
            try:
                book = books[ticker] = self.client.orderbook(ticker)
            except requests.exceptions.RequestException as e:
                # Without data, leaving is always safe; placing is not.
                self.say(f"  {ticker}: order book unavailable ({e})")
                actions += [Action("cancel", ticker, o.outcome, order_id=o.order_id,
                                   reason="market data unavailable")
                            for o in mine_by_ticker.get(ticker, [])]
                continue
            actions += plan_market(program, book, mine_by_ticker.get(ticker, []), self.config, now)
        for o in resting:
            if o.ticker not in programs:
                actions.append(Action("cancel", o.ticker, o.outcome, order_id=o.order_id,
                                      reason="no active program"))

        # Cancels first; only successful ones free up collateral.
        cancelled = {a.order_id for a in actions if a.kind == "cancel" and self.execute(a)}
        remaining = [o for o in resting if o.order_id not in cancelled]
        limit = budget(self.config, self.fill_spend)
        for a in over_budget(remaining, limit):
            if self.execute(a):
                remaining = [o for o in remaining if o.order_id != a.order_id]
        # Top-ups keep sides we already hold at Target, so they go before new orders.
        held = {(o.ticker, o.outcome) for o in remaining}
        placements = sorted((a for a in actions if a.kind == "place"),
                            key=lambda a: ((a.ticker, a.outcome) not in held, a.cost))
        allowed, refused = fits(placements, sum((o.collateral for o in remaining), Decimal(0)), limit)
        placed = [a for a in allowed if self.execute(a)]
        refused_keys = set()
        for a in refused:
            key = (a.ticker, a.outcome, a.count)
            refused_keys.add(key)
            if key not in self._refused_logged:          # say it once, not every loop
                self.say(f"  refused by caps: {a.describe()}")
        self._refused_logged = refused_keys
        # A side that cannot be topped up back to Target scores nothing while still
        # getting filled; leaving frees its collateral for a side that can stay full.
        for a in refused:
            if (a.ticker, a.outcome) not in held:
                continue
            depth = sum(size for _, size in side_levels(books.get(a.ticker, {}), a.outcome))
            if depth >= programs[a.ticker].target:
                continue
            for o in [o for o in remaining if (o.ticker, o.outcome) == (a.ticker, a.outcome)]:
                if self.execute(Action("cancel", o.ticker, o.outcome, order_id=o.order_id,
                                       reason="cannot keep side at Target within caps")):
                    remaining.remove(o)
                    cancelled.add(o.order_id)

        # Orders just placed count too (in a dry run they are all there is).
        sides = remaining + [BotOrder("planned", a.ticker, a.outcome, a.price, a.count) for a in placed]
        return {"programs": len(programs), "resting": len(remaining) + (len(placed) if self.live else 0),
                "actions": len(cancelled) + len(placed), "refused": len(refused),
                "fill_spend": self.fill_spend, "est_per_hour": estimated_reward_per_hour(programs, sides)}

    def seconds_to_next_deadline(self, now: datetime) -> float:
        """Time until the next program the bot quotes enters its end buffer."""
        deadlines = [(p.end - now).total_seconds() - self.config.end_buffer_s
                     for p in self._programs.values()]
        return min([d for d in deadlines if d > 0], default=float("inf"))

    def shutdown(self, attempts: int = 3) -> list:
        """Cancel every bot order in this series. One failure never stops the others;
        the list is re-fetched and retried. Returns the orders still resting, and sets
        shutdown_verified to False if it could never confirm what is resting."""
        # A second Ctrl-C, or the second SIGHUP a closing terminal sends, must not interrupt.
        stop_signals = [getattr(signal, n) for n in ("SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK")
                        if hasattr(signal, n)]
        previous = {s: signal.signal(s, signal.SIG_IGN) for s in stop_signals}
        try:
            left, verified = [], False
            for attempt in range(attempts + 1):
                try:
                    left = self.my_orders()
                    verified = True
                except requests.exceptions.RequestException as e:
                    self.say(f"  could not list orders: {e}")
                    verified = False
                    if attempt < attempts:
                        time.sleep(self.retry_pause)
                    continue
                if not left or attempt == attempts:
                    break
                for o in left:
                    self.execute(Action("cancel", o.ticker, o.outcome, order_id=o.order_id,
                                        reason="bot stopping"))
            self.shutdown_verified = verified
            if not verified:
                self.say("COULD NOT CONFIRM THE BOT'S ORDERS WERE CANCELLED. Open the Kalshi app and "
                         "cancel any open orders on these markets; they also expire at their program's end.")
            elif left:
                self.say("STILL RESTING (cancel in the Kalshi app; they also expire at their program's "
                         "end): " + ", ".join(f"{o.ticker} {o.order_id}" for o in left))
            return left
        finally:
            for s, handler in previous.items():
                signal.signal(s, handler)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def stop_on_signals() -> None:
    """Treat SIGTERM, SIGHUP (closed terminal, kill, service stop) and Windows' Ctrl-Break
    like Ctrl-C, so the bot always runs its shutdown."""
    def interrupt(signum, frame):
        raise KeyboardInterrupt
    for name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupt)


def cmd_plan(args, config: Config) -> int:
    bot = Bot(KalshiClient(DEMO_URL if args.demo else PROD_URL), config, live=False)
    now = datetime.now(timezone.utc)
    programs = bot.programs(now)
    print(f"{now:%H:%M} UTC: {len(programs)} active liquidity programs in {', '.join(config.series)}")
    total = Decimal(0)
    for ticker, program in sorted(programs.items()):
        actions = plan_market(program, bot.client.orderbook(ticker), [], config, now)
        for a in actions:
            print("  " + a.describe().replace("PLACE ", "would place ", 1))
            total += program.reward_per_hour / 2
    print(f"Unclaimed sides worth up to ${total:.0f}/hour if nobody else completes them.")
    return 0


def cmd_run(args, config: Config) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)    # show the log as it happens
    if bool(args.key_id) != bool(args.key_file):
        print("Pass both --key-id and --key-file (or neither).", file=sys.stderr)
        return 2
    if args.live and not args.key_file:
        print("--live needs --key-id and --key-file", file=sys.stderr)
        return 2
    signer = None
    if args.key_file:
        try:
            signer = Signer.from_pem_file(args.key_file)
        except (OSError, ValueError, TypeError) as e:
            print(f"Can't read the key file '{args.key_file}' ({e}). Use the .txt file Kalshi "
                  "downloaded, unchanged; type 'ls' (Mac) or 'dir' (Windows) to see its exact name.",
                  file=sys.stderr)
            return 2
    client = KalshiClient(DEMO_URL if args.demo else PROD_URL, args.key_id, signer)
    if signer:
        try:
            cash = client.balance()
        except requests.exceptions.HTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status in (401, 403):
                print("Kalshi rejected the key. Check the Key ID, that the key file is the one "
                      "downloaded with it, and that this computer's clock is set automatically.",
                      file=sys.stderr)
                return 2
            print(f"Could not check the key: {e}", file=sys.stderr)
            return 2
        except requests.exceptions.RequestException as e:
            print(f"Could not reach Kalshi to check the key: {e}", file=sys.stderr)
            return 2
        print(f"Key OK. Cash available on Kalshi's default exchange: ${cash:.2f}")
        if args.live and cash < config.max_capital:
            print(f"Warning: less than --max-capital (${config.max_capital}) is available, so "
                  "fewer orders will fit.")
    if args.live:
        where = "DEMO" if args.demo else "REAL-MONEY"
        answer = input(f"Place {where} orders (collateral cap ${config.max_capital}, fill cap "
                       f"${config.max_fill_spend})? Type LIVE to continue: ")
        if answer.strip() != "LIVE":
            print("Not confirmed; exiting.")
            return 1
    stop_on_signals()
    bot = Bot(client, config, live=args.live)
    bot.say(f"{'LIVE' if args.live else 'DRY RUN'} on {client.base_url}, series {', '.join(config.series)}")
    try:
        while True:
            now = datetime.now(timezone.utc)
            try:
                s = bot.step(now)
                bot.say(f"{now:%H:%M:%S} programs {s['programs']}, bot orders {s['resting']}, "
                        f"actions {s['actions']}, refused {s['refused']}, fill spend "
                        f"${s['fill_spend']:.2f}, est. up to ${s['est_per_hour']:.0f}/h")
            except requests.exceptions.RequestException as e:
                bot.say(f"{now:%H:%M:%S} request failed: {e}")
            if bot.fill_spend >= config.max_fill_spend:
                bot.say("Fill spend cap reached; stopping.")
                break
            time.sleep(max(1.0, min(args.every, bot.seconds_to_next_deadline(datetime.now(timezone.utc)))))
    except KeyboardInterrupt:
        bot.say("\nStopping...")
    finally:
        left = bot.shutdown()
    return 1 if left or not bot.shutdown_verified else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan", help="show what the bot would do right now (no key needed)")
    run = sub.add_parser("run", help="run the bot (dry run unless --live)")
    for p in (plan, run):
        p.add_argument("--series", nargs="+", default=list(Config.series))
        p.add_argument("--pin-threshold", type=Decimal, default=Config.pin_threshold)
        p.add_argument("--demo", action="store_true", help="use Kalshi's demo environment")
    run.add_argument("--key-id", help="Kalshi API key ID")
    run.add_argument("--key-file", help="path to the private key file Kalshi downloaded (.txt)")
    run.add_argument("--live", action="store_true", help="actually place and cancel orders")
    run.add_argument("--max-capital", type=Decimal, default=Config.max_capital,
                     help="dollars of collateral the bot may keep in resting orders")
    run.add_argument("--max-fill-spend", type=Decimal, default=Config.max_fill_spend,
                     help="dollars that may be spent through fills per UTC day, counting "
                          "earlier runs today (a hard cap)")
    run.add_argument("--every", type=float, default=10.0, help="seconds between checks")
    args = parser.parse_args(argv)
    config = Config(series=tuple(args.series), pin_threshold=args.pin_threshold)
    if args.command == "run":
        config.max_capital, config.max_fill_spend = args.max_capital, args.max_fill_spend
        return cmd_run(args, config)
    return cmd_plan(args, config)


if __name__ == "__main__":
    sys.exit(main())
