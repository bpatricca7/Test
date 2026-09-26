# Robinhood Prediction Markets Analysis

Tools for Robinhood's prediction markets, which are powered by [Kalshi](https://kalshi.com/), a CFTC-regulated exchange.

**Need money today?** Start with [MONEY_TODAY.md](MONEY_TODAY.md). It gives an honest ranking of what can put cash in your hands within 24 hours, and what these tools can and can't do.

## Correction (September 2026)

The December 2025 picks in this repo (AFC teams at 1–8¢, Bears at 11¢, and so on) recommended **buying cheap longshot contracts**. Kalshi's own trade data shows that is the losing side: buyers of contracts under 10¢ lost over 60% of their money on average, while expensive contracts earned small positive returns ([Bürgi, Deng & Whelan](https://cepr.org/voxeu/columns/economics-kalshi-prediction-market)). The analyzer now flags cheap contracts as **AVOID**. The older analysis files are kept as a record, not as advice.

## Contents

- `arbitrage_scanner.py` finds sets of contracts that pay out more than they cost after fees, whatever the outcome. It reads public data only and never places orders.
- `prediction_market_analyzer.py` scores markets for irregular pricing and flags longshots to avoid.
- `MONEY_TODAY.md` covers same-day cash options, fees and withdrawal times.
- `tests/` holds unit tests plus a **synthetic** fixture for offline runs.
- `UNDERVALUED_PREDICTIONS_ANALYSIS.md`, `PRICE_MOVEMENT_VALIDATION.md` and `undervalued_predictions.json` are the December 2025 analysis, superseded by the correction above.

## Quick Start

```bash
pip install -r requirements.txt

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
