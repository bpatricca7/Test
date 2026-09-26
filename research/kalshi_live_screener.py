#!/usr/bin/env python3
"""Live screener for the Kalshi patterns tested in this repo (read-only; prints candidates, places nothing).

  1. 15-minute crypto up/down markets closing within --minutes, where one side is asked at >= --fav
  2. hourly BTC/ETH strike ladders: strikes with YES ask <= --tail (sell the upper tail via NO) or YES bid >= 1 - --tail
  3. sports game markets starting soon with a heavy favourite

Fee-adjusted expected value uses the calibration tables written by the analysis scripts when present
(research/results/calibration_*.json); otherwise it assumes the quoted price is the true probability, in
which case EV is just minus the fee.  Run: python research/kalshi_live_screener.py --minutes 4 --fav 0.94
"""
import argparse, json, os, sys, time, datetime as dt
import requests
sys.path.insert(0, os.path.dirname(__file__))
from lib.stats import kalshi_fee

BASE = "https://api.elections.kalshi.com/trade-api/v2"
S = requests.Session(); S.headers.update({"Accept": "application/json", "User-Agent": "market-research-screener/1.0"})
RES = os.path.join(os.path.dirname(__file__), "results")


def get(path, **params):
    r = S.get(f"{BASE}{path}", params=params, timeout=30); r.raise_for_status(); return r.json()


def open_markets(series_ticker):
    out, cursor = [], None
    while True:
        j = get("/markets", series_ticker=series_ticker, status="open", limit=1000, **({"cursor": cursor} if cursor else {}))
        out += j.get("markets", []); cursor = j.get("cursor")
        if not cursor: break
    return out


def load_calibration(name):
    p = os.path.join(RES, f"calibration_{name}.json")
    return json.load(open(p)) if os.path.exists(p) else None


def calibrated_prob(cal, price, minute=None):
    """Look up realised frequency for a quoted price from a saved calibration table; fall back to the price."""
    if not cal: return price
    rows = [r for r in cal if (minute is None or r.get("minute") == minute) and r["lo"] <= price < r["hi"]]
    return rows[0]["realised"] if rows else price


def screen_15m(minutes, fav):
    now = time.time(); cal = load_calibration("15m")
    print(f"\n=== 15-minute crypto markets closing within {minutes} min with a side asked >= {fav:.2f} ===")
    for st in ("KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXDOGE15M", "KXBNB15M", "KXHYPE15M"):
        for m in open_markets(st):
            close = dt.datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp()
            left = (close - now) / 60
            if not (0 < left <= minutes): continue
            ya, yb = float(m.get("yes_ask_dollars") or 0), float(m.get("yes_bid_dollars") or 0)
            na = 1 - yb if yb else 0
            for side, price in (("YES", ya), ("NO", na)):
                if price >= fav and price < 1:
                    p = calibrated_prob(cal, price, minute=15 - int(left))
                    ev = p * (1 - price) - (1 - p) * price - float(kalshi_fee(price))
                    print(f"{m['ticker']:<32s} {side} ask {price:.3f}  {left:4.1f} min left  strike {m.get('floor_strike')}  est.P {p:.3f}  fee-adj EV {ev*100:+.2f}c  vol {float(m.get('volume_fp') or 0):,.0f}")


def screen_ladders(tail):
    cal = load_calibration("hourly")
    print(f"\n=== hourly BTC/ETH ladders: strikes asked <= {tail:.2f} (buy NO) or bid >= {1-tail:.2f} (buy YES) ===")
    for st in ("KXBTCD", "KXETHD"):
        ms = open_markets(st)
        for m in sorted(ms, key=lambda x: (x["close_time"], float(x.get("floor_strike") or 0))):
            ya, yb = float(m.get("yes_ask_dollars") or 0), float(m.get("yes_bid_dollars") or 0)
            if 0 < ya <= tail:
                price = 1 - yb if yb else None
                if price:
                    p = 1 - calibrated_prob(cal, ya); ev = p * (1 - price) - (1 - p) * price - float(kalshi_fee(price))
                    print(f"{m['ticker']:<34s} buy NO at {price:.3f} (YES ask {ya:.3f}) closes {m['close_time'][11:16]}Z  est.P(no) {p:.3f}  EV {ev*100:+.2f}c")
            elif yb >= 1 - tail and ya < 1:
                p = calibrated_prob(cal, ya); ev = p * (1 - ya) - (1 - p) * ya - float(kalshi_fee(ya))
                print(f"{m['ticker']:<34s} buy YES at {ya:.3f} closes {m['close_time'][11:16]}Z  est.P(yes) {p:.3f}  EV {ev*100:+.2f}c")


def screen_sports(fav, hours):
    now = time.time(); cal = load_calibration("sports")
    print(f"\n=== sports game markets closing within {hours}h with a side asked >= {fav:.2f} ===")
    series = get("/series", limit=1000).get("series", [])
    for s in series:
        st = s["ticker"]
        if s.get("category") != "Sports" or not any(k in st for k in ("GAME", "MATCH", "FIGHT", "BOUT")) or st.startswith("KXMVE"): continue
        try: ms = open_markets(st)
        except requests.HTTPError: continue
        for m in ms:
            close = dt.datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp()
            if not (0 < (close - now) / 3600 <= hours): continue
            ya, yb = float(m.get("yes_ask_dollars") or 0), float(m.get("yes_bid_dollars") or 0); na = 1 - yb if yb else 0
            for side, price in (("YES", ya), ("NO", na)):
                if fav <= price < 1:
                    p = calibrated_prob(cal, price); ev = p * (1 - price) - (1 - p) * price - float(kalshi_fee(price))
                    print(f"{m['ticker']:<40s} {side} at {price:.3f}  {m['title'][:40]:<40s} closes {m['close_time'][:16]}  est.P {p:.3f}  EV {ev*100:+.2f}c")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--minutes", type=float, default=4); ap.add_argument("--fav", type=float, default=0.94)
    ap.add_argument("--tail", type=float, default=0.10); ap.add_argument("--hours", type=float, default=6); ap.add_argument("--no-sports", action="store_true")
    a = ap.parse_args()
    screen_15m(a.minutes, a.fav); screen_ladders(a.tail)
    if not a.no_sports: screen_sports(a.fav, a.hours)
