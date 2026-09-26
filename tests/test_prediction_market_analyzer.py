"""Tests for prediction_market_analyzer. Run with: python -m unittest discover -s tests"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import prediction_market_analyzer as pma  # noqa: E402


def analyze(**raw):
    base = {"ticker": "T", "title": "t", "yes_bid": 50, "yes_ask": 52, "volume_24h": 5000,
            "close_time": "2030-01-01T00:00:00Z"}
    base.update(raw)
    market = pma.parse_market(base)
    return pma.UndervaluedAnalyzer([market]).calculate_value_score(market)


class RecommendationTests(unittest.TestCase):
    def test_longshot_is_never_a_buy(self):
        rec = analyze(yes_bid=5, yes_ask=7, volume_24h=0)["recommendation"]
        self.assertTrue(rec.startswith("AVOID YES"), rec)
        self.assertNotIn("Consider YES", rec)

    def test_favorite_does_not_recommend_the_cheap_no(self):
        rec = analyze(yes_bid=92, yes_ask=94, volume_24h=0)["recommendation"]
        self.assertTrue(rec.startswith("AVOID NO"), rec)

    def test_mid_price_irregular_market_is_watch_only(self):
        rec = analyze(yes_bid=40, yes_ask=60, volume_24h=0)["recommendation"]
        self.assertTrue(rec.startswith("WATCH"), rec)

    def test_efficient_mid_price_market_is_hold(self):
        rec = analyze(volume_24h=50000)["recommendation"]
        self.assertTrue(rec.startswith("HOLD"), rec)

    def test_missing_bid_is_not_read_as_a_longshot(self):
        rec = analyze(yes_bid=0, yes_ask=60, volume_24h=50000)["recommendation"]
        self.assertFalse(rec.startswith("AVOID"), rec)

    def test_unquoted_market_is_not_evaluated(self):
        rec = analyze(yes_bid=0, yes_ask=100)["recommendation"]
        self.assertTrue(rec.startswith("NO QUOTE"), rec)


class ParseTests(unittest.TestCase):
    def test_fixed_point_volume_fields(self):
        market = pma.parse_market({"ticker": "T", "volume_fp": "1200.00",
                                   "volume_24h_fp": "35.50", "open_interest_fp": "80.00"})
        self.assertEqual((market.volume, market.volume_24h, market.open_interest), (1200, 35, 80))

    def test_naive_close_time_does_not_crash_scoring(self):
        market = pma.parse_market({"ticker": "T", "yes_bid": 50, "yes_ask": 52,
                                   "close_time": "2030-01-01T00:00:00"})
        pma.UndervaluedAnalyzer([market]).calculate_value_score(market)

    def test_dollar_price_fields(self):
        market = pma.parse_market({"ticker": "T", "yes_bid_dollars": "0.4550",
                                   "yes_ask_dollars": "0.4700"})
        self.assertAlmostEqual(market.yes_bid, 45.5)
        self.assertAlmostEqual(market.yes_ask, 47.0)

    def test_missing_prices_default_to_zero(self):
        market = pma.parse_market({"ticker": "T"})
        self.assertEqual((market.yes_bid, market.yes_ask), (0, 0))


if __name__ == "__main__":
    unittest.main()
