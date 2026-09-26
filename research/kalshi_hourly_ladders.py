#!/usr/bin/env python3
"""Kalshi hourly BTC/ETH strike ladders ("price at HH:00 >= K?"): implied distribution vs realised.

For every sampled hour, each strike market's YES ask/bid at minute k gives P(price >= K).  Tests:
  (1) calibration of ask price vs realised across all strikes (favourite-longshot bias on a ladder);
  (2) fee-adjusted EV of buying NO on far-out-of-the-money strikes ("selling tails") and of buying YES on
      deep-in-the-money strikes at minute k, held to settlement;
  (3) implied vs realised 1-hour move size.
Standard errors are clustered by hour (strikes within an hour are one bet on the same outcome).
"""
import os, sys, json, glob, math
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee, tstat, pvalue_two_sided

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi"); OUT = os.path.join(os.path.dirname(__file__), "results")
need = {}
for fn in glob.glob(os.path.join(KD, "candles_hourly*.jsonl")):
    for line in open(fn):
        j = json.loads(line); need[j["ticker"]] = j["candlesticks"]
mk = {}
with open(os.path.join(KD, "markets.jsonl")) as f:
    for line in f:
        if '"series_ticker": "KXBTCD"' not in line and '"series_ticker": "KXETHD"' not in line: continue
        t = line.split('"ticker": "')[1].split('"')[0]
        if t in need: mk[t] = json.loads(line)
rows = []
for t, cs in need.items():
    m = mk.get(t)
    if not m or m["result"] not in ("yes", "no"): continue
    open_s = pd.Timestamp(m["open_time"]).timestamp()
    for c in cs:
        k = int((c["end_period_ts"] - open_s) // 60)
        if k not in (1, 5, 15, 30, 45, 55): continue
        try:
            rows.append({"ticker": t, "coin": "BTC" if m["series_ticker"] == "KXBTCD" else "ETH", "hour": m["close_time"], "strike": float(m["floor_strike"]),
                         "settle": float(m["expiration_value"]), "yes": m["result"] == "yes", "k": k, "ask": float(c["yes_ask"]["close_dollars"]),
                         "bid": float(c["yes_bid"]["close_dollars"]), "vol": float(c.get("volume_fp") or 0)})
        except (KeyError, ValueError, TypeError): pass
d = pd.DataFrame(rows)
if d.empty: print("no hourly ladder candles yet"); sys.exit()
d = d[(d.ask > 0) & (d.ask < 1) & (d.bid >= 0) & (d.bid < 1) & (d.ask >= d.bid)]
d["mid"] = (d.ask + d.bid) / 2; d["moneyness"] = np.log(d.strike / d.settle)
print(f"ladder observations: {len(d)}; hours: {d.hour.nunique()}; markets: {d.ticker.nunique()}; per coin: {d.groupby('coin').hour.nunique().to_dict()}")

def yes_pnl(x): return np.where(x.yes, 1 - x.ask, -x.ask) - kalshi_fee(x.ask)
def no_pnl(x): p = 1 - x.bid; return np.where(~x.yes, 1 - p, -p) - kalshi_fee(p)
def clustered(pnl, hours):
    s = pd.Series(np.asarray(pnl, float)).groupby(np.asarray(hours)).mean(); return s.mean(), tstat(s.values), len(s)
def line(label, pnl, hours):
    if len(pnl) == 0: print(f"{label:<74s} (no data)"); return
    m, t, n = clustered(pnl, hours); print(f"{label:<74s} n={len(pnl):>6d} hours={n:>4d}  ROI/contract={m*100:+6.2f}c  t={t:+5.2f} p={pvalue_two_sided(t, n):.4f}")

for k in (1, 15, 30, 45, 55):
    x = d[d.k == k]
    if len(x) < 200: continue
    print(f"\n=== minute {k} of 60: calibration by mid-price bucket (both coins) ===")
    x = x.assign(bucket=pd.cut(x.mid, [0, .03, .06, .1, .2, .3, .4, .5, .6, .7, .8, .9, .94, .97, 1.0]))
    print(x.groupby("bucket", observed=True).apply(lambda y: pd.Series({"n": len(y), "mid": y.mid.mean(), "realised": y.yes.mean(), "spread_c": (y.ask - y.bid).mean() * 100,
                                                                        "ev_yes_c": np.mean(yes_pnl(y)) * 100, "ev_no_c": np.mean(no_pnl(y)) * 100, "vol_in_min": y.vol.mean()})).round(3).to_string())
print("\n=== strategies, held to settlement (clustered by hour) ===")
for k in (1, 15, 30, 45):
    x = d[d.k == k]
    line(f"minute {k}: buy NO on strikes with YES ask <= 0.10 (sell the upper tail)", no_pnl(x[x.ask <= .10]), x[x.ask <= .10].hour)
    line(f"minute {k}: buy YES on strikes with YES bid >= 0.90 (sell the lower tail)", yes_pnl(x[x.bid >= .90]), x[x.bid >= .90].hour)
    line(f"minute {k}: buy NO when NO price 0.80-0.95", no_pnl(x[(1 - x.bid).between(.8, .95)]), x[(1 - x.bid).between(.8, .95)].hour)
    line(f"minute {k}: buy YES when YES ask 0.80-0.95", yes_pnl(x[x.ask.between(.8, .95)]), x[x.ask.between(.8, .95)].hour)
    line(f"minute {k}: buy YES on longshots (ask 0.03-0.15)", yes_pnl(x[x.ask.between(.03, .15)]), x[x.ask.between(.03, .15)].hour)
    line(f"minute {k}: buy YES near the money (ask 0.40-0.60)", yes_pnl(x[x.ask.between(.4, .6)]), x[x.ask.between(.4, .6)].hour)
for coin in ("BTC", "ETH"):
    x = d[(d.coin == coin) & (d.k == 15)]
    print(f"\n--- {coin}, minute 15 ---")
    line(f"  buy NO on strikes with YES ask <= 0.10", no_pnl(x[x.ask <= .10]), x[x.ask <= .10].hour)
    line(f"  buy YES on strikes with YES bid >= 0.90", yes_pnl(x[x.bid >= .90]), x[x.bid >= .90].hour)
    line(f"  buy the favourite side priced 0.80-0.95 (either side)", np.concatenate([no_pnl(x[(1 - x.bid).between(.8, .95)]), yes_pnl(x[x.ask.between(.8, .95)])]),
         np.concatenate([x[(1 - x.bid).between(.8, .95)].hour.values, x[x.ask.between(.8, .95)].hour.values]))
# implied vs realised move: for each hour at minute 1, the strike where mid crosses 0.5 is the implied median; the 0.1/0.9 crossings bound the implied 80% interval
print("\n=== implied vs realised one-hour moves (minute 1, hours with >= 6 quoted strikes) ===")
rec = []
for (coin, h), g in d[d.k == 1].groupby(["coin", "hour"]):
    g = g.sort_values("strike")
    if len(g) < 6 or g.mid.max() < .9 or g.mid.min() > .1: continue
    med = np.interp(0.5, g.mid[::-1].values, g.strike[::-1].values); lo = np.interp(0.9, g.mid[::-1].values, g.strike[::-1].values); hi = np.interp(0.1, g.mid[::-1].values, g.strike[::-1].values)
    rec.append({"coin": coin, "hour": h, "implied_median": med, "implied_lo10": lo, "implied_hi90": hi, "settle": g.settle.iloc[0]})
r = pd.DataFrame(rec)
if len(r):
    r["inside80"] = (r.settle >= r.implied_lo10) & (r.settle <= r.implied_hi90); r["above_median"] = r.settle > r.implied_median
    r["implied_halfwidth_bp"] = (r.implied_hi90 - r.implied_lo10) / 2 / r.implied_median * 1e4; r["abs_move_bp"] = (r.settle / r.implied_median - 1).abs() * 1e4
    for coin, g in r.groupby("coin"):
        print(f"{coin}: hours={len(g)}  settle inside implied 80% band: {g.inside80.mean():.3f} (calibrated = 0.80)  above implied median: {g.above_median.mean():.3f}"
              f"  implied 80% half-width {g.implied_halfwidth_bp.median():.0f} bp vs realised median |move| {g.abs_move_bp.median():.0f} bp")
d.to_parquet(os.path.join(OUT, "kalshi_hourly_ladders.parquet"))
edges = [0, .03, .06, .1, .2, .3, .4, .5, .6, .7, .8, .9, .94, .97, 1.0001]; cal = []
x = d[d.k.isin([1, 5, 15, 30])]
for lo, hi in zip(edges[:-1], edges[1:]):
    y = x[(x.ask >= lo) & (x.ask < hi)]
    if len(y) >= 30: cal.append({"lo": lo, "hi": hi, "n": int(len(y)), "ask": float(y.ask.mean()), "realised": float(y.yes.mean())})
json.dump(cal, open(os.path.join(OUT, "calibration_hourly.json"), "w"), indent=1)
