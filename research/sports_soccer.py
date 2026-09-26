#!/usr/bin/env python3
"""Soccer betting tests on 238k club matches (2000-2026, 38 divisions) with average and best-available odds.

Odd*  = average bookmaker odds (vig ~6-7%);  Max* = best price across books (vig ~1%).
All ROI figures are net: we pay the quoted price.
"""
import os, sys, json, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import summarize_bets, fmt_bets, devig_power, TestRegistry

DATA = os.environ.get("DATA_DIR", "data")
OUT = os.path.join(os.path.dirname(__file__), "results"); os.makedirs(OUT, exist_ok=True)
REG = TestRegistry()

m = pd.read_csv(os.path.join(DATA, "Matches.csv"), low_memory=False)
m["MatchDate"] = pd.to_datetime(m.MatchDate)
m["season"] = np.where(m.MatchDate.dt.month >= 7, m.MatchDate.dt.year, m.MatchDate.dt.year - 1)
m = m[m.FTResult.isin(["H", "D", "A"])].copy()
for c in ["OddHome", "OddDraw", "OddAway", "MaxHome", "MaxDraw", "MaxAway", "Over25", "Under25", "MaxOver25", "MaxUnder25", "HandiHome", "HandiAway"]:
    m[c] = pd.to_numeric(m[c], errors="coerce"); m.loc[m[c] <= 1.0, c] = np.nan
TOP5 = {"E0", "SP1", "D1", "I1", "F1"}
m["tier"] = np.where(m.Division.isin(TOP5), "top5", "other")
print(f"matches: {len(m)}  seasons {m.season.min()}-{m.season.max()}")


def pnl(won, odds):
    return np.where(won, odds - 1.0, -1.0)


def report(family, label, p, seasons=None):
    d = summarize_bets(p, label)
    if seasons is not None and len(p):
        s = pd.Series(p, index=seasons).groupby(level=0).mean()
        d["seasons_positive"] = f"{int((s > 0).sum())}/{len(s)}"
        half = np.median(seasons)
        d["roi_first_half"] = float(np.mean(p[seasons <= half])); d["roi_second_half"] = float(np.mean(p[seasons > half])) if (seasons > half).any() else np.nan
    REG.add(family, d)
    extra = f"  seasons+={d.get('seasons_positive','')}  halves={d.get('roi_first_half',np.nan)*100:+.1f}%/{d.get('roi_second_half',np.nan)*100:+.1f}%" if seasons is not None else ""
    print(fmt_bets(d) + extra)
    return d


# --------------------------------------------------------- 1. favourite-longshot bias, avg vs best odds
rows = []
for side, res in [("Home", "H"), ("Draw", "D"), ("Away", "A")]:
    for pre in ["Odd", "Max"]:
        d = m.dropna(subset=[pre + side])
        rows.append(pd.DataFrame({"side": side, "book": pre, "imp": 1 / d[pre + side], "pnl": pnl(d.FTResult == res, d[pre + side]), "season": d.season, "tier": d.tier}))
S = pd.concat(rows)
edges = [0, .1, .2, .3, .4, .5, .6, .7, .8, 1.01]
S["bucket"] = pd.cut(S.imp, edges, right=False)
for pre in ["Odd", "Max"]:
    print(f"\n=== 1X2 ROI by implied-probability bucket at {'AVERAGE' if pre=='Odd' else 'BEST'} odds ===")
    for b, d in S[S.book == pre].groupby("bucket", observed=True):
        report(f"soccer_bucket_{pre}", f"{pre} 1X2 implied {b}", d.pnl.values, d.season.values)
print("\n=== by outcome type ===")
for side in ["Home", "Draw", "Away"]:
    for pre in ["Odd", "Max"]:
        d = S[(S.side == side) & (S.book == pre)]; report("soccer_side", f"{pre} all {side}", d.pnl.values, d.season.values)
d = S[(S.book == "Max") & (S.imp >= .7)]; report("soccer_side", "Max: heavy favourites (>=70% implied)", d.pnl.values, d.season.values)
d = S[(S.book == "Max") & (S.imp < .15)]; report("soccer_side", "Max: longshots (<15% implied)", d.pnl.values, d.season.values)
for t in ["top5", "other"]:
    d = S[(S.book == "Max") & (S.tier == t) & (S.imp >= .6)]; report("soccer_side", f"Max: favourites >=60% in {t}", d.pnl.values, d.season.values)

# --------------------------------------------------------- 2. cross-book arbitrage at best prices
d = m.dropna(subset=["MaxHome", "MaxDraw", "MaxAway"]).copy()
d["ov"] = 1 / d.MaxHome + 1 / d.MaxDraw + 1 / d.MaxAway
arb = d[d.ov < 1]
print(f"\n=== ARBITRAGE (sum of 1/best odds < 1): {len(arb)} of {len(d)} matches ({len(arb)/len(d)*100:.1f}%), "
      f"mean guaranteed profit {((1/arb.ov)-1).mean()*100:.2f}%, median {((1/arb.ov)-1).median()*100:.2f}%, p90 {((1/arb.ov)-1).quantile(.9)*100:.2f}%")
print(d.groupby("season").apply(lambda x: pd.Series({"n": len(x), "arb_share": (x.ov < 1).mean(), "mean_arb_profit": ((1 / x.ov[x.ov < 1]) - 1).mean()})).round(4).T.to_string())
print("arb share by tier:", d.groupby("tier").apply(lambda x: (x.ov < 1).mean()).round(4).to_dict())
d2 = m.dropna(subset=["MaxOver25", "MaxUnder25"]).copy(); d2["ov"] = 1 / d2.MaxOver25 + 1 / d2.MaxUnder25
print(f"O/U 2.5 arbitrage share at best prices: {(d2.ov < 1).mean()*100:.2f}% of {len(d2)}; mean profit {((1/d2.ov[d2.ov<1])-1).mean()*100:.2f}%")

# --------------------------------------------------------- 3. walk-forward models -> value bets at best odds
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

mm = m.dropna(subset=["HomeElo", "AwayElo", "OddHome", "OddDraw", "OddAway", "MaxHome", "MaxDraw", "MaxAway"]).copy()
mm["elo_diff"] = mm.HomeElo - mm.AwayElo
mm["form_diff3"] = mm.Form3Home.fillna(0) - mm.Form3Away.fillna(0)
mm["form_diff5"] = mm.Form5Home.fillna(0) - mm.Form5Away.fillna(0)
ph, pdr, pa = devig_power(1 / mm.OddHome, 1 / mm.OddDraw, 1 / mm.OddAway)
mm["mkt_h"], mm["mkt_d"], mm["mkt_a"] = ph, pdr, pa
mm["lg_h"] = np.log(mm.mkt_h / mm.mkt_d); mm["lg_a"] = np.log(mm.mkt_a / mm.mkt_d)
y = mm.FTResult.map({"H": 0, "D": 1, "A": 2}).values
feature_sets = {"elo_only": ["elo_diff", "HomeElo", "AwayElo", "form_diff3", "form_diff5"],
                "market_only": ["lg_h", "lg_a"],
                "market+elo": ["lg_h", "lg_a", "elo_diff", "form_diff3", "form_diff5"]}
seasons = sorted(mm.season.unique())
test_seasons = [s for s in seasons if s >= 2010]
preds = {k: np.full((len(mm), 3), np.nan) for k in feature_sets}
for k, feats in feature_sets.items():
    X = mm[feats].values
    for s in test_seasons:
        tr = (mm.season < s).values; te = (mm.season == s).values
        if tr.sum() < 5000 or te.sum() == 0:
            continue
        clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
        clf.fit(X[tr], y[tr])
        preds[k][te] = clf.predict_proba(X[te])
print("\n=== WALK-FORWARD VALUE BETTING at BEST odds (train on all prior seasons, test season by season, 2010+) ===")
from sklearn.metrics import log_loss
for k in feature_sets:
    ok = ~np.isnan(preds[k][:, 0])
    ll = log_loss(y[ok], preds[k][ok]); ll_mkt = log_loss(y[ok], mm.loc[ok, ["mkt_h", "mkt_d", "mkt_a"]].values)
    print(f"model {k:<12s} out-of-sample log-loss {ll:.4f}   (market devigged avg odds: {ll_mkt:.4f})")
for k in feature_sets:
    ok = ~np.isnan(preds[k][:, 0]); dd = mm[ok].copy(); P = preds[k][ok]
    for j, (side, res) in enumerate([("Home", "H"), ("Draw", "D"), ("Away", "A")]):
        dd[f"ev_{side}"] = P[:, j] * dd["Max" + side] - 1
    for thr in [0.0, 0.03, 0.06, 0.10]:
        allp, alls = [], []
        for side, res in [("Home", "H"), ("Draw", "D"), ("Away", "A")]:
            sel = dd[dd[f"ev_{side}"] > thr]
            allp.append(pnl(sel.FTResult == res, sel["Max" + side])); alls.append(sel.season.values)
        p = np.concatenate(allp); s = np.concatenate(alls)
        report("soccer_model_value", f"{k}: bet best odds when model EV > {thr:.0%}", p, s)
# pure line-shopping: devigged average-market probability vs best price (no model)
dd = mm.copy()
for thr in [0.0, 0.02, 0.05]:
    allp, alls = [], []
    for side, res, mk in [("Home", "H", "mkt_h"), ("Draw", "D", "mkt_d"), ("Away", "A", "mkt_a")]:
        sel = dd[dd[mk] * dd["Max" + side] - 1 > thr]
        allp.append(pnl(sel.FTResult == res, sel["Max" + side])); alls.append(sel.season.values)
    p = np.concatenate(allp); s = np.concatenate(alls)
    report("soccer_lineshop", f"line-shop: consensus prob x best odds > 1+{thr:.0%} (no model)", p, s)
    for t in ["top5", "other"]:
        sel_idx = [dd[(dd[mk] * dd["Max" + side] - 1 > thr) & (dd.tier == t)] for side, res, mk in [("Home", "H", "mkt_h"), ("Draw", "D", "mkt_d"), ("Away", "A", "mkt_a")]]
        p = np.concatenate([pnl(x.FTResult == r, x["Max" + sd]) for x, (sd, r) in zip(sel_idx, [("Home", "H"), ("Draw", "D"), ("Away", "A")])])
        s = np.concatenate([x.season.values for x in sel_idx])
        report("soccer_lineshop", f"   ... in {t} leagues", p, s)

# --------------------------------------------------------- 4. over/under and asian handicap at best prices
d = m.dropna(subset=["MaxOver25", "MaxUnder25"])
print("\n=== OVER/UNDER 2.5 at best odds ===")
report("soccer_ou", "O/U: always over 2.5 (best odds)", pnl((d.FTHome + d.FTAway) > 2.5, d.MaxOver25).astype(float), d.season.values)
report("soccer_ou", "O/U: always under 2.5 (best odds)", pnl((d.FTHome + d.FTAway) < 2.5, d.MaxUnder25).astype(float), d.season.values)
d["imp_o"] = 1 / d.MaxOver25
for lo, hi in [(0, .4), (.4, .5), (.5, .6), (.6, 1.01)]:
    x = d[(d.imp_o >= lo) & (d.imp_o < hi)]
    report("soccer_ou", f"O/U: over when over implied in [{lo},{hi})", pnl((x.FTHome + x.FTAway) > 2.5, x.MaxOver25).astype(float), x.season.values)
    report("soccer_ou", f"O/U: under when over implied in [{lo},{hi})", pnl((x.FTHome + x.FTAway) < 2.5, x.MaxUnder25).astype(float), x.season.values)

df = REG.frame(); df.to_csv(os.path.join(OUT, "soccer_tests.csv"), index=False)
print(f"\nTests run in this file: {len(df)}; best Bonferroni-adjusted p: {df.bonferroni_p.min():.4f}")
print(df.sort_values("p").head(12)[["label", "n", "roi", "t", "p", "bonferroni_p"]].to_string(index=False))
