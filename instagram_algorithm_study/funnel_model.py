"""
Stage-gated distribution model of Instagram Reels reach.

WHAT THIS IS
------------
A transparent, mechanistic Monte Carlo model of how a recommendation system
that "tests content on a small audience, then expands it if it performs"
turns per-viewer behaviour (watch time, sends, likes) into view counts.

The *structure* follows what Instagram has said publicly:
  * Content is first shown to a small group (some followers, and for Trial
    Reels, non-followers). If it does well relative to other content, it is
    shown to progressively larger audiences.
  * Watch time, sends-per-reach and likes-per-reach are the signals named as
    most important for Reels (Adam Mosseri, Jan 2025).

The *numbers* (batch sizes, thresholds, weights, base rates) are NOT known
publicly. They are illustrative assumptions, chosen so that a typical small
creator gets a realistic-looking, heavy-tailed view distribution. Every
conclusion we draw from this model is therefore stated in relative terms and
checked for robustness across alternative weightings (see `weight_robustness`).

Run:  python3 funnel_model.py            -> prints tables, writes results JSON
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).parent / "results"


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Creator:
    followers: int = 5_000
    retention: float = 0.40       # avg fraction of the Reel watched by a well-matched viewer
    send_rate: float = 0.010      # DM sends per account reached
    like_rate: float = 0.040      # likes per account reached
    seed_alignment: float = 1.0   # how well the first-wave audience matches the content (1 = perfect)
    content_sigma: float = 0.30   # post-to-post quality variation (log scale)


@dataclass(frozen=True)
class Platform:
    # Relative importance of each prediction in the ranking score.
    # Default order follows Mosseri's stated order (watch time, sends, likes).
    weights: tuple[float, float, float] = (0.45, 0.35, 0.20)
    # Average rates of the competing content pool (what "good" is measured against).
    bench: tuple[float, float, float] = (0.35, 0.008, 0.035)
    follower_seed_frac: float = 0.06   # share of followers who see it in wave 0
    nonfollower_seed: int = 250        # non-follower test batch in wave 0
    growth: float = 3.5                # each promotion multiplies audience size by this
    max_stages: int = 9                # wave 8 ~ 0.5M-1M+ accounts
    cooling: float = 0.86              # rates decay per wave as the audience gets less niche-matched
    theta0: float = 1.05               # score needed to leave wave 0 (1.0 = pool average)
    theta_step: float = 0.06           # bar rises each wave (tougher competition)
    watch_sd: float = 0.30             # per-viewer SD of fraction watched (sampling noise)
    signal_sigma: float = 0.15         # independent per-signal variation within a post
    views_per_send: float = 0.7        # extra views generated directly by each DM send
    wave_jitter: float = 0.35          # wave sizes vary post to post (time of day, inventory)
    fail_floor: float = 0.25           # a post that fails a wave still gets >= this share of it


# --------------------------------------------------------------------------
# Core simulator (vectorised over posts)
# --------------------------------------------------------------------------
def simulate(creator: Creator, platform: Platform = Platform(), n_posts: int = 40_000,
             seed: int = 7, return_detail: bool = False):
    rng = np.random.default_rng(seed)
    w = np.array(platform.weights, dtype=float)
    w = w / w.sum()
    bench = np.array(platform.bench, dtype=float)

    # per-post latent quality: common factor + small independent per-signal factor
    sc = creator.content_sigma
    q_common = np.exp(rng.normal(-sc**2 / 2, sc, n_posts))
    ss = platform.signal_sigma
    q_sig = np.exp(rng.normal(-ss**2 / 2, ss, (n_posts, 3)))
    base = np.array([creator.retention, creator.send_rate, creator.like_rate])
    true_rates = base[None, :] * q_common[:, None] * q_sig            # (n_posts, 3)

    n0 = creator.followers * platform.follower_seed_frac + platform.nonfollower_seed
    views = np.zeros(n_posts)
    sends_total = np.zeros(n_posts)
    likes_total = np.zeros(n_posts)
    watch_total = np.zeros(n_posts)
    stage_reached = np.zeros(n_posts, dtype=int)
    alive = np.ones(n_posts, dtype=bool)

    for k in range(platform.max_stages):
        idx = np.flatnonzero(alive)
        if idx.size == 0:
            break
        jit = platform.wave_jitter
        n_k = n0 * platform.growth**k * np.exp(rng.normal(-jit**2 / 2, jit, idx.size))
        align = creator.seed_alignment if k == 0 else 1.0
        r = true_rates[idx] * (platform.cooling**k) * align
        r[:, 0] = np.clip(r[:, 0], 0.01, 0.95)
        r[:, 1:] = np.clip(r[:, 1:], 0.0, 0.5)
        n_int = np.maximum(np.round(n_k).astype(np.int64), 1)

        # observed batch statistics (what the system "sees")
        watch_obs = r[:, 0] + rng.normal(0, 1, idx.size) * platform.watch_sd / np.sqrt(n_int)
        sends = rng.binomial(n_int, r[:, 1])
        likes = rng.binomial(n_int, r[:, 2])
        obs = np.column_stack([watch_obs, sends / n_int, likes / n_int])

        score = (obs / bench[None, :]) @ w
        bar = platform.theta0 + platform.theta_step * k
        promote = score >= bar
        # a post that misses the bar is throttled part-way through the wave
        frac = np.where(promote, 1.0, np.clip((score / bar) ** 4, platform.fail_floor, 1.0))

        views[idx] += frac * n_int + platform.views_per_send * sends * frac
        sends_total[idx] += sends * frac
        likes_total[idx] += likes * frac
        watch_total[idx] += watch_obs * n_int * frac
        stage_reached[idx] = k
        alive[idx[~promote]] = False

    if not return_detail:
        return views
    return {
        "views": views,
        "true_quality": q_common,
        "like_rate_realised": likes_total / views,
        "send_rate_realised": sends_total / views,
        "watch_realised": watch_total / np.maximum(views, 1),
        "stage": stage_reached,
    }


# --------------------------------------------------------------------------
# Summaries
# --------------------------------------------------------------------------
def summarise(views: np.ndarray) -> dict:
    v = np.sort(views)
    top10_share = v[int(0.9 * v.size):].sum() / v.sum()
    logv = np.log(v)
    return {
        "p10": float(np.percentile(v, 10)),
        "p25": float(np.percentile(v, 25)),
        "median": float(np.median(v)),
        "p75": float(np.percentile(v, 75)),
        "p90": float(np.percentile(v, 90)),
        "p99": float(np.percentile(v, 99)),
        "mean": float(v.mean()),
        "geo_mean": float(np.exp(logv.mean())),
        "mean_over_median": float(v.mean() / np.median(v)),
        "top10pct_share_of_views": float(top10_share),
        "p_over_10k": float((v > 10_000).mean()),
        "p_over_100k": float((v > 100_000).mean()),
        "p_over_1m": float((v > 1_000_000).mean()),
        "sd_log_views": float(logv.std()),
    }


def log_histogram(views: np.ndarray, lo=2.0, hi=7.0, step=0.25) -> list[dict]:
    edges = np.arange(lo, hi + step, step)
    counts, _ = np.histogram(np.log10(views), bins=edges)
    frac = counts / views.size
    return [{"log10_lo": float(a), "log10_hi": float(b), "share": float(f)}
            for a, b, f in zip(edges[:-1], edges[1:], frac)]


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    rx = np.argsort(np.argsort(x))
    ry = np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


# --------------------------------------------------------------------------
# Experiments
# --------------------------------------------------------------------------
LEVERS = {
    "retention (watch time)": "retention",
    "sends per reach": "send_rate",
    "likes per reach": "like_rate",
}


def lever_sensitivity(c: Creator, p: Platform, bumps=(0.10, 0.25, 0.50)) -> list[dict]:
    base = summarise(simulate(c, p))
    rows = []
    for label, attr in LEVERS.items():
        for b in bumps:
            c2 = replace(c, **{attr: getattr(c, attr) * (1 + b)})
            s = summarise(simulate(c2, p))
            rows.append({
                "lever": label, "improvement": b,
                "median_x": s["median"] / base["median"],
                "geo_mean_x": s["geo_mean"] / base["geo_mean"],
                "mean_x": s["mean"] / base["mean"],
                "p_over_100k_x": s["p_over_100k"] / max(base["p_over_100k"], 1e-9),
                "p_over_100k": s["p_over_100k"],
            })
    # all three at once
    for b in bumps:
        c2 = replace(c, retention=c.retention * (1 + b), send_rate=c.send_rate * (1 + b),
                     like_rate=c.like_rate * (1 + b))
        s = summarise(simulate(c2, p))
        rows.append({"lever": "all three together", "improvement": b,
                     "median_x": s["median"] / base["median"], "geo_mean_x": s["geo_mean"] / base["geo_mean"],
                     "mean_x": s["mean"] / base["mean"],
                     "p_over_100k_x": s["p_over_100k"] / max(base["p_over_100k"], 1e-9),
                     "p_over_100k": s["p_over_100k"]})
    return rows


def quality_response_curve(c: Creator, p: Platform) -> list[dict]:
    """Scale ALL behaviour rates by m: shows the convex (threshold) response."""
    rows = []
    for m in np.round(np.arange(0.6, 1.81, 0.1), 2):
        c2 = replace(c, retention=c.retention * m, send_rate=c.send_rate * m, like_rate=c.like_rate * m)
        s = summarise(simulate(c2, p, n_posts=30_000))
        rows.append({"quality_multiplier": float(m), "median": s["median"], "geo_mean": s["geo_mean"],
                     "mean": s["mean"], "p_over_10k": s["p_over_10k"],
                     "p_over_100k": s["p_over_100k"]})
    return rows


def retention_send_grid(c: Creator, p: Platform) -> list[dict]:
    rows = []
    mults = [0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5]
    for rm in mults:
        for sm in mults:
            c2 = replace(c, retention=c.retention * rm, send_rate=c.send_rate * sm)
            v = simulate(c2, p, n_posts=20_000)
            rows.append({"retention_x": rm, "sends_x": sm, "median": float(np.median(v)),
                         "geo_mean": float(np.exp(np.log(v).mean())),
                         "p_over_10k": float((v > 1e4).mean()), "p_over_100k": float((v > 1e5).mean())})
    return rows


def seed_alignment_effect(c: Creator, p: Platform) -> list[dict]:
    rows = []
    for a in [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]:
        s = summarise(simulate(replace(c, seed_alignment=a), p))
        rows.append({"seed_alignment": a, "median": s["median"], "geo_mean": s["geo_mean"], "mean": s["mean"],
                     "p_over_10k": s["p_over_10k"],
                     "p_over_100k": s["p_over_100k"]})
    return rows


def follower_scale(c: Creator, p: Platform) -> list[dict]:
    rows = []
    for f in [500, 2_000, 5_000, 20_000, 100_000, 500_000]:
        s = summarise(simulate(replace(c, followers=f), p))
        rows.append({"followers": f, "median": s["median"], "views_per_follower_median": s["median"] / f,
                     "p_over_100k": s["p_over_100k"]})
    return rows


def frequency_analysis(c: Creator, p: Platform, quality_tax_per_extra_post: float = 0.0) -> list[dict]:
    """P(at least one post > 100k views in 30 days) vs posts per week.

    quality_tax_per_extra_post: fractional drop in all rates for each weekly post
    beyond 3 (a stylised 'rushing content' penalty, used as a sensitivity check).
    """
    rows = []
    for ppw in [1, 2, 3, 4, 5, 7, 10, 14]:
        tax = max(0, ppw - 3) * quality_tax_per_extra_post
        m = max(1 - tax, 0.3)
        c2 = replace(c, retention=c.retention * m, send_rate=c.send_rate * m, like_rate=c.like_rate * m)
        v = simulate(c2, p, n_posts=30_000)
        p_hit = float((v > 1e5).mean())
        posts_30d = ppw * 30 / 7
        rows.append({"posts_per_week": ppw, "posts_30d": posts_30d, "p_hit_per_post": p_hit,
                     "p_at_least_one_100k_in_30d": 1 - (1 - p_hit) ** posts_30d,
                     "expected_views_30d": float(v.mean() * posts_30d),
                     "median_views_per_post": float(np.median(v))})
    return rows


def weight_robustness(c: Creator) -> list[dict]:
    """Does the convexity (threshold) conclusion depend on the assumed weights?"""
    rows = []
    for name, w in {
        "Mosseri order (default)": (0.45, 0.35, 0.20),
        "watch-time heavy": (0.65, 0.20, 0.15),
        "equal weights": (1 / 3, 1 / 3, 1 / 3),
        "sends heavy": (0.25, 0.55, 0.20),
        "likes heavy": (0.30, 0.20, 0.50),
    }.items():
        p = Platform(weights=w)
        base = summarise(simulate(c, p))
        up = summarise(simulate(replace(c, retention=c.retention * 1.25, send_rate=c.send_rate * 1.25,
                                        like_rate=c.like_rate * 1.25), p))
        sens = {}
        for label, attr in LEVERS.items():
            s = summarise(simulate(replace(c, **{attr: getattr(c, attr) * 1.25}), p))
            sens[label] = s["geo_mean"] / base["geo_mean"]
        rows.append({"weights": name, "w": w,
                     "base_median": base["median"], "base_p100k": base["p_over_100k"],
                     "all_plus25_geo_x": up["geo_mean"] / base["geo_mean"],
                     "all_plus25_p100k_x": up["p_over_100k"] / max(base["p_over_100k"], 1e-9),
                     "single_lever_plus25_median_x": sens})
    return rows


def platform_robustness(c: Creator) -> list[dict]:
    """Vary the unknown platform constants; check the qualitative findings survive."""
    rows = []
    variants = {
        "default": Platform(),
        "bigger waves (growth 5x)": Platform(growth=5.0),
        "smaller waves (growth 2.5x)": Platform(growth=2.5),
        "mild cooling (0.93)": Platform(cooling=0.93),
        "strong cooling (0.8)": Platform(cooling=0.80),
        "flat bar (no rise per wave)": Platform(theta_step=0.0),
        "steep bar (+0.1 per wave)": Platform(theta_step=0.10),
        "bigger test batch (1,000)": Platform(nonfollower_seed=1_000),
    }
    for name, p in variants.items():
        base = summarise(simulate(c, p))
        up = summarise(simulate(replace(c, retention=c.retention * 1.25, send_rate=c.send_rate * 1.25,
                                        like_rate=c.like_rate * 1.25), p))
        rows.append({"variant": name, "median": base["median"], "mean_over_median": base["mean_over_median"],
                     "top10_share": base["top10pct_share_of_views"],
                     "plus25_geo_x": up["geo_mean"] / base["geo_mean"],
                     "plus25_p100k_x": up["p_over_100k"] / max(base["p_over_100k"], 1e-9)})
    return rows


def naive_correlation_trap(c: Creator, p: Platform) -> dict:
    """Show why 'like rate vs views' in your Insights can mislead.

    Realised per-reach rates are measured on the audience a post actually got.
    Posts that travel far are measured on colder audiences, which dilutes the
    rate. True quality drives views, but the realised rate understates it.
    """
    d = simulate(c, p, n_posts=40_000, return_detail=True)
    logv = np.log(d["views"])
    return {
        "spearman_true_quality_vs_views": spearman(d["true_quality"], logv),
        "spearman_realised_like_rate_vs_views": spearman(d["like_rate_realised"], logv),
        "spearman_realised_send_rate_vs_views": spearman(d["send_rate_realised"], logv),
        "spearman_realised_watch_vs_views": spearman(d["watch_realised"], logv),
        "median_like_rate_bottom_half": float(np.median(d["like_rate_realised"][logv < np.median(logv)])),
        "median_like_rate_top_1pct": float(np.median(d["like_rate_realised"][logv > np.percentile(logv, 99)])),
    }


# --------------------------------------------------------------------------
def main():
    OUT_DIR.mkdir(exist_ok=True)
    c, p = Creator(), Platform()
    views = simulate(c, p)
    results = {
        "assumptions": {"creator": c.__dict__, "platform": {k: v for k, v in p.__dict__.items()}},
        "baseline": summarise(views),
        "baseline_histogram": log_histogram(views),
        "lever_sensitivity": lever_sensitivity(c, p),
        "quality_response_curve": quality_response_curve(c, p),
        "retention_send_grid": retention_send_grid(c, p),
        "seed_alignment": seed_alignment_effect(c, p),
        "follower_scale": follower_scale(c, p),
        "frequency_constant_quality": frequency_analysis(c, p, 0.0),
        "frequency_with_quality_tax": frequency_analysis(c, p, 0.04),
        "weight_robustness": weight_robustness(c),
        "platform_robustness": platform_robustness(c),
        "naive_correlation_trap": naive_correlation_trap(c, p),
    }
    (OUT_DIR / "funnel_model_results.json").write_text(json.dumps(results, indent=2, default=float))

    b = results["baseline"]
    print("== Baseline creator (5k followers) ==")
    for k, v in b.items():
        print(f"  {k:28s} {v:,.3f}")
    print("\n== Lever sensitivity (multiplier vs baseline) ==")
    for r in results["lever_sensitivity"]:
        print(f"  {r['lever']:24s} +{r['improvement']:.0%}  typical(geo) x{r['geo_mean_x']:.2f}  "
              f"mean x{r['mean_x']:.2f}  P(>100k) x{r['p_over_100k_x']:.2f}")
    print("\n== Quality response curve ==")
    for r in results["quality_response_curve"]:
        print(f"  quality x{r['quality_multiplier']:.1f}  geo {r['geo_mean']:>9,.0f}  median {r['median']:>10,.0f}  "
              f"mean {r['mean']:>10,.0f}  P(>100k) {r['p_over_100k']:.3%}")
    print("\n== Seed alignment ==")
    for r in results["seed_alignment"]:
        print(f"  align {r['seed_alignment']:.1f}  geo {r['geo_mean']:>8,.0f}  P(>10k) {r['p_over_10k']:.2%}  P(>100k) {r['p_over_100k']:.3%}")
    print("\n== Follower scale ==")
    for r in results["follower_scale"]:
        print(f"  {r['followers']:>8,} followers  median {r['median']:>9,.0f}  "
              f"views/follower {r['views_per_follower_median']:.2f}  P(>100k) {r['p_over_100k']:.3%}")
    print("\n== Frequency (constant quality | with 4% quality tax per extra post) ==")
    for a, t in zip(results["frequency_constant_quality"], results["frequency_with_quality_tax"]):
        print(f"  {a['posts_per_week']:>2}/wk  P(>=1 100k in 30d) {a['p_at_least_one_100k_in_30d']:.1%} | "
              f"{t['p_at_least_one_100k_in_30d']:.1%}   E[views 30d] {a['expected_views_30d']:>10,.0f} | "
              f"{t['expected_views_30d']:>10,.0f}")
    print("\n== Weight robustness ==")
    for r in results["weight_robustness"]:
        s = r["single_lever_plus25_median_x"]
        print(f"  {r['weights']:24s} all+25%: typical x{r['all_plus25_geo_x']:.2f}, "
              f"P(>100k) x{r['all_plus25_p100k_x']:.2f} | single +25%: "
              + ", ".join(f"{k.split()[0]} x{v:.2f}" for k, v in s.items()))
    print("\n== Platform-constant robustness ==")
    for r in results["platform_robustness"]:
        print(f"  {r['variant']:30s} median {r['median']:>8,.0f}  mean/median {r['mean_over_median']:.1f}  "
              f"top10% share {r['top10_share']:.0%}  +25% quality: typical x{r['plus25_geo_x']:.2f}, "
              f"P(>100k) x{r['plus25_p100k_x']:.1f}")
    print("\n== Naive correlation trap ==")
    for k, v in results["naive_correlation_trap"].items():
        print(f"  {k:42s} {v:.4f}")


if __name__ == "__main__":
    main()
