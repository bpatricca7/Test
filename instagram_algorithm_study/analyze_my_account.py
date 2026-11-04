"""
Run the study's statistics on YOUR OWN Instagram data.

Export post-level insights (Meta Business Suite -> Insights -> Content ->
Export, or Professional Dashboard export) as CSV, then:

    python3 analyze_my_account.py my_export.csv            # writes my_account_report.md
    python3 analyze_my_account.py --demo                   # synthetic example, clearly labelled

Column names vary between exports and change over time; this script matches
common variants (Views/Plays/Impressions, Reach/Accounts reached, Shares/Sends,
Publish time/Date, Duration (sec), Post type, Description/Caption, ...).

What it computes
  1. Your view distribution: median, typical (geometric mean), spread of log
     views (sd_log), and how concentrated your views are in your top posts.
  2. Format and length benchmarks with bootstrap confidence intervals on the median.
  3. Which behaviour signals (sends, saves, likes, comments, follows per reach,
     avg watch time) track your views, as rank correlations.
  4. A regression of log(views) on things you control (format, length, hashtag
     count, caption length, time of day, days since previous post, trend), with
     heteroskedasticity-robust (HC3) standard errors, reported as % effects.
  5. How many posts YOU need per variant to detect a given lift, using your own sd_log.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ALIASES = {
    "views": ["views", "plays", "video views", "reel plays", "impressions"],
    "reach": ["reach", "accounts reached", "accounts center accounts reached"],
    "likes": ["likes", "reactions"],
    "comments": ["comments"],
    "shares": ["shares", "sends", "reel shares"],
    "saves": ["saves", "saved"],
    "follows": ["follows", "follows from post"],
    "duration": ["duration (sec)", "duration (seconds)", "duration", "video duration"],
    "avg_watch": ["average watch time", "avg watch time", "average watch time (sec)"],
    "skip_rate": ["skip rate"],
    "type": ["post type", "media type", "type", "media product type"],
    "time": ["publish time", "published", "publish date", "date", "timestamp", "created time"],
    "caption": ["description", "caption", "text"],
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def map_columns(df: pd.DataFrame) -> dict[str, str]:
    cols = {_norm(c): c for c in df.columns}
    found = {}
    for key, names in ALIASES.items():
        for n in names:                       # exact match first
            if n in cols:
                found[key] = cols[n]
                break
        else:
            for n in names:                   # then substring match
                hit = next((orig for low, orig in cols.items() if n in low), None)
                if hit:
                    found[key] = hit
                    break
    return found


def to_num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.replace(",", "").str.replace("%", ""), errors="coerce")


# --------------------------------------------------------------------------
def prepare(df: pd.DataFrame) -> pd.DataFrame:
    m = map_columns(df)
    if "views" not in m and "reach" not in m:
        sys.exit("Could not find a Views/Plays/Reach column. Columns seen: " + ", ".join(df.columns))
    out = pd.DataFrame(index=df.index)
    for k in ["views", "reach", "likes", "comments", "shares", "saves", "follows", "duration",
              "avg_watch", "skip_rate"]:
        if k in m:
            out[k] = to_num(df[m[k]])
    if "views" not in out:
        out["views"] = out["reach"]
    if "type" in m:
        out["type"] = df[m["type"]].astype(str).str.strip().str.title()
    else:
        out["type"] = "Unknown"
    if "time" in m:
        out["time"] = pd.to_datetime(df[m["time"]], errors="coerce")
    if "caption" in m:
        cap = df[m["caption"]].fillna("").astype(str)
        out["hashtags"] = cap.str.count(r"#\w+")
        out["caption_words"] = cap.str.split().str.len()
    out = out[out["views"] > 0].copy()
    denom = out["reach"] if "reach" in out else out["views"]
    for k in ["shares", "saves", "likes", "comments", "follows"]:
        if k in out:
            out[f"{k}_per_reach"] = out[k] / denom.replace(0, np.nan)
    if "time" in out:
        out = out.sort_values("time")
        out["hour"] = out["time"].dt.hour
        out["weekday"] = out["time"].dt.day_name()
        out["days_since_prev"] = out["time"].diff().dt.total_seconds() / 86400
        out["post_index"] = np.arange(len(out))
    out["log_views"] = np.log(out["views"])
    return out.reset_index(drop=True)


# --------------------------------------------------------------------------
def bootstrap_median_ci(x: np.ndarray, reps=4000, lo=5, hi=95, seed=1):
    rng = np.random.default_rng(seed)
    if x.size < 3:
        return (float("nan"), float("nan"))
    meds = np.median(rng.choice(x, (reps, x.size), replace=True), axis=1)
    return float(np.percentile(meds, lo)), float(np.percentile(meds, hi))


def spearman(x, y) -> float:
    x, y = np.asarray(x, float), np.asarray(y, float)
    ok = ~(np.isnan(x) | np.isnan(y))
    if ok.sum() < 8:
        return float("nan")
    rx = pd.Series(x[ok]).rank().to_numpy()
    ry = pd.Series(y[ok]).rank().to_numpy()
    return float(np.corrcoef(rx, ry)[0, 1])


def ols_hc3(y: np.ndarray, X: np.ndarray):
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    e = y - X @ beta
    h = np.einsum("ij,jk,ik->i", X, XtX_inv, X)
    omega = (e / np.clip(1 - h, 1e-6, None)) ** 2
    V = XtX_inv @ (X.T * omega) @ X @ XtX_inv
    se = np.sqrt(np.diag(V))
    r2 = 1 - (e @ e) / ((y - y.mean()) @ (y - y.mean()))
    return beta, se, r2


def n_per_arm(lift, sd_log):
    return math.ceil(2 * (1.959964 + 0.841621) ** 2 * sd_log**2 / math.log(1 + lift) ** 2)


# --------------------------------------------------------------------------
def analyse(d: pd.DataFrame, title: str) -> str:
    L = [f"# {title}", ""]
    v = d["views"].to_numpy()
    sd_log = float(d["log_views"].std())
    vs = np.sort(v)[::-1]
    top10 = vs[: max(1, int(round(0.1 * vs.size)))].sum() / vs.sum()
    L += ["## 1. Your view distribution", "",
          f"- Posts analysed: **{len(d)}**",
          f"- Median views: **{np.median(v):,.0f}** (90% CI {bootstrap_median_ci(v)[0]:,.0f} to "
          f"{bootstrap_median_ci(v)[1]:,.0f})",
          f"- Typical views (geometric mean): **{math.exp(d['log_views'].mean()):,.0f}**; "
          f"arithmetic mean {v.mean():,.0f} (mean/median = {v.mean() / np.median(v):.1f})",
          f"- Spread of log views (sd_log): **{sd_log:.2f}**  -> a 'normal' post can land anywhere from "
          f"{math.exp(d['log_views'].mean() - sd_log):,.0f} to {math.exp(d['log_views'].mean() + sd_log):,.0f} views",
          f"- Your top 10% of posts produced **{top10:.0%}** of all your views.",
          "", "Track the median and the geometric mean, not the average: one breakout post moves the "
          "average a lot and tells you little about what is working.", ""]

    # 2. format / length
    L += ["## 2. Format and length", "", "| Group | Posts | Median views | 90% CI of median |", "|---|---:|---:|---:|"]
    for t, g in d.groupby("type"):
        lo, hi = bootstrap_median_ci(g["views"].to_numpy())
        L.append(f"| {t} | {len(g)} | {g['views'].median():,.0f} | {lo:,.0f} to {hi:,.0f} |")
    if "duration" in d and d["duration"].notna().sum() >= 8:
        bins = [0, 10, 20, 35, 60, 90, 10_000]
        labels = ["<10s", "10-20s", "20-35s", "35-60s", "60-90s", "90s+"]
        d["len_bucket"] = pd.cut(d["duration"], bins=bins, labels=labels, right=False)
        for t, g in d.dropna(subset=["len_bucket"]).groupby("len_bucket", observed=True):
            lo, hi = bootstrap_median_ci(g["views"].to_numpy())
            L.append(f"| Length {t} | {len(g)} | {g['views'].median():,.0f} | {lo:,.0f} to {hi:,.0f} |")
    L += ["", "Overlapping intervals mean the data cannot yet tell those groups apart.", ""]

    # 3. signals
    sig_cols = [c for c in ["shares_per_reach", "saves_per_reach", "likes_per_reach", "comments_per_reach",
                            "follows_per_reach", "avg_watch", "skip_rate"] if c in d]
    if sig_cols:
        L += ["## 3. Which signals track your views", "",
              "| Signal | Rank correlation with log views | Median value |", "|---|---:|---:|"]
        for c in sorted(sig_cols, key=lambda c: -abs(spearman(d[c], d["log_views"]))):
            L.append(f"| {c.replace('_', ' ')} | {spearman(d[c], d['log_views']):+.2f} | {d[c].median():.4g} |")
        L += ["", "Caveat: these rates are measured on the audience each post actually reached. Posts that "
              "travel far are measured on colder audiences, which pulls their rates down, so these "
              "correlations *understate* how much the underlying behaviour matters (see the study's "
              "'measurement trap' section). Use them to rank signals, not to size effects.", ""]

    # 4. regression on controllable choices
    feats, names = [], []
    if d["type"].nunique() > 1:
        base = d["type"].value_counts().index[0]
        for t in sorted(d["type"].unique()):
            if t != base:
                feats.append((d["type"] == t).astype(float).to_numpy()); names.append(f"format: {t} (vs {base})")
    for col, nm, tf in [("duration", "length: x2 longer", lambda s: np.log2(s.clip(lower=1))),
                        ("hashtags", "hashtags: +1", lambda s: s),
                        ("caption_words", "caption: +50 words", lambda s: s / 50),
                        ("days_since_prev", "gap since previous post: +1 day", lambda s: s.clip(upper=30)),
                        ("post_index", "trend: per 10 posts", lambda s: s / 10)]:
        if col in d and d[col].notna().sum() >= 0.8 * len(d) and d[col].nunique() > 2:
            feats.append(tf(d[col].fillna(d[col].median())).to_numpy(float)); names.append(nm)
    if "hour" in d:
        evening = d["hour"].between(17, 22).astype(float).to_numpy()
        if 0.1 < evening.mean() < 0.9:
            feats.append(evening); names.append("posted 17:00-22:59 (vs other hours)")
    if feats and len(d) >= len(feats) + 10:
        X = np.column_stack([np.ones(len(d))] + feats)
        beta, se, r2 = ols_hc3(d["log_views"].to_numpy(), X)
        L += ["## 4. What your choices are associated with (regression on log views)", "",
              f"R² = {r2:.2f}. Effects are % change in typical views, holding the other rows fixed; "
              "95% intervals use robust (HC3) standard errors.", "",
              "| Factor | Effect | 95% interval | Evidence |", "|---|---:|---:|---|"]
        for nm, b, s in zip(names, beta[1:], se[1:]):
            lo, hi = b - 1.96 * s, b + 1.96 * s
            strength = "clear" if lo > 0 or hi < 0 else "not distinguishable from zero"
            L.append(f"| {nm} | {math.exp(b) - 1:+.0%} | {math.exp(lo) - 1:+.0%} to {math.exp(hi) - 1:+.0%} | {strength} |")
        L += ["", "This is observational: you chose when and what to post, so these are associations. "
              "Confirm anything important with a deliberate test (section 5).", ""]

    # 5. power
    L += ["## 5. How many posts you need to test something", "",
          f"Using your own sd_log = {sd_log:.2f} (two-sided, 5% false-positive rate, 80% power):", "",
          "| Lift you want to detect | Posts per variant (A vs B) | Pairs if same content, two versions (corr 0.7) |",
          "|---|---:|---:|"]
    for lift in (0.25, 0.5, 1.0, 2.0):
        n = n_per_arm(lift, sd_log)
        L.append(f"| +{lift:.0%} | {n} | {math.ceil(n * (1 - 0.7))} |")
    L += ["", "If those numbers are bigger than you can post in a month, test big swings (new hook style, "
          "new format), use paired tests (same video, two hooks, via Trial Reels), and judge by the "
          "median over many posts, never one post.", ""]
    return "\n".join(L)


# --------------------------------------------------------------------------
def demo_frame(n=150, seed=5) -> pd.DataFrame:
    """Synthetic export with KNOWN built-in effects, generated by the funnel model."""
    from dataclasses import replace
    from funnel_model import Creator, Platform, simulate
    rng = np.random.default_rng(seed)
    rows, c, p = [], Creator(), Platform()
    t = pd.Timestamp("2026-02-01 12:00")
    for i in range(n):
        typ = rng.choice(["Reel", "Carousel", "Image"], p=[0.6, 0.3, 0.1])
        dur = float(np.clip(rng.lognormal(math.log(25), 0.6), 5, 180)) if typ == "Reel" else np.nan
        tau, h = 22.0, 0.6
        L = dur if typ == "Reel" else 20.0
        ret = h * tau * (1 - math.exp(-L / tau)) / L         # avg fraction watched
        tm = {"Reel": 1.0, "Carousel": 0.9, "Image": 0.65}[typ]
        cc = replace(c, retention=ret * 1.4 * tm, send_rate=c.send_rate * tm * (1 + 0.004 * i),
                     like_rate=c.like_rate * tm)
        v = float(simulate(cc, p, n_posts=1, seed=1000 + i)[0])
        reach = v * rng.uniform(0.6, 0.8)
        caption = "demo " * int(rng.integers(5, 120)) + " ".join("#tag" for _ in range(int(rng.integers(0, 6))))
        rows.append({"Post type": typ, "Publish time": t, "Duration (sec)": dur, "Views": round(v),
                     "Reach": round(reach), "Likes": rng.binomial(int(reach), 0.035 * tm),
                     "Shares": rng.binomial(int(reach), 0.008 * tm), "Saves": rng.binomial(int(reach), 0.01),
                     "Comments": rng.binomial(int(reach), 0.003), "Follows": rng.binomial(int(reach), 0.002),
                     "Description": caption})
        t += pd.Timedelta(hours=float(rng.uniform(20, 90)))
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?", help="Instagram insights CSV export")
    ap.add_argument("--demo", action="store_true", help="run on a synthetic example")
    ap.add_argument("-o", "--out", default="my_account_report.md")
    a = ap.parse_args()
    if a.demo:
        raw, title = demo_frame(), "Account report: SYNTHETIC DEMO DATA (not a real account)"
    elif a.csv:
        raw = pd.read_csv(a.csv)
        title = f"Account report: {Path(a.csv).name}"
    else:
        ap.error("give a CSV path or --demo")
    report = analyse(prepare(raw), title)
    Path(a.out).write_text(report)
    print(report)
    print(f"\nWrote {a.out}")


if __name__ == "__main__":
    main()
