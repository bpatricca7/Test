"""
Statistics for testing content on Instagram, plus the watch-time / length model.

1. Power analysis: how many posts you need before a "this worked better"
   conclusion means anything, given that views are heavy-tailed (log-normal-ish).
2. Simulated A/B tests using the funnel model: unpaired (post A one day, post B
   another day) vs paired (same content, two hooks, e.g. via Trial Reels).
3. Retention-curve model: how hook strength and pacing set watch time, and why
   the best length is proportional to how long you can hold attention.

Run:  python3 experiment_design.py
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path

import numpy as np

from funnel_model import Creator, Platform, simulate

OUT_DIR = Path(__file__).parent / "results"
Z = {0.05: 1.959964, 0.80: 0.841621, 0.90: 1.281552}


# --------------------------------------------------------------------------
# 1. Closed-form power analysis on log(views)
# --------------------------------------------------------------------------
def n_per_arm(lift: float, sd_log: float, alpha=0.05, power=0.80) -> int:
    """Posts per variant for a two-sample test on log views to detect a
    multiplicative lift in typical (geometric-mean) views."""
    delta = math.log(1 + lift)
    za, zb = Z[alpha], Z[power]
    return math.ceil(2 * (za + zb) ** 2 * sd_log**2 / delta**2)


def n_pairs(lift: float, sd_log: float, rho: float, alpha=0.05, power=0.80) -> int:
    """Pairs needed when each pair shares the same underlying content
    (correlation rho between the two variants' log views)."""
    delta = math.log(1 + lift)
    za, zb = Z[alpha], Z[power]
    var_diff = 2 * sd_log**2 * (1 - rho)
    return math.ceil((za + zb) ** 2 * var_diff / delta**2)


def power_tables():
    lifts = [0.10, 0.25, 0.50, 1.00, 2.00]
    sds = [0.8, 1.2, 1.6, 2.0]
    unpaired = [{"lift": l, **{f"sd_{s}": n_per_arm(l, s) for s in sds}} for l in lifts]
    paired = [{"lift": l, **{f"rho_{r}": n_pairs(l, 1.6, r) for r in (0.0, 0.5, 0.7, 0.85)}} for l in lifts]
    return {"unpaired_n_per_arm": unpaired, "paired_n_pairs_sd1.6": paired, "sds": sds}


# --------------------------------------------------------------------------
# 2. Simulated tests with the funnel model
# --------------------------------------------------------------------------
def mann_whitney_p(a: np.ndarray, b: np.ndarray) -> float:
    """Two-sided Mann-Whitney U, normal approximation (fine for n >= 8)."""
    n1, n2 = a.size, b.size
    ranks = np.argsort(np.argsort(np.concatenate([a, b]))) + 1
    u = ranks[:n1].sum() - n1 * (n1 + 1) / 2
    mu = n1 * n2 / 2
    sigma = math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    z = (u - mu) / sigma
    return math.erfc(abs(z) / math.sqrt(2))


def paired_perm_p(diff: np.ndarray, rng: np.random.Generator, n_perm: int = 1000) -> float:
    """Two-sided sign-flip permutation test on the mean paired log-difference."""
    obs = abs(diff.mean())
    signs = rng.choice(np.array([-1.0, 1.0]), size=(n_perm, diff.size))
    null = np.abs((signs * diff).mean(axis=1))
    return float((1 + (null >= obs - 1e-12).sum()) / (n_perm + 1))


def simulated_power(retention_lift=0.15, ns=(5, 10, 20, 40, 80), reps=600, seed=11):
    """Variant B has a better hook (retention x(1+lift)); everything else equal."""
    rng = np.random.default_rng(seed)
    c, p = Creator(), Platform()
    cb = replace(c, retention=c.retention * (1 + retention_lift))
    pool = int(max(ns) * reps * 1.1)
    # unpaired: independent content for each post
    va = simulate(c, p, n_posts=pool, seed=101)
    vb = simulate(cb, p, n_posts=pool, seed=202)
    # paired: SAME content draw (same seed -> same latent quality), different hook,
    # different delivery noise. We emulate shared content by reusing the content
    # seed and re-simulating delivery noise.
    pa, pb = _paired_draws(c, cb, p, pool, seed=303)
    true_geo_lift = math.exp(np.log(vb).mean() - np.log(va).mean()) - 1
    rows = []
    for n in ns:
        hits_u = hits_p = 0
        for r in range(reps):
            ia = rng.choice(pool, n, replace=False)
            ib = rng.choice(pool, n, replace=False)
            if mann_whitney_p(np.log(va[ia]), np.log(vb[ib])) < 0.05:
                hits_u += 1
            ip = rng.choice(pool, n, replace=False)
            if paired_perm_p(np.log(pb[ip]) - np.log(pa[ip]), rng) < 0.05:
                hits_p += 1
        rows.append({"n_per_arm": n, "power_unpaired": hits_u / reps, "power_paired": hits_p / reps})
    corr = float(np.corrcoef(np.log(pa), np.log(pb))[0, 1])
    return {"retention_lift": retention_lift, "true_typical_view_lift": true_geo_lift,
            "paired_log_corr": corr, "rows": rows}


def _paired_draws(ca: Creator, cb: Creator, p: Platform, n: int, seed: int):
    """Two variants of the same content: identical latent quality draws, independent
    audience/delivery noise. Implemented by fixing content quality via content_sigma
    draws and passing them through a seeded simulate with a per-variant noise seed."""
    rng = np.random.default_rng(seed)
    sc = ca.content_sigma
    q = np.exp(rng.normal(-sc**2 / 2, sc, n))
    out = []
    for c, s in ((ca, seed + 1), (cb, seed + 2)):
        # Remove content variance from the simulator and inject the shared q instead.
        c_fixed = replace(c, content_sigma=1e-9)
        v = np.empty(n)
        # vectorised: scale base rates per post by q (simulate takes scalar rates,
        # so we bin q into quantiles to keep it fast and exact enough)
        bins = np.quantile(q, np.linspace(0, 1, 41))
        which = np.clip(np.searchsorted(bins, q, side="right") - 1, 0, 39)
        for b in range(40):
            idx = np.flatnonzero(which == b)
            if idx.size == 0:
                continue
            m = float(q[idx].mean())
            cc = replace(c_fixed, retention=c.retention * m, send_rate=c.send_rate * m,
                         like_rate=c.like_rate * m)
            v[idx] = simulate(cc, p, n_posts=idx.size, seed=s * 1000 + b)
        out.append(v)
    return out[0], out[1]


# --------------------------------------------------------------------------
# 3. Retention curve / length model
# --------------------------------------------------------------------------
def retention_table():
    """R(t) = h * exp(-t / tau): h = share still watching after the hook (~first
    2-3 s), tau = how fast the rest drift away (pacing). Half-life = tau * ln 2."""
    rows = []
    for tau in (6, 12, 25, 50):
        for L in (7, 15, 30, 60, 90, 180):
            h = 0.6
            avg_watch = h * tau * (1 - math.exp(-L / tau))
            rows.append({"tau_s": tau, "half_life_s": round(tau * math.log(2), 1), "length_s": L,
                         "avg_watch_s": round(avg_watch, 1),
                         "avg_pct_watched": round(avg_watch / L, 3),
                         "completion_rate": round(h * math.exp(-L / tau), 3)})
    return rows


def optimal_length_multipliers():
    """Best length L* = c * tau under different plausible ranking objectives."""
    xs = np.linspace(0.05, 6, 20000)
    objectives = {
        "avg seconds x avg % watched": (1 - np.exp(-xs)) ** 2 / xs,
        "sqrt(avg seconds x completion)": np.sqrt((1 - np.exp(-xs)) * np.exp(-xs)),
        "avg seconds x sqrt(% watched)": (1 - np.exp(-xs)) * np.sqrt((1 - np.exp(-xs)) / xs),
    }
    return {k: float(xs[np.argmax(v)]) for k, v in objectives.items()}


def hook_effect():
    """Hook strength h scales total watch time linearly at every length."""
    return [{"hook_hold_h": h, "avg_watch_s_at_30s_tau12": round(h * 12 * (1 - math.exp(-30 / 12)), 2),
             "relative_to_h0.5": round(h / 0.5, 2)} for h in (0.4, 0.5, 0.6, 0.7, 0.8)]


def main():
    OUT_DIR.mkdir(exist_ok=True)
    res = {
        "power_tables": power_tables(),
        "simulated_power": simulated_power(),
        "retention_table": retention_table(),
        "optimal_length_multipliers_of_tau": optimal_length_multipliers(),
        "hook_effect": hook_effect(),
    }
    (OUT_DIR / "experiment_design_results.json").write_text(json.dumps(res, indent=2))

    print("== Posts needed PER VARIANT (unpaired, alpha .05, power .80) ==")
    print("  lift   " + "  ".join(f"sd={s:<4}" for s in res["power_tables"]["sds"]))
    for r in res["power_tables"]["unpaired_n_per_arm"]:
        print(f"  +{r['lift']:<5.0%} " + "  ".join(f"{r[f'sd_{s}']:>7}" for s in res["power_tables"]["sds"]))
    print("\n== Pairs needed (same content, two variants; sd=1.6) ==")
    for r in res["power_tables"]["paired_n_pairs_sd1.6"]:
        print(f"  +{r['lift']:<5.0%} " + "  ".join(f"rho={k[4:]}:{v:>5}" for k, v in r.items() if k != 'lift'))
    sp = res["simulated_power"]
    print(f"\n== Simulated hook test: retention +{sp['retention_lift']:.0%} "
          f"-> true typical-view lift {sp['true_typical_view_lift']:+.0%}; paired corr {sp['paired_log_corr']:.2f} ==")
    for r in sp["rows"]:
        print(f"  n={r['n_per_arm']:>3}/arm  power unpaired {r['power_unpaired']:.0%}   paired {r['power_paired']:.0%}")
    print("\n== Optimal length as multiple of tau ==")
    for k, v in res["optimal_length_multipliers_of_tau"].items():
        print(f"  {k:34s} L* = {v:.2f} tau = {v / math.log(2):.2f} x half-life")
    print("\n== Retention table (h=0.6) ==")
    for r in res["retention_table"]:
        print(f"  tau {r['tau_s']:>2}s  L {r['length_s']:>3}s  avg watch {r['avg_watch_s']:>5}s  "
              f"avg% {r['avg_pct_watched']:.0%}  completion {r['completion_rate']:.1%}")


if __name__ == "__main__":
    main()
