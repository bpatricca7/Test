# Robinhood Prediction Markets Analysis

Automated analysis tool for identifying undervalued predictions in Robinhood's prediction markets (powered by Kalshi).

## Overview

Robinhood's prediction markets are powered by [Kalshi](https://kalshi.com/), a CFTC-regulated exchange. This repository contains tools and analysis for finding potentially undervalued prediction opportunities.

## Contents

- `prediction_market_analyzer.py` - Python script to fetch and analyze prediction market data via Kalshi's API
- `UNDERVALUED_PREDICTIONS_ANALYSIS.md` - Detailed analysis report with current opportunities
- `undervalued_predictions.json` - Structured data of identified opportunities
- `requirements.txt` - Python dependencies

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the analyzer
python prediction_market_analyzer.py
```

## Analysis Methodology

Markets are scored on four dimensions (0-25 points each, max 100):

1. **Extreme Probability Bias** - Markets at price extremes often overprice certainty
2. **Spread Opportunity** - Wide bid-ask spreads indicate pricing uncertainty
3. **Liquidity Score** - Low volume markets may have stale/inefficient pricing
4. **Time Pressure** - Markets near expiry may have mispriced time value

## Current Top Opportunities (Dec 28, 2025)

| Rank | Market | Direction | Reasoning |
|------|--------|-----------|-----------|
| 1 | AFC Super Bowl Contenders | YES | Playoff teams at 1-8 cents underpriced |
| 2 | Chicago Bears Super Bowl | YES | #2 NFC seed at only 11 cents |
| 3 | BTC $150K by Dec 31 | NO | 72% move needed in 3 days |
| 4 | NFC vs AFC spread | LONG AFC | 15 cent spread may be excessive |
| 5 | S&P 500 7,000+ | YES | Only 1% away with momentum |

## Data Sources

- [Kalshi API](https://docs.kalshi.com/)
- [Robinhood Prediction Markets](https://robinhood.com/us/en/prediction-markets/)
- [Polymarket](https://polymarket.com/)

## Disclaimer

This analysis is for **informational purposes only** and should not be considered financial advice. Prediction markets involve significant risk of loss. Past performance does not guarantee future results. Always do your own research before trading.

## License

MIT
