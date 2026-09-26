#!/usr/bin/env python3
"""Kalshi sports game markets: pregame pricing efficiency.

Pregame price = hourly candle close at (close_time - typical game duration - 1h), i.e. roughly one hour
before kickoff.  Tests: calibration of pregame YES price vs outcome, favourite-longshot bias, and the
fee-adjusted return of buying the favourite / the longshot pregame and holding to settlement.
For NFL, Kalshi pregame prices are also compared with the sportsbook closing moneyline (nflverse).
"""
import os, sys, glob, json, re, glob, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee, tstat, pvalue_two_sided, american_to_prob, devig_power, summarize_bets, fmt_bets

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi"); DATA = os.environ.get("DATA_DIR", "data"); OUT = os.path.join(os.path.dirname(__file__), "results")
series = {s["ticker"]: s for s in json.load(open(os.path.join(KD, "series.json")))}
KEYWORD_HOURS = [("NFL", 3.25), ("NCAAF", 3.5), ("CFB", 3.5), ("UFL", 3.25), ("MLB", 3.0), ("BASEBALL", 3.0), ("NBA", 2.5), ("WNBA", 2.25),
                 ("BASKETBALL", 2.25), ("NCAAMB", 2.25), ("NHL", 2.75), ("HOCKEY", 2.75), ("SHL", 2.75), ("UFC", 0.6), ("FIGHT", 0.6), ("BOUT", 0.6),
                 ("BOXING", 0.8), ("ATP", 2.5), ("WTA", 2.2), ("TENNIS", 2.5), ("T20", 3.5), ("ODI", 8.0), ("TEST", 120.0), ("CRICKET", 4.0),
                 ("RUGBY", 2.0), ("VOLLEYBALL", 2.0), ("TT", 1.0), ("TABLE", 1.0), ("CSGO", 1.5), ("VALORANT", 1.5), ("LOL", 1.5), ("DOTA", 1.5),
                 ("ESPORTS", 1.5), ("GOLF", 6.0), ("LACROSSE", 2.0), ("PICKLEBALL", 1.0)]
def duration_hours(st):
    for k, h in KEYWORD_HOURS:
        if k in st: return h
    return 2.0    # soccer and everything else
def is_game(st):
    s = series.get(st, {})
    return s.get("category") == "Sports" and any(k in st for k in ("GAME", "MATCH", "FIGHT", "BOUT")) and not st.startswith("KXMVE")
def sport_family(st):
    for k in ("NFL", "NCAAF", "CFB", "MLB", "NBA", "WNBA", "NHL", "UFC", "ATP", "WTA", "CRICKET", "T20", "ODI", "MLS", "UEFA", "EPL", "LALIGA", "SERIEA", "BUNDESLIGA", "LIGUE1", "CSGO", "VALORANT", "LOL", "DOTA"):
        if k in st: return k
    return "other"
DUR = {}
mk = {}
for _fn in sorted(glob.glob(os.path.join(KD, "markets*.jsonl"))):
  with open(_fn) as f:
    for line in f:
        if '"series_ticker": "KX' not in line: continue
        st = line.split('"series_ticker": "')[1].split('"')[0]
        if not is_game(st): continue
        DUR[st] = duration_hours(st)
        m = json.loads(line); mk[m["ticker"]] = m
print(f"sports game markets settled: {len(mk)}  by series: {pd.Series([m['series_ticker'] for m in mk.values()]).value_counts().to_dict()}")

rows = []
for fn in glob.glob(os.path.join(KD, "candles_sports*.jsonl")):
    for line in open(fn):
        j = json.loads(line); m = mk.get(j["ticker"])
        if not m: continue
        close = dt.datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp()
        target = close - (DUR[m["series_ticker"]] + 1.0) * 3600
        cs = [c for c in j["candlesticks"] if c["end_period_ts"] <= target and c.get("price", {}).get("close_dollars")]
        if not cs: continue
        c = max(cs, key=lambda c: c["end_period_ts"])
        try:
            rows.append({"ticker": m["ticker"], "series": m["series_ticker"], "family": sport_family(m["series_ticker"]), "yes": m["result"] == "yes", "price": float(c["price"]["close_dollars"]),
                         "ask": float(c["yes_ask"]["close_dollars"]), "bid": float(c["yes_bid"]["close_dollars"]), "hours_before_close": (close - c["end_period_ts"]) / 3600,
                         "volume": float(m.get("volume_fp") or 0), "close_time": m["close_time"], "title": m["title"]})
        except (KeyError, ValueError, TypeError): pass
d = pd.DataFrame(rows)
if d.empty: print("no sports candles yet"); sys.exit()
d = d[(d.ask > 0) & (d.ask < 1) & (d.bid >= 0)]
d["mid"] = (d.bid + d.ask) / 2; d["spread"] = d.ask - d.bid
print(f"markets with a pregame quote: {len(d)}; median spread {d.spread.median()*100:.1f}c; median hours-before-close of quote {d.hours_before_close.median():.1f}")

def yes_pnl(x): return np.where(x.yes, 1 - x.ask, -x.ask) - kalshi_fee(x.ask)
def no_pnl(x): p = 1 - x.bid; return np.where(~x.yes, 1 - p, -p) - kalshi_fee(p)
def line(label, pnl):
    d0 = summarize_bets(pnl, label); print(fmt_bets(d0)); return d0

print("\n=== calibration of pregame MID price (all sports) ===")
d["bucket"] = pd.cut(d.mid, [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.0])
print(d.groupby("bucket", observed=True).apply(lambda x: pd.Series({"n": len(x), "mid": x.mid.mean(), "realised": x.yes.mean(), "ev_buy_yes_c": np.mean(yes_pnl(x)) * 100, "ev_buy_no_c": np.mean(no_pnl(x)) * 100})).round(3).to_string())
for s, x in d.groupby("family"):
    if len(x) < 200: continue
    print(f"\n--- {s}: n={len(x)} ---")
    print(x.groupby("bucket", observed=True).apply(lambda y: pd.Series({"n": len(y), "mid": y.mid.mean(), "realised": y.yes.mean(), "ev_buy_yes_c": np.mean(yes_pnl(y)) * 100, "ev_buy_no_c": np.mean(no_pnl(y)) * 100})).round(3).to_string())
print("\n=== strategies (ROI per $1 of contract price paid is ROI/contract divided by price; shown per contract) ===")
line("buy YES pregame on every market (baseline)", yes_pnl(d))
line("buy favourite pregame (ask >= 0.60): YES side", yes_pnl(d[d.ask >= .6]))
line("buy favourite pregame via NO side (NO price >= 0.60)", no_pnl(d[(1 - d.bid) >= .6]))
line("buy heavy favourite pregame (ask 0.80-0.97)", yes_pnl(d[(d.ask >= .8) & (d.ask <= .97)]))
line("buy longshot pregame (ask <= 0.30)", yes_pnl(d[d.ask <= .3]))
line("buy longshot pregame (ask <= 0.15)", yes_pnl(d[d.ask <= .15]))

# ---- NFL vs sportsbook closing line
g = pd.read_csv(os.path.join(DATA, "games.csv")); g = g[g.home_score.notna() & g.home_moneyline.notna()]
g["gameday"] = pd.to_datetime(g.gameday)
abbr = {"GB": "GB", "KC": "KC", "SF": "SF", "NE": "NE", "NO": "NO", "TB": "TB", "LV": "LV", "LA": "LA", "LAC": "LAC"}
nfl = d[d.series == "KXNFLGAME"].copy()
if len(nfl):
    nfl["date"] = pd.to_datetime(nfl.ticker.str.extract(r"KXNFLGAME-(\d{2}[A-Z]{3}\d{2})")[0], format="%y%b%d", errors="coerce")
    nfl["team"] = nfl.ticker.str.split("-").str[-1]
    out = []
    for _, r in nfl.iterrows():
        cands = g[(g.gameday.between(r.date - pd.Timedelta("1D"), r.date + pd.Timedelta("1D"))) & ((g.home_team == r.team) | (g.away_team == r.team))]
        if len(cands) != 1: continue
        gm = cands.iloc[0]; home = gm.home_team == r.team
        ph, pa = devig_power(american_to_prob([gm.home_moneyline]), american_to_prob([gm.away_moneyline]))
        vegas = float(ph[0] if home else pa[0])
        out.append({"ticker": r.ticker, "kalshi_mid": r.mid, "kalshi_ask": r.ask, "kalshi_bid": r.bid, "vegas_fair": vegas, "yes": r.yes})
    v = pd.DataFrame(out)
    if len(v):
        v["diff"] = v.kalshi_mid - v.vegas_fair
        print(f"\n=== NFL: Kalshi pregame mid vs sportsbook closing fair prob, n={len(v)} sides; mean |diff| {v['diff'].abs().mean()*100:.1f}c, corr {np.corrcoef(v.kalshi_mid, v.vegas_fair)[0,1]:.3f} ===")
        cheap = v[v.kalshi_ask < v.vegas_fair - 0.02]
        pnl = np.where(cheap.yes, 1 - cheap.kalshi_ask, -cheap.kalshi_ask) - kalshi_fee(cheap.kalshi_ask)
        line("buy YES on Kalshi when ask is >2c below Vegas fair prob", pnl)
        rich = v[(1 - v.kalshi_bid) < (1 - v.vegas_fair) - 0.02]
        p = 1 - rich.kalshi_bid; pnl = np.where(~rich.yes, 1 - p, -p) - kalshi_fee(p)
        line("buy NO on Kalshi when NO price is >2c below Vegas fair", pnl)
        from sklearn.metrics import log_loss
        print(f"log-loss: Kalshi mid {log_loss(v.yes, v.kalshi_mid.clip(.01,.99)):.4f} vs Vegas fair {log_loss(v.yes, v.vegas_fair.clip(.01,.99)):.4f}")
d.drop(columns=["bucket"]).to_parquet(os.path.join(OUT, "kalshi_sports_pregame.parquet"))
edges = [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, 1.0001]; cal = []
for lo, hi in zip(edges[:-1], edges[1:]):
    y = d[(d.ask >= lo) & (d.ask < hi)]
    if len(y) >= 30: cal.append({"lo": lo, "hi": hi, "n": int(len(y)), "ask": float(y.ask.mean()), "realised": float(y.yes.mean())})
json.dump(cal, open(os.path.join(OUT, "calibration_sports.json"), "w"), indent=1)
