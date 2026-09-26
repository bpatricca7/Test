"""Tests for lip_bot. Run with: python -m unittest discover -s tests"""

import base64
import io
import os
import signal
import sys
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import lip_bot as lb  # noqa: E402

NOW = datetime(2026, 9, 26, 18, 30, tzinfo=timezone.utc)
CONFIG = lb.Config()
ROOMY = lb.Config(max_capital=Decimal(50), max_fill_spend=Decimal(50))   # fits every test order
T1, T2 = "KXTEMPMIAH-26SEP2615-T81.99", "KXTEMPMIAH-26SEP2615-T90.99"
WANT = 1050   # Target 1000 plus the 5% buffer


def program(ticker=T1, target=1000, minutes_left=30):
    return lb.Program(ticker, target, Decimal(100), NOW - timedelta(minutes=30),
                      NOW + timedelta(minutes=minutes_left))


def book(yes=(), no=()):
    """Levels as (cents, size); API order is ascending price."""
    def fmt(levels):
        return [[f"{c / 100:.4f}", f"{s}.00"] for c, s in sorted(levels)]
    return {"yes_dollars": fmt(yes), "no_dollars": fmt(no)}


def mine(outcome, remaining, order_id="o1", ticker=T1):
    return lb.BotOrder(order_id, ticker, outcome, Decimal("0.01"), remaining)


def raw_order(order_id, ticker, outcome="no", remaining=WANT, prefix="lipbot-"):
    return {"order_id": order_id, "ticker": ticker, "client_order_id": f"{prefix}{order_id}",
            "outcome_side": outcome, f"{outcome}_price_dollars": "0.0100",
            "remaining_count_fp": f"{remaining}.00"}


class PlanTests(unittest.TestCase):
    def test_completes_empty_no_side_when_yes_is_pinned(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)]), [], CONFIG, NOW)
        self.assertEqual((a.kind, a.outcome, a.price, a.count), ("place", "no", Decimal("0.01"), WANT))

    def test_placements_expire_at_the_program_end_buffer(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)]), [], CONFIG, NOW)
        self.assertEqual(a.expires_ts, int((NOW + timedelta(minutes=30)).timestamp()) - 60)

    def test_completes_empty_yes_side_when_no_is_pinned(self):
        [a] = lb.plan_market(program(), book(no=[(97, 3000)]), [], CONFIG, NOW)
        self.assertEqual((a.kind, a.outcome, a.count), ("place", "yes", WANT))

    def test_no_order_when_it_would_cross_or_side_is_not_pinned(self):
        self.assertEqual(lb.plan_market(program(), book(yes=[(99, 4000)]), [], CONFIG, NOW), [])
        self.assertEqual(lb.plan_market(program(), book(yes=[(90, 4000)]), [], CONFIG, NOW), [])

    def test_no_order_when_pinned_side_itself_misses_the_target(self):
        # Snapshots would still be excluded, so completing our side earns nothing.
        self.assertEqual(lb.plan_market(program(), book(yes=[(98, 600)]), [], CONFIG, NOW), [])

    def test_tops_up_after_partial_fill(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, 700)]),
                             [mine("no", 700)], CONFIG, NOW)
        self.assertEqual((a.kind, a.count), ("place", WANT - 700))

    def test_full_order_needs_nothing(self):
        self.assertEqual(lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, WANT)]),
                                        [mine("no", WANT)], CONFIG, NOW), [])

    def test_other_1c_completers_do_not_make_us_leave(self):
        actions = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(1, 2050)]),
                                 [mine("no", WANT)], CONFIG, NOW)
        self.assertEqual(actions, [])

    def test_real_liquidity_above_1c_makes_us_leave(self):
        [a] = lb.plan_market(program(), book(yes=[(98, 4000)], no=[(2, 1500), (1, WANT)]),
                             [mine("no", WANT)], CONFIG, NOW)
        self.assertEqual((a.kind, a.reason), ("cancel", "side complete without us"))

    def test_cancels_when_unpinned_or_ending(self):
        [a] = lb.plan_market(program(), book(yes=[(80, 4000)], no=[(1, WANT)]),
                             [mine("no", WANT)], CONFIG, NOW)
        self.assertEqual((a.kind, a.reason), ("cancel", "no longer pinned"))
        [b] = lb.plan_market(program(minutes_left=0.5), book(yes=[(98, 4000)], no=[(1, WANT)]),
                             [mine("no", WANT)], CONFIG, NOW)
        self.assertEqual((b.kind, b.reason), ("cancel", "program ending"))

    def test_side_levels_accepts_cent_format(self):
        self.assertEqual(lb.side_levels({"yes": [[98, 10]]}, "yes"), [(Decimal("0.98"), Decimal(10))])


class BudgetTests(unittest.TestCase):
    def test_budget_is_the_smaller_of_capital_and_fill_budget_left(self):
        config = lb.Config(max_capital=Decimal(30), max_fill_spend=Decimal(20))
        self.assertEqual(lb.budget(config, Decimal(0)), Decimal(20))
        self.assertEqual(lb.budget(config, Decimal("19.19")), Decimal("0.81"))
        self.assertEqual(lb.budget(config, Decimal(25)), Decimal(0))
        self.assertEqual(lb.budget(lb.Config(max_capital=Decimal(10)), Decimal(0)), Decimal(10))

    def test_over_budget_cancels_largest_orders_first(self):
        resting = [mine("no", 1020, "big"), mine("no", 300, "small", T2)]
        [a] = lb.over_budget(resting, Decimal(5))
        self.assertEqual((a.order_id, a.reason), ("big", "over budget"))
        self.assertEqual(lb.over_budget(resting, Decimal(20)), [])

    def test_fits_stops_at_the_limit(self):
        placements = [lb.Action("place", "A", "no", Decimal("0.01"), 1020),
                      lb.Action("place", "B", "no", Decimal("0.01"), 1020)]
        allowed, refused = lb.fits(placements, Decimal(0), Decimal(15))
        self.assertEqual(([a.ticker for a in allowed], [a.ticker for a in refused]), (["A"], ["B"]))


class ParsingTests(unittest.TestCase):
    def test_bot_orders_only(self):
        raw = raw_order("1", "T", remaining=700)
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

    def test_program_with_trimmed_fraction_parses_and_bad_dates_are_skipped(self):
        raw = {"market_ticker": "T", "target_size_fp": "1000.00", "period_reward": 1000000,
               "start_date": "2026-09-26T18:02:10.13622Z", "end_date": "2026-09-26T19:00:00Z"}
        self.assertIsNotNone(lb.Program.from_api(raw))
        self.assertIsNone(lb.Program.from_api(dict(raw, start_date="garbage")))
        self.assertIsNone(lb.Program.from_api(dict(raw, end_date=raw["start_date"])))

    def test_fill_spend_counts_only_bot_orders_at_their_outcome_price(self):
        fills = [{"order_id": "b1", "outcome_side": "no", "no_price_dollars": "0.0100",
                  "yes_price_dollars": "0.9900", "count_fp": "300.00"},
                 {"order_id": "manual", "outcome_side": "yes", "yes_price_dollars": "0.5000",
                  "count_fp": "10.00"}]
        self.assertEqual(lb.fill_spend(fills, {"b1"}), Decimal("3.00"))


class ClientTests(unittest.TestCase):
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

    def test_paged_follows_both_cursor_names(self):
        client = lb.KalshiClient()
        pages = iter([{"incentive_programs": [1, 2], "next_cursor": "c1"},
                      {"incentive_programs": [3], "cursor": "c2"},
                      {"incentive_programs": [4], "next_cursor": ""}])
        seen = []
        client.request = lambda method, path, params=None, body=None, signed=False: (
            seen.append(params.get("cursor")) or next(pages))
        self.assertEqual(client.liquidity_programs(), [1, 2, 3, 4])
        self.assertEqual(seen, [None, "c1", "c2"])

    def test_create_order_sends_expiration_and_post_only(self):
        client = lb.KalshiClient(lb.PROD_URL, "KEY", lb.Signer(lambda m: b"s"))
        sent = {}
        client.request = lambda method, path, params=None, body=None, signed=False: sent.update(body) or {}
        client.create_order("T", "ask", Decimal("0.99"), 1020, "lipbot-x", 1790000000)
        self.assertEqual((sent["side"], sent["price"], sent["count"], sent["expiration_time"],
                          sent["post_only"]), ("ask", "0.9900", "1020.00", 1790000000, True))


class FakeClient:
    def __init__(self, programs, books, resting=(), fills=(), history=()):
        self.key_id, self.signer = "KEY", object()
        self.programs, self.books = programs, books
        self.resting, self.fill_list, self.history = list(resting), list(fills), list(history)
        self.created, self.cancelled = [], []
        self.fail_cancel, self.fail_books = set(), set()

    def liquidity_programs(self):
        return self.programs

    def orderbook(self, ticker):
        if ticker in self.fail_books:
            raise requests.exceptions.ReadTimeout("timed out")
        return self.books[ticker]

    def resting_orders(self):
        return list(self.resting)

    def orders_since(self, min_ts):
        return list(self.resting) + list(self.history)

    def create_order(self, ticker, book_side, price, count, client_order_id, expiration_ts=None):
        self.created.append((ticker, book_side, price, count, client_order_id, expiration_ts))
        return {"order_id": f"new{len(self.created)}"}

    def cancel_order(self, order_id, ticker):
        if order_id in self.fail_cancel:
            raise requests.exceptions.HTTPError("503")
        self.cancelled.append((order_id, ticker))
        self.resting = [o for o in self.resting if o["order_id"] != order_id]
        return {}

    def fills(self, min_ts):
        return self.fill_list


def raw_program(ticker, start=NOW - timedelta(minutes=30), end=NOW + timedelta(minutes=30)):
    return {"market_ticker": ticker, "target_size_fp": "1000.00", "period_reward": 1000000,
            "start_date": start.isoformat(), "end_date": end.isoformat()}


class BotTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient(
            [raw_program(T1), raw_program(T2), raw_program("KXOTHER-1")],
            {T1: book(yes=[(98, 4000)]), T2: book(no=[(98, 4000)]), "KXOTHER-1": book(yes=[(98, 4000)])},
            resting=[raw_order("stale", "KXTEMPMIAH-26SEP2614-T80.99"),
                     raw_order("manual", T1, "yes", 5, prefix="mine-"),
                     raw_order("other-series", "KXTEMPNYH-26SEP2615-T70.99")])
        self.logs = []

    def bot(self, config=CONFIG, live=True):
        return lb.Bot(self.client, config, live=live, log=self.logs.append, retry_pause=0)

    def test_dry_run_never_writes(self):
        summary = self.bot(ROOMY, live=False).step(NOW)
        self.assertEqual((self.client.created, self.client.cancelled), ([], []))
        self.assertEqual(summary["programs"], 2)          # other series ignored
        self.assertFalse(any(line.startswith(("PLACE", "CANCEL")) for line in self.logs))
        self.assertTrue(any(line.startswith("[dry run] PLACE") for line in self.logs))

    def test_default_caps_allow_two_completion_orders(self):
        self.client.programs.append(raw_program("KXTEMPMIAH-26SEP2615-T82.99"))
        self.client.books["KXTEMPMIAH-26SEP2615-T82.99"] = book(yes=[(98, 4000)])
        summary = self.bot(CONFIG).step(NOW)
        self.assertEqual((len(self.client.created), summary["refused"]), (2, 1))

    def test_live_places_completions_with_correct_book_side_and_cancels_stale(self):
        bot = self.bot(ROOMY)
        bot.step(NOW)
        placed = {(t, side, price, count) for t, side, price, count, _, _ in self.client.created}
        self.assertEqual(placed, {(T1, "ask", Decimal("0.99"), WANT),      # NO bid at 1c
                                  (T2, "bid", Decimal("0.01"), WANT)})     # YES bid at 1c
        self.assertTrue(all(c[4].startswith(lb.ORDER_PREFIX) and c[5] for c in self.client.created))
        # Only this series' stale bot order is cancelled: not the manual one, not other series.
        self.assertEqual(self.client.cancelled, [("stale", "KXTEMPMIAH-26SEP2614-T80.99")])
        self.assertIn("new1", bot.bot_order_ids)

    def test_failed_cancel_keeps_its_collateral_counted(self):
        # Cap $15: the stale $10.50 order must really be gone before a new $10.50 order goes up.
        self.client.fail_cancel = {"stale"}
        summary = self.bot(lb.Config(max_capital=Decimal(15), max_fill_spend=Decimal(20))).step(NOW)
        self.assertEqual(self.client.created, [])
        self.assertEqual(summary["refused"], 2)

    def test_resting_collateral_never_exceeds_the_fill_budget_left(self):
        # $19.19 already spent of a $20 fill cap leaves $0.81: nothing new may rest.
        self.client.fill_list = [{"order_id": "gone", "outcome_side": "no", "no_price_dollars": "0.0100",
                                  "count_fp": "1919.00"}]
        self.client.history = [raw_order("gone", T1, remaining=0)]
        bot = self.bot(lb.Config(max_capital=Decimal(30), max_fill_spend=Decimal(20)))
        summary = bot.step(NOW)
        self.assertEqual(bot.fill_spend, Decimal("19.19"))
        self.assertEqual(self.client.created, [])
        self.assertEqual(summary["refused"], 2)

    def test_over_budget_orders_are_cancelled(self):
        self.client.resting = [raw_order("r1", T1), raw_order("r2", T2, "yes")]
        self.client.fill_list = [{"order_id": "r1", "outcome_side": "no", "no_price_dollars": "0.0100",
                                  "count_fp": "1500.00"}]
        self.bot(lb.Config(max_capital=Decimal(30), max_fill_spend=Decimal(20))).step(NOW)
        # $15 spent of $20 leaves $5, but $21.00 rests
        self.assertEqual({c[0] for c in self.client.cancelled}, {"r1", "r2"})
        self.assertEqual(self.client.created, [])

    def test_fully_filled_order_with_lost_create_response_is_counted(self):
        self.client.history = [raw_order("lost", T1, remaining=0)]
        self.client.fill_list = [{"order_id": "lost", "outcome_side": "no", "no_price_dollars": "0.0100",
                                  "count_fp": "1020.00"}]
        bot = self.bot()
        bot.step(NOW)
        self.assertEqual(bot.fill_spend, Decimal("10.20"))

    def test_failed_orderbook_cancels_that_markets_orders_and_still_handles_others(self):
        self.client.resting = [raw_order("r1", T1)]
        self.client.fail_books = {T1}
        self.bot(ROOMY).step(NOW)
        self.assertIn(("r1", T1), self.client.cancelled)
        self.assertEqual([c[0] for c in self.client.created], [T2])

    def test_shutdown_keeps_going_after_a_failed_cancel_and_reports_leftovers(self):
        self.client.resting = [raw_order("a", T1), raw_order("b", T2, "yes")]
        self.client.fail_cancel = {"a"}
        left = self.bot().shutdown()
        self.assertIn(("b", T2), self.client.cancelled)
        self.assertEqual([o.order_id for o in left], ["a"])
        self.assertTrue(any("STILL RESTING" in line for line in self.logs))

    def test_shutdown_survives_broken_logging(self):
        self.client.resting = [raw_order("a", T1)]

        def broken(_):
            raise BrokenPipeError
        bot = lb.Bot(self.client, CONFIG, live=True, log=broken)
        self.assertEqual(bot.shutdown(), [])
        self.assertEqual(self.client.cancelled, [("a", T1)])

    def test_shutdown_leaves_other_orders_alone(self):
        self.bot().shutdown()
        self.assertEqual(self.client.cancelled, [("stale", "KXTEMPMIAH-26SEP2614-T80.99")])

    def test_program_list_is_cached_between_steps(self):
        calls = []
        original = self.client.liquidity_programs
        self.client.liquidity_programs = lambda: calls.append(1) or original()
        bot = self.bot(live=False)
        bot.step(NOW)
        bot.step(NOW + timedelta(seconds=30))
        self.assertEqual(len(calls), 1)
        bot.step(NOW + timedelta(seconds=61))
        self.assertEqual(len(calls), 2)

    def test_dry_run_estimates_planned_sides(self):
        self.assertEqual(self.bot(ROOMY, live=False).step(NOW)["est_per_hour"], Decimal(100))

    def test_side_that_cannot_be_topped_up_to_target_is_abandoned(self):
        # $4.40 spent of $25 leaves $20.60; two partly filled orders rest ($19.80).
        # Only one $0.60 top-up fits: the other side stays below Target, scores nothing, and goes.
        self.client.books = {T1: book(yes=[(98, 4000)], no=[(1, 990)]),
                             T2: book(no=[(98, 4000)], yes=[(1, 990)])}
        self.client.resting = [raw_order("r1", T1, remaining=990), raw_order("r2", T2, "yes", remaining=990)]
        self.client.history = [raw_order("gone", T1, remaining=0)]
        self.client.fill_list = [{"order_id": "gone", "outcome_side": "no", "no_price_dollars": "0.0100",
                                  "count_fp": "440.00"}]
        summary = self.bot().step(NOW)
        self.assertEqual(len(self.client.created), 1)
        kept = self.client.created[0][0]
        dropped = ({T1, T2} - {kept}).pop()
        self.assertEqual([c[1] for c in self.client.cancelled], [dropped])
        self.assertTrue(any("cannot keep side at Target" in line for line in self.logs))
        self.assertEqual(summary["est_per_hour"], Decimal(50))

    def test_side_kept_at_target_by_other_completers_is_not_abandoned(self):
        self.client.books = {T1: book(yes=[(98, 4000)], no=[(1, 2000)]), T2: book(yes=[(90, 10)])}
        self.client.resting = [raw_order("r1", T1, remaining=990)]
        self.bot(lb.Config(max_capital=Decimal("9.90"), max_fill_spend=Decimal(25))).step(NOW)
        self.assertEqual((self.client.created, self.client.cancelled), ([], []))

    def test_top_ups_go_before_new_orders(self):
        self.client.books = {T1: book(yes=[(98, 4000)], no=[(1, 700)]), T2: book(no=[(98, 4000)])}
        self.client.resting = [raw_order("r1", T1, remaining=700)]
        self.bot(lb.Config(max_capital=Decimal(12), max_fill_spend=Decimal(25))).step(NOW)
        self.assertEqual([(c[0], c[3]) for c in self.client.created], [(T1, WANT - 700)])

    def test_refused_placements_are_logged_once(self):
        self.client.programs.append(raw_program("KXTEMPMIAH-26SEP2615-T82.99"))
        self.client.books["KXTEMPMIAH-26SEP2615-T82.99"] = book(yes=[(98, 4000)])
        bot = self.bot(CONFIG, live=False)
        bot.step(NOW)
        bot.step(NOW + timedelta(seconds=10))
        self.assertEqual(sum("refused by caps" in line for line in self.logs), 1)

    def test_live_estimate_includes_orders_just_placed(self):
        summary = self.bot(ROOMY).step(NOW)
        self.assertEqual((summary["est_per_hour"], summary["resting"]), (Decimal(100), 2))

    def test_fill_window_starts_at_the_utc_day_so_restarts_keep_the_cap(self):
        bot = self.bot()
        self.assertEqual(bot.started_ts % 86400, 0)
        self.assertLessEqual(time.time() - bot.started_ts, 86400)

    def test_shutdown_that_never_lists_orders_is_reported_unverified(self):
        def down():
            raise requests.exceptions.ConnectionError("network down")
        self.client.resting_orders = down
        bot = self.bot()
        self.assertEqual(bot.shutdown(), [])
        self.assertFalse(bot.shutdown_verified)
        self.assertTrue(any("COULD NOT CONFIRM" in line for line in self.logs))

    def test_shutdown_ignores_repeated_stop_signals(self):
        names = [n for n in ("SIGINT", "SIGTERM", "SIGHUP") if hasattr(signal, n)]
        seen = []
        original = self.client.resting_orders
        self.client.resting_orders = lambda: seen.append(
            [signal.getsignal(getattr(signal, n)) for n in names]) or original()
        before = [signal.getsignal(getattr(signal, n)) for n in names]
        self.bot().shutdown()
        self.assertTrue(seen and all(h == signal.SIG_IGN for h in seen[0]))
        self.assertEqual([signal.getsignal(getattr(signal, n)) for n in names], before)

    def test_sleep_is_capped_by_the_next_end_buffer(self):
        bot = self.bot(live=False)
        bot.step(NOW)
        self.assertAlmostEqual(bot.seconds_to_next_deadline(NOW), 30 * 60 - 60)


class SignalTests(unittest.TestCase):
    def test_sigterm_and_sighup_raise_keyboard_interrupt(self):
        names = [n for n in ("SIGTERM", "SIGHUP") if hasattr(signal, n)]
        saved = {n: signal.getsignal(getattr(signal, n)) for n in names}
        try:
            lb.stop_on_signals()
            for name in names:
                with self.assertRaises(KeyboardInterrupt):
                    signal.getsignal(getattr(signal, name))(getattr(signal, name), None)
        finally:
            for name, handler in saved.items():
                signal.signal(getattr(signal, name), handler)


class CliTests(unittest.TestCase):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = lb.main(["run", *argv])
        return code, out.getvalue() + err.getvalue()

    def test_half_supplied_key_flags_are_refused(self):
        self.assertEqual(self.run_cli("--key-id", "abc")[0], 2)
        self.assertEqual(self.run_cli("--key-file", "x.txt")[0], 2)

    def test_unreadable_key_file_gets_a_plain_message(self):
        code, text = self.run_cli("--key-id", "abc", "--key-file", "no-such-file.txt")
        self.assertEqual(code, 2)
        self.assertIn("Can't read the key file", text)
        self.assertNotIn("Traceback", text)

    def test_rejected_key_stops_before_anything_else(self):
        response = requests.Response()
        response.status_code = 401

        def reject(client):
            raise requests.exceptions.HTTPError("401", response=response)
        originals = lb.KalshiClient.balance, lb.Signer.__dict__["from_pem_file"]
        lb.KalshiClient.balance = reject
        lb.Signer.from_pem_file = classmethod(lambda cls, path: cls(lambda m: b"s"))
        try:
            code, text = self.run_cli("--key-id", "abc", "--key-file", "key.txt", "--live")
        finally:
            lb.KalshiClient.balance, lb.Signer.from_pem_file = originals
        self.assertEqual(code, 2)
        self.assertIn("Kalshi rejected the key", text)

    def test_balance_reads_dollars_from_the_default_exchange(self):
        client = lb.KalshiClient(lb.PROD_URL, "KEY", lb.Signer(lambda m: b"s"))
        seen = []
        client.request = lambda method, path, params=None, body=None, signed=False: (
            seen.append((path, params, signed)) or {"balance": 10000, "balance_dollars": "100.00"})
        self.assertEqual(client.balance(), Decimal("100.00"))
        self.assertEqual(seen, [("/portfolio/balance", {"exchange_index": 0}, True)])


if __name__ == "__main__":
    unittest.main()
