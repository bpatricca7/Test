#!/usr/bin/env python3
"""
Robinhood/Kalshi Prediction Markets Analyzer
============================================
This script fetches prediction market data from Kalshi's public API
(which powers Robinhood's prediction markets) and identifies potentially
undervalued predictions using various analytical methods.

Author: Claude
Date: 2025-12-28
"""

import requests
import json
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
import time


# Kalshi API base URL (provides data for Robinhood prediction markets)
BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"


@dataclass
class Market:
    """Represents a prediction market."""
    ticker: str
    title: str
    subtitle: str
    category: str
    yes_price: float  # Price in cents (0-100)
    no_price: float
    yes_bid: float
    yes_ask: float
    volume: int
    volume_24h: int
    open_interest: int
    close_time: Optional[datetime]
    status: str
    result: Optional[str]

    @property
    def implied_probability(self) -> float:
        """Convert yes price to implied probability."""
        return self.yes_price / 100

    @property
    def spread(self) -> float:
        """Calculate bid-ask spread."""
        return self.yes_ask - self.yes_bid

    @property
    def spread_percentage(self) -> float:
        """Spread as percentage of mid price."""
        mid = (self.yes_ask + self.yes_bid) / 2
        if mid == 0:
            return 0
        return (self.spread / mid) * 100


class KalshiClient:
    """Client for Kalshi's public API endpoints."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Accept': 'application/json',
            'User-Agent': 'PredictionMarketAnalyzer/1.0'
        })

    def get_markets(self, limit: int = 200, cursor: str = None,
                    status: str = "open", series_ticker: str = None) -> dict:
        """Fetch markets from Kalshi API."""
        params = {
            'limit': limit,
            'status': status
        }
        if cursor:
            params['cursor'] = cursor
        if series_ticker:
            params['series_ticker'] = series_ticker

        response = self.session.get(f"{BASE_URL}/markets", params=params)
        response.raise_for_status()
        return response.json()

    def get_all_open_markets(self, max_markets: int = 1000) -> list[dict]:
        """Fetch all open markets with pagination."""
        all_markets = []
        cursor = None

        while len(all_markets) < max_markets:
            data = self.get_markets(limit=200, cursor=cursor, status="open")
            markets = data.get('markets', [])

            if not markets:
                break

            all_markets.extend(markets)
            cursor = data.get('cursor')

            if not cursor:
                break

            # Rate limiting
            time.sleep(0.2)

        return all_markets[:max_markets]

    def get_market_orderbook(self, ticker: str) -> dict:
        """Get orderbook for a specific market."""
        response = self.session.get(f"{BASE_URL}/markets/{ticker}/orderbook")
        response.raise_for_status()
        return response.json()

    def get_series(self, series_ticker: str) -> dict:
        """Get series information."""
        response = self.session.get(f"{BASE_URL}/series/{series_ticker}")
        response.raise_for_status()
        return response.json()


def parse_market(raw: dict) -> Market:
    """Parse raw API response into Market object."""
    close_time = None
    if raw.get('close_time'):
        try:
            close_time = datetime.fromisoformat(raw['close_time'].replace('Z', '+00:00'))
        except:
            pass

    return Market(
        ticker=raw.get('ticker', ''),
        title=raw.get('title', ''),
        subtitle=raw.get('subtitle', ''),
        category=raw.get('category', ''),
        yes_price=raw.get('yes_bid', 0) or 0,
        no_price=raw.get('no_bid', 0) or 0,
        yes_bid=raw.get('yes_bid', 0) or 0,
        yes_ask=raw.get('yes_ask', 0) or 0,
        volume=raw.get('volume', 0) or 0,
        volume_24h=raw.get('volume_24h', 0) or 0,
        open_interest=raw.get('open_interest', 0) or 0,
        close_time=close_time,
        status=raw.get('status', ''),
        result=raw.get('result')
    )


class UndervaluedAnalyzer:
    """
    Analyzes prediction markets to find potentially undervalued predictions.

    Methodology:
    1. Liquidity Score - Markets with high volume and tight spreads are more efficient
    2. Extreme Probability Bias - Markets at extreme prices (>90% or <10%) often overvalue certainty
    3. Time Value Analysis - Markets close to expiry may have mispriced time decay
    4. Contrarian Opportunities - Low-volume markets may have stale prices
    5. Spread Arbitrage - Wide spreads indicate pricing uncertainty
    """

    def __init__(self, markets: list[Market]):
        self.markets = markets
        self.analyzed = []

    def calculate_value_score(self, market: Market) -> dict:
        """
        Calculate a composite value score for a market.
        Higher scores indicate potentially more undervalued opportunities.
        """
        scores = {}

        # 1. Extreme Probability Bias Score (0-25 points)
        # Markets at extremes often overprice certainty
        prob = market.implied_probability
        if prob <= 0.05 or prob >= 0.95:
            # Very extreme - potential value in betting against certainty
            scores['extreme_bias'] = 25
            scores['extreme_bias_note'] = "Very extreme probability - market may be overconfident"
        elif prob <= 0.15 or prob >= 0.85:
            scores['extreme_bias'] = 15
            scores['extreme_bias_note'] = "Extreme probability - some certainty premium likely"
        elif prob <= 0.25 or prob >= 0.75:
            scores['extreme_bias'] = 5
            scores['extreme_bias_note'] = "Moderate probability skew"
        else:
            scores['extreme_bias'] = 0
            scores['extreme_bias_note'] = "Balanced probability"

        # 2. Spread Opportunity Score (0-25 points)
        # Wide spreads mean pricing uncertainty
        spread_pct = market.spread_percentage
        if spread_pct >= 20:
            scores['spread_opportunity'] = 25
            scores['spread_note'] = f"Very wide spread ({spread_pct:.1f}%) - significant pricing uncertainty"
        elif spread_pct >= 10:
            scores['spread_opportunity'] = 15
            scores['spread_note'] = f"Wide spread ({spread_pct:.1f}%) - some pricing uncertainty"
        elif spread_pct >= 5:
            scores['spread_opportunity'] = 8
            scores['spread_note'] = f"Moderate spread ({spread_pct:.1f}%)"
        else:
            scores['spread_opportunity'] = 0
            scores['spread_note'] = f"Tight spread ({spread_pct:.1f}%) - efficient pricing"

        # 3. Volume/Liquidity Score (0-25 points)
        # Low volume markets may have stale or inefficient pricing
        if market.volume_24h == 0:
            scores['liquidity'] = 25
            scores['liquidity_note'] = "No 24h volume - potentially stale pricing"
        elif market.volume_24h < 100:
            scores['liquidity'] = 20
            scores['liquidity_note'] = "Very low volume - inefficient market"
        elif market.volume_24h < 1000:
            scores['liquidity'] = 10
            scores['liquidity_note'] = "Low volume - some inefficiency possible"
        elif market.volume_24h < 10000:
            scores['liquidity'] = 5
            scores['liquidity_note'] = "Moderate volume"
        else:
            scores['liquidity'] = 0
            scores['liquidity_note'] = "High volume - efficient market"

        # 4. Time Pressure Score (0-25 points)
        # Markets close to expiry may have mispriced time value
        if market.close_time:
            now = datetime.now(timezone.utc)
            time_left = (market.close_time - now).total_seconds()
            hours_left = time_left / 3600

            if hours_left < 0:
                scores['time_pressure'] = 0
                scores['time_note'] = "Market expired"
            elif hours_left < 24:
                scores['time_pressure'] = 20
                scores['time_note'] = f"Expires in {hours_left:.1f} hours - high time pressure"
            elif hours_left < 72:
                scores['time_pressure'] = 15
                scores['time_note'] = f"Expires in {hours_left/24:.1f} days - moderate time pressure"
            elif hours_left < 168:
                scores['time_pressure'] = 10
                scores['time_note'] = f"Expires in {hours_left/24:.1f} days"
            else:
                scores['time_pressure'] = 5
                scores['time_note'] = f"Expires in {hours_left/24:.1f} days - long time horizon"
        else:
            scores['time_pressure'] = 5
            scores['time_note'] = "No expiration date available"

        # Calculate total score
        total_score = sum([
            scores['extreme_bias'],
            scores['spread_opportunity'],
            scores['liquidity'],
            scores['time_pressure']
        ])

        return {
            'market': market,
            'total_score': total_score,
            'scores': scores,
            'recommendation': self._get_recommendation(market, scores, total_score)
        }

    def _get_recommendation(self, market: Market, scores: dict, total_score: int) -> str:
        """Generate trading recommendation based on analysis."""
        prob = market.implied_probability

        if total_score >= 60:
            strength = "STRONG"
        elif total_score >= 40:
            strength = "MODERATE"
        elif total_score >= 25:
            strength = "WEAK"
        else:
            return "HOLD - Market appears efficiently priced"

        # Determine direction based on extreme bias
        if prob >= 0.85:
            direction = "Consider NO position - high certainty may be overpriced"
        elif prob <= 0.15:
            direction = "Consider YES position - market may be overly pessimistic"
        else:
            direction = "Analyze fundamentals to determine direction"

        return f"{strength} OPPORTUNITY - {direction}"

    def analyze_all(self) -> list[dict]:
        """Analyze all markets and return sorted by value score."""
        self.analyzed = [self.calculate_value_score(m) for m in self.markets]
        self.analyzed.sort(key=lambda x: x['total_score'], reverse=True)
        return self.analyzed

    def get_top_opportunities(self, n: int = 20) -> list[dict]:
        """Get top N undervalued opportunities."""
        if not self.analyzed:
            self.analyze_all()
        return self.analyzed[:n]

    def filter_by_category(self, category: str) -> list[dict]:
        """Filter opportunities by category."""
        if not self.analyzed:
            self.analyze_all()
        return [a for a in self.analyzed if category.lower() in a['market'].category.lower()]


def format_market_analysis(analysis: dict) -> str:
    """Format a single market analysis for display."""
    market = analysis['market']
    scores = analysis['scores']

    lines = [
        f"\n{'='*80}",
        f"TICKER: {market.ticker}",
        f"TITLE: {market.title}",
        f"{'='*80}",
        f"",
        f"MARKET DATA:",
        f"  Current YES Price: {market.yes_price}¢ (Implied Prob: {market.implied_probability*100:.1f}%)",
        f"  Bid/Ask: {market.yes_bid}¢ / {market.yes_ask}¢ (Spread: {market.spread}¢)",
        f"  24h Volume: {market.volume_24h:,} contracts",
        f"  Open Interest: {market.open_interest:,}",
        f"  Category: {market.category}",
    ]

    if market.close_time:
        lines.append(f"  Closes: {market.close_time.strftime('%Y-%m-%d %H:%M UTC')}")

    lines.extend([
        f"",
        f"VALUE ANALYSIS (Total Score: {analysis['total_score']}/100):",
        f"  Extreme Bias:    {scores['extreme_bias']:2}/25 - {scores['extreme_bias_note']}",
        f"  Spread Value:    {scores['spread_opportunity']:2}/25 - {scores['spread_note']}",
        f"  Liquidity:       {scores['liquidity']:2}/25 - {scores['liquidity_note']}",
        f"  Time Pressure:   {scores['time_pressure']:2}/25 - {scores['time_note']}",
        f"",
        f"RECOMMENDATION: {analysis['recommendation']}",
    ])

    return '\n'.join(lines)


def main():
    """Main function to run the prediction market analysis."""
    print("=" * 80)
    print("ROBINHOOD/KALSHI PREDICTION MARKETS ANALYZER")
    print("Finding Undervalued Predictions")
    print("=" * 80)
    print()
    print("Fetching market data from Kalshi API...")
    print("(Kalshi powers Robinhood's prediction markets)")
    print()

    try:
        # Initialize client and fetch markets
        client = KalshiClient()
        raw_markets = client.get_all_open_markets(max_markets=500)

        print(f"Successfully fetched {len(raw_markets)} open markets")
        print()

        # Parse markets
        markets = [parse_market(m) for m in raw_markets]

        # Filter out markets with no pricing data
        markets = [m for m in markets if m.yes_bid > 0 or m.yes_ask > 0]

        print(f"Analyzing {len(markets)} markets with active pricing...")
        print()

        # Run analysis
        analyzer = UndervaluedAnalyzer(markets)
        opportunities = analyzer.get_top_opportunities(n=25)

        # Display results
        print("\n" + "=" * 80)
        print("TOP 25 POTENTIALLY UNDERVALUED PREDICTIONS")
        print("=" * 80)

        for i, analysis in enumerate(opportunities, 1):
            print(f"\n#{i}", end="")
            print(format_market_analysis(analysis))

        # Summary by category
        print("\n" + "=" * 80)
        print("OPPORTUNITIES BY CATEGORY")
        print("=" * 80)

        categories = {}
        for analysis in analyzer.analyzed:
            cat = analysis['market'].category or 'Unknown'
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(analysis)

        for cat, analyses in sorted(categories.items(), key=lambda x: -len(x[1])):
            top_score = max(a['total_score'] for a in analyses)
            high_value = len([a for a in analyses if a['total_score'] >= 40])
            print(f"  {cat}: {len(analyses)} markets, {high_value} high-value opportunities (top score: {top_score})")

        # Statistical summary
        print("\n" + "=" * 80)
        print("SUMMARY STATISTICS")
        print("=" * 80)

        all_scores = [a['total_score'] for a in analyzer.analyzed]
        high_value = [a for a in analyzer.analyzed if a['total_score'] >= 40]
        extreme_value = [a for a in analyzer.analyzed if a['total_score'] >= 60]

        print(f"  Total Markets Analyzed: {len(analyzer.analyzed)}")
        print(f"  Average Value Score: {sum(all_scores)/len(all_scores):.1f}")
        print(f"  High Value Opportunities (score >= 40): {len(high_value)}")
        print(f"  Extreme Value Opportunities (score >= 60): {len(extreme_value)}")

        # Save detailed results to JSON
        output_data = {
            'analysis_date': datetime.now(timezone.utc).isoformat(),
            'total_markets_analyzed': len(analyzer.analyzed),
            'top_opportunities': [
                {
                    'rank': i + 1,
                    'ticker': a['market'].ticker,
                    'title': a['market'].title,
                    'category': a['market'].category,
                    'yes_price': a['market'].yes_price,
                    'implied_probability': a['market'].implied_probability,
                    'volume_24h': a['market'].volume_24h,
                    'total_score': a['total_score'],
                    'recommendation': a['recommendation'],
                    'score_breakdown': {
                        'extreme_bias': a['scores']['extreme_bias'],
                        'spread_opportunity': a['scores']['spread_opportunity'],
                        'liquidity': a['scores']['liquidity'],
                        'time_pressure': a['scores']['time_pressure']
                    }
                }
                for i, a in enumerate(opportunities)
            ]
        }

        with open('undervalued_predictions.json', 'w') as f:
            json.dump(output_data, f, indent=2, default=str)

        print(f"\n  Detailed results saved to: undervalued_predictions.json")
        print("\n" + "=" * 80)
        print("DISCLAIMER")
        print("=" * 80)
        print("""
This analysis is for informational purposes only and should not be considered
financial advice. Prediction markets involve risk and you could lose money.
Always do your own research before trading. Past performance does not guarantee
future results. The 'undervalued' designation is based on quantitative metrics
and does not account for fundamental factors that may justify current pricing.
        """)

        return output_data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}")
        print("\nNote: The Kalshi API may have rate limits or require authentication")
        print("for certain endpoints. Try again in a few minutes.")
        return None


if __name__ == "__main__":
    main()
