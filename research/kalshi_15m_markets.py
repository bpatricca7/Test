#!/usr/bin/env python3
"""Kalshi 15-minute crypto up/down markets: are they priced efficiently minute by minute, and does the
'reversal after a big down bar' signal survive the actual market price and the fee?

Inputs: markets.jsonl (settled 15M markets) and candles_15m.jsonl (1-minute candles per market).
Entry price convention: buy YES at the yes-ask CLOSE of minute k (k=1..14); buy NO at 1 - yes-bid close.
Fee: Kalshi quadratic 0.07*P*(1-P), rounded up to the cent.  Hold to settlement.
Standard errors: pooled across coins, clustered by timestamp (coins co-move), reported as t on per-timestamp means.
"""
import os, sys, json, math
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee, tstat, pvalue_two_sided, bootstrap_mean_ci

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi"); OUT = os.path.join(os.path.dirname(__file__), "results")
M15 = {"KXBTC15M": "BTC", "KXETH15M": "ETH", "KXSOL15M": "SOL", "KXXRP15M": "XRP", "KXDOGE15M": "DOGE", "KXBNB15M": "BNB", "KXHYPE15M": "HYPE"}

# ---- markets
rows = []
with open(os.path.join(KD, "markets.jsonl")) as f:
    for line in f:
        if '"series_ticker": "KX' not in line or '15M"' not in line: continue
        m = json.loads(line)
        if m["series_ticker"] not in M15: continue
        try: rows.append((m["ticker"], M15[m["series_ticker"]], m["open_time"], float(m["floor_strike"]), float(m["expiration_value"]), m["result"] == "yes", float(m["volume_fp"] or 0)))
        except (TypeError, ValueError): pass
mk = pd.DataFrame(rows, columns=["ticker", "coin", "open_time", "p_open", "p_close", "yes", "volume"]).drop_duplicates("ticker")
mk["open_time"] = pd.to_datetime(mk.open_time); mk = mk.sort_values(["coin", "open_time"])
mk["ret"] = mk.p_close / mk.p_open - 1
mk["prev_ret"] = mk.groupby("coin").ret.shift(1)
mk["prev_open"] = mk.groupby("coin").open_time.shift(1); mk.loc[(mk.open_time - mk.prev_open) != pd.Timedelta("15min"), "prev_ret"] = np.nan
# rolling (trailing 7 days = 672 bars) decile thresholds, shifted so they are known at the open
g = mk.groupby("coin").prev_ret
mk["q10"] = g.transform(lambda s: s.rolling(672, min_periods=200).quantile(0.10).shift(1))
mk["q90"] = g.transform(lambda s: s.rolling(672, min_periods=200).quantile(0.90).shift(1))
mk["big_down"] = mk.prev_ret < mk.q10; mk["big_up"] = mk.prev_ret > mk.q90

# ---- candles
crow = []; seen = set()
import glob
for fn in sorted(glob.glob(os.path.join(KD, "candles_15m*.jsonl"))):
  with open(fn) as f:
    for line in f:
        j = json.loads(line); t = j["ticker"]
        if t in seen: continue
        seen.add(t)
        cs = sorted(j["candlesticks"], key=lambda c: c["end_period_ts"])
        for k, c in enumerate(cs, start=1):
            try:
                crow.append((t, k, c["end_period_ts"], float(c["price"].get("close_dollars", "nan")), float(c["price"].get("mean_dollars", "nan")),
                             float(c["yes_ask"]["close_dollars"]), float(c["yes_bid"]["close_dollars"]), float(c.get("volume_fp") or 0)))
            except (KeyError, ValueError, TypeError): pass
cd = pd.DataFrame(crow, columns=["ticker", "k", "end_ts", "px_close", "px_mean", "ask", "bid", "vol"])
cd = cd.merge(mk[["ticker", "coin", "open_time", "yes", "prev_ret", "big_down", "big_up", "volume"]], on="ticker")
open_s = (cd.open_time - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds()
cd["minute"] = ((cd.end_ts - open_s) // 60).astype(int)   # 1..15 relative to market open (candle k covers minute k)
cd = cd[(cd.minute >= 1) & (cd.minute <= 15)]
print(f"markets with candles: {cd.ticker.nunique()} of {len(mk)} settled 15M markets; coins: {sorted(cd.coin.unique())}")
print(f"date range with candles: {cd.open_time.min()} -> {cd.open_time.max()}")

# ---- P&L helpers: buy YES at ask (hold to settlement), buy NO at 1-bid
def yes_pnl(d): return np.where(d.yes, 1 - d.ask, -d.ask) - kalshi_fee(d.ask)
def no_pnl(d):
    price = 1 - d.bid; return np.where(~d.yes, 1 - price, -price) - kalshi_fee(price)
def clustered(pnl, ts):
    """Mean and t-stat using per-timestamp averages as the independent unit."""
    s = pd.Series(pnl).groupby(ts.values).mean(); return s.mean(), tstat(s.values), len(s)
def line(label, pnl, ts, price=None):
    pnl = np.asarray(pnl, float); ok = ~np.isnan(pnl); pnl = pnl[ok]; ts = ts[ok]
    if len(pnl) == 0: print(f"{label:<70s} (no data)"); return
    m, t, ncl = clustered(pnl, ts); p = pvalue_two_sided(t, ncl)
    extra = f"  avg price {np.nanmean(price[ok]):.3f}" if price is not None else ""
    print(f"{label:<70s} n={len(pnl):>6d} (clusters {ncl:>5d})  ROI/contract={m*100:+6.2f}c  t={t:+5.2f} p={p:.4f}{extra}")

print("\n=== (A) Market calibration by minute: realised P(yes) vs ask price, fee-adjusted EV of buying YES / NO (all 15M markets, pooled) ===")
cd["ask_bucket"] = pd.cut(cd.ask, [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.0001])
for k in [1, 5, 10, 13, 14]:
    x = cd[(cd.minute == k) & cd.ask.between(0.02, 0.98)]
    tab = x.groupby("ask_bucket", observed=True).apply(lambda d: pd.Series({"n": len(d), "ask": d.ask.mean(), "realised": d.yes.mean(),
                                                                          "ev_yes_c": np.mean(yes_pnl(d)) * 100, "ev_no_c": np.mean(no_pnl(d)) * 100}))
    print(f"\nminute {k}:"); print(tab.round(3).to_string())

print("\n=== (B) Simple contract-level strategies at minute 1 (pooled, clustered by timestamp) ===")
m1 = cd[cd.minute == 1]
line("buy YES at minute-1 ask, every market (baseline: pays the fee)", yes_pnl(m1), m1.open_time, m1.ask.values)
line("buy NO  at minute-1, every market", no_pnl(m1), m1.open_time)
for k in [1, 2, 3, 5]:
    x = cd[(cd.minute == k) & cd.big_down]; line(f"after BIG DOWN prior bar: buy YES at minute-{k} ask", yes_pnl(x), x.open_time, x.ask.values)
for k in [1, 2, 3, 5]:
    x = cd[(cd.minute == k) & cd.big_up]; line(f"after BIG UP prior bar: buy NO at minute-{k}", no_pnl(x), x.open_time, (1 - x.bid).values)
x = cd[(cd.minute == 1) & (cd.prev_ret < 0)]; line("after any DOWN prior bar: buy YES at minute-1 ask", yes_pnl(x), x.open_time, x.ask.values)
x = cd[(cd.minute == 1) & (cd.prev_ret > 0)]; line("after any UP prior bar: buy NO at minute-1", no_pnl(x), x.open_time)
print("\n--- big-down reversal by coin (minute-1 YES) ---")
for coin, x in cd[(cd.minute == 1) & cd.big_down].groupby("coin"):
    line(f"  {coin}: after BIG DOWN, buy YES at minute-1 ask (P(yes)={x.yes.mean():.3f})", yes_pnl(x), x.open_time, x.ask.values)
print("\n--- by month (walk-forward consistency), big-down reversal minute-1 YES, all coins ---")
x = cd[(cd.minute == 1) & cd.big_down].copy(); x["month"] = x.open_time.dt.to_period("M")
for mo, d in x.groupby("month"): line(f"  {mo}", yes_pnl(d), d.open_time, d.ask.values)

print("\n=== (C) Late-market favourites: buy the side priced >= X at minute k (tests the favourite-longshot bias inside 15 minutes) ===")
for k in [10, 12, 13, 14]:
    for lo in [0.80, 0.90, 0.95]:
        x = cd[(cd.minute == k) & (cd.ask >= lo) & (cd.ask <= 0.99)]; line(f"minute {k}: buy YES when ask in [{lo:.2f},0.99]", yes_pnl(x), x.open_time, x.ask.values)
        x = cd[(cd.minute == k) & ((1 - cd.bid) >= lo) & ((1 - cd.bid) <= 0.99)]; line(f"minute {k}: buy NO when NO price in [{lo:.2f},0.99]", no_pnl(x), x.open_time)
print("\n=== (D) Late-market longshots: buy the side priced <= X at minute k ===")
for k in [10, 13, 14]:
    for hi in [0.05, 0.10, 0.20]:
        x = cd[(cd.minute == k) & (cd.ask <= hi) & (cd.ask >= 0.01)]; line(f"minute {k}: buy YES when ask <= {hi:.2f}", yes_pnl(x), x.open_time, x.ask.values)
cd.drop(columns=["ask_bucket"]).to_parquet(os.path.join(OUT, "kalshi_15m_candles_long.parquet"))
