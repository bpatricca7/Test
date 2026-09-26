#!/usr/bin/env python3
"""Deep-dive on the two soccer edges that survived: (1) favourites at best available odds and
(2) walk-forward market-calibrated model + Elo, betting only at the best price when EV > threshold.

Breaks results down by side, probability bucket, league tier, season, and shows what happens if you can
only get AVERAGE odds (i.e. no line shopping)."""
import os, sys, warnings, math
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import summarize_bets, fmt_bets, devig_power, bootstrap_mean_ci, tstat
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

DATA = os.environ.get("DATA_DIR", "data"); OUT = os.path.join(os.path.dirname(__file__), "results")
m = pd.read_csv(os.path.join(DATA, "Matches.csv"), low_memory=False)
m["MatchDate"] = pd.to_datetime(m.MatchDate); m["season"] = np.where(m.MatchDate.dt.month >= 7, m.MatchDate.dt.year, m.MatchDate.dt.year - 1)
m = m[m.FTResult.isin(["H", "D", "A"])].copy()
for c in ["OddHome", "OddDraw", "OddAway", "MaxHome", "MaxDraw", "MaxAway"]:
    m[c] = pd.to_numeric(m[c], errors="coerce"); m.loc[m[c] <= 1.0, c] = np.nan
TOP5 = {"E0", "SP1", "D1", "I1", "F1"}; m["tier"] = np.where(m.Division.isin(TOP5), "top5", "other")


def pnl(won, odds): return np.where(won, odds - 1.0, -1.0)
def show(label, p, seasons=None):
    d = summarize_bets(p, label); s = ""
    if seasons is not None and len(p):
        ss = pd.Series(p, index=seasons).groupby(level=0).mean(); s = f"  seasons+={int((ss>0).sum())}/{len(ss)}"
    print(fmt_bets(d) + s); return d

# ---------------------------------------------------------------- (1) favourites at best odds, sliced
print("=== (1) FAVOURITES AT BEST ODDS: every 1X2 outcome with best-odds implied prob >= 0.70 ===")
rows = []
for side, res in [("Home", "H"), ("Away", "A"), ("Draw", "D")]:
    d = m.dropna(subset=["Max" + side, "Odd" + side]); imp = 1 / d["Max" + side]
    rows.append(pd.DataFrame({"side": side, "imp": imp, "imp_avg": 1 / d["Odd" + side], "pnl_max": pnl(d.FTResult == res, d["Max" + side]),
                              "pnl_avg": pnl(d.FTResult == res, d["Odd" + side]), "season": d.season, "tier": d.tier, "div": d.Division, "won": d.FTResult == res}))
S = pd.concat(rows); F = S[S.imp >= 0.70]
show("fav>=70% @best odds, all", F.pnl_max.values, F.season.values)
show("fav>=70% @AVERAGE odds (no line shopping)", F.pnl_avg.values, F.season.values)
for side in ["Home", "Away"]:
    x = F[F.side == side]; show(f"fav>=70% @best, {side} favourites", x.pnl_max.values, x.season.values)
for lo, hi in [(0.70, 0.75), (0.75, 0.80), (0.80, 0.85), (0.85, 0.90), (0.90, 1.01)]:
    x = S[(S.imp >= lo) & (S.imp < hi)]; d = show(f"best-odds implied in [{lo:.2f},{hi:.2f}) -> realised {x.won.mean():.3f}", x.pnl_max.values, x.season.values)
print("\nper-season ROI, favourites >=70% at best odds:")
print(F.groupby("season").agg(n=("pnl_max", "size"), roi=("pnl_max", "mean")).T.round(3).to_string())
print("\nby league (n>=300):")
bl = F.groupby("div").agg(n=("pnl_max", "size"), roi=("pnl_max", "mean"), hit=("won", "mean")); print(bl[bl.n >= 300].sort_values("roi", ascending=False).round(3).to_string())

# ---------------------------------------------------------------- (2) walk-forward market+elo value model
mm = m.dropna(subset=["HomeElo", "AwayElo", "OddHome", "OddDraw", "OddAway", "MaxHome", "MaxDraw", "MaxAway"]).copy()
mm["elo_diff"] = mm.HomeElo - mm.AwayElo; mm["form_diff3"] = mm.Form3Home.fillna(0) - mm.Form3Away.fillna(0); mm["form_diff5"] = mm.Form5Home.fillna(0) - mm.Form5Away.fillna(0)
ph, pdr, pa = devig_power(1 / mm.OddHome, 1 / mm.OddDraw, 1 / mm.OddAway); mm["mkt_h"], mm["mkt_d"], mm["mkt_a"] = ph, pdr, pa
mm["lg_h"] = np.log(mm.mkt_h / mm.mkt_d); mm["lg_a"] = np.log(mm.mkt_a / mm.mkt_d)
feats = ["lg_h", "lg_a", "elo_diff", "form_diff3", "form_diff5"]; y = mm.FTResult.map({"H": 0, "D": 1, "A": 2}).values
P = np.full((len(mm), 3), np.nan); X = mm[feats].values
for s in sorted(mm.season.unique()):
    if s < 2010: continue
    tr = (mm.season < s).values; te = (mm.season == s).values
    if tr.sum() < 5000 or te.sum() == 0: continue
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)); clf.fit(X[tr], y[tr]); P[te] = clf.predict_proba(X[te])
ok = ~np.isnan(P[:, 0]); dd = mm[ok].copy(); P = P[ok]
bets = []
for j, (side, res) in enumerate([("Home", "H"), ("Draw", "D"), ("Away", "A")]):
    b = pd.DataFrame({"season": dd.season, "tier": dd.tier, "div": dd.Division, "side": side, "p_model": P[:, j], "odds_max": dd["Max" + side], "odds_avg": dd["Odd" + side],
                      "won": dd.FTResult == res, "date": dd.MatchDate})
    b["ev_max"] = b.p_model * b.odds_max - 1; b["ev_avg"] = b.p_model * b.odds_avg - 1
    b["pnl_max"] = pnl(b.won, b.odds_max); b["pnl_avg"] = pnl(b.won, b.odds_avg); bets.append(b)
B = pd.concat(bets); B["imp_max"] = 1 / B.odds_max
print("\n=== (2) WALK-FORWARD market+Elo model, bets at BEST odds when EV > 3% (out-of-sample 2010-2026) ===")
V = B[B.ev_max > 0.03]
show("EV>3% @best odds, all", V.pnl_max.values, V.season.values)
show("same selections but paid AVERAGE odds", V.pnl_avg.values, V.season.values)
show("EV>3% computed on AVERAGE odds, paid average (no line shop)", B[B.ev_avg > 0.03].pnl_avg.values, B[B.ev_avg > 0.03].season.values)
for side in ["Home", "Draw", "Away"]:
    x = V[V.side == side]; show(f"EV>3% @best, {side}", x.pnl_max.values, x.season.values)
for t in ["top5", "other"]:
    x = V[V.tier == t]; show(f"EV>3% @best, {t} leagues", x.pnl_max.values, x.season.values)
for lo, hi in [(0, .2), (.2, .35), (.35, .5), (.5, .7), (.7, 1.01)]:
    x = V[(V.imp_max >= lo) & (V.imp_max < hi)]; show(f"EV>3% @best, best-odds implied in [{lo},{hi})", x.pnl_max.values, x.season.values)
x = V[V.season >= 2019]; show("EV>3% @best, seasons 2019-2026 only", x.pnl_max.values, x.season.values)
print("\nper-season: n bets and ROI (EV>3% @best):")
print(V.groupby("season").agg(n=("pnl_max", "size"), roi=("pnl_max", "mean")).T.round(3).to_string())
# bankroll simulation, flat 1% stakes vs quarter-Kelly, chronological
V = V.sort_values("date"); bank_flat, bank_kelly = 100.0, 100.0; path_f, path_k = [], []
for _, r in V.iterrows():
    stake_f = 0.01 * bank_flat; bank_flat += stake_f * r.pnl_max
    k = max(0.0, (r.p_model * r.odds_max - 1) / (r.odds_max - 1)); stake_k = min(0.25 * k, 0.05) * bank_kelly; bank_kelly += stake_k * r.pnl_max
    path_f.append(bank_flat); path_k.append(bank_kelly)
pf, pk = np.array(path_f), np.array(path_k)
print(f"\nbankroll sim over {len(V)} bets, 2010-2026: flat 1% -> {bank_flat:.0f} (max DD {((pf/np.maximum.accumulate(pf))-1).min()*100:.1f}%),"
      f" quarter-Kelly capped 5% -> {bank_kelly:.0f} (max DD {((pk/np.maximum.accumulate(pk))-1).min()*100:.1f}%)")
yrs = (V.date.max() - V.date.min()).days / 365.25
print(f"that is {(bank_flat/100)**(1/yrs)-1:+.1%}/yr flat and {(bank_kelly/100)**(1/yrs)-1:+.1%}/yr quarter-Kelly, before bookmaker limits")
B.to_parquet(os.path.join(OUT, "soccer_model_bets.parquet"))
