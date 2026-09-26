#!/usr/bin/env python3
"""Bulk-download Kalshi settled-market history (public, unauthenticated API).

Phase 1: all series (category, fee schedule) + every settled market per series
         (multivariate combo series KXMVE* are skipped: derivative, no new info).
Phase 2: 1-minute candlesticks for the 15-minute crypto up/down markets.
Phase 3: hourly candlesticks for NFL / MLB / NCAAF game-winner markets.
Phase 4: daily candlesticks for the highest-volume markets in every other category.

Everything is written as JSONL under DATA_DIR so the job can be resumed.
"""
import json, os, sys, time, glob, datetime as dt
import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
DATA_DIR = os.environ.get("KALSHI_DATA_DIR", "data/kalshi")
RATE = float(os.environ.get("KALSHI_RPS", "8"))     # requests per second
os.makedirs(DATA_DIR, exist_ok=True)

S = requests.Session()
S.headers.update({"Accept": "application/json", "User-Agent": "market-research/1.0"})
_last = [0.0]

KEEP = ["ticker", "event_ticker", "title", "yes_sub_title", "no_sub_title", "strike_type", "floor_strike",
        "cap_strike", "expiration_value", "result", "last_price_dollars", "previous_price_dollars",
        "yes_bid_dollars", "yes_ask_dollars", "previous_yes_bid_dollars", "previous_yes_ask_dollars",
        "volume_fp", "volume_24h_fp", "open_interest_fp", "liquidity_dollars", "open_time", "close_time",
        "expiration_time", "expected_expiration_time", "settlement_ts", "created_time", "market_type",
        "settlement_value_dollars", "notional_value_dollars", "can_close_early", "is_provisional",
        "mve_collection_ticker", "status"]


def get(path, **params):
    """GET with client-side rate limiting and retry on 429/5xx."""
    for attempt in range(8):
        wait = 1.0 / RATE - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = S.get(f"{BASE}{path}", params=params, timeout=60)
        except requests.RequestException as e:
            log(f"  net error {e}; retry {attempt}")
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 404:
            return None
        log(f"  HTTP {r.status_code} {path} {params} {r.text[:200]}")
        return None
    return None


def log(msg):
    line = f"{dt.datetime.utcnow().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    with open(os.path.join(DATA_DIR, "download.log"), "a") as f:
        f.write(line + "\n")


def load_done(name):
    p = os.path.join(DATA_DIR, name)
    return set(l.strip() for l in open(p)) if os.path.exists(p) else set()


def mark_done(name, key):
    with open(os.path.join(DATA_DIR, name), "a") as f:
        f.write(key + "\n")


# ---------------- Phase 1: series + settled markets ----------------
def phase1():
    sp = os.path.join(DATA_DIR, "series.json")
    if os.path.exists(sp):
        series = json.load(open(sp))
    else:
        series = []
        cursor = None
        while True:
            j = get("/series", limit=1000, **({"cursor": cursor} if cursor else {}))
            if not j:
                break
            series += j.get("series", [])
            cursor = j.get("cursor")
            if not cursor:
                break
        json.dump(series, open(sp, "w"))
    log(f"phase1: {len(series)} series")
    suffix = os.environ.get("KALSHI_SHARD", "").replace("/", "of")
    done = set()
    for fn in glob.glob(os.path.join(DATA_DIR, "series_done*.txt")):
        done |= set(l.strip() for l in open(fn))
    order = {"Crypto": 0, "Sports": 1, "Economics": 2, "Politics": 3, "Elections": 4, "Entertainment": 5,
             "Climate and Weather": 6, "Science and Technology": 7, "Companies": 8, "World": 9, "Financials": 10}
    series.sort(key=lambda s: order.get(s.get("category"), 9))
    if os.environ.get("KALSHI_SHARD"):
        i_, n_ = map(int, os.environ["KALSHI_SHARD"].split("/")); series = [s for s in series if sum(map(ord, s["ticker"])) % n_ == i_]
    out = open(os.path.join(DATA_DIR, f"markets{('_' + suffix) if suffix else ''}.jsonl"), "a")
    n_total = 0
    for i, s in enumerate(series):
        t = s["ticker"]
        if t in done or t.startswith("KXMVE"):
            continue
        cursor, n = None, 0
        while True:
            j = get("/markets", series_ticker=t, status="settled", limit=1000, **({"cursor": cursor} if cursor else {}))
            if not j:
                break
            for m in j.get("markets", []):
                rec = {k: m.get(k) for k in KEEP}
                rec["series_ticker"] = t
                if m.get("custom_strike"):
                    rec["custom_strike"] = m["custom_strike"]
                out.write(json.dumps(rec) + "\n")
                n += 1
            cursor = j.get("cursor")
            if not cursor:
                break
        out.flush()
        mark_done(f"series_done{('_' + suffix) if suffix else ''}.txt", t)
        n_total += n
        if n or i % 200 == 0:
            log(f"  [{i}/{len(series)}] {t} ({s.get('category')}): {n} settled markets (running total {n_total})")
    out.close()
    log("phase1 done")


def iter_markets():
    for fn in sorted(glob.glob(os.path.join(DATA_DIR, "markets*.jsonl"))):
        with open(fn) as f:
            for line in f:
                yield json.loads(line)


def ts(iso):
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def fetch_candles(series_ticker, ticker, start, end, period, outfile, done_name):
    j = get(f"/series/{series_ticker}/markets/{ticker}/candlesticks", start_ts=start, end_ts=end, period_interval=period)
    if j is None:
        mark_done(done_name, ticker)
        return 0
    c = j.get("candlesticks", [])
    outfile.write(json.dumps({"ticker": ticker, "series_ticker": series_ticker, "period": period, "candlesticks": c}) + "\n")
    mark_done(done_name, ticker)
    return len(c)


# ---------------- Phase 2: 15-minute crypto markets, 1-minute candles ----------------
def phase2():
    targets = {"KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"}
    done = load_done("candles15_done.txt")
    suffix = os.environ.get("KALSHI_SHARD", "").replace("/", "of")
    out = open(os.path.join(DATA_DIR, f"candles_15m{('_' + suffix) if suffix else ''}.jsonl"), "a")
    ms = [m for m in iter_markets() if m["series_ticker"] in targets and m["ticker"] not in done]
    shard = os.environ.get("KALSHI_SHARD")          # "i/n": this worker handles tickers with hash % n == i
    if shard:
        i, n = map(int, shard.split("/")); ms = [m for m in ms if sum(map(ord, m["ticker"])) % n == i]
    log(f"phase2{'[' + shard + ']' if shard else ''}: {len(ms)} 15-minute markets need candles")
    for i, m in enumerate(ms):
        fetch_candles(m["series_ticker"], m["ticker"], ts(m["open_time"]) - 60, ts(m["close_time"]) + 60, 1, out, f"candles15_done{('_' + suffix) if suffix else ''}.txt")
        if i % 500 == 0:
            out.flush(); log(f"  phase2 {i}/{len(ms)}")
    out.close(); log("phase2 done")


# ---------------- Phase 3: sports game markets, hourly candles ----------------
def phase3(min_volume=5000):
    """Every Sports-category game/match/fight market with at least $min_volume traded."""
    series = {s["ticker"]: s for s in json.load(open(os.path.join(DATA_DIR, "series.json")))}
    def is_game(st):
        s = series.get(st, {})
        return s.get("category") == "Sports" and any(k in st for k in ("GAME", "MATCH", "FIGHT", "BOUT")) and not st.startswith("KXMVE")
    done = load_done("candles_sports_done.txt")
    suffix = os.environ.get("KALSHI_SHARD", "").replace("/", "of")
    out = open(os.path.join(DATA_DIR, f"candles_sports{('_' + suffix) if suffix else ''}.jsonl"), "a")
    ms = [m for m in iter_markets() if is_game(m["series_ticker"]) and m["ticker"] not in done and float(m.get("volume_fp") or 0) >= min_volume]
    if os.environ.get("KALSHI_SHARD"):
        i, n = map(int, os.environ["KALSHI_SHARD"].split("/")); ms = [m for m in ms if sum(map(ord, m["ticker"])) % n == i]
    log(f"phase3: {len(ms)} sports markets need candles")
    for i, m in enumerate(ms):
        fetch_candles(m["series_ticker"], m["ticker"], ts(m["open_time"]) - 3600, ts(m["close_time"]) + 3600, 60, out, f"candles_sports_done{('_' + suffix) if suffix else ''}.txt")
        if i % 500 == 0:
            out.flush(); log(f"  phase3 {i}/{len(ms)}")
    out.close(); log("phase3 done")


# ---------------- Phase 4: long-lived markets in every category, daily candles ----------------
def phase4(per_series=40, min_volume=100):
    """RANDOM sample (seeded) of up to per_series markets per series with lifetime >= 2 days and any volume.
    Do not pick by volume: contracts that end at 100c attract volume, which would bias calibration."""
    import random
    rnd = random.Random(20260926)
    skip_prefix = ("KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXBNB15M", "KXHYPE15M", "KXNEAR15M", "KXZEC15M", "KXDOGE15M")
    done = set()
    for fn in glob.glob(os.path.join(DATA_DIR, "candles_daily2_done*.txt")):
        done |= set(l.strip() for l in open(fn))
    by_series = {}
    for m in iter_markets():
        st = m["series_ticker"]
        if st in skip_prefix or m.get("result") not in ("yes", "no"):
            continue
        try:
            v = float(m.get("volume_fp") or 0)
        except ValueError:
            v = 0
        if v < min_volume:
            continue
        life = ts(m["close_time"]) - ts(m["open_time"])
        if life < 2 * 86400:
            continue
        by_series.setdefault(st, []).append(m)
    ms = []
    for st, lst in by_series.items():
        rnd.shuffle(lst)
        ms += lst[:per_series]
    ms = [m for m in ms if m["ticker"] not in done]
    suffix = os.environ.get("KALSHI_SHARD", "").replace("/", "of")
    if os.environ.get("KALSHI_SHARD"):
        i, n = map(int, os.environ["KALSHI_SHARD"].split("/")); ms = [m for m in ms if sum(map(ord, m["ticker"])) % n == i]
    log(f"phase4{'[' + suffix + ']' if suffix else ''}: {len(ms)} long-lived markets need daily candles")
    out = open(os.path.join(DATA_DIR, f"candles_daily2{('_' + suffix) if suffix else ''}.jsonl"), "a")
    for i, m in enumerate(ms):
        fetch_candles(m["series_ticker"], m["ticker"], ts(m["open_time"]) - 86400, ts(m["close_time"]) + 86400, 1440, out, f"candles_daily2_done{('_' + suffix) if suffix else ''}.txt")
        if i % 500 == 0:
            out.flush(); log(f"  phase4 {i}/{len(ms)}")
    out.close(); log("phase4 done")


# ---------------- Phase 5: hourly BTC/ETH strike ladders, 1-minute candles (sampled hours) ----------------
def phase5(min_volume=50):
    """KXBTCD every 3rd UTC hour, KXETHD every 6th hour: enough ladders to measure implied-vs-realised tails."""
    done = load_done("candles_hourly_done.txt")
    suffix = os.environ.get("KALSHI_SHARD", "").replace("/", "of")
    ms = []
    for m in iter_markets():
        st = m["series_ticker"]
        if st not in ("KXBTCD", "KXETHD") or m["ticker"] in done:
            continue
        try:
            if float(m.get("volume_fp") or 0) < min_volume:
                continue
        except ValueError:
            continue
        hour = int(m["close_time"][11:13])
        if (st == "KXBTCD" and hour % 3 == 0) or (st == "KXETHD" and hour % 6 == 0):
            ms.append(m)
    if os.environ.get("KALSHI_SHARD"):
        i, n = map(int, os.environ["KALSHI_SHARD"].split("/")); ms = [m for m in ms if sum(map(ord, m["ticker"])) % n == i]
    log(f"phase5{'[' + suffix + ']' if suffix else ''}: {len(ms)} hourly ladder markets need candles")
    out = open(os.path.join(DATA_DIR, f"candles_hourly{('_' + suffix) if suffix else ''}.jsonl"), "a")
    for i, m in enumerate(ms):
        fetch_candles(m["series_ticker"], m["ticker"], ts(m["open_time"]) - 60, ts(m["close_time"]) + 60, 1, out, f"candles_hourly_done{('_' + suffix) if suffix else ''}.txt")
        if i % 500 == 0:
            out.flush(); log(f"  phase5 {i}/{len(ms)}")
    out.close(); log("phase5 done")


if __name__ == "__main__":
    phases = sys.argv[1:] or ["1", "2", "3", "4"]
    for p in phases:
        {"1": phase1, "2": phase2, "3": phase3, "4": phase4, "5": phase5}[p]()
    log("ALL DONE")
