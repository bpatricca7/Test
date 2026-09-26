#!/usr/bin/env python3
"""NFL betting tests on nflverse closing lines (1999-2026; moneylines from 2006).

Every result is net of the bookmaker's vig (we pay the quoted price). Baseline expectation for a
no-skill bettor: about -2.5% ROI on moneylines and -4.5% on -110 spread/total bets.
"""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import american_to_decimal, american_to_prob, summarize_bets, fmt_bets, TestRegistry

DATA = os.environ.get("DATA_DIR", "data")
OUT = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(OUT, exist_ok=True)
REG = TestRegistry()

g = pd.read_csv(os.path.join(DATA, "games.csv"))
g = g[g.home_score.notna()].copy()
g["gameday"] = pd.to_datetime(g["gameday"])
g["margin"] = g.home_score - g.away_score
g["tot"] = g.home_score + g.away_score
print(f"NFL games with results: {len(g)} ({g.season.min()}-{g.season.max()})")


def bet_pnl(won, dec, push=None):
    """1 unit staked at decimal odds `dec`."""
    pnl = np.where(won, dec - 1.0, -1.0)
    if push is not None:
        pnl = np.where(push, 0.0, pnl)
    return pnl


def report(family, label, pnl, seasons=None):
    d = summarize_bets(pnl, label)
    if seasons is not None and len(pnl):
        s = pd.Series(pnl, index=seasons).groupby(level=0).mean()
        d["seasons_positive"] = f"{int((s > 0).sum())}/{len(s)}"
        seasons = np.asarray(seasons); half = np.median(seasons)
        d["roi_first_half"] = float(np.mean(pnl[seasons <= half])) if (seasons <= half).any() else np.nan
        d["roi_second_half"] = float(np.mean(pnl[seasons > half])) if (seasons > half).any() else np.nan
    REG.add(family, d)
    extra = f"  seasons+={d.get('seasons_positive','')}  1st/2nd half ROI={d.get('roi_first_half',np.nan)*100:+.1f}%/{d.get('roi_second_half',np.nan)*100:+.1f}%" if seasons is not None else ""
    print(fmt_bets(d) + extra)
    return d


# ------------------------------------------------------------------ moneylines
ml = g.dropna(subset=["home_moneyline", "away_moneyline"]).copy()
ml = ml[(ml.home_moneyline != 0) & (ml.away_moneyline != 0)]
ml["h_dec"], ml["a_dec"] = american_to_decimal(ml.home_moneyline), american_to_decimal(ml.away_moneyline)
ml["h_imp"], ml["a_imp"] = american_to_prob(ml.home_moneyline), american_to_prob(ml.away_moneyline)
ml["h_win"], ml["a_win"], ml["tie"] = ml.margin > 0, ml.margin < 0, ml.margin == 0
ml["h_pnl"] = bet_pnl(ml.h_win, ml.h_dec, ml.tie)
ml["a_pnl"] = bet_pnl(ml.a_win, ml.a_dec, ml.tie)
print("\n=== MONEYLINE: favourite-longshot bias (bet every side, bucket by implied probability) ===")
sides = pd.concat([pd.DataFrame({"imp": ml.h_imp, "pnl": ml.h_pnl, "season": ml.season, "home": 1}),
                   pd.DataFrame({"imp": ml.a_imp, "pnl": ml.a_pnl, "season": ml.season, "home": 0})])
edges = [0, .15, .25, .35, .45, .55, .65, .75, .85, 1.01]
sides["bucket"] = pd.cut(sides.imp, edges, right=False)
for b, d in sides.groupby("bucket", observed=True):
    report("nfl_ml_bucket", f"ML implied prob {b}", d.pnl.values, d.season.values)
print("\n--- moneyline systems ---")
report("nfl_ml_system", "ML: all home teams", ml.h_pnl.values, ml.season.values)
report("nfl_ml_system", "ML: all away teams", ml.a_pnl.values, ml.season.values)
report("nfl_ml_system", "ML: all favourites", sides[sides.imp > .5].pnl.values, sides[sides.imp > .5].season.values)
report("nfl_ml_system", "ML: all underdogs", sides[sides.imp < .5].pnl.values, sides[sides.imp < .5].season.values)
hd = ml[ml.h_imp < .5]; report("nfl_ml_system", "ML: home underdogs", hd.h_pnl.values, hd.season.values)
hf = ml[ml.h_imp >= .8]; report("nfl_ml_system", "ML: home favourites >=80% implied", hf.h_pnl.values, hf.season.values)
af = ml[ml.a_imp >= .8]; report("nfl_ml_system", "ML: away favourites >=80% implied", af.a_pnl.values, af.season.values)
dd = ml[(ml.div_game == 1) & (ml.h_imp < .5)]; report("nfl_ml_system", "ML: divisional home underdogs", dd.h_pnl.values, dd.season.values)
bd = sides[sides.imp < .25]; report("nfl_ml_system", "ML: big underdogs (<25% implied)", bd.pnl.values, bd.season.values)
po = ml[ml.game_type != "REG"]; report("nfl_ml_system", "ML: playoff underdogs", np.where(po.h_imp < .5, po.h_pnl, po.a_pnl), po.season.values)

# ------------------------------------------------------------------ spreads
sp = g.dropna(subset=["spread_line"]).copy()
sp["h_odds"] = sp.home_spread_odds.fillna(-110); sp["a_odds"] = sp.away_spread_odds.fillna(-110)
sp["h_cover"] = sp.margin > sp.spread_line; sp["a_cover"] = sp.margin < sp.spread_line; sp["push"] = sp.margin == sp.spread_line
sp["h_pnl"] = bet_pnl(sp.h_cover, american_to_decimal(sp.h_odds), sp.push)
sp["a_pnl"] = bet_pnl(sp.a_cover, american_to_decimal(sp.a_odds), sp.push)
sp["home_fav"] = sp.spread_line > 0; sp["rest_diff"] = sp.home_rest - sp.away_rest
sp["weekday"] = sp.gameday.dt.day_name()
print("\n=== SPREAD (ATS) systems, net of -110 / quoted juice ===")
report("nfl_ats", "ATS: all home teams", sp.h_pnl.values, sp.season.values)
report("nfl_ats", "ATS: all away teams", sp.a_pnl.values, sp.season.values)
x = sp[~sp.home_fav & (sp.spread_line != 0)]; report("nfl_ats", "ATS: home underdogs", x.h_pnl.values, x.season.values)
x = sp[sp.home_fav]; report("nfl_ats", "ATS: road underdogs", x.a_pnl.values, x.season.values)
x = sp[sp.spread_line >= 7]; report("nfl_ats", "ATS: fade home favourites of 7+ (bet away)", x.a_pnl.values, x.season.values)
x = sp[sp.spread_line <= -7]; report("nfl_ats", "ATS: fade road favourites of 7+ (bet home)", x.h_pnl.values, x.season.values)
x = sp[sp.spread_line >= 10]; report("nfl_ats", "ATS: fade home favourites of 10+ (bet away)", x.a_pnl.values, x.season.values)
x = sp[(sp.div_game == 1) & ~sp.home_fav]; report("nfl_ats", "ATS: divisional home dogs", x.h_pnl.values, x.season.values)
x = sp[(sp.div_game == 1)]; report("nfl_ats", "ATS: divisional game underdogs", np.where(x.home_fav, x.a_pnl, x.h_pnl), x.season.values)
x = sp[sp.rest_diff >= 4]; report("nfl_ats", "ATS: home team off bye/extra rest (>=4 days more)", x.h_pnl.values, x.season.values)
x = sp[sp.rest_diff <= -4]; report("nfl_ats", "ATS: away team off bye/extra rest (bet away)", x.a_pnl.values, x.season.values)
x = sp[sp.weekday == "Thursday"]; report("nfl_ats", "ATS: Thursday games, bet home", x.h_pnl.values, x.season.values)
x = sp[sp.weekday == "Monday"]; report("nfl_ats", "ATS: Monday games, bet home", x.h_pnl.values, x.season.values)
x = sp[sp.game_type != "REG"]; report("nfl_ats", "ATS: playoff underdogs", np.where(x.home_fav, x.a_pnl, x.h_pnl), x.season.values)
x = sp[sp.week == 1]; report("nfl_ats", "ATS: week-1 underdogs", np.where(x.home_fav, x.a_pnl, x.h_pnl), x.season.values)
x = sp[(sp.week >= 15) & (sp.game_type == "REG")]; report("nfl_ats", "ATS: late-season (wk15+) underdogs", np.where(x.home_fav, x.a_pnl, x.h_pnl), x.season.values)
x = sp[sp.roof.isin(["dome", "closed"])]; report("nfl_ats", "ATS: dome games, bet home", x.h_pnl.values, x.season.values)
x = sp[sp.temp <= 32]; report("nfl_ats", "ATS: freezing games, bet home", x.h_pnl.values, x.season.values)
print("\n--- ATS by closing spread bucket (bet the underdog) ---")
sp["abs_spread"] = sp.spread_line.abs()
for lo, hi in [(0, 3), (3, 6.5), (6.5, 10), (10, 30)]:
    x = sp[(sp.abs_spread >= lo) & (sp.abs_spread < hi) & (sp.spread_line != 0)]
    report("nfl_ats_bucket", f"ATS: underdog when |spread| in [{lo},{hi})", np.where(x.home_fav, x.a_pnl, x.h_pnl), x.season.values)

# ------------------------------------------------------------------ totals
to = g.dropna(subset=["total_line"]).copy()
to["o_odds"] = to.over_odds.fillna(-110); to["u_odds"] = to.under_odds.fillna(-110)
to["over"] = to.tot > to.total_line; to["under"] = to.tot < to.total_line; to["push"] = to.tot == to.total_line
to["o_pnl"] = bet_pnl(to.over, american_to_decimal(to.o_odds), to.push)
to["u_pnl"] = bet_pnl(to.under, american_to_decimal(to.u_odds), to.push)
to["weekday"] = to.gameday.dt.day_name()
print("\n=== TOTALS systems ===")
report("nfl_totals", "TOTAL: always over", to.o_pnl.values, to.season.values)
report("nfl_totals", "TOTAL: always under", to.u_pnl.values, to.season.values)
x = to[to.wind >= 15]; report("nfl_totals", "TOTAL: under when wind >= 15 mph", x.u_pnl.values, x.season.values)
x = to[to.wind >= 20]; report("nfl_totals", "TOTAL: under when wind >= 20 mph", x.u_pnl.values, x.season.values)
x = to[to.temp <= 32]; report("nfl_totals", "TOTAL: under when temp <= 32F", x.u_pnl.values, x.season.values)
x = to[to.roof.isin(["dome", "closed"])]; report("nfl_totals", "TOTAL: over in domes", x.o_pnl.values, x.season.values)
x = to[to.weekday == "Thursday"]; report("nfl_totals", "TOTAL: under on Thursday", x.u_pnl.values, x.season.values)
x = to[to.week <= 2]; report("nfl_totals", "TOTAL: under in weeks 1-2", x.u_pnl.values, x.season.values)
x = to[to.game_type != "REG"]; report("nfl_totals", "TOTAL: under in playoffs", x.u_pnl.values, x.season.values)
x = to[to.div_game == 1]; report("nfl_totals", "TOTAL: under in divisional games", x.u_pnl.values, x.season.values)
print("\n--- totals by line bucket ---")
for lo, hi in [(0, 40), (40, 44), (44, 48), (48, 52), (52, 80)]:
    x = to[(to.total_line >= lo) & (to.total_line < hi)]
    report("nfl_totals_bucket", f"TOTAL: under when line in [{lo},{hi})", x.u_pnl.values, x.season.values)

# ------------------------------------------------------------------ line-value sanity: how good is the closing line?
d = sp.dropna(subset=["spread_line"])
print(f"\nClosing spread quality: mean(margin - spread) = {(d.margin - d.spread_line).mean():+.2f} pts, "
      f"sd = {(d.margin - d.spread_line).std():.2f}, corr = {np.corrcoef(d.spread_line, d.margin)[0,1]:.3f}")
mlc = ml.copy(); mlc["h_fair"] = mlc.h_imp / (mlc.h_imp + mlc.a_imp)
cal = mlc.groupby(pd.cut(mlc.h_fair, np.arange(0, 1.01, .1))).agg(n=("h_win", "size"), implied=("h_fair", "mean"), actual=("h_win", "mean"))
print("Moneyline calibration (home team, vig removed proportionally):"); print(cal.round(3).to_string())

df = REG.frame(); df.to_csv(os.path.join(OUT, "nfl_tests.csv"), index=False)
print(f"\nTests run in this file: {len(df)}; best Bonferroni-adjusted p: {df.bonferroni_p.min():.3f}")
print(df.sort_values("p").head(8)[["label", "n", "roi", "t", "p", "bonferroni_p"]].to_string(index=False))
