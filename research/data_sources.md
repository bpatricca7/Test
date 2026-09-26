# Data sources (all fetched 2026-09-26)

| File | Source | Content |
|---|---|---|
| games.csv | https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv | NFL games 1999-2026 with closing spread, total, moneylines |
| Matches.csv | https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data-2000-2025/main/data/Matches.csv | 238k club matches, Elo, form, average and best 1X2 / O-U / AH odds |
| nbaallelo.csv | https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv | NBA Elo 1946-2015 (no odds; unused) |
| vix-daily.csv | https://raw.githubusercontent.com/datasets/finance-vix/main/data/vix-daily.csv | CBOE VIX daily 1990-2026 |
| data.csv | https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv | Shiller monthly S&P 500, CAPE |
| wti-daily.csv | https://raw.githubusercontent.com/datasets/oil-prices/main/data/wti-daily.csv | WTI spot daily |
| daily.csv | https://raw.githubusercontent.com/datasets/exchange-rates/main/data/daily.csv | FRED daily FX vs USD |
| sp500-2000.csv | https://raw.githubusercontent.com/vega/vega-datasets/main/data/sp500-2000.csv | S&P 500 OHLC 2000-2020 |
| monthly.csv | https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv | Gold monthly |
| (pip) skfolio | `skfolio.datasets.load_sp500_index / load_sp500_dataset` | S&P 500 index and 20 stocks, daily 1990-2022 |
| (pip) arch | `arch.data.sp500 / nasdaq / vix / wti` | 1999-2018 OHLCV (cross-check only) |
| Kalshi | https://api.elections.kalshi.com/trade-api/v2 (`/series`, `/markets?status=settled`, candlesticks) | every settled market, fee schedules, 1-minute / hourly / daily candles |
