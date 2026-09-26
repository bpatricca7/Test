"""Tests for arbitrage_scanner. Run with: python -m unittest discover -s tests"""

import contextlib
import io
import os
import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import arbitrage_scanner as arb  # noqa: E402
import requests  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample_markets.json")
NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
CLOSE = "2026-09-26T21:00:00Z"
FEES = arb.FeeModel()


def market(ticker, event="EV", **fields):
    raw = {"ticker": ticker, "event_ticker": event, "title": ticker, "status": "active",
           "close_time": CLOSE}
    raw.update(fields)
    return raw


def quotes(*raws):
    return [arb.parse_quote(r) for r in raws]


class FeeTests(unittest.TestCase):
    def test_single_contract_at_50_rounds_up_to_2_cents(self):
        # 0.07 x 1 x 0.50 x 0.50 = $0.0175 -> 2c
        self.assertEqual(arb.taker_fee_cents(Decimal(50), 1), Decimal(2))

    def test_hundred_contracts_at_50(self):
        # 0.07 x 100 x 0.25 = $1.75 exactly
        self.assertEqual(arb.taker_fee_cents(Decimal(50), 100), Decimal(175))

    def test_hundred_contracts_at_1_cent(self):
        # 0.07 x 100 x 0.01 x 0.99 = $0.0693 -> 7c
        self.assertEqual(arb.taker_fee_cents(Decimal(1), 100), Decimal(7))

    def test_subpenny_price(self):
        # 0.07 x 10 x 0.455 x 0.545 = $0.1735825 -> 18c
        self.assertEqual(arb.taker_fee_cents(Decimal("45.5"), 10), Decimal(18))

    def test_untradable_price_and_zero_size_cost_nothing(self):
        self.assertEqual(arb.taker_fee_cents(Decimal(0), 10), 0)
        self.assertEqual(arb.taker_fee_cents(Decimal(100), 10), 0)
        self.assertEqual(arb.taker_fee_cents(Decimal(50), 0), 0)

    def test_broker_fee_added_per_contract(self):
        self.assertEqual(arb.taker_fee_cents(Decimal(50), 100, extra_per_contract=Decimal(1)),
                         Decimal(275))


class TimeTests(unittest.TestCase):
    def test_trimmed_fractional_seconds_parse_on_any_python(self):
        # Kalshi drops trailing zeros; Python < 3.11 only accepts 3 or 6 digits.
        self.assertEqual(arb.parse_time("2026-09-26T17:16:49.46391Z"),
                         datetime(2026, 9, 26, 17, 16, 49, 463910, tzinfo=timezone.utc))
        self.assertEqual(arb.parse_time("2026-09-26T17:16:49.1234567Z").microsecond, 123456)
        self.assertEqual(arb.parse_time("2026-09-26T17:16:49Z").microsecond, 0)
        self.assertIsNone(arb.parse_time("not a time"))


class ParseTests(unittest.TestCase):
    def test_dollar_fields_preferred_over_cents(self):
        q = arb.parse_quote(market("X", yes_bid=10, yes_bid_dollars="0.4550"))
        self.assertEqual(q.yes_bid, Decimal("45.5"))

    def test_cent_fields_used_when_no_dollar_fields(self):
        q = arb.parse_quote(market("X", yes_bid=45, yes_ask=47, no_bid=53, no_ask=55))
        self.assertEqual((q.yes_bid, q.yes_ask, q.no_bid, q.no_ask),
                         (Decimal(45), Decimal(47), Decimal(53), Decimal(55)))

    def test_no_side_derived_from_yes_side_when_missing(self):
        q = arb.parse_quote(market("X", yes_bid=45, yes_ask=47))
        self.assertEqual((q.no_ask, q.no_bid), (Decimal(55), Decimal(53)))

    def test_missing_prices_are_none_and_untradable(self):
        q = arb.parse_quote(market("X"))
        self.assertIsNone(q.yes_ask)
        self.assertFalse(arb.tradable(q.yes_ask))


class NoBasketTests(unittest.TestCase):
    def test_finds_basket_when_yes_bids_sum_past_100_after_fees(self):
        qs = quotes(market("A", no_ask=55), market("B", no_ask=60), market("C", no_ask=70))
        opp = arb.find_no_basket("EV", "t", qs, 1, FEES)
        # Fees 2c each. Cost 55 + 60 + 70 + 6 = 191; two of three NOs always pay: 200.
        self.assertIsNotNone(opp)
        self.assertEqual(opp.payout, Decimal(200))
        self.assertEqual(opp.cost, Decimal(191))
        self.assertEqual(opp.profit, Decimal(9))

    def test_leg_that_cannot_cover_its_fee_is_left_out(self):
        qs = quotes(market("A", no_ask=55), market("B", no_ask=60), market("C", no_ask=70),
                    market("D", no_ask=99))
        opp = arb.find_no_basket("EV", "t", qs, 1, FEES)
        # D adds 1c of edge but costs a 1c fee at size 1, so it is dropped.
        self.assertEqual([leg.ticker for leg in opp.legs], ["A", "B", "C"])
        self.assertEqual(opp.profit, Decimal(9))

    def test_none_when_fees_eat_the_edge(self):
        qs = quotes(market("A", no_ask=49), market("B", no_ask=50))
        # 99c for a $1 payout before fees, but two 2c fees make it 103c.
        self.assertIsNone(arb.find_no_basket("EV", "t", qs, 1, FEES))

    def test_duplicate_rows_counted_once(self):
        # Counting A twice would claim $2 of payout; if A wins, only B pays $1.
        qs = quotes(market("A", no_ask=55), market("A", no_ask=55), market("B", no_ask=60))
        self.assertIsNone(arb.find_no_basket("EV", "t", qs, 1, FEES))

    def test_thin_leg_dropped_instead_of_capping_the_basket(self):
        legs = [arb.Leg("A", "no", Decimal(40), depth=Decimal(100)),
                arb.Leg("B", "no", Decimal(55), depth=Decimal(100)),
                arb.Leg("D", "no", Decimal(97), depth=Decimal(1))]
        opp = arb.Opportunity("no_basket", "EV", "t", legs, Decimal(200), 10, None)
        best = arb.best_no_basket(opp, legs, FEES)
        # All three legs fit only 1 set (3c profit); A and B alone fill 10 sets:
        # (60 x 10 - 17) + (45 x 10 - 18) - 1000 = 15c.
        self.assertEqual([leg.ticker for leg in best.legs], ["A", "B"])
        self.assertEqual((best.contracts, best.payout_per_set, best.profit),
                         (10, Decimal(100), Decimal(15)))

    def test_closed_markets_ignored(self):
        qs = quotes(market("A", no_ask=55), market("B", no_ask=60, status="closed"))
        self.assertIsNone(arb.find_no_basket("EV", "t", qs, 1, FEES))


class YesBasketTests(unittest.TestCase):
    def setUp(self):
        self.qs = quotes(market("L", yes_ask=30), market("M", yes_ask=30), market("H", yes_ask=35))

    def test_rounding_makes_small_sizes_unprofitable(self):
        # 95c of asks + three 2c fees = 101c for a $1 payout.
        self.assertIsNone(arb.find_yes_basket("EV", "t", self.qs, 1, FEES))

    def test_profitable_at_size(self):
        opp = arb.find_yes_basket("EV", "t", self.qs, 100, FEES)
        # Fees 147 + 147 + 160 = 454c; cost 9500 + 454 = 9954c; payout 10000c.
        self.assertEqual(opp.cost, Decimal(9954))
        self.assertEqual(opp.profit, Decimal(46))
        self.assertIn("every possible outcome", opp.caveat)

    def test_deep_discount_means_missing_outcomes_not_profit(self):
        # Asks summing to 12c: the market says the winner is probably not listed.
        qs = quotes(market("A", yes_ask=5), market("B", yes_ask=4), market("C", yes_ask=3))
        self.assertIsNone(arb.find_yes_basket("EV", "t", qs, 100, FEES))

    def test_requires_every_market_open_and_offered(self):
        qs = self.qs + quotes(market("X", yes_ask=100))
        self.assertIsNone(arb.find_yes_basket("EV", "t", qs, 100, FEES))


class LadderTests(unittest.TestCase):
    def test_above_ladder_inversion(self):
        qs = quotes(
            market("T60", strike_type="greater", floor_strike=60000, yes_ask=70, no_ask=32),
            market("T61", strike_type="greater", floor_strike=61000, yes_ask=77, no_ask=25),
        )
        [opp] = arb.find_strike_ladders("EV", "t", qs, 1, FEES)
        self.assertEqual([(l.ticker, l.side) for l in opp.legs], [("T60", "yes"), ("T61", "no")])
        # 70 + 25 + 2 + 2 = 99c for a guaranteed $1.
        self.assertEqual(opp.profit, Decimal(1))

    def test_below_ladder_inversion(self):
        qs = quotes(
            market("B40", strike_type="less", cap_strike=4000, yes_ask=57, no_ask=45),
            market("B41", strike_type="less", cap_strike=4100, yes_ask=50, no_ask=52),
        )
        [opp] = arb.find_strike_ladders("EV", "t", qs, 1, FEES)
        self.assertEqual([(l.ticker, l.side) for l in opp.legs], [("B41", "yes"), ("B40", "no")])
        self.assertEqual(opp.profit, Decimal(1))

    def test_consistent_ladder_has_no_opportunity(self):
        qs = quotes(
            market("T60", strike_type="greater", floor_strike=60000, yes_ask=70, no_ask=32),
            market("T61", strike_type="greater", floor_strike=61000, yes_ask=55, no_ask=47),
        )
        self.assertEqual(arb.find_strike_ladders("EV", "t", qs, 1, FEES), [])

    def test_different_underlyings_never_paired(self):
        qs = quotes(
            market("BTC60", title="Bitcoin above 60,000?", strike_type="greater",
                   floor_strike=60000, yes_ask=70, no_ask=32),
            market("ETH61", title="Ethereum above 61,000?", strike_type="greater",
                   floor_strike=61000, yes_ask=77, no_ask=25),
        )
        self.assertEqual(arb.find_strike_ladders("EV", "t", qs, 1, FEES), [])

    def test_rules_text_decides_underlying_when_present(self):
        rules = "Resolves Yes if the BTC index is above {} at 5pm ET."
        qs = quotes(
            market("T60", title="$60k", rules_primary=rules.format("60,000.00"),
                   strike_type="greater", floor_strike=60000, yes_ask=70, no_ask=32),
            market("T61", title="$61k or more", rules_primary=rules.format("61,000.00"),
                   strike_type="greater", floor_strike=61000, yes_ask=77, no_ask=25),
        )
        self.assertEqual(len(arb.find_strike_ladders("EV", "t", qs, 1, FEES)), 1)

    def test_unknown_expiry_never_paired(self):
        qs = quotes(
            market("T60", strike_type="greater", floor_strike=60000, yes_ask=70, no_ask=32,
                   close_time=None),
            market("T61", strike_type="greater", floor_strike=61000, yes_ask=77, no_ask=25,
                   close_time=None),
        )
        self.assertEqual(arb.find_strike_ladders("EV", "t", qs, 1, FEES), [])

    def test_exact_value_markets_labeled_less_are_not_thresholds(self):
        # Real Kalshi shape (KXSTARSHIPSPACE-26, 2026-09-26): "exactly N" markets carry
        # strike_type "less" with floor == cap. YES "exactly 9" + NO "exactly 5" both
        # lose if exactly 5 happens, so this must never be reported as a ladder.
        rules = "If exactly {} Starship launches reach Space in 2026, then the market resolves to Yes."
        qs = quotes(
            market("S-5.0", strike_type="less", floor_strike=5, cap_strike=5,
                   rules_primary=rules.format(5), yes_bid_dollars="0.4400", yes_ask_dollars="0.4900",
                   no_ask_dollars="0.5600"),
            market("S-9.0", strike_type="less", floor_strike=9, cap_strike=9,
                   rules_primary=rules.format(9), yes_bid_dollars="0.0000", yes_ask_dollars="0.0100",
                   no_ask_dollars="1.0000"),
        )
        self.assertEqual(arb.find_strike_ladders("EV", "t", qs, 100, FEES), [])

    def test_different_expiries_never_paired(self):
        qs = quotes(
            market("T60", strike_type="greater", floor_strike=60000, yes_ask=70, no_ask=32),
            market("T61", strike_type="greater", floor_strike=61000, yes_ask=77, no_ask=25,
                   close_time="2026-09-27T21:00:00Z"),
        )
        self.assertEqual(arb.find_strike_ladders("EV", "t", qs, 1, FEES), [])


class OrderbookTests(unittest.TestCase):
    def test_cent_levels(self):
        ob = {"orderbook": {"yes": [[40, 100], [45, 20]], "no": [[50, 10], [53, 7]]}}
        self.assertEqual(arb.best_ask_from_orderbook(ob, "yes"), (Decimal(47), Decimal(7)))
        self.assertEqual(arb.best_ask_from_orderbook(ob, "no"), (Decimal(55), Decimal(20)))

    def test_dollar_levels(self):
        ob = {"orderbook_fp": {"yes_dollars": [["0.4000", "100.00"]],
                               "no_dollars": [["0.5300", "7.00"]]}}
        self.assertEqual(arb.best_ask_from_orderbook(ob, "yes"), (Decimal("47.00"), Decimal("7.00")))

    def test_malformed_levels_ignored(self):
        ob = {"orderbook_fp": {"no_dollars": ["0.5300", {"price": 1}, [None, "5"], ["0.5000", "4.00"]]}}
        self.assertEqual(arb.best_ask_from_orderbook(ob, "yes"), (Decimal("50.00"), Decimal("4.00")))

    def test_empty_side_has_no_ask(self):
        self.assertIsNone(arb.best_ask_from_orderbook({"orderbook": {"yes": None, "no": []}}, "yes"))


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.client = arb.FixtureClient.from_file(FIXTURE)

    def test_fixture_scan_finds_each_kind_sized_to_depth(self):
        opps = arb.scan(self.client, contracts=10, now=NOW)
        by_kind = {o.kind: o for o in opps}
        self.assertEqual([o.kind for o in opps], ["no_basket", "strike_ladder", "yes_basket"])

        no_basket = by_kind["no_basket"]
        # Candidate C only has 6 contracts bid at 30c, so the basket shrinks to 6 sets.
        self.assertEqual(no_basket.contracts, 6)
        self.assertTrue(no_basket.depth_checked)
        self.assertEqual(no_basket.cost, Decimal(1736))
        self.assertEqual(no_basket.payout, Decimal(1800))
        self.assertEqual(no_basket.profit, Decimal(64))

        ladder = by_kind["strike_ladder"]
        self.assertEqual(ladder.contracts, 10)
        self.assertEqual(ladder.profit, Decimal(21))

        self.assertEqual(by_kind["yes_basket"].profit, Decimal(4))

    def test_without_depth_check_uses_snapshot_size(self):
        opps = arb.scan(self.client, contracts=10, depth_check=False, now=NOW)
        no_basket = next(o for o in opps if o.kind == "no_basket")
        self.assertEqual(no_basket.contracts, 10)
        self.assertFalse(no_basket.depth_checked)

    def test_closing_window_excludes_later_markets(self):
        self.assertEqual(arb.scan(self.client, closing_within_hours=24, now=NOW), [])

    def test_leg_without_offers_drops_opportunity(self):
        data = dict(self.client.data)
        data["orderbooks"] = dict(data["orderbooks"], **{"DEMO-BTC-T61000": {"orderbook": {}}})
        opps = arb.scan(arb.FixtureClient(data), contracts=10, now=NOW)
        self.assertNotIn("strike_ladder", [o.kind for o in opps])

    def test_yes_basket_skipped_when_event_lists_no_markets(self):
        data = dict(self.client.data)
        data["events"] = dict(data["events"], **{
            "DEMO-RAIN": {"event_ticker": "DEMO-RAIN", "mutually_exclusive": True}})
        opps = arb.scan(arb.FixtureClient(data), contracts=10, now=NOW)
        self.assertNotIn("yes_basket", [o.kind for o in opps])

    def test_shared_leg_depth_is_not_double_counted(self):
        data = dict(self.client.data)
        data["markets"] = data["markets"] + [
            {"ticker": "DEMO-BTC-T61500", "event_ticker": "DEMO-BTC", "title": "Demo BTC above $61,500",
             "status": "active", "strike_type": "greater", "floor_strike": 61500,
             "yes_bid": 76, "yes_ask": 78, "no_bid": 22, "no_ask": 24, "close_time": "2030-01-01T00:00:00Z"}]
        data["orderbooks"] = dict(data["orderbooks"], **{
            "DEMO-BTC-T61500": {"orderbook": {"yes": [[76, 100]], "no": [[22, 100]]}}})
        ladders = [o for o in arb.scan(arb.FixtureClient(data), contracts=40, now=NOW)
                   if o.kind == "strike_ladder"]
        # Both ladders buy YES on T60000, which has only 40 contracts offered.
        self.assertEqual(sum(o.contracts for o in ladders
                             if o.legs[0].ticker == "DEMO-BTC-T60000"), 40)
        self.assertEqual(ladders[0].legs[1].ticker, "DEMO-BTC-T61500")

    def test_yes_basket_not_labeled_guaranteed(self):
        yes_basket = next(o for o in arb.scan(self.client, contracts=10, now=NOW)
                          if o.kind == "yes_basket")
        self.assertFalse(yes_basket.to_dict(NOW)["payout_guaranteed"])
        self.assertIn("payout IF outcomes are exhaustive", arb.format_opportunity(1, yes_basket, NOW))

    def test_series_fee_multiplier_applied(self):
        data = dict(self.client.data)
        data["series"] = dict(data["series"], DEMOBTC={"fee_type": "quadratic", "fee_multiplier": 2})
        opps = arb.scan(arb.FixtureClient(data), contracts=10, now=NOW)
        # Doubled fees: YES 70c -> 30c fee, NO 25c -> 27c fee; 950 + 57 = 1007c > $10.
        self.assertNotIn("strike_ladder", [o.kind for o in opps])

    def test_event_override_beats_series_multiplier(self):
        data = dict(self.client.data)
        data["events"] = dict(data["events"])
        data["events"]["DEMO-BTC"] = dict(data["events"]["DEMO-BTC"], fee_multiplier_override="0.5")
        ladder = next(o for o in arb.scan(arb.FixtureClient(data), contracts=10, now=NOW)
                      if o.kind == "strike_ladder")
        # Halved fees: 0.035 x 10 x 0.70 x 0.30 -> 8c, 0.035 x 10 x 0.25 x 0.75 -> 7c.
        self.assertEqual(ladder.profit, Decimal(50 - 15))

    def test_unconfirmed_fees_are_skipped_not_guessed(self):
        data = dict(self.client.data)
        data["series"] = dict(data["series"], DEMOBTC={}, DEMOPRES={"fee_type": "flat", "fee_multiplier": 1})
        skipped = []
        opps = arb.scan(arb.FixtureClient(data), contracts=10, now=NOW, skipped=skipped)
        self.assertEqual([o.kind for o in opps], ["yes_basket"])
        self.assertEqual(sorted(skipped), ["DEMO-BTC", "DEMO-PRES"])

    def test_zero_or_negative_fee_override_is_not_trusted(self):
        for override in ("0", "-1"):
            data = dict(self.client.data)
            data["events"] = dict(data["events"])
            data["events"]["DEMO-BTC"] = dict(data["events"]["DEMO-BTC"],
                                              fee_multiplier_override=override)
            skipped = []
            arb.scan(arb.FixtureClient(data), contracts=10, now=NOW, skipped=skipped)
            self.assertIn("DEMO-BTC", skipped)

    def test_request_error_skips_event_instead_of_aborting(self):
        class Flaky(arb.FixtureClient):
            def get_event(self, event_ticker):
                if event_ticker == "DEMO-PRES":
                    raise requests.exceptions.ConnectionError("boom")
                return super().get_event(event_ticker)

            def get_orderbook(self, ticker):
                if ticker == "DEMO-RAIN-HIGH":
                    raise requests.exceptions.HTTPError("503")
                return super().get_orderbook(ticker)

        skipped = []
        opps = arb.scan(Flaky(self.client.data), contracts=10, now=NOW, skipped=skipped)
        self.assertEqual([o.kind for o in opps], ["strike_ladder"])
        self.assertEqual(sorted(skipped), ["DEMO-PRES", "DEMO-RAIN"])

    def test_naive_close_time_is_utc(self):
        data = dict(self.client.data)
        data["markets"] = [dict(m, close_time="2030-01-01T00:00:00") for m in data["markets"]]
        self.assertTrue(arb.scan(arb.FixtureClient(data), contracts=10, now=NOW))

    def test_cli_rejects_values_that_would_fake_profit(self):
        for bad in (["--contracts", "0"], ["--extra-fee-cents", "-1"], ["--fee-rate", "nan"],
                    ["--closing-within-hours", "inf"], ["--max-pages", "-3"]):
            with self.subTest(bad=bad), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    arb.main(["--fixture", FIXTURE] + bad)

    def test_one_way_ladders_skip_basket_lookups(self):
        calls = []

        class Counting(arb.FixtureClient):
            def get_event(self, event_ticker):
                calls.append(event_ticker)
                return super().get_event(event_ticker)

        arb.scan(Counting(self.client.data), contracts=10, now=NOW)
        # DEMO-SPX is all "below" strikes with no inverted pair: nothing to check.
        self.assertNotIn("DEMO-SPX", calls)
        self.assertIn("DEMO-BTC", calls)

    def test_repeated_scans_reuse_event_and_series_details(self):
        calls = []

        class Counting(arb.FixtureClient):
            def get_event(self, event_ticker):
                calls.append(("event", event_ticker))
                return super().get_event(event_ticker)

            def get_series(self, series_ticker):
                calls.append(("series", series_ticker))
                return super().get_series(series_ticker)

        client, cache = Counting(self.client.data), {}
        first = arb.scan(client, contracts=10, now=NOW, cache=cache)
        calls.clear()
        second = arb.scan(client, contracts=10, now=NOW, cache=cache)
        self.assertEqual([o.profit for o in first], [o.profit for o in second])
        # Only the YES basket re-reads its event, for current prices.
        self.assertEqual(calls, [("event", "DEMO-RAIN")])

    def test_failed_series_lookup_is_retried_next_scan(self):
        attempts = []

        class FlakySeries(arb.FixtureClient):
            def get_series(self, series_ticker):
                attempts.append(series_ticker)
                if len(attempts) == 1:
                    raise requests.exceptions.ConnectionError("boom")
                return super().get_series(series_ticker)

        client, cache, skipped = FlakySeries(self.client.data), {}, []
        arb.scan(client, contracts=10, now=NOW, cache=cache, skipped=skipped)
        self.assertEqual(len(skipped), 1)
        opps = arb.scan(client, contracts=10, now=NOW, cache=cache)
        self.assertEqual(len(opps), 3)

    def test_repeat_mode_prints_new_opportunities_then_stops_on_ctrl_c(self):
        sleeps = []

        def fake_sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 2:
                raise KeyboardInterrupt

        out = io.StringIO()
        real_sleep, arb.time.sleep = arb.time.sleep, fake_sleep
        try:
            with contextlib.redirect_stdout(out):
                self.assertEqual(arb.main(["--fixture", FIXTURE, "--repeat", "5"]), 0)
        finally:
            arb.time.sleep = real_sleep
        text = out.getvalue()
        self.assertEqual(sleeps, [5.0, 5.0])
        self.assertIn("3 live, 3 new", text)
        self.assertIn("3 live, 0 new", text)
        self.assertEqual(text.count("[no_basket] DEMO-PRES"), 1)
        self.assertIn("Stopped.", text)

    def test_cli_runs_offline(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(arb.main(["--fixture", FIXTURE]), 0)
        self.assertIn("[no_basket] DEMO-PRES", out.getvalue())


if __name__ == "__main__":
    unittest.main()
