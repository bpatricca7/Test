"""Tests for backtest. Run with: python -m unittest discover -s tests"""

import os
import sys
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest as bt  # noqa: E402

SERIES = {"S": {"category": "Crypto", "fee_type": "quadratic", "fee_multiplier": 1},
          "HALF": {"category": "Financials", "fee_type": "quadratic", "fee_multiplier": 0.5},
          "ODD": {"category": "Other", "fee_type": "flat", "fee_multiplier": 1}}
CLOSE = 1_790_000_000


def market(ticker="S-1", series="S", result="yes", candles=None, event="S-EV"):
    return {"ticker": ticker, "event_ticker": event, "series": series, "result": result,
            "close_ts": CLOSE, "can_close_early": False, "occurrence_ts": None,
            "candles": candles if candles is not None else [
                [CLOSE - 25 * 3600, 60.0, 64.0],   # 25h before close
                [CLOSE - 2 * 3600, 70.0, 72.0],    # 2h before close
                [CLOSE - 3600, 80.0, 82.0],        # 1h before close
            ]}


class QuoteTests(unittest.TestCase):
    def test_latest_candle_at_or_before_time(self):
        candles = market()["candles"]
        self.assertEqual(bt.quote_at(candles, CLOSE - 3600), (80.0, 82.0))
        self.assertEqual(bt.quote_at(candles, CLOSE - 90 * 60), (70.0, 72.0))
        self.assertEqual(bt.quote_at(candles, CLOSE - 24 * 3600), (60.0, 64.0))
        self.assertIsNone(bt.quote_at(candles, CLOSE - 30 * 3600))

    def test_unsorted_candles(self):
        candles = list(reversed(market()["candles"]))
        self.assertEqual(bt.quote_at(candles, CLOSE - 3600), (80.0, 82.0))


class TradeTests(unittest.TestCase):
    def test_yes_and_no_entries_priced_at_the_ask_with_fees(self):
        trades = bt.trades_for([market()], SERIES)
        one_hour = {t["side"]: t for t in trades if t["horizon"] == 1}
        # YES at the 82c ask wins $1; fee on 100 lots: 0.07*100*0.82*0.18 = $1.0332 -> $1.04.
        self.assertAlmostEqual(one_hour["yes"]["cost"], 82 + 1.04)
        self.assertAlmostEqual(one_hour["yes"]["pnl"], 100 - 82 - 1.04)
        # NO costs 100 - 80 bid = 20c and loses; fee 0.07*100*0.2*0.8 = $1.12.
        self.assertAlmostEqual(one_hour["no"]["pnl"], -(20 + 1.12))

    def test_spread_recorded_for_filtering(self):
        trades = bt.trades_for([market()], SERIES)
        self.assertEqual({t["spread"] for t in trades if t["horizon"] == 1}, {2.0})

    def test_early_close_markets_are_timed_from_the_scheduled_event(self):
        # A prop that closed the moment YES happened: its actual close must not be
        # used. Entries count back from the scheduled start (3h after close here),
        # and entry times at or after the actual close are impossible.
        m = market()
        m.update(can_close_early=True, occurrence_ts=CLOSE + 3 * 3600)
        trades = bt.trades_for([m], SERIES)
        self.assertEqual({t["horizon"] for t in trades}, {4, 8, 24})
        four = next(t for t in trades if t["horizon"] == 4 and t["side"] == "yes")
        self.assertEqual(four["price"], 82.0)      # quote 1h before the actual close
        self.assertTrue(four["early_close"])

    def test_unknown_timing_is_skipped(self):
        for fields in ({"can_close_early": None}, {"can_close_early": True, "occurrence_ts": None}):
            m = market()
            m.update(fields)
            self.assertEqual(bt.trades_for([m], SERIES), [])

    def test_fixed_close_only_drops_early_close_markets(self):
        m = market()
        m.update(can_close_early=True, occurrence_ts=CLOSE + 3 * 3600)
        self.assertEqual(bt.trades_for([m], SERIES, fixed_close_only=True), [])

    def test_series_multiplier_scales_fees(self):
        trades = bt.trades_for([market(series="HALF")], SERIES)
        yes = next(t for t in trades if t["horizon"] == 1 and t["side"] == "yes")
        # 0.035*100*0.82*0.18 = $0.5166 -> $0.52 per 100 lots.
        self.assertAlmostEqual(yes["cost"], 82 + 0.52)

    def test_unknown_fee_structure_and_missing_series_skipped(self):
        self.assertEqual(bt.trades_for([market(series="ODD")], SERIES), [])
        self.assertEqual(bt.trades_for([market(series="NOPE")], SERIES), [])

    def test_untradable_quotes_skipped(self):
        m = market(candles=[[CLOSE - 3600, 0.0, 100.0], [CLOSE - 7200, None, None]])
        self.assertEqual(bt.trades_for([m], SERIES), [])

    def test_horizon_without_a_quote_yet_is_skipped(self):
        trades = bt.trades_for([market(candles=[[CLOSE - 3600, 80.0, 82.0]])], SERIES)
        self.assertEqual({t["horizon"] for t in trades}, {1})


class EvaluateTests(unittest.TestCase):
    def trade(self, event, ts, pnl, cost=50.0, side="yes", price=50.0, horizon=1, category="Crypto"):
        return {"event": event, "close_ts": ts, "pnl": pnl, "cost": cost, "side": side,
                "price": price, "horizon": horizon, "category": category, "series": "S"}

    def test_roi_is_cost_weighted(self):
        trades = [self.trade("a", 0, 10, cost=90), self.trade("b", 0, -5, cost=10)]
        self.assertAlmostEqual(bt.roi(trades), 5 / 100)

    def test_rules_split_by_time_and_need_enough_events(self):
        trades = ([self.trade(f"e{i}", 100, 5) for i in range(30)]
                  + [self.trade(f"f{i}", 300, -5) for i in range(30)])
        [rule_all, rule_cat] = sorted(bt.evaluate(trades, split_ts=200), key=lambda r: r["rule"][3])
        self.assertEqual(rule_all["rule"], ("yes", "50-60c", 1, "All"))
        self.assertAlmostEqual(rule_all["train_roi"], 0.1)
        self.assertAlmostEqual(rule_all["test_roi"], -0.1)
        self.assertEqual(bt.evaluate(trades[:29] + trades[30:], split_ts=200), [])

    def test_bootstrap_resamples_events_not_trades(self):
        # One event with 50 winning strikes and 29 single losing events: the
        # interval must reflect 30 events, so it should comfortably include zero.
        trades = [self.trade("big", 0, 50) for _ in range(50)]
        trades += [self.trade(f"l{i}", 0, -50) for i in range(29)]
        low, high = bt.event_bootstrap(trades)
        self.assertLess(low, 0)
        self.assertGreater(high, 0)

    def test_momentum_move_is_toward_the_side_bought(self):
        up = self.trade("a", 0, 5, side="yes")
        up["move"] = 10.0                      # YES price rose 10c
        down_for_no = self.trade("b", 0, 5, side="no")
        down_for_no["move"] = 10.0             # same rise is a 10c fall for NO
        rules = bt.momentum_rules([up, down_for_no])
        self.assertEqual(rules[("momentum", "+5..+15c", 1, "All")], [up])
        self.assertEqual(rules[("momentum", "-15..-5c", 1, "All")], [down_for_no])

    def test_momentum_ignores_entries_without_a_move(self):
        t = self.trade("a", 0, 5)
        t["move"] = None
        self.assertEqual(bt.momentum_rules([t]), {})

    def test_credit_value_counts_only_winning_profit(self):
        wins = [self.trade(f"w{i}", 0, pnl=48.0, cost=52.0, price=50.0) for i in range(100)]
        losses = [self.trade(f"l{i}", 0, pnl=-52.0, cost=52.0, price=50.0) for i in range(100)]
        [(band, per_dollar, win_rate, n)] = bt.credit_value(wins + losses)
        self.assertEqual((band, n), ("50-60c", 200))
        self.assertAlmostEqual(win_rate, 0.5)
        self.assertAlmostEqual(per_dollar, 0.5 * 48 / 52)

    def test_loss_rate_bound_rule_of_three(self):
        # Zero losses in 300 trials: the 95% upper bound is about 3/300.
        self.assertAlmostEqual(bt.loss_rate_upper(0, 300), 0.00994, places=4)
        self.assertEqual(bt.loss_rate_upper(5, 5), 1.0)
        self.assertGreater(bt.loss_rate_upper(3, 100), 0.03)

    def test_worst_case_roi_punishes_unseen_losses(self):
        # 100 wins at 97c and no losses looks like +2%, but a 3% loss rate
        # (inside the 95% bound for 100 trials) would lose money.
        trades = [self.trade(f"w{i}", 0, pnl=2.8, cost=97.2, price=97.0) for i in range(100)]
        self.assertGreater(bt.roi(trades), 0)
        self.assertLess(bt.worst_case_roi(trades), 0)

    def test_h2_selects_expensive_tight_entries_in_its_categories(self):
        base = dict(pnl=2.0, cost=97.2, price=97.0, category="Economics")
        keep = self.trade("a", 0, horizon=2, **base)
        keep["spread"] = 1.0
        wrong_category = self.trade("b", 0, horizon=2, **dict(base, category="Sports"))
        wrong_horizon = self.trade("c", 0, horizon=1, **base)
        cheap = self.trade("d", 0, horizon=4, **dict(base, price=90.0))
        wide = self.trade("e", 0, horizon=4, **base)
        for t in (wrong_category, wrong_horizon, cheap):
            t["spread"] = 1.0
        wide["spread"] = 5.0
        self.assertEqual(bt.h2_trades([keep, wrong_category, wrong_horizon, cheap, wide]), [keep])

    def test_price_bins(self):
        self.assertEqual(bt.price_bin(1.0), "01-05c")
        self.assertEqual(bt.price_bin(94.9), "90-95c")
        self.assertEqual(bt.price_bin(99.5), "95-100c")
        self.assertIsNone(bt.price_bin(0.5))


class CandleFormatTests(unittest.TestCase):
    def test_batch_and_historical_formats_both_parse_to_cents(self):
        batch = {"end_period_ts": 1, "yes_bid": {"close_dollars": "0.4100"},
                 "yes_ask": {"close_dollars": "0.4300"}}
        historical = {"end_period_ts": 2, "yes_bid": {"close": "0.4100"},
                      "yes_ask": {"close": "0.4300"}}
        empty = {"end_period_ts": 3, "yes_bid": {}, "yes_ask": {"close": None}}
        self.assertEqual(bt.candle_points([batch, historical, empty]),
                         [[1, 41.0, 43.0], [2, 41.0, 43.0], [3, None, None]])


class BatchTests(unittest.TestCase):
    def test_batches_respect_size_and_close_time_spread(self):
        markets = [{"close_ts": i * 3600} for i in range(0, 30)] + \
                  [{"close_ts": 100 * 3600 + i} for i in range(150)]
        batches = bt.close_time_batches(markets, size=100, max_spread_hours=24)
        self.assertTrue(all(len(b) <= 100 for b in batches))
        self.assertTrue(all(b[-1]["close_ts"] - b[0]["close_ts"] <= 24 * 3600 for b in batches))
        self.assertEqual(sum(len(b) for b in batches), 180)


if __name__ == "__main__":
    unittest.main()
