"""Tests for lip_bot. Run with: python -m unittest discover -s tests"""

import base64
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import lip_bot as lb  # noqa: E402

NOW = datetime(2026, 9, 26, 18, 30, tzinfo=timezone.utc)
CONFIG = lb.Config()


def program(ticker="KXTEMPMIAH-26SEP2615-T81.99", target=1000, minutes_left=30):
    return lb.Program(ticker, target, Decimal(100), NOW - timedelta(minutes=28),
                      NOW + timedelta(minutes=minutes_left))


def book(yes=(), no=()):
    """Levels as (cents, size); API order is ascending price."""
    def fmt(levels):
        return [[f"{c / 100:.4f}", f"{s}.00"] for c, s in sorted(levels)]
    return {"yes_dollars": fmt(yes), "no_dollars": fmt(no)}


def mine(outcome, remaining, order_id="o1", ticker="KXTEMPMIAH-26SEP2615-T81.99"):
    return lb.BotOrder(order_id, ticker, outcome, Decimal("0.01"), remaining)


class PlanTests(unittest.TestCase):
    def test_completes_empty_no_side_when_yes_is_pinned(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)]), [], CONFIG, NOW)
        self.assertEqual((a.kind, a.outcome, a.price, a.count), ("place", "no", Decimal("0.01"), 1020))

    def test_completes_empty_yes_side_when_no_is_pinned(self):
        [a] = lb.plan_market(program(), book(no=[(97, 3000)]), [], CONFIG, NOW)
        self.assertEqual((a.kind, a.outcome, a.count), ("place", "yes", 1020))

    def test_no_order_when_it_would_cross_or_side_is_not_pinned(self):
        self.assertEqual(lb.plan_market(program(), book(yes=[(99, 4000)]), [], CONFIG, NOW), [])
        self.assertEqual(lb.plan_market(program(), book(yes=[(90, 4000)]), [], CONFIG, NOW), [])

    def test_no_order_when_pinned_side_itself_misses_the_target(self):
        # Snapshots would still be excluded, so completing our side earns nothing.
        self.assertEqual(lb.plan_market(program(), book(yes=[(98, 600)]), [], CONFIG, NOW), [])

    def test_tops_up_after_partial_fill(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, 700)]),
                             [mine("no", 700)], CONFIG, NOW)
        self.assertEqual((a.kind, a.count), ("place", 320))

    def test_full_order_needs_nothing(self):
        self.assertEqual(lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, 1020)]),
                                        [mine("no", 1020)], CONFIG, NOW), [])

    def test_other_1c_completers_do_not_make_us_leave(self):
        actions = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, 2020)]),
                                 [mine("no", 1020)], CONFIG, NOW)
        self.assertEqual(actions, [])

    def test_real_liquidity_above_1c_makes_us_leave(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(2, 1500), (1, 1020)]),
                             [mine("no", 1020)], CONFIG, NOW)
        self.assertEqual((a.kind, a.reason), ("cancel", "side complete without us"))

    def test_cancels_when_unpinned_or_ending(self):
        [a] = lb.plan_market(program(), book(yes=[(80, 4000)], no=[(1, 1020)]),
                             [mine("no", 1020)], CONFIG, NOW)
        self.assertEqual((a.kind, a.reason), ("cancel", "no longer pinned"))
        [b] = lb.plan_market(program(minutes_left=0.5), book(yes=[(98, 4000)], no=[(1, 1020)]),
                             [mine("no", 1020)], CONFIG, NOW)
        self.assertEqual((b.kind, b.reason), ("cancel", "program ending"))

    def test_side_levels_accepts_cent_format(self):
        self.assertEqual(lb.side_levels({"yes": [[98, 10]]}, "yes"), [(Decimal("0.98"), Decimal(10))])


class CapTests(unittest.TestCase):
    def test_capital_cap_refuses_extra_placements(self):
        config = lb.Config(max_capital=Decimal(15))
        actions = [lb.Action("place", "A", "no", Decimal("0.01"), 1020),
                   lb.Action("place", "B", "no", Decimal("0.01"), 1020)]
        allowed, refused = lb.within_caps(actions, [], Decimal(0), config)
        self.assertEqual(([a.ticker for a in allowed], [a.ticker for a in refused]), (["A"], ["B"]))

    def test_cancelled_orders_free_capital(self):
        config = lb.Config(max_capital=Decimal(15))
        resting = [mine("no", 1020, "old", "A")]
        actions = [lb.Action("cancel", "A", "no", order_id="old"),
                   lb.Action("place", "B", "no", Decimal("0.01"), 1020)]
        allowed, refused = lb.within_caps(actions, resting, Decimal(0), config)
        self.assertEqual((len(allowed), refused), (2, []))

    def test_fill_cap_blocks_placements_but_not_cancels(self):
        actions = [lb.Action("cancel", "A", order_id="x"), lb.Action("place", "B", "no", count=5)]
        allowed, refused = lb.within_caps(actions, [], CONFIG.max_fill_spend, CONFIG)
        self.assertEqual(([a.kind for a in allowed], [a.kind for a in refused]), (["cancel"], ["place"]))


class ParsingTests(unittest.TestCase):
    def test_bot_orders_only(self):
        raw = {"order_id": "1", "ticker": "T", "client_order_id": "lipbot-abc", "outcome_side": "no",
               "no_price_dollars": "0.0100", "yes_price_dollars": "0.9900", "remaining_count_fp": "700.00"}
        order = lb.BotOrder.from_api(raw)
        self.assertEqual((order.outcome, order.price, order.remaining, order.collateral),
                         ("no", Decimal("0.01"), 700, Decimal("7.00")))
        self.assertIsNone(lb.BotOrder.from_api(dict(raw, client_order_id="manual-1")))
        self.assertIsNone(lb.BotOrder.from_api(dict(raw, client_order_id=None)))

    def test_program_reward_units(self):
        raw = {"market_ticker": "T", "target_size_fp": "1000.00", "period_reward": 1000000,
               "start_date": "2026-09-26T18:00:00Z", "end_date": "2026-09-26T19:00:00Z"}
        p = lb.Program.from_api(raw)
        self.assertEqual((p.target, p.reward_per_hour), (1000, Decimal(100)))

    def test_fill_spend_counts_only_bot_orders_at_their_outcome_price(self):
        fills = [{"order_id": "b1", "outcome_side": "no", "no_price_dollars": "0.0100",
                  "yes_price_dollars": "0.9900", "count_fp": "300.00"},
                 {"order_id": "manual", "outcome_side": "yes", "yes_price_dollars": "0.5000",
                  "count_fp": "10.00"}]
        self.assertEqual(lb.fill_spend(fills, {"b1"}), Decimal("3.00"))


class SignerTests(unittest.TestCase):
    def test_message_and_headers(self):
        seen = []
        signer = lb.Signer(lambda m: seen.append(m) or b"sig")
        headers = signer.headers("KEY", "get", "/trade-api/v2/portfolio/orders?limit=5", 1703123456789)
        self.assertEqual(seen, [b"1703123456789GET/trade-api/v2/portfolio/orders"])
        self.assertEqual(headers, {"KALSHI-ACCESS-KEY": "KEY", "KALSHI-ACCESS-TIMESTAMP": "1703123456789",
                                   "KALSHI-ACCESS-SIGNATURE": base64.b64encode(b"sig").decode()})

    def test_client_signs_full_api_path(self):
        client = lb.KalshiClient(lb.PROD_URL, "KEY", lb.Signer(lambda m: b"s"))
        self.assertEqual(client.prefix, "/trade-api/v2")
        self.assertEqual(lb.KalshiClient(lb.DEMO_URL).prefix, "/trade-api/v2")


class FakeClient:
    def __init__(self, programs, books, resting=(), fills=()):
        self.key_id, self.signer = "KEY", object()
        self.programs, self.books = programs, books
        self.resting, self.fill_list = list(resting), list(fills)
        self.created, self.cancelled = [], []

    def liquidity_programs(self):
        return self.programs

    def orderbook(self, ticker):
        return self.books[ticker]

    def resting_orders(self):
        return self.resting

    def create_order(self, ticker, book_side, price, count, client_order_id):
        self.created.append((ticker, book_side, price, count, client_order_id))
        return {"order_id": f"new{len(self.created)}"}

    def cancel_order(self, order_id, ticker):
        self.cancelled.append((order_id, ticker))
        return {}

    def fills(self, min_ts):
        return self.fill_list


def raw_program(ticker, start=NOW - timedelta(minutes=30), end=NOW + timedelta(minutes=30)):
    return {"market_ticker": ticker, "target_size_fp": "1000.00", "period_reward": 1000000,
            "start_date": start.isoformat(), "end_date": end.isoformat()}


class BotTests(unittest.TestCase):
    def setUp(self):
        self.t1, self.t2 = "KXTEMPMIAH-26SEP2615-T81.99", "KXTEMPMIAH-26SEP2615-T90.99"
        self.client = FakeClient(
            [raw_program(self.t1), raw_program(self.t2), raw_program("KXOTHER-1")],
            {self.t1: book(yes=[(98, 4000)]), self.t2: book(no=[(98, 4000)]),
             "KXOTHER-1": book(yes=[(98, 4000)])},
            resting=[{"order_id": "stale", "ticker": "KXTEMPMIAH-26SEP2614-T80.99",
                      "client_order_id": "lipbot-1", "outcome_side": "no", "no_price_dollars": "0.0100",
                      "remaining_count_fp": "1020.00"},
                     {"order_id": "manual", "ticker": self.t1, "client_order_id": "mine",
                      "outcome_side": "yes", "yes_price_dollars": "0.5000", "remaining_count_fp": "5.00"}])
        self.logs = []

    def test_dry_run_never_writes(self):
        bot = lb.Bot(self.client, CONFIG, live=False, log=self.logs.append)
        summary = bot.step(NOW)
        self.assertEqual((self.client.created, self.client.cancelled), ([], []))
        self.assertEqual(summary["programs"], 2)          # other series ignored
        self.assertTrue(all(line.startswith("[dry run]") for line in self.logs))

    def test_live_places_completions_with_correct_book_side_and_cancels_stale(self):
        bot = lb.Bot(self.client, CONFIG, live=True, log=self.logs.append)
        bot.step(NOW)
        placed = {(t, side, price, count) for t, side, price, count, _ in self.client.created}
        self.assertEqual(placed, {(self.t1, "ask", Decimal("0.99"), 1020),      # NO bid at 1c
                                  (self.t2, "bid", Decimal("0.01"), 1020)})     # YES bid at 1c
        self.assertTrue(all(c[4].startswith(lb.ORDER_PREFIX) for c in self.client.created))
        self.assertEqual(self.client.cancelled, [("stale", "KXTEMPMIAH-26SEP2614-T80.99")])
        self.assertIn("new1", bot.bot_order_ids)

    def test_fill_cap_stops_new_orders(self):
        self.client.fill_list = [{"order_id": "stale", "outcome_side": "no", "no_price_dollars": "0.0100",
                                  "count_fp": "2500.00"}]
        bot = lb.Bot(self.client, lb.Config(max_fill_spend=Decimal(20)), live=True, log=self.logs.append)
        summary = bot.step(NOW)
        self.assertEqual(bot.fill_spend, Decimal(25))
        self.assertEqual(self.client.created, [])
        self.assertEqual(summary["refused"], 2)

    def test_program_list_is_cached_between_steps(self):
        calls = []
        original = self.client.liquidity_programs
        self.client.liquidity_programs = lambda: calls.append(1) or original()
        bot = lb.Bot(self.client, CONFIG, live=False, log=self.logs.append)
        bot.step(NOW)
        bot.step(NOW + timedelta(seconds=30))
        self.assertEqual(len(calls), 1)
        bot.step(NOW + timedelta(seconds=61))
        self.assertEqual(len(calls), 2)

    def test_dry_run_estimates_planned_sides(self):
        bot = lb.Bot(self.client, CONFIG, live=False, log=self.logs.append)
        self.assertEqual(bot.step(NOW)["est_per_hour"], Decimal(100))   # 2 sides x $100/h / 2

    def test_shutdown_cancels_only_bot_orders(self):
        bot = lb.Bot(self.client, CONFIG, live=True, log=self.logs.append)
        bot.shutdown()
        self.assertEqual(self.client.cancelled, [("stale", "KXTEMPMIAH-26SEP2614-T80.99")])


if __name__ == "__main__":
    unittest.main()
