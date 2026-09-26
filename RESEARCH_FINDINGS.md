# Market Edge Research: What Survived Testing

**Run date:** 2026-09-26  **Branch:** `claude/market-testing-profitable-advantages-96j2xo`
**Scope:** prediction markets (Kalshi), sports betting (NFL, club soccer), crypto (BTC/ETH/SOL/XRP/DOGE/BNB/HYPE),
equity indices, volatility, FX, commodities.  Every number below is net of the cost you would actually pay
(bookmaker vig, Kalshi taker fees, index trading costs).  All code is in `research/`, raw outputs in `research/results/`.

> Not financial advice. A backtested edge is a hypothesis about the future, not a guarantee. Bookmakers limit
> winning accounts, and prediction-market liquidity is thin at extreme prices. Position-size accordingly.

## 1. Executive summary: ranked by evidence quality

| Rank | Market | Edge | Net ROI | Evidence | Practical catch |
|---|---|---|---|---|---|
| 1 | Club soccer (1X2) | Bet **favourites (>=70% implied) at the best available price** across bookmakers | **+2.2% per bet** (n=14,958; 95% CI +1.3% to +3.1%; t=5.1) | 18 of 22 seasons positive; both halves of the sample positive; monotone across the 70-100% buckets; robust to which bookmaker is best | At average odds the same bets lose 0.95%. You need accounts at many books and to always take the top price. Soft books limit winners. |
| 2 | Club soccer (1X2) | Walk-forward **market-recalibration + Elo model**, bet at best price when model EV > 3% | **+3.3% per bet** (n=35,841; CI +1.6% to +4.9%; t=3.9) | Out-of-sample season by season 2010-2026, 14/17 seasons positive; EV>6% subset +5.2%; EV>10% subset +14% | Same picks paid at average odds: **-5.9%**. Weaker since 2019 (+1.9%, t=1.1). Edge is line-shopping plus longshot-bias correction, not football insight. |
| 3 | Club soccer (1X2) | **Cross-bookmaker arbitrage** (sum of 1/best odds < 1) | 1.25% locked-in per arb (median 0.76%) on 22.7% of matches since 2005 | Mechanical; no forecasting needed | Requires 10+ funded accounts, fast execution, and tolerance for stale "ghost" lines and account closures. Treat the 22.7% as an upper bound. |
| 4 | Kalshi 15-minute crypto markets | Buy the side priced 85-99c at **minutes 5-7** of the window (mid-window favourite underpricing) | **+1.1 to +1.5c per contract** (~1.2% per 10-minute hold; n=4,670-8,723; t=2.8) | Positive in all 3 months and 4 coins, but not robust to the ~60 cells tested (adj. p~0.35); reverses in the last 2 minutes | Needs a live paper-trade before real size; 2,500+ contracts trade per qualifying minute, so capacity is real |
| 5 | NFL totals | **Under when recorded wind >= 15 mph** | +10.0% (n=684; CI +2.7% to +17.2%; t=2.8) | 17/27 seasons; monotone in wind; +13.7% / +3.5% / +11.0% across three eras | Does not survive a 56-test Bonferroni correction (adj. p=0.33). Uses wind recorded at kickoff, not the pre-game forecast. About 25 bets per season. |
| 6 | Equity indices | 10-month SMA trend filter / vol targeting on S&P 500 | same CAGR as buy-and-hold (7.4%) at 2/3 the volatility; max drawdown -23% vs -57% | 33 years; both halves positive | This is risk management, not alpha. Taxable turnover. |

Everything else tested was flat or negative after costs (Sections 2-6 list every test, including the failures).

## 2. Sports betting: club soccer (238,854 matches, 38 divisions, 2000-2026)

Data: `xgabora/Club-Football-Match-Data-2000-2025` (football-data.co.uk odds). `Odd*` = average bookmaker price
(vig 6-7%), `Max*` = best price across all listed books (vig ~1%). Season = Aug-Jul.

### 2.1 Favourite-longshot bias is large and survives only at the best price

ROI of betting every 1X2 outcome, bucketed by implied probability (`research/results/soccer_tests.txt`):

| Best-odds implied prob | n | ROI at best odds | ROI at average odds |
|---|---|---|---|
| 0-10% | 12,866 | -16.8% | -36.8% |
| 10-20% | 64,554 | -2.6% | -15.1% |
| 20-30% | 243,731 | -2.6% | -9.8% |
| 30-40% | 139,515 | -1.0% | -6.9% |
| 40-50% | 83,511 | -0.4% | -6.1% |
| 50-60% | 50,811 | +0.5% | -4.8% |
| 60-70% | 23,637 | +0.5% | -4.2% |
| **70-80%** | **10,152** | **+2.3% (t=3.9)** | -2.1% |
| **80-100%** | **4,846** | **+2.1% (t=3.5)** | -1.0% |

Favourites at >=70% (`soccer_deep.txt`): +2.20% overall, home favourites +2.30% (t=4.9), away favourites +1.70% (t=1.5).
Per season: positive in 18 of 22 (misses: 2006, 2019, 2020, and the 51-match 2026 stub). By league the edge is
concentrated in Portugal, Greece, China, Belgium, Spain, Euro competitions (+3.6% to +7.2%) and is roughly zero
in England, Germany and the Netherlands.

**Is it one stale bookmaker?** No. Bucketing by how far the best price sits above the average
(`soccer_outlier.txt`): +2.8% when the premium is under 1%, +1.8% at 3-5%, +6.5% at 5-8%.
If you could only get halfway between the average and the best price: +0.6% (t=1.5), i.e. marginal.
**The edge is entirely a line-shopping edge.**

### 2.2 Walk-forward value model

Multinomial logistic regression on the de-vigged average-market log-odds, Elo difference, and 3/5-match form,
refit each season on all prior seasons (2010-2026 out of sample). Bets placed at the best price when
model probability x best odds - 1 > threshold.

| Selection rule | n | ROI | t | Seasons + |
|---|---|---|---|---|
| Market + Elo, EV > 0% | 106,573 | +1.5% | 3.4 | 14/17 |
| Market + Elo, EV > 3% | 35,841 | +3.3% | 3.9 | 14/17 |
| Market + Elo, EV > 6% | 9,938 | +5.2% | 2.7 | 11/17 |
| Market + Elo, EV > 10% | 2,189 | +14.2% | 2.7 | 13/17 |
| Market-only recalibration, EV > 6% | 6,651 | +8.0% | 3.3 | 14/17 |
| Elo only (no market input), any EV | 137,001 | -3.2% | -6.7 | 0/17 |
| Same EV>3% picks paid at *average* odds | 35,841 | **-5.9%** | -8.1 | 1/17 |

Out-of-sample log-loss: market-only 0.9939, market+Elo 0.9938, Elo-only 1.0113, raw de-vigged market 0.9940.
Elo adds almost nothing to the market; the model's job is to correct the favourite-longshot bias and then
exploit price dispersion between books. Seasons 2019-2026 only: +1.9% (n=9,235, t=1.1, 6/8 seasons) -- the
edge has narrowed as books have sharpened and as the best-price coverage in the data changed.

Bankroll simulation (chronological, EV>3%): flat 1% stakes compound at roughly +57%/yr over 2010-2026 with
a 75% peak-to-trough drawdown; quarter-Kelly capped at 5% roughly doubles per year with a 56% drawdown.
Both numbers assume you are never limited and always get the best price, which no real account achieves.

### 2.3 Arbitrage

Share of matches where the best prices across books sum to less than 100%: 4.7% (2005) rising to 30-47%
(2012-2016) and 20-30% since. Mean locked profit 1.25%, 90th percentile 2.8%. Over/under 2.5: 4.7% of matches,
0.9% mean. This is the well-known "surebet" market; the binding constraints are execution and account survival.

### 2.4 Negative results (soccer)
Every outcome type at average odds (-6% to -10%); longshots at any price (-8.6% below 15% implied);
over/under 2.5 in every bucket (-0.5% to -4.5%); pure line shopping without recalibration (-0.5%);
Elo-only models at any threshold (-3% to -4%).

## 3. Sports betting: NFL (7,309 games, closing lines 1999-2026; moneylines from 2006)

Data: `nflverse/nfldata` games.csv. 56 systems tested (`research/results/nfl_tests.txt`).

* The closing line is well calibrated: home-team fair probability vs realised win rate tracks within 2-3
  points in every bucket; mean(margin - spread) = +0.08 points.
* Betting every home team ATS: -4.8% (t=-4.3). Every favourite on the moneyline: -3.4% (t=-3.5).
  Every over: -4.4%. These are the vig.
* No moneyline bucket, home/road dog, divisional, rest, primetime, playoff, week-1, dome, cold-weather or
  spread-size system is positive with t > 2 except:
* **Under when wind >= 15 mph:** +10.0% (n=684, t=2.8, p=0.006; 17/27 seasons; first/second half +10.6%/+9.4%).

  | Recorded wind (outdoor games) | n | Under ROI | Seasons + | Total line | Actual total |
  |---|---|---|---|---|---|
  | 0-5 mph | 1,067 | -3.2% | 13/28 | 43.4 | 44.9 |
  | 5-10 mph | 2,258 | -6.7% | 8/28 | 42.9 | 43.9 |
  | 10-15 mph | 1,216 | +4.4% | 18/28 | 42.5 | 42.5 |
  | 15-20 mph | 497 | +10.9% | 17/27 | 42.1 | 40.5 |
  | 20+ mph | 187 | +7.9% | 14/27 | 40.9 | 39.9 |

  By era (wind >= 15): 1999-2008 +13.7%, 2009-2016 +3.5%, 2017-2026 +11.0%. The market already shades the
  total down about 1.3 points in wind, but actual totals come in another 1.45 points lower. Caveats: 56 hypotheses
  were tested (Bonferroni-adjusted p = 0.33); wind is the value recorded at kickoff, so a live strategy must use
  the forecast; about 25 qualifying games per season, so annual variance is large.

## 4. Equities, volatility, FX, commodities (`research/results/equities_tests.txt`)

S&P 500 1990-2022 daily, OHLC 2000-2020, VIX 1990-2026, WTI 1986-2026, FRED G10 FX 1999-2026, gold 1971-2026,
Shiller monthly 1881-2023. Costs 0.05% per switch.

| Strategy | CAGR | Vol | Sharpe | Max DD | Verdict |
|---|---|---|---|---|---|
| Buy & hold S&P 500 | 7.4% | 18.3% | 0.48 | -57% | benchmark |
| 10-month SMA filter (monthly) | 7.4% | 12.1% | 0.65 | -23% | same return, far less risk (both halves positive) |
| 12-month time-series momentum | 7.3% | 12.8% | 0.61 | -25% | same |
| 200-day SMA (daily) | 5.7% | 11.3% | 0.55 | -30% | more whipsaw |
| Vol-target 10% | 5.3% | 10.1% | 0.56 | -36% | risk control |
| Turn-of-month only (4 days) | 2.6% | 8.1% | 0.36 | -31% | TOM days +6.9 bp vs +2.7 bp, t=1.3: weak |
| Sell in May | 5.7% | 13.0% | 0.49 | -35% | no better than B&H per unit risk |
| Overnight only (2000-2020) | 0.7% gross | 4.5% | 0.17 | -20% | dead after 0.1%/day costs |
| VIX > 30 only / VIX <= 20 only | 2.7% / 2.7% | | 0.29 / 0.35 | | no timing information |
| G10 FX 12-1 momentum | 0.0% | 6.9% | 0.03 | -39% | none (ex-carry) |
| Gold 12-month momentum | 9.6% | 14.9% | 0.69 | -32% | vs B&H 0.58 |
| WTI momentum (spot) | 2.7% | | 0.23 | | none |
| Out of market when CAPE in top quintile | 2.6% | | 0.27 | | loses to B&H (4.7%) |
| 20-stock XS momentum / reversal | -1.3% / -8.7% | | 0.11 / -0.24 | | none |

Conclusion: nothing here is a mispricing you can harvest; trend filters and vol targeting are worth using as
risk management on long-only exposure, which is a different claim.

## 5. Kalshi prediction markets

Data: every settled market Kalshi's public API returns (4.4M+ markets, but the API only serves roughly the
last ten weeks: 2026-07-18 to 2026-09-26 for nearly every series), plus 1-minute candlesticks for 26,367
fifteen-minute crypto markets, 1-minute candlesticks for sampled hourly BTC/ETH strike ladders, and hourly
candlesticks for sports game markets. Fees: taker 0.07 x P x (1-P) per contract (100-contract orders).
Standard errors are clustered by timestamp because the coins move together.

### 5.1 Fifteen-minute crypto up/down markets (BTC, ETH, SOL, XRP; 26,367 markets, 6,598 timestamps)

These are the most liquid contracts on the exchange (BTC alone traded about $13B notional in the window; a
median of 2,500-3,200 contracts trade in a single mid-window minute).

| Test (buy at the quoted ask, hold to settlement) | n | ROI / contract | t (clustered) |
|---|---|---|---|
| Buy YES at minute 1, every market (baseline) | 26,367 | -1.85c | -3.8 |
| Buy NO at minute 1, every market | 26,367 | -2.75c | -5.7 |
| After a top-decile DOWN bar: buy YES at minute 1 (the reversal signal from Section 6) | 2,658 | +0.13c | +0.1 |
| After a top-decile UP bar: buy NO at minute 1 | 2,680 | -2.02c | -1.6 |
| Favourite side priced 0.85-0.99 at **minute 5** | 4,670 | **+1.50c** | +2.8 |
| Favourite side priced 0.85-0.99 at **minute 7** | 8,723 | **+1.07c** | +2.8 |
| Favourite side priced 0.85-0.99 at minute 10 | 14,176 | +0.35c | +1.3 |
| Favourite side priced 0.85-0.99 at minute 13 | 10,954 | -1.20c | -4.6 |
| Favourite side priced 0.85-0.99 at minute 14 | 6,089 | -1.05c | -3.3 |
| Longshot YES asked <= 0.10 at minute 10 / 13 / 14 | 5,335 / 5,088 / 3,012 | -1.06c / -0.87c / -0.39c | -2.8 / -3.1 / -1.1 |

Reading: the baseline loses exactly the fee, so the market is fair on average at the open. The 15-minute
reversal in the underlying is fully priced in (the next window opens at 52c, not 50c). Longshots are
overpriced at every minute (classic favourite-longshot bias), and the mirror image exists **mid-window**:
at minutes 5-7 the side priced 85-99c settles in the money more often than its price implies (at minute 5
contracts asked at 93c pay out 96.4% of the time). The cell is positive in each of the three months
(+2.5c, +1.2c, +1.3c) and in all four coins (XRP +2.3c, BTC +1.7c, SOL +0.8c, ETH +0.0c), but only the pooled
estimate is significant, and the +1.5c must be discounted for the roughly 60 cells examined here (Bonferroni
p ~ 0.35). By the final two minutes the effect reverses: quotes widen and the 97c favourite settles yes only
93-94% of the time. **Verdict: a plausible ~1c-per-contract (about 1.2% per 10-minute hold) edge for a
maker-style buyer of mid-window favourites, worth paper-trading with `research/kalshi_live_screener.py`,
not yet a proven one.** Everything else in these markets is efficient net of fees.

### 5.2 Hourly BTC/ETH strike ladders (529 BTC hours and 269 ETH hours sampled; 12,524 strike markets)

Each hour Kalshi lists 20+ strikes ("BTC at 16:00 >= $84,400?"), i.e. a full implied distribution.
Bought at the ask at minute 1 / 15 / 30 / 45 and held to settlement, clustered by hour:

| Strategy | minute 1 | minute 15 | minute 30 | minute 45 |
|---|---|---|---|---|
| Sell the upper tail (buy NO on strikes asked <= 10c) | -0.85c (t -2.2) | -1.46c (t -2.6) | -1.12c (t -2.2) | -0.78c (t -1.7) |
| Sell the lower tail (buy YES on strikes bid >= 90c) | -0.86c | -0.46c | -0.36c | -0.01c |
| Buy longshots (asked 3-15c) | +0.81c (t 0.8) | +0.56c | -0.02c | -1.68c (t -1.9) |
| Buy near-the-money (asked 40-60c) | -7.54c (t -3.9) | -0.88c | +0.25c | -2.89c |
| Buy the favourite side priced 80-95c | -4.4c / -6.4c (t -3.3 / -4.3) | +0.8c / -3.9c | +0.7c / -1.9c | +0.5c / +0.5c |

The implied 80% interval contained the settle 82.0% of the time for BTC (484 hours) and 81.4% for ETH
(199 hours): the ladders are calibrated. Tails are, if anything, slightly under-priced (the 6-10c bucket
settles yes 12% of the time), which is why "selling volatility" loses here. Near-the-money quotes at the
open carry 5-10c spreads that no bucket's mispricing covers. **Verdict: no edge.**

### 5.3 Sports game markets, pregame (48,514 markets with a quote about an hour before the start)

Every Sports-category game/match/fight market with >= $5k volume (tennis, MLB, NCAAF, soccer leagues, cricket,
esports, NBA summer league, UFC, etc.), quoted from hourly candles roughly one hour before the scheduled start.
Median bid-ask spread: 1c.

| Pregame mid | n | realised | fee-adjusted EV of buying YES at ask | ... NO at 1-bid |
|---|---|---|---|---|
| 0-10c | 2,392 | 6.0% | -1.5c | -1.0c |
| 10-20c | 4,555 | 18.2% | +0.4c | -4.6c |
| 20-30c | 8,003 | 27.3% | -0.4c | -4.6c |
| 30-40c | 6,783 | 36.3% | -2.0c | -4.3c |
| 40-50c | 7,273 | 45.7% | -3.0c | -4.3c |
| 50-60c | 6,791 | 55.0% | -3.6c | -3.4c |
| 60-70c | 5,249 | 64.4% | -3.6c | -2.9c |
| 70-80c | 3,530 | 75.2% | -2.6c | -3.2c |
| 80-90c | 2,487 | 83.0% | -4.1c | -0.4c |
| 90-100c | 1,451 | 94.1% | -0.6c | -2.0c |

* Buy every YES pregame: -2.1% (t=-10.5). Buy favourites (>= 60c): -4.0% to -4.9% (t=-11 to -17).
  Heavy favourites (80-97c): -3.9%. Longshots (<= 30c): -0.2% (n.s.); (<= 15c): -1.2%.
* Unlike bookmakers, Kalshi's sports prices show **no favourite-longshot bias**: longshots are fairly priced
  and favourites cost the full spread plus fee. The per-sport tables (ATP, WTA, MLB, T20, esports, soccer
  leagues) show the same picture; the few positive cells (NBA summer league 80-90c, Dota 10-20c) have n < 60.
* **NFL vs the sportsbook closing line** (62 sides, weeks 1-3 of 2026): Kalshi's pregame mid and the
  de-vigged closing moneyline differ by 0.9c on average (correlation 0.998), and only one side was more than
  2c cheaper on Kalshi. There is no Kalshi-vs-Vegas arbitrage in NFL winners; Kalshi's log-loss (0.666) is
  indistinguishable from Vegas (0.664).

Verdict: no edge in Kalshi sports game markets at the pregame quote.

### 5.4 Long-dated markets, 1 / 7 / 30 days before close (all categories)

Filled in from the daily-candle pull; see the end of this file.

## 6. Crypto underlying (reconstructed from settled Kalshi markets, 2026-07-18 to 2026-09-26)

Each settled 15-minute market records the reference price at open and at close, so the settled history is a
15-minute price series (checked: open/close ordering matches the settled result in 99.98% of markets).
Annualised vol: BTC 34%, ETH 47%, SOL 56%, XRP 70%, DOGE 67%, HYPE 73%, BNB 37%.

* Autocorrelation of 15-minute returns is essentially zero (|rho| < 0.05 at lags 1-4) for every coin.
* After a **top-decile down bar**, the next bar is up 55% (BTC), 58% (ETH), 55% (SOL), 56% (BNB), 55% (HYPE),
  54% (XRP), 50% (DOGE), n about 300 each -- a short-term reversal that exceeds the 52% break-even of a 50c
  contract. Whether Kalshi's 15-minute market already prices it in is tested in Section 5.
* Hour-of-day and day-of-week effects: no cell survives multiple testing (82 tests, smallest Bonferroni p = 1.0).
* Daily momentum (7/14/30-day) over the 70-day window underperforms buy-and-hold in a rising market; the sample
  is far too short to say anything about crypto momentum.

## 7. How to act on the soccer findings (the only edges with strong evidence)

1. **Accounts.** The edge is the gap between the best and the average price, so it needs accounts at 8-15
   bookmakers plus an odds-comparison feed (Oddsportal-style, or a paid API). With one or two books the same
   bets lose money (Section 2.1). Expect soft books to cut limits on a winning account within months; spread
   volume, avoid round stakes, and accept that the edge has a shelf life per account.
2. **Selection.** Simplest rule with the best evidence: any 1X2 outcome whose best available price implies
   >= 70% (odds <= 1.43), taken only at the best price. Expect about 2% per bet, roughly 700 qualifying bets a
   season across the 38 covered divisions, and a season ROI between -3% and +5%. The model-based rule
   (Section 2.2) roughly doubles the number of bets and the per-bet edge but needs the Elo/market pipeline
   rebuilt each week; its edge has been thinner since 2019.
3. **Sizing.** Flat stakes of 1% of bankroll (or quarter-Kelly capped at 5%) were used in the simulation; even
   then the historical drawdown from peak exceeded 50%. Halve the stake if you cannot tolerate that.
4. **Verification before scaling.** Log every bet with the price obtained versus the best price at the time and
   the closing price. If your realised prices sit closer to the average than to the best, the edge is gone.

## 8. What was blocked, and what would unlock more

The environment's network policy allowed only the Kalshi API, GitHub and PyPI. Denied hosts that would extend
this research: `api.binance.com` / `data.binance.vision` (years of crypto candles and funding rates),
`query1.finance.yahoo.com` (equities/ETFs to 2026), `gamma-api.polymarket.com` / `clob.polymarket.com`
(Kalshi-vs-Polymarket arbitrage), `www.football-data.co.uk` (opening vs closing soccer odds),
`api.the-odds-api.com` (live multi-book odds), `fred.stlouisfed.org`. Network access is changed in the
environment settings (Edit environment > Network access).

## 9. Method notes

* Costs: soccer/NFL pay the quoted price (vig included). Kalshi: taker fee 0.07 x P x (1-P) per contract,
  rounded up per order (100-contract orders assumed). Index strategies: 0.05% per one-way trade.
* Inference: bet-level bootstrap 95% CIs, t-statistics, first-half/second-half splits, seasons-positive counts.
  Kalshi 15-minute results use per-timestamp clustering because the coins move together.
* Multiple testing: every hypothesis is logged (`research/results/*_tests.csv`, column `bonferroni_p`).
  Roughly 300 hypotheses were evaluated in total; a nominal p of 0.05 means nothing here, and only results
  with p < 0.001 and consistency across sub-periods are treated as findings.
* Reproduce: `pip install -r requirements.txt`, download the CSVs listed in `research/data_sources.md`,
  run `python research/kalshi_download.py`, then each `research/*.py` with `DATA_DIR` / `KALSHI_DATA_DIR` set.
