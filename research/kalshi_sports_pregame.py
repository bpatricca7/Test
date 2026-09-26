#!/usr/bin/env python3
"""Kalshi sports game markets: pregame pricing efficiency.

Pregame price = hourly candle close at (close_time - typical game duration - 1h), i.e. roughly one hour
before kickoff.  Tests: calibration of pregame YES price vs outcome, favourite-longshot bias, and the
fee-adjusted return of buying the favourite / the longshot pregame and holding to settlement.
For NFL, Kalshi pregame prices are also compared with the sportsbook closing moneyline (nflverse).
"""
import os, sys, json, re, glob, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee, tstat, pvalue_two_sided, american_to_prob, devig_power, summarize_bets, fmt_bets

KD = os.environ.get("KALSHI_DATA_DIR", "data/kalshi"); DATA = os.environ.get("DATA_DIR", "data"); OUT = os.path.join(os.path.dirname(__file__), "results")
DUR = {"KXNFLGAME": 3.25, "KXNCAAFGAME": 3.5, "KXCFBGAME": 3.5, "KXMLBGAME": 3.0, "KXNBAGAME": 2.5, "KXNHLGAME": 2.75, "KXWNBAGAME": 2.25}

mk = {}
with open(os.path.join(KD, "markets.jsonl")) as f:
    for line in f:
        if '"series_ticker": "KX' not in line: continue
        st = line.split('"series_ticker": "')[1].split('"')[0]
        if st not in DUR: continue
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
            rows.append({"ticker": m["ticker"], "series": m["series_ticker"], "yes": m["result"] == "yes", "price": float(c["price"]["close_dollars"]),
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
for s, x in d.groupby("series"):
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
d.to_parquet(os.path.join(OUT, "kalshi_sports_pregame.parquet"))
