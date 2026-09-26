#!/usr/bin/env python3
"""Equity-index, volatility, FX and commodity tests on daily data.

Sources: S&P 500 index 1990-2022 (skfolio), S&P 500 OHLC 2000-2020 (vega-datasets), VIX 1990-2026 (CBOE via
datasets/finance-vix), WTI 1986-2026, FRED daily FX 1971-2026, 20 large-cap stocks 1990-2022, gold monthly.
Costs: 0.05% per one-way trade for index products (round trip 0.10%).
"""
import os, sys, math, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import summarize_returns, fmt_ret, tstat, pvalue_two_sided, bootstrap_mean_ci, TestRegistry, probabilistic_sharpe

DATA = os.environ.get("DATA_DIR", "data")
OUT = os.path.join(os.path.dirname(__file__), "results"); os.makedirs(OUT, exist_ok=True)
REG = TestRegistry(); COST = 0.0005


def rep(family, label, r, ppy=252, extra=""):
    d = summarize_returns(r, ppy, label); d["psr"] = probabilistic_sharpe(d["sharpe"] / math.sqrt(ppy), d["n"])
    REG.add(family, d); print(fmt_ret(d) + extra); return d


def with_costs(pos, ret):
    """pos = exposure decided at close t-1 applied to ret_t; cost charged on |Δpos|."""
    pos = pos.shift(1).fillna(0)
    return pos * ret - pos.diff().abs().fillna(0) * COST


def halves(label, r):
    r = r.dropna(); h = len(r) // 2
    a, b = summarize_returns(r.iloc[:h], 252), summarize_returns(r.iloc[h:], 252)
    print(f"    {label}: first-half Sharpe {a['sharpe']:+.2f} / second-half Sharpe {b['sharpe']:+.2f}")


# ------------------------------------------------------------------ S&P 500 index 1990-2022
import skfolio.datasets as skd
spx = skd.load_sp500_index().iloc[:, 0].rename("spx"); spx.index = pd.to_datetime(spx.index)
r = spx.pct_change().dropna()
print(f"S&P 500 index: {spx.index.min().date()} -> {spx.index.max().date()}, {len(r)} days")
print("\n=== TREND FILTERS (S&P 500, 1990-2022, long/flat, 0.05% per switch) ===")
bh = rep("eq_bench", "Buy & hold S&P 500", r)
for w in [50, 100, 200]:
    pos = (spx > spx.rolling(w).mean()).astype(float)
    rep("eq_trend", f"{w}-day SMA filter (daily)", with_costs(pos, r))
sma10 = spx.resample("ME").last(); pos_m = (sma10 > sma10.rolling(10).mean()).astype(float).reindex(spx.index, method="ffill")
x = rep("eq_trend", "Faber 10-month SMA (monthly)", with_costs(pos_m, r)); halves("10m SMA", with_costs(pos_m, r))
mom12 = spx / spx.shift(252) - 1; pos = (mom12 > 0).astype(float)
x = rep("eq_trend", "12-month time-series momentum", with_costs(pos, r)); halves("TSMOM12", with_costs(pos, r))

print("\n=== CALENDAR EFFECTS (S&P 500 1990-2022) ===")
df = pd.DataFrame({"r": r}); df["dom"] = df.index.day; df["month"] = df.index.to_period("M")
df["tday_from_end"] = df.groupby("month").cumcount(ascending=False); df["tday_from_start"] = df.groupby("month").cumcount()
tom = (df.tday_from_end == 0) | (df.tday_from_start <= 2)
print(f"turn-of-month days: mean {df.r[tom].mean()*1e4:+.1f} bp/day (n={tom.sum()}) vs other days {df.r[~tom].mean()*1e4:+.1f} bp/day (n={(~tom).sum()});"
      f" t-stat of difference = {(df.r[tom].mean()-df.r[~tom].mean())/math.sqrt(df.r[tom].var()/tom.sum()+df.r[~tom].var()/(~tom).sum()):+.2f}")
rep("eq_calendar", "Turn-of-month only (4 days/month)", with_costs(tom.astype(float), r)); halves("TOM", with_costs(tom.astype(float), r))
rep("eq_calendar", "Rest-of-month only (fade TOM)", with_costs((~tom).astype(float), r))
dow = df.groupby(df.index.dayofweek).r.agg(["mean", "count", tstat]); dow.index = ["Mon", "Tue", "Wed", "Thu", "Fri"]; dow["mean_bp"] = dow["mean"] * 1e4
print("day-of-week mean return (bp) and t:"); print(dow[["mean_bp", "count", "tstat"]].round(2).to_string())
rep("eq_calendar", "Skip Mondays (long Tue-Fri)", with_costs(pd.Series(df.index.dayofweek != 0, index=df.index).astype(float), r))
sell_may = ~df.index.month.isin([5, 6, 7, 8, 9, 10])
rep("eq_calendar", "Sell in May (long Nov-Apr)", with_costs(pd.Series(sell_may, index=df.index).astype(float), r)); halves("SellMay", with_costs(pd.Series(sell_may, index=df.index).astype(float), r))

# ------------------------------------------------------------------ overnight vs intraday (2000-2020 OHLC)
o = pd.read_csv(os.path.join(DATA, "sp500-2000.csv"), parse_dates=["date"]).set_index("date").sort_index()
on = (o.open / o.close.shift(1) - 1).dropna(); intra = (o.close / o.open - 1).dropna()
print(f"\n=== OVERNIGHT vs INTRADAY (S&P 500 {o.index.min().date()} -> {o.index.max().date()}) ===")
rep("eq_overnight", "Overnight only (buy close, sell open) gross", on)
rep("eq_overnight", "Overnight only net of 0.10%/day round trip", on - 2 * COST)
rep("eq_overnight", "Intraday only (buy open, sell close) gross", intra)
rep("eq_overnight", "Close-to-close", (o.close.pct_change().dropna()))
halves("overnight gross", on); halves("intraday gross", intra)

# ------------------------------------------------------------------ VIX regime tests
vix = pd.read_csv(os.path.join(DATA, "vix-daily.csv"), parse_dates=["DATE"]).set_index("DATE").CLOSE.rename("vix")
v = pd.concat([r.rename("r"), vix], axis=1).dropna(); v["fwd1"] = v.r.shift(-1); v["fwd21"] = (1 + v.r).rolling(21).apply(np.prod, raw=True).shift(-21) - 1
print("\n=== VIX REGIMES (next-day and next-21-day S&P returns conditional on VIX close) ===")
for lo, hi in [(0, 12), (12, 15), (15, 20), (20, 25), (25, 30), (30, 40), (40, 100)]:
    x = v[(v.vix >= lo) & (v.vix < hi)]
    print(f"VIX in [{lo:>2},{hi:>3}): n={len(x):>5d}  next-day {x.fwd1.mean()*1e4:+6.1f} bp (t={tstat(x.fwd1):+5.2f})  next-21d {x.fwd21.mean()*100:+5.2f}% (t={tstat(x.fwd21.dropna()[::21]):+4.2f})")
for thr in [20, 25, 30]:
    rep("eq_vix", f"Long S&P only when VIX > {thr}", with_costs((v.vix > thr).astype(float), v.r))
    rep("eq_vix", f"Long S&P only when VIX <= {thr}", with_costs((v.vix <= thr).astype(float), v.r))
# VIX spike mean reversion: does a 1-day VIX jump > 20% predict positive S&P next 5 days?
v["vix_chg"] = v.vix.pct_change(); v["fwd5"] = (1 + v.r).rolling(5).apply(np.prod, raw=True).shift(-5) - 1
x = v[v.vix_chg > 0.2]; print(f"after VIX 1-day spike >20%: n={len(x)}, next-5d S&P {x.fwd5.mean()*100:+.2f}% (t={tstat(x.fwd5):+.2f}), next-21d {x.fwd21.mean()*100:+.2f}% (t={tstat(x.fwd21):+.2f})")
# vol targeting
rv = r.rolling(21).std() * math.sqrt(252); lev = (0.10 / rv).clip(upper=1.0)
rep("eq_vol", "Vol-target 10% (cap 1x) on S&P", with_costs(lev, r)); halves("voltarget", with_costs(lev, r))
lev2 = (0.15 / rv).clip(upper=2.0)
rep("eq_vol", "Vol-target 15% (cap 2x, financing ignored)", with_costs(lev2, r))

# ------------------------------------------------------------------ cross-sectional momentum, 20 large caps
px = skd.load_sp500_dataset(); px.index = pd.to_datetime(px.index)
mp = px.resample("ME").last(); mr = mp.pct_change()
mom = mp.shift(1) / mp.shift(12) - 1   # 12-1 momentum
long_short = []
for t in range(13, len(mp) - 1):
    sig = mom.iloc[t].dropna()
    if len(sig) < 10: long_short.append(np.nan); continue
    k = max(3, len(sig) // 4); top = sig.nlargest(k).index; bot = sig.nsmallest(k).index
    long_short.append(mr.iloc[t + 1][top].mean() - mr.iloc[t + 1][bot].mean() - 4 * COST)
ls = pd.Series(long_short, index=mp.index[14:len(mp)])
print("\n=== CROSS-SECTIONAL 12-1 MOMENTUM, 20 large caps, monthly long top-quartile / short bottom-quartile ===")
rep("eq_xsmom", "XS momentum long-short (20 stocks)", ls, 12)
rev = mp.shift(0) / mp.shift(1) - 1
lsr = []
for t in range(2, len(mp) - 1):
    sig = rev.iloc[t].dropna(); k = max(3, len(sig) // 4)
    lsr.append(mr.iloc[t + 1][sig.nsmallest(k).index].mean() - mr.iloc[t + 1][sig.nlargest(k).index].mean() - 4 * COST)
rep("eq_xsmom", "1-month reversal long-short (20 stocks)", pd.Series(lsr, index=mp.index[3:len(mp)]), 12)

# ------------------------------------------------------------------ FX time-series momentum (FRED daily, USD per unit)
fx = pd.read_csv(os.path.join(DATA, "daily.csv"), parse_dates=["Date"])
fx = fx.pivot(index="Date", columns="Country", values="Exchange rate").sort_index()
G10 = ["Australia", "Canada", "Denmark", "Euro", "Japan", "New Zealand", "Norway", "Sweden", "Switzerland", "United Kingdom"]
fx = fx[[c for c in G10 if c in fx.columns]].loc["1999":].dropna(axis=1, thresh=5000)
print(f"\n=== FX TIME-SERIES MOMENTUM (G10 only: {list(fx.columns)}; {fx.index.min().date()} -> {fx.index.max().date()}) ===")
print("NOTE: spot returns only; the interest-rate differential (carry) is not included, so these are approximate excess returns.")
fxm = fx.resample("ME").last(); fxr = fxm.pct_change()
# FRED quotes most as foreign currency per USD -> a rising quote means USD strengthening; direction is irrelevant for TS momentum
sig = np.sign(fxm.shift(1) / fxm.shift(13) - 1)
strat = (sig * fxr).mean(axis=1).dropna() - 2 * COST / 12
rep("fx_mom", "FX 12-1 TS momentum, equal weight, monthly", strat, 12); halves("FX mom", strat.reindex(pd.date_range(strat.index.min(), strat.index.max(), freq="ME")).dropna())
sig3 = np.sign(fxm.shift(1) / fxm.shift(4) - 1)
rep("fx_mom", "FX 3-1 TS momentum, equal weight, monthly", (sig3 * fxr).mean(axis=1).dropna() - 2 * COST / 12, 12)

# ------------------------------------------------------------------ commodities
wti = pd.read_csv(os.path.join(DATA, "wti-daily.csv"), parse_dates=["Date"]).set_index("Date").Price
wti = wti[wti > 0]; wm = wti.resample("ME").last(); wr = wm.pct_change()
print(f"\n=== COMMODITIES (spot series; NOTE: no roll yield, so futures results will differ) ===")
rep("cmdty", "WTI buy & hold (spot, monthly)", wr.dropna(), 12)
rep("cmdty", "WTI 12-month momentum long/flat (spot)", (((wm.shift(1) / wm.shift(13) - 1) > 0).astype(float) * wr).dropna(), 12)
rep("cmdty", "WTI 12-month momentum long/short (spot)", (np.sign(wm.shift(1) / wm.shift(13) - 1) * wr).dropna(), 12)
gold = pd.read_csv(os.path.join(DATA, "monthly.csv")); gold["Date"] = pd.to_datetime(gold.Date); gold = gold.set_index("Date").Price.loc["1971":]
gr = gold.pct_change()
rep("cmdty", "Gold buy & hold (monthly, 1971+)", gr.dropna(), 12)
rep("cmdty", "Gold 12-month momentum long/flat", (((gold.shift(1) / gold.shift(13) - 1) > 0).astype(float) * gr).dropna(), 12)

# ------------------------------------------------------------------ Shiller CAPE (monthly, 1881+)
sh = pd.read_csv(os.path.join(DATA, "data.csv")); sh["Date"] = pd.to_datetime(sh.Date); sh = sh.set_index("Date")
sh = sh[(sh.PE10 > 0)]; sr = sh.SP500.pct_change()
sh["cape_hi"] = sh.PE10 > sh.PE10.expanding().quantile(0.8)
fwd12 = sh.SP500.shift(-12) / sh.SP500 - 1
print(f"\n=== SHILLER CAPE ({sh.index.min().year}-{sh.index.max().year}) ===")
print(f"12m fwd price return when CAPE in top expanding-quintile: {fwd12[sh.cape_hi].mean()*100:+.2f}% (n={sh.cape_hi.sum()}) vs otherwise {fwd12[~sh.cape_hi].mean()*100:+.2f}% (n={(~sh.cape_hi).sum()})")
rep("cape", "S&P price return, out of market when CAPE in top quintile", ((~sh.cape_hi).shift(1).fillna(False).astype(float) * sr).dropna(), 12)
rep("cape", "S&P price return buy & hold (same sample)", sr.dropna(), 12)

df = REG.frame(); df.to_csv(os.path.join(OUT, "equities_tests.csv"), index=False)
print(f"\nTests run in this file: {len(df)}; best Bonferroni-adjusted p: {df.bonferroni_p.min():.4f}")
print(df.sort_values("p").head(10)[["label", "n", "cagr", "sharpe", "max_dd", "t", "p", "bonferroni_p"]].to_string(index=False))
