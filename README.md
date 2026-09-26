# Robinhood Prediction Markets Analysis

Tools for Robinhood's prediction markets, which are powered by [Kalshi](https://kalshi.com/), a CFTC-regulated exchange.

**Need money today?** Start with [MONEY_TODAY.md](MONEY_TODAY.md). It gives an honest ranking of what can put cash in your hands within 24 hours, and what these tools can and can't do.

## Correction (September 2026)

The December 2025 picks in this repo (AFC teams at 1–8¢, Bears at 11¢, and so on) recommended **buying cheap longshot contracts**. Kalshi's own trade data shows that is the losing side: buyers of contracts under 10¢ lost over 60% of their money on average, while expensive contracts earned small positive returns ([Bürgi, Deng & Whelan](https://cepr.org/voxeu/columns/economics-kalshi-prediction-market)). The analyzer now flags cheap contracts as **AVOID**. The older analysis files are kept as a record, not as advice.

## Contents

- `lip_bot.py` collects Kalshi liquidity rewards by completing empty sides of pinned markets. It's a dry run unless you pass `--live`.
- `backtest.py` and `paper_trade.py` backtest and forward-test trading rules; results are in `STRATEGY_TESTS.md`.
- `arbitrage_scanner.py` finds sets of contracts that pay out more than they cost after fees, whatever the outcome. It reads public data only and never places orders.
- `prediction_market_analyzer.py` scores markets for irregular pricing and flags longshots to avoid.
- `MONEY_TODAY.md` covers same-day cash options, fees and withdrawal times.
- `tests/` holds unit tests plus a **synthetic** fixture for offline runs.
- `UNDERVALUED_PREDICTIONS_ANALYSIS.md`, `PRICE_MOVEMENT_VALIDATION.md` and `undervalued_predictions.json` are the December 2025 analysis, superseded by the correction above.

## Quick Start

```bash
python3 -m pip install -r requirements.txt     # Windows: py -m pip install -r requirements.txt

# Scan live Kalshi markets that settle within the next 12 hours
python arbitrage_scanner.py --closing-within-hours 12

# Trading through Robinhood? Add its per-contract fees (conservative)
python arbitrage_scanner.py --closing-within-hours 12 --extra-fee-cents 2

# Keep watching: re-scan every 60 seconds, print only new opportunities (Ctrl-C to stop)
python arbitrage_scanner.py --closing-within-hours 12 --repeat 60

# Offline demo on made-up data
python arbitrage_scanner.py --fixture tests/fixtures/sample_markets.json

# Run the tests
python -m unittest discover -s tests
```

## Liquidity reward bot (`lip_bot.py`)

Kalshi's Liquidity Incentive Program pays reward pools to resting orders near the top of the book. A snapshot only counts when both sides have the program's Target Size resting. In hourly Miami temperature markets, many strikes are "pinned": one side is bid at 97–98¢ and the other side is empty, so their pools go unpaid.

The bot rests a post-only 1¢ bid, sized just above the Target (about $10 of collateral), on the empty side. Under the published scoring, the only order on a side earns that side's share: half the pool, about $50/hour per strike. See [STRATEGY_TESTS.md](STRATEGY_TESTS.md) for the measurements and caveats.

**Unverified:** that Kalshi credits these orders as the rules imply, and that the rewards are withdrawable cash (Kalshi calls them "reward credits" and lists them under Activity → Credits). The Rewards popover on each market shows a live earnings estimate for your resting orders, so check it.

**The opening comes and goes.** A strike can only be completed while the full side's best bid is 97–98¢. At 99¢, a 1¢ order would cross, so nothing can rest. On 2026-09-26 strikes were completable in about 60% of checks during one afternoon hour and about 14% during another. `plan` shows what is open right now.

### Running a one-hour test

You need a Mac or Windows PC that stays on and awake for the hour. A phone can't run it: iOS pauses apps in the background, and the bot must keep running to manage its orders.

1. **Create an API key** in a computer browser: kalshi.com/account/profile → API Keys → Create New API Key, with the default (read and write) access. Copy the Key ID. The private key downloads as a `.txt` file; move it into this folder and don't rename, edit or share it.
2. **Install**: get Python 3 from python.org, then in this folder run `python3 -m pip install -r requirements.txt` (Mac) or `py -m pip install -r requirements.txt` (Windows).
3. **Run** (Windows: type `py` instead of `python3`):

```bash
python3 lip_bot.py plan                                              # what it would do now; no key needed
python3 lip_bot.py run --key-id YOUR_KEY_ID --key-file YOUR_KEY.txt         # checks the key, then a dry run
python3 lip_bot.py run --key-id YOUR_KEY_ID --key-file YOUR_KEY.txt --live  # real money; type LIVE
```

The key check prints `Key OK` and your cash on Kalshi's default exchange, or a plain message if the key is rejected. `--demo` needs a separate account and key from demo.kalshi.co, because production keys don't work there.

4. **While it runs**: keep the computer plugged in and awake. On a Mac, run `caffeinate -dis` in a second Terminal window; on Windows, set sleep to Never. Keep a laptop's lid open. On Windows, don't click inside the window: that pauses the output, and the bot with it (press Esc if the title starts with "Select").
5. **Stop** with Ctrl-C and wait for the prompt to return (up to about 30 seconds). If it prints `STILL RESTING` or `COULD NOT CONFIRM`, cancel the listed orders in the Kalshi app. Either way, check the app for open orders afterwards.

Safeguards:
- It only places orders with `--live`, and you must type `LIVE` to confirm.
- Orders are post-only, so they never pay the spread.
- Every order expires on the exchange 60 seconds before its program ends.
- Resting collateral never exceeds the smaller of `--max-capital` and the fill budget left (`--max-fill-spend` minus what fills have already cost). So even if every resting order filled at once, total fill spend stays within `--max-fill-spend`.
- Fills count from the start of the UTC day, so restarting the bot doesn't reset the fill cap.
- Each completion order is 1,050 contracts at 1¢ (about $10.50), so the defaults ($25 and $25) allow two at a time. Raise both caps together to run more.
- When the fill budget can't keep both orders at Target, it drops one so the other stays full. An order below Target earns nothing but can still be filled.
- It only manages orders it created (IDs prefixed `lipbot-`) in the series it runs.
- It cancels them on Ctrl-C, SIGTERM, SIGHUP (a closed Mac or Linux terminal) or Ctrl-Break, and says so if it couldn't. On Windows, closing the window may not leave time to cancel, so stop it with Ctrl-C.

Rules to know:
- US members trading on Kalshi directly only; customers of brokers such as Robinhood are excluded.
- Payouts aren't real time. Kalshi scores a program after it ends and pays in a later processing run ("Timing can vary"); we once saw payment about 6 hours after a program ended. Paid rewards appear under Activity → Credits.
- Anything under $1 per program period isn't paid.
- Kalshi can change or end the program, or revoke participants it judges abusive, at any time.
- After testing, you can delete the API key at kalshi.com/account/profile.

## What the scanner checks

| Structure | Why it can't lose (if filled at the listed prices) |
|-----------|----------------------------------------------------|
| **NO basket** | In a mutually exclusive event at most one market resolves YES, so NO on k markets pays at least (k−1) × $1. |
| **Strike ladder** | "Above $60k" YES plus "above $61k" NO: one of them pays wherever the price lands. |
| **YES basket** | Pays $1 **only if** the listed outcomes cover every possibility. Read the event rules; the API doesn't say. |

Every candidate is:

1. priced with Kalshi's taker fee, `round_up(M × 0.07 × C × P × (1−P))`, using the event's own series multiplier M. Events whose multiplier can't be confirmed are skipped and listed.
2. re-priced from the live order book and sized to the contracts actually offered at the best price.

Payload handling was checked against the live Kalshi API on 2026-09-26: `*_dollars` prices, `orderbook_fp` books, and the series `fee_type`/`fee_multiplier`.

**Expect most scans to find nothing.** These gaps are rare, small, and usually closed by bots within seconds. When one does appear: use limit orders, fill the thinnest leg first, and never leave a set half-filled.

## Analyzer scoring

`prediction_market_analyzer.py` scores markets 0–100 on four irregularity signals: extreme price, wide spread, thin volume and time to close. A high score means "look closer", not "buy". Extreme prices produce **AVOID** recommendations for the cheap side.

## Data Sources

- [Kalshi API](https://docs.kalshi.com/). Public market data needs no API key.
- [Robinhood Prediction Markets](https://robinhood.com/us/en/prediction-markets/)

## Disclaimer

For **informational purposes only**; not financial advice. Prediction markets can lose you money. An "arbitrage" is only risk-free if every leg fills at the listed price and the event settles under its published rules.

## License

MIT
