#!/usr/bin/env python3
"""Where does the best-odds favourite edge come from: one outlier bookmaker or the whole market?
Bucket favourites (best-odds implied >= 0.70) by how far the best price sits above the average price."""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__)); from lib.stats import summarize_bets, fmt_bets
DATA = os.environ.get("DATA_DIR", "data")
m = pd.read_csv(os.path.join(DATA, "Matches.csv"), low_memory=False); m["MatchDate"] = pd.to_datetime(m.MatchDate)
m["season"] = np.where(m.MatchDate.dt.month >= 7, m.MatchDate.dt.year, m.MatchDate.dt.year - 1); m = m[m.FTResult.isin(["H", "D", "A"])]
for c in ["OddHome", "OddAway", "MaxHome", "MaxAway"]: m[c] = pd.to_numeric(m[c], errors="coerce"); m.loc[m[c] <= 1, c] = np.nan
rows = []
for side, res in [("Home", "H"), ("Away", "A")]:
    d = m.dropna(subset=["Max" + side, "Odd" + side]); d = d[1 / d["Max" + side] >= 0.70]
    rows.append(pd.DataFrame({"prem": d["Max" + side] / d["Odd" + side] - 1, "pnl": np.where(d.FTResult == res, d["Max" + side] - 1, -1.0), "season": d.season,
                              "pnl_avg": np.where(d.FTResult == res, d["Odd" + side] - 1, -1.0), "n_gap": (d["Max" + side] - d["Odd" + side])}))
S = pd.concat(rows)
print("favourites >=70% at best odds, bucketed by best/average price premium:")
for lo, hi in [(0, .01), (.01, .02), (.02, .03), (.03, .05), (.05, .08), (.08, 1)]:
    x = S[(S.prem >= lo) & (S.prem < hi)]
    d = summarize_bets(x.pnl.values, f"best price {lo:.0%}-{hi:.0%} above average"); ss = pd.Series(x.pnl.values, index=x.season.values).groupby(level=0).mean()
    print(fmt_bets(d) + f"  seasons+={int((ss>0).sum())}/{len(ss)}  (same bets at avg odds: {x.pnl_avg.mean()*100:+.2f}%)")
print("\nIf you could only get the 2nd-best price (approximated as average + 50% of the premium):")
S["mid"] = 1 + (S.pnl_avg + 1)  # placeholder to keep the frame simple
half_prem_odds = None
d = m.copy()
rows2 = []
for side, res in [("Home", "H"), ("Away", "A")]:
    dd = d.dropna(subset=["Max" + side, "Odd" + side]); dd = dd[1 / dd["Max" + side] >= 0.70]
    o = dd["Odd" + side] + 0.5 * (dd["Max" + side] - dd["Odd" + side]); rows2.append(pd.DataFrame({"pnl": np.where(dd.FTResult == res, o - 1, -1.0), "season": dd.season}))
S2 = pd.concat(rows2); d = summarize_bets(S2.pnl.values, "fav>=70% at halfway-to-best price"); ss = pd.Series(S2.pnl.values, index=S2.season.values).groupby(level=0).mean()
print(fmt_bets(d) + f"  seasons+={int((ss>0).sum())}/{len(ss)}")
