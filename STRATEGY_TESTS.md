# Strategy Tests: What Was Tried and What Happened

*Research log, started 2026-09-26. Every idea goes in here with its result, including the ones that failed or turned out to be mistakes. Nothing here places trades.*

## How ideas are tested

1. **Backtest on settled Kalshi markets** (`backtest.py`). The data is two months of settled markets, sampled at up to 15 per series per day, with the hourly best bid and ask before close.
   - Entries are priced at the **ask**, the price you'd actually pay, plus Kalshi's fee for that series.
   - Rules are picked on the earlier ~65% of the period and checked on the later ~35%.
   - Confidence intervals resample **whole events**, because 20 strikes of one Bitcoin event aren't 20 independent bets.
   - Rules that buy expensive contracts must also stay profitable at the 95% upper bound on the loss rate. Resampling can't invent losses a sample never saw, and one loss at 97¢ erases about 40 wins.
2. **Holdout:** anything that survives is re-checked on older data (June–July 2026) that wasn't used to find it.
3. **Paper trading** (`paper_trade.py`): survivors are forward-tested on live markets before any real money.

## Results so far

| # | Idea | Result |
|---|------|--------|
| 1 | **Risk-free arbitrage** (NO baskets, strike ladders, YES baskets) across all open Kalshi markets | **None found that pays within 3 days.** The closest same-day sets cost 101–103¢ per $1 before fees. A watcher re-scanned every minute for hours and found nothing. The only full-market hits were long-dated YES baskets returning 0.1–6% over 1–3 years, which also depend on the listed outcomes being complete. |
| 2 | **Buy cheap longshots** (the repo's original December picks) | **Loses heavily.** 1–5¢ contracts lost 65–90% at the ask. This matches published Kalshi research. |
| 3 | **Buy any price band at the ask** | **Loses 7–25%** across almost all bands, mostly because of **bid-ask spreads**: mid-priced markets averaged 17–26¢ spreads. At the midpoint, prices were well calibrated: contracts quoted around 94.5¢ won 96.3%, around 54¢ won 56.5%. |
| 4 | **Momentum** (buy what rose over the last 8 hours) | **Negative in every bucket**, with or without a spread filter. |
| 5 | **Sports YES at 50–70¢, 1h before close** | Looked like **+5–6% out of sample, then retracted as lookahead bias.** Sports props close the moment the event happens (a touchdown prop closes when the player scores), so counting back from the *actual* close selected moments just before YES happened. **Confirmed by the leak-free re-run:** timed from the scheduled time instead, YES at 50–60¢ one hour out made +0.3% before the split date and **−3.4% after it**. |
| 6 | **Pre-registered rule H1** (YES 40–70¢, spread ≤ 2¢, 1h before close) | **Retracted** for the same reason; its paper trading was stopped. |
| 7 | **Leak-free re-run of every price band and momentum rule** (266,129 markets, 384 rules, spread ≤ 2¢) | **Nothing held up.** Four near-certain-contract rules (95–100¢ in Economics, Financials and Commodities) showed +0.7–1.8% after the split date, but with **0–1 losses in 43–84 trades**. At the 95% upper bound on their loss rate they lose 3.5–5.1%. That isn't evidence either way. |
| 8 | **Maker orders** (rest a 1-lot bid at the best bid 1h or 4h before the scheduled close, hold to settlement; 2,365 markets, fills simulated from public trade prints) | **Loses 7–15% per filled dollar** in the later period, even with the most optimistic fill rule. If every order had filled it would have made +10–15%. But fills are adverse: filled bids won 35–41% of the time, unfilled ones 82–91%. An independent reviewer reproduced it exactly. |
| 9 | **Crypto hourly ladders vs. a volatility model** (BTC/ETH, spot from Kalshi's own 15-minute settlements, entry 1h before scheduled close) | **−9.4%** (95% interval −16.1% to −3.3%, 2,369 trades). The market was better calibrated than the model: it predicted 42% wins where 29% happened. Reviewer reproduced it. |
| 10 | **Relative value in one-winner events** (buy outcomes priced below their share of the event's total) | **NO side −9.9%** (1,175 events). YES side +24% but on only 42 trades, with the interval spanning −4% to +50%, and negative in the earlier period. Unproven. Reviewer reproduced it. |
| 11 | **Kalshi new-user promotion** | **Positive expected value, one time only.** Kalshi's help center says only *profits* from credits are withdrawable. The leak-free backtest says long-odds contracts turn credit into far more withdrawable profit than near-certain ones. See below. |

## Using a Kalshi promo credit well

The credit itself can't be withdrawn, and losing it costs you nothing of your own. So a long-odds contract with a big win when right beats a near-certain one:

| Contract price (1h before scheduled close, spread ≤ 2¢) | Expected withdrawable profit per $1 of credit | How often it wins |
|---|---|---|
| 5–10¢ | $0.89 | 7% |
| 10–20¢ | $0.73 | 13% |
| 20–30¢ | $0.69 | 24% |
| 30–40¢ | $0.60 | 34% |
| 50–60¢ | $0.43 | 55% |
| 95–100¢ | $0.02 | 98% |

*Leak-free timing, 2026-07-28 to 2026-09-25. Cheaper bands pay more on average but win rarely. For example, six separate $10 bets at about 25¢ each win at least once about 80% of the time, and are worth about $40 on average.*

Spreading the credit over several **independent** events (different games or cities, not strikes of one event) keeps the average about the same and makes an all-or-nothing result much less likely. Your own **$25 qualifying trade** is real money: put it on a tight-spread favorite, where losses are rarest.

## Pre-registered: H2 (written 2026-09-26, before any holdout data was collected)

> Buy whichever side's ask is 95–99.99¢, with a spread of at most 2¢, 2 or 4 hours before the scheduled close, in the **Economics, Financials and Commodities** categories. Pay the ask plus the series taker fee.

It is judged on **June 1 – July 27, 2026** only, data no rule was fitted to. It passes only if returns are positive with a 95% event-clustered interval above zero **and** it stays profitable at the 95% upper bound on the loss rate.

## Still running

- **H2 holdout, second pass:** the batch price endpoint only reaches back to mid-July, so the June 1 – July 16 holdout prices are being fetched from the historical endpoint. That slice hasn't been looked at.
- **H2 live paper trading** (`python paper_trade.py --name h2 --report`).
- **Kalshi's Liquidity Incentive Program:** Kalshi pays for resting orders near the top of the book, even unfilled; $911k of pools were active on 2026-09-26. Being measured: what share a small participant would get, what fills cost, and when rewards pay out.

## The pattern so far

Using only Kalshi's own prices, no simple rule beats the market after fees and spreads: not price bands, momentum, passive maker orders, a volatility model or relative value. Where money exists, it comes from information the market lacks, or from Kalshi paying for liquidity.
- Ideas that need one more allowed domain: weather markets vs. NWS forecasts (`api.weather.gov`, `mesonet.agron.iastate.edu` for archived forecasts) and crypto ladders vs. a volatility model (`api.exchange.coinbase.com`).
