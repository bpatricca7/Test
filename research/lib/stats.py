"""Shared statistics for market-edge research.

Design rules used everywhere:
  * every strategy is evaluated NET of realistic costs (vig, fees, spread);
  * every mean is reported with a bet/period-level bootstrap CI and a t-statistic;
  * the number of hypotheses tested is tracked so significance can be Bonferroni-adjusted.
"""
import math
import numpy as np
import pandas as pd

RNG = np.random.default_rng(20260926)

# ---------------------------------------------------------------- odds helpers
def american_to_decimal(ml):
    ml = np.asarray(ml, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(ml < 0, 1 + 100 / (-ml), 1 + ml / 100)


def american_to_prob(ml):
    """Implied (vig-included) probability from American odds."""
    ml = np.asarray(ml, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(ml < 0, -ml / (-ml + 100), 100 / (ml + 100))


def devig_multiplicative(*imp):
    s = sum(imp)
    return [p / s for p in imp]


def devig_power(*imp, tol=1e-10):
    """Power (a.k.a. 'logarithmic') devig: find k with sum(p_i^k) = 1.
    Handles favourite-longshot bias better than proportional normalisation."""
    imp = [np.asarray(p, dtype=float) for p in imp]
    lo, hi = np.full_like(imp[0], 0.5), np.full_like(imp[0], 3.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        s = sum(p ** mid for p in imp)
        hi = np.where(s > 1, hi, mid)
        lo = np.where(s > 1, mid, lo)
    k = (lo + hi) / 2
    return [p ** k for p in imp]


def devig_shin(*imp, iters=100):
    """Shin (1993) devig for n outcomes: p_i = (sqrt(z^2 + 4(1-z) pi_i^2/B) - z) / (2(1-z)),
    with B = sum(pi_i), z solved so probabilities sum to 1."""
    imp = [np.asarray(p, dtype=float) for p in imp]
    B = sum(imp)
    z = np.zeros_like(B)
    for _ in range(iters):
        probs = [(np.sqrt(z ** 2 + 4 * (1 - z) * p ** 2 / B) - z) / (2 * (1 - z)) for p in imp]
        s = sum(probs)
        z = z + (s - 1) * 0.5      # simple fixed-point step; converges for realistic overrounds
        z = np.clip(z, 0, 0.5)
    probs = [(np.sqrt(z ** 2 + 4 * (1 - z) * p ** 2 / B) - z) / (2 * (1 - z)) for p in imp]
    s = sum(probs)
    return [p / s for p in probs]


def kalshi_fee(price, contracts=100.0, multiplier=0.07):
    """Kalshi taker fee PER CONTRACT in dollars for an order of `contracts` contracts.
    Schedule: fee = multiplier * C * P * (1-P), rounded UP to the next cent per ORDER (not per contract),
    so with a 100-contract order the rounding is negligible; per-contract rounding would overstate fees
    5-7x at extreme prices.  Maker orders pay nothing on most series ('quadratic' fee_type)."""
    price = np.asarray(price, dtype=float)
    raw = multiplier * contracts * price * (1 - price)
    return np.ceil(raw * 100) / 100 / contracts


# ---------------------------------------------------------------- inference helpers
def bootstrap_mean_ci(x, n_boot=4000, alpha=0.05, seed=None):
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) == 0:
        return (np.nan, np.nan, np.nan)
    rng = np.random.default_rng(seed) if seed is not None else RNG
    n = len(x)
    if n > 50000:            # large samples: fewer resamples are plenty
        n_boot = min(n_boot, 1000)
    chunk = max(1, int(2e7 // n))          # keep each resample matrix under ~160 MB
    means = np.empty(n_boot)
    for start in range(0, n_boot, chunk):
        k = min(chunk, n_boot - start)
        idx = rng.integers(0, n, size=(k, n))
        means[start:start + k] = x[idx].mean(axis=1)
    return (x.mean(), np.quantile(means, alpha / 2), np.quantile(means, 1 - alpha / 2))


def tstat(x):
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) < 2 or x.std(ddof=1) == 0:
        return np.nan
    return x.mean() / (x.std(ddof=1) / math.sqrt(len(x)))


def pvalue_two_sided(t, n):
    from scipy import stats as st
    if np.isnan(t):
        return np.nan
    return 2 * st.t.sf(abs(t), df=max(n - 1, 1))


def summarize_bets(pnl, label="", n_boot=4000):
    """pnl = per-bet profit in units of 1 unit staked. Returns dict with ROI, CI, t, p, n."""
    pnl = np.asarray(pnl, dtype=float)
    pnl = pnl[~np.isnan(pnl)]
    n = len(pnl)
    m, lo, hi = bootstrap_mean_ci(pnl, n_boot=n_boot) if n else (np.nan, np.nan, np.nan)
    t = tstat(pnl)
    return {"label": label, "n": int(n), "roi": m, "ci_lo": lo, "ci_hi": hi, "t": t, "p": pvalue_two_sided(t, n),
            "hit_rate": float((pnl > 0).mean()) if n else np.nan}


def sharpe(returns, periods_per_year):
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) < 2 or r.std(ddof=1) == 0:
        return np.nan
    return r.mean() / r.std(ddof=1) * math.sqrt(periods_per_year)


def max_drawdown(returns):
    r = np.asarray(returns, dtype=float)
    eq = np.cumprod(1 + r)
    peak = np.maximum.accumulate(eq)
    return float((eq / peak - 1).min())


def cagr(returns, periods_per_year):
    r = np.asarray(returns, dtype=float)
    if len(r) == 0:
        return np.nan
    total = np.prod(1 + r)
    years = len(r) / periods_per_year
    return total ** (1 / years) - 1 if years > 0 and total > 0 else np.nan


def summarize_returns(returns, periods_per_year, label=""):
    r = pd.Series(np.asarray(returns, dtype=float)).dropna()
    t = tstat(r.values)
    return {"label": label, "n": int(len(r)), "cagr": cagr(r.values, periods_per_year), "ann_vol": r.std(ddof=1) * math.sqrt(periods_per_year),
            "sharpe": sharpe(r.values, periods_per_year), "max_dd": max_drawdown(r.values), "t": t, "p": pvalue_two_sided(t, len(r)),
            "mean_per_period": r.mean()}


def probabilistic_sharpe(sr_hat, n, skew=0.0, kurt=3.0, sr_benchmark=0.0):
    """Bailey & Lopez de Prado PSR: P(true SR > benchmark). sr_hat in per-period units."""
    from scipy import stats as st
    if n < 3 or np.isnan(sr_hat):
        return np.nan
    denom = math.sqrt(max(1 - skew * sr_hat + (kurt - 1) / 4 * sr_hat ** 2, 1e-12))
    z = (sr_hat - sr_benchmark) * math.sqrt(n - 1) / denom
    return float(st.norm.cdf(z))


def deflated_sharpe_threshold(n_trials, var_sr, n):
    """Expected max Sharpe (per period) under the null after n_trials independent tries (Bailey & LdP 2014)."""
    from scipy import stats as st
    if n_trials <= 1:
        return 0.0
    euler = 0.5772156649
    e_max = math.sqrt(var_sr) * ((1 - euler) * st.norm.ppf(1 - 1 / n_trials) + euler * st.norm.ppf(1 - 1 / (n_trials * math.e)))
    return e_max


class TestRegistry:
    """Counts every hypothesis evaluated so the final report can apply Bonferroni."""
    def __init__(self):
        self.rows = []

    def add(self, family, result):
        r = dict(result); r["family"] = family
        self.rows.append(r)
        return r

    def frame(self):
        df = pd.DataFrame(self.rows)
        if len(df):
            m = len(df)
            df["bonferroni_p"] = (df["p"] * m).clip(upper=1.0)
            df["n_tests"] = m
        return df


def fmt_bets(d):
    return (f"{d['label']:<58s} n={d['n']:>6d}  ROI={d['roi']*100:+6.2f}%  95%CI=[{d['ci_lo']*100:+6.2f}%,{d['ci_hi']*100:+6.2f}%]"
            f"  t={d['t']:+5.2f}  p={d['p']:.4f}")


def fmt_ret(d):
    return (f"{d['label']:<48s} n={d['n']:>6d}  CAGR={d['cagr']*100:+6.2f}%  vol={d['ann_vol']*100:5.1f}%  Sharpe={d['sharpe']:+5.2f}"
            f"  MaxDD={d['max_dd']*100:6.1f}%  t={d['t']:+5.2f}  p={d['p']:.4f}")
