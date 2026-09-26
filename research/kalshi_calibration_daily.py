#!/usr/bin/env python3
"""Kalshi long-lived markets (all categories): is the price 1 / 7 / 30 days before close calibrated?

Uses daily candles (phase 4).  For each market and horizon h, the YES ask/bid at the last daily candle
ending at least h days before close.  Reports calibration and the fee-adjusted return of buying YES or NO
at that horizon and holding to settlement, by category and by price bucket.  Because capital is locked
for h days, the per-day return is also shown.
"""
import os, sys, glob, json, glob, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee, summarize_bets, fmt_bets, tstat

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi"); OUT = os.path.join(os.path.dirname(__file__), "results")
series = {s["ticker"]: s for s in json.load(open(os.path.join(KD, "series.json")))}
need = set()
for fn in glob.glob(os.path.join(KD, "candles_daily*.jsonl")):
    for line in open(fn): need.add(json.loads(line)["ticker"])
mk = {}
for _fn in sorted(glob.glob(os.path.join(KD, "markets*.jsonl"))):
  with open(_fn) as f:
    for line in f:
        t = line.split('"ticker": "')[1].split('"')[0]
        if t in need: mk[t] = json.loads(line)
rows = []
for fn in glob.glob(os.path.join(KD, "candles_daily*.jsonl")):
    for line in open(fn):
        j = json.loads(line); m = mk.get(j["ticker"])
        if not m or m["result"] not in ("yes", "no"): continue
        close = dt.datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp()
        for h in (1, 7, 30):
            cs = [c for c in j["candlesticks"] if c["end_period_ts"] <= close - h * 86400 and c.get("yes_ask", {}).get("close_dollars")]
            if not cs: continue
            c = max(cs, key=lambda c: c["end_period_ts"])
            try:
                rows.append({"ticker": m["ticker"], "series": m["series_ticker"], "category": series.get(m["series_ticker"], {}).get("category", "?"), "h": h,
                             "yes": m["result"] == "yes", "ask": float(c["yes_ask"]["close_dollars"]), "bid": float(c["yes_bid"]["close_dollars"]),
                             "volume": float(m.get("volume_fp") or 0), "days_before": (close - c["end_period_ts"]) / 86400})
            except (KeyError, ValueError, TypeError): pass
d = pd.DataFrame(rows)
if d.empty: print("no daily candles yet"); sys.exit()
d = d[(d.ask > 0) & (d.ask < 1) & (d.bid >= 0) & (d.bid < 1)]; d["mid"] = (d.ask + d.bid) / 2
print(f"observations: {len(d)} (markets {d.ticker.nunique()}), categories: {d.category.value_counts().to_dict()}")
def yes_pnl(x): return np.where(x.yes, 1 - x.ask, -x.ask) - kalshi_fee(x.ask)
def no_pnl(x): p = 1 - x.bid; return np.where(~x.yes, 1 - p, -p) - kalshi_fee(p)
for h in (1, 7, 30):
    x = d[d.h == h]
    print(f"\n=== horizon: {h} day(s) before close (n={len(x)}) — calibration of mid, fee-adjusted EV (cents/contract) of buying YES at ask / NO at 1-bid ===")
    x = x.assign(bucket=pd.cut(x.mid, [0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, 1.0]))
    print(x.groupby("bucket", observed=True).apply(lambda y: pd.Series({"n": len(y), "mid": y.mid.mean(), "realised": y.yes.mean(), "spread_c": (y.ask - y.bid).mean() * 100,
                                                                        "ev_yes_c": np.mean(yes_pnl(y)) * 100, "ev_no_c": np.mean(no_pnl(y)) * 100})).round(3).to_string())
    print(f"\n--- by category, buy the FAVOURITE (whichever side is priced >= 0.80) at {h}d ---")
    fav_yes = x[x.ask >= .8]; fav_no = x[(1 - x.bid) >= .8]
    pnl = np.concatenate([yes_pnl(fav_yes), no_pnl(fav_no)]); cats = np.concatenate([fav_yes.category.values, fav_no.category.values])
    for c in pd.Series(cats).value_counts().index:
        r = summarize_bets(pnl[cats == c], f"{h}d favourites >=0.80, {c}")
        if r["n"] >= 30: print(fmt_bets(r) + f"  per-day ROI {r['roi']/h*100:+.3f}%")
    r = summarize_bets(pnl, f"{h}d favourites >=0.80, ALL"); print(fmt_bets(r) + f"  per-day ROI {r['roi']/h*100:+.3f}%")
    print(f"--- by category, buy the LONGSHOT (side priced <= 0.20) at {h}d ---")
    ls_yes = x[x.ask <= .2]; ls_no = x[(1 - x.bid) <= .2]
    pnl = np.concatenate([yes_pnl(ls_yes), no_pnl(ls_no)]); cats = np.concatenate([ls_yes.category.values, ls_no.category.values])
    for c in pd.Series(cats).value_counts().index:
        r = summarize_bets(pnl[cats == c], f"{h}d longshots <=0.20, {c}")
        if r["n"] >= 30: print(fmt_bets(r))
    r = summarize_bets(pnl, f"{h}d longshots <=0.20, ALL"); print(fmt_bets(r))
d.to_parquet(os.path.join(OUT, "kalshi_daily_calibration.parquet"))
