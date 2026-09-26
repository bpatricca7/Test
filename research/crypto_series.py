#!/usr/bin/env python3
"""Reconstruct BTC / ETH / SOL / XRP price series from settled Kalshi markets and test the underlying.

Each 15-minute market carries the reference price at open (floor_strike) and at close (expiration_value):
that is a genuine 15-minute price series.  Hourly KXBTCD-style markets carry the hourly settlement price.

Tests: drift, autocorrelation (momentum vs reversal), hour-of-day and day-of-week seasonality, and whether any
of it clears the Kalshi fee hurdle for the 15-minute up/down contracts.
"""
import os, sys, glob, json, math
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import tstat, pvalue_two_sided, bootstrap_mean_ci, kalshi_fee, TestRegistry

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi")
OUT = os.path.join(os.path.dirname(__file__), "results"); os.makedirs(OUT, exist_ok=True)
REG = TestRegistry()
M15 = {"KXBTC15M": "BTC", "KXETH15M": "ETH", "KXSOL15M": "SOL", "KXXRP15M": "XRP", "KXDOGE15M": "DOGE", "KXBNB15M": "BNB", "KXHYPE15M": "HYPE"}
HOURLY = {"KXBTCD": "BTC", "KXETHD": "ETH", "KXSOLD": "SOL", "KXXRPD": "XRP"}

rows15, rowsH = [], []
for _fn in sorted(glob.glob(os.path.join(KD, "markets*.jsonl"))):
  with open(_fn) as f:
    for line in f:
        st = line[line.find('"series_ticker": "') + 18: line.find('"series_ticker": "') + 30].split('"')[0] if '"series_ticker"' in line else ""
        if st in M15:
            m = json.loads(line)
            try:
                rows15.append((M15[st], m["open_time"], m["close_time"], float(m["floor_strike"]), float(m["expiration_value"]), m["result"], float(m["volume_fp"] or 0)))
            except (TypeError, ValueError):
                pass
        elif st in HOURLY:
            m = json.loads(line)
            try:
                rowsH.append((HOURLY[st], m["close_time"], float(m["expiration_value"]), float(m["volume_fp"] or 0)))
            except (TypeError, ValueError):
                pass
d15 = pd.DataFrame(rows15, columns=["coin", "open_time", "close_time", "p_open", "p_close", "result", "volume"])
d15["open_time"] = pd.to_datetime(d15.open_time); d15["close_time"] = pd.to_datetime(d15.close_time)
d15 = d15.drop_duplicates(["coin", "open_time"]).sort_values(["coin", "open_time"])
dH = pd.DataFrame(rowsH, columns=["coin", "close_time", "price", "volume"]); dH["close_time"] = pd.to_datetime(dH.close_time)
dH = dH.groupby(["coin", "close_time"]).agg(price=("price", "first"), volume=("volume", "sum")).reset_index().sort_values(["coin", "close_time"])
print("15-minute markets:", d15.groupby("coin").agg(n=("p_open", "size"), start=("open_time", "min"), end=("open_time", "max"), vol_usd=("volume", "sum")).to_string())
print("\nhourly settlement prices:", dH.groupby("coin").agg(n=("price", "size"), start=("close_time", "min"), end=("close_time", "max")).to_string())
d15["ret"] = d15.p_close / d15.p_open - 1
d15["up"] = d15.result == "yes"
print("\nconsistency check: share of markets where (p_close >= p_open) == (result yes):", ((d15.p_close >= d15.p_open) == d15.up).mean().round(4))


def rep(label, x, extra=""):
    x = np.asarray(x, float); x = x[~np.isnan(x)]
    m, lo, hi = bootstrap_mean_ci(x); t = tstat(x); p = pvalue_two_sided(t, len(x))
    REG.add("crypto", {"label": label, "n": len(x), "roi": m, "ci_lo": lo, "ci_hi": hi, "t": t, "p": p})
    print(f"{label:<64s} n={len(x):>6d} mean={m*1e4:+7.2f}bp  95%CI=[{lo*1e4:+.2f},{hi*1e4:+.2f}]bp  t={t:+5.2f} p={p:.4f}{extra}")


for coin, d in d15.groupby("coin"):
    d = d.set_index("open_time")
    print(f"\n===== {coin}: 15-minute series, {len(d)} bars, {d.index.min()} -> {d.index.max()} =====")
    r = d.ret
    print(f"P(up)={d.up.mean():.4f}  mean ret {r.mean()*1e4:+.2f} bp  sd {r.std()*1e4:.1f} bp  (ann. vol ~{r.std()*math.sqrt(4*24*365)*100:.0f}%)  skew {r.skew():+.2f}  kurt {r.kurt():.1f}")
    ac = [r.autocorr(k) for k in range(1, 5)]
    print("autocorr lags 1-4:", np.round(ac, 4), " (negative = short-term reversal)")
    rep(f"{coin} 15m: next return after an UP bar", r.shift(-1)[r > 0])
    rep(f"{coin} 15m: next return after a DOWN bar", r.shift(-1)[r < 0])
    big = r.abs() > r.abs().quantile(0.9)
    rep(f"{coin} 15m: next return after big UP bar (top-decile |move|)", r.shift(-1)[big & (r > 0)])
    rep(f"{coin} 15m: next return after big DOWN bar", r.shift(-1)[big & (r < 0)])
    # 'reversal' P(up) conditional: the quantity that matters for the up/down contract
    for cond, name in [((r < 0), "after DOWN bar"), ((r > 0), "after UP bar"), ((big & (r < 0)), "after big DOWN"), ((big & (r > 0)), "after big UP")]:
        nxt = d.up.shift(-1)[cond].dropna()
        print(f"   P(next bar UP | {name:<14s}) = {nxt.mean():.4f}  (n={len(nxt)})")
    # hour-of-day (UTC) and weekday
    hod = r.groupby(r.index.hour).agg(["mean", "count", tstat]); hod["mean_bp"] = hod["mean"] * 1e4
    print("hour-of-day (UTC) mean 15m return, bp (t):", {int(h): f"{v:+.1f}({t:+.1f})" for h, v, t in zip(hod.index, hod.mean_bp, hod.tstat)})
    dow = r.groupby(r.index.dayofweek).agg(["mean", "count", tstat]); print("day-of-week mean bp (t):", {int(h): f"{v*1e4:+.1f}({t:+.1f})" for h, v, t in zip(dow.index, dow["mean"], dow.tstat)})
    # hourly / 4-hourly / daily aggregation momentum tests from 15m closes
    px = d.p_close
    for rule, lab, k in [("1h", "hourly", 24 * 365), ("4h", "4-hourly", 6 * 365), ("1D", "daily", 365)]:
        pr = px.resample(rule).last().dropna(); rr = pr.pct_change().dropna()
        if len(rr) < 30: continue
        print(f"   {lab}: n={len(rr)} mean {rr.mean()*1e4:+.1f}bp sd {rr.std()*1e4:.0f}bp autocorr1 {rr.autocorr(1):+.3f} autocorr2 {rr.autocorr(2):+.3f}")
        rep(f"{coin} {lab}: next return after UP period", rr.shift(-1)[rr > 0]); rep(f"{coin} {lab}: next return after DOWN period", rr.shift(-1)[rr < 0])

# fee hurdle for the 15-minute contract
print("\n=== Fee hurdle for Kalshi 15-minute up/down contracts ===")
for p in [0.30, 0.40, 0.50, 0.60, 0.70, 0.90, 0.97]:
    fee = float(kalshi_fee(p))
    print(f"buy YES at {p:.2f} (100-contract taker order): fee {fee*100:.2f}c/contract -> need P(yes) > {(p+fee):.4f} to break even")

# hourly series (longer history) tests
for coin, d in dH.groupby("coin"):
    d = d.set_index("close_time"); r = d.price.pct_change().dropna()
    if len(r) < 100: continue
    print(f"\n===== {coin}: hourly settlement series, {len(r)} bars, {d.index.min()} -> {d.index.max()} =====")
    print(f"mean {r.mean()*1e4:+.2f} bp  sd {r.std()*1e4:.0f} bp  autocorr1-3 {[round(r.autocorr(k),4) for k in (1,2,3)]}")
    rep(f"{coin} hourly: next hour after UP hour", r.shift(-1)[r > 0]); rep(f"{coin} hourly: next hour after DOWN hour", r.shift(-1)[r < 0])
    big = r.abs() > r.abs().quantile(0.9)
    rep(f"{coin} hourly: next hour after big UP", r.shift(-1)[big & (r > 0)]); rep(f"{coin} hourly: next hour after big DOWN", r.shift(-1)[big & (r < 0)])
    day = d.price.resample("1D").last().dropna(); dr = day.pct_change().dropna()
    print(f"daily from hourly settles: n={len(dr)} mean {dr.mean()*1e4:+.1f}bp sd {dr.std()*1e4:.0f}bp autocorr1 {dr.autocorr(1):+.3f}")
    dowd = dr.groupby(dr.index.dayofweek).agg(["mean", "count", tstat]); print("daily day-of-week mean bp (t):", {int(h): f"{v*1e4:+.1f}({t:+.1f})" for h, v, t in zip(dowd.index, dowd["mean"], dowd.tstat)})
    for w in [7, 14, 30]:
        if len(dr) > 2 * w:
            sig = (day.shift(1) / day.shift(w + 1) - 1) > 0
            s = (sig.astype(float) * dr).dropna(); bh = dr.reindex(s.index)
            print(f"   {w}-day momentum long/flat: mean {s.mean()*1e4:+.1f}bp/day vs B&H {bh.mean()*1e4:+.1f}bp/day; Sharpe {s.mean()/s.std()*math.sqrt(365):+.2f} vs {bh.mean()/bh.std()*math.sqrt(365):+.2f}")

d15.to_parquet(os.path.join(OUT, "crypto_15m_series.parquet")); dH.to_parquet(os.path.join(OUT, "crypto_hourly_series.parquet"))
df = REG.frame(); df.to_csv(os.path.join(OUT, "crypto_series_tests.csv"), index=False)
print(f"\nTests: {len(df)}; smallest Bonferroni p: {df.bonferroni_p.min():.4f}")
print(df.sort_values("p").head(10)[["label", "n", "roi", "t", "p", "bonferroni_p"]].to_string(index=False))
