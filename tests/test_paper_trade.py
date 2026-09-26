"""Tests for paper_trade. Run with: python -m unittest discover -s tests"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import arbitrage_scanner as arb  # noqa: E402
import paper_trade as pt  # noqa: E402

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
RULE = pt.Rule(sides=("yes",), min_ask=Decimal(40), max_ask=Decimal(70), max_spread=Decimal(2),
               hours_before=(1.0,))


def raw_market(minutes=60, bid="0.5400", ask="0.5500", status="active", early=False,
               occurrence_minutes=None):
    raw = {"ticker": "T", "event_ticker": "E", "title": "t", "status": status,
           "yes_bid_dollars": bid, "yes_ask_dollars": ask,
           "close_time": (NOW + timedelta(minutes=minutes)).isoformat(), "can_close_early": early}
    if occurrence_minutes is not None:
        raw["occurrence_datetime"] = (NOW + timedelta(minutes=occurrence_minutes)).isoformat()
    return raw


def entry_for(raw, rule=RULE, multiplier=Decimal(1)):
    entries = pt.rule_entries(raw, arb.parse_quote(raw), rule, multiplier, NOW)
    assert len(entries) <= 1
    return entries[0] if entries else None


class RuleTests(unittest.TestCase):
    def test_qualifying_market_is_entered_at_the_ask_with_fee(self):
        entry = entry_for(raw_market())
        self.assertEqual((entry["ask"], entry["bid"], entry["side"]), (55.0, 54.0, "yes"))
        # 0.07 x 100 x 0.55 x 0.45 = $1.7325 -> $1.74 per 100 lots.
        self.assertAlmostEqual(entry["fee"], 1.74)
        self.assertIsNone(entry["result"])

    def test_window_price_and_spread_limits(self):
        self.assertIsNone(entry_for(raw_market(minutes=50)))
        self.assertIsNone(entry_for(raw_market(minutes=70)))
        self.assertIsNone(entry_for(raw_market(bid="0.3800", ask="0.3900")))
        self.assertIsNone(entry_for(raw_market(bid="0.6900", ask="0.7000")))
        self.assertIsNone(entry_for(raw_market(bid="0.5100", ask="0.5500")))
        self.assertIsNone(entry_for(raw_market(status="closed")))
        self.assertIsNotNone(entry_for(raw_market(bid="0.6700", ask="0.6900")))

    def test_early_close_markets_timed_from_scheduled_event_not_close(self):
        # A sports prop lists a far-off latest close; only its event time counts.
        far_close = raw_market(minutes=60 * 48, early=True, occurrence_minutes=60)
        self.assertIsNotNone(entry_for(far_close))
        close_in_an_hour = raw_market(minutes=60, early=True, occurrence_minutes=300)
        self.assertIsNone(entry_for(close_in_an_hour))
        self.assertIsNone(entry_for(raw_market(minutes=60, early=True)))   # no event time

    def test_unknown_timing_is_skipped(self):
        raw = raw_market()
        raw["can_close_early"] = None
        self.assertIsNone(entry_for(raw))

    def test_no_side_uses_no_prices(self):
        rule = pt.Rule(sides=("no",), min_ask=Decimal(40), max_ask=Decimal(50))
        entry = entry_for(raw_market(), rule)
        self.assertEqual((entry["side"], entry["ask"], entry["bid"]), ("no", 46.0, 45.0))

    def test_series_multiplier_scales_fee(self):
        self.assertAlmostEqual(entry_for(raw_market(), multiplier=Decimal("0.5"))["fee"], 0.87)

    def test_both_sides_and_several_horizons(self):
        rule = pt.Rule(sides=("yes", "no"), min_ask=Decimal(95), max_ask=Decimal(100),
                       max_spread=Decimal(2), hours_before=(2.0, 4.0))
        expensive_yes = raw_market(minutes=120, bid="0.9600", ask="0.9700")
        cheap_yes = raw_market(minutes=240, bid="0.0200", ask="0.0300")
        [yes] = pt.rule_entries(expensive_yes, arb.parse_quote(expensive_yes), rule, Decimal(1), NOW)
        [no] = pt.rule_entries(cheap_yes, arb.parse_quote(cheap_yes), rule, Decimal(1), NOW)
        self.assertEqual((yes["side"], yes["ask"], yes["hours_before"]), ("yes", 97.0, 2.0))
        self.assertEqual((no["side"], no["ask"], no["hours_before"]), ("no", 98.0, 4.0))
        self.assertNotEqual(pt.entry_key(yes), pt.entry_key(dict(yes, hours_before=4.0)))


class ScoreTests(unittest.TestCase):
    def entry(self, result, event="E", ask=55.0, fee=1.74, side="yes"):
        return {"ticker": "T", "event_ticker": event, "ask": ask, "fee": fee,
                "result": result, "side": side}

    def test_pnl(self):
        self.assertAlmostEqual(pt.pnl(self.entry("yes")), 100 - 55 - 1.74)
        self.assertAlmostEqual(pt.pnl(self.entry("no")), -(55 + 1.74))
        self.assertAlmostEqual(pt.pnl(self.entry("no", side="no")), 100 - 55 - 1.74)

    def test_summary_ignores_unsettled_and_scalar(self):
        entries = [self.entry("yes", "a"), self.entry("no", "b"), self.entry(None, "c"),
                   self.entry("scalar", "d")]
        text = pt.summarize(entries)
        self.assertIn("4 entries, 2 settled", text)
        self.assertIn("won 1/2 (50.0%)", text)

    def test_summary_without_settled_entries(self):
        self.assertEqual(pt.summarize([self.entry(None)]), "1 entries, 0 settled")

    def test_save_and_load_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x", "log.jsonl")
            pt.save([self.entry("yes")], path)
            self.assertEqual(pt.load(path), [self.entry("yes")])


if __name__ == "__main__":
    unittest.main()
