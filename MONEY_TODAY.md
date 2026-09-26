# Getting Money Today: What Actually Works

*Researched 2026-09-26 for a US adult. Items marked ✓ were checked against a second search; the rest come from one research pass over search results (sources cited) and should be confirmed before you rely on a specific number.*

## Bottom line

Nothing in this repo can put money in your account by itself. The prediction-market tools help you **stop losing money** and **catch rare risk-free price gaps**. Those gaps are small and usually taken by bots within seconds.

If you need cash in hand **today**, the only reliable options are the first two below.

## Ranked: cash in hand within ~24 hours

| # | Method | Realistic today? | How you get paid | Main catch |
|---|--------|------------------|------------------|------------|
| 1 | **Sell things locally** (Facebook Marketplace, OfferUp, local pickup) | Yes | Cash at the meetup; $0 platform fee for local in-person sales | Price it to move (below comparable listings); scams target sellers |
| 2 | **Plasma donation, first visit** (CSL, BioLife, Octapharma) | Yes, if you qualify | Prepaid card, same day or within 24 h | First visit takes 2–3 h; the big "up to $625–$800" offers are spread over ~8 visits in the first month |
| 3 | **Coin jar → Coinstar** | Yes | Cash voucher | Fee up to 15.9% + $0.99 for cash (most US kiosks give a 0%-fee eGift card instead) |
| 4 | **Shift apps with a fast start** (Wonolo, Veryable) | Work today, **paid tomorrow at best** | Wonolo: 1–5 business days (instant only for Gold Badge). Veryable: next day | Many jobs need a background check first |
| — | **Already a gig driver?** Cash out what you've earned | Yes | Uber Instant Pay ~$1.25 per cash-out; DoorDash Fast Pay $1.99 | Only for existing accounts that meet eligibility |

**Not realistic today for a new signup:** DoorDash, Instacart, Uber, Instawork and TaskRabbit. Each needs a background check that typically takes 3–10 business days. DoorDash Fast Pay also requires 25 deliveries and 14 days on the platform, and TaskRabbit charges a $25 non-refundable registration fee.

### Selling locally, safely
- Meet in a public place; many police stations have "safe exchange" zones.
- Take cash, or confirm a transfer **in your own bank app**. Never trust a screenshot or an email.
- Common scams: overpayment "refunds", fake Zelle "business upgrade" emails, verification-code requests, and prepaid shipping labels from the buyer.

### Plasma: what to bring
You must be 18+, at least 110 lb and healthy. First visit: photo ID, proof of Social Security number, and proof of address dated within 60 days. Posted new-donor offers: CSL up to $700–$800 in the first month; BioLife $625–$725 depending on city; Octapharma up to $750 in the first 35 days. Federal rules allow at most two donations in any 7 days.

## Prediction markets: the honest version

### Stop buying longshots
On Kalshi, cheap contracts win far less often than their price implies:
- Buyers of contracts under 10¢ lost **over 60%** of their money on average (Bürgi, Deng & Whelan, *Makers and Takers*; 2021–Apr 2025 data).
- Across 72 million Kalshi trades, 5¢ contracts won about 4.2% of the time. Every price level below 20¢ underperformed; every level above 80¢ outperformed.
- Kalshi users lost a reported **$294M net on combos/parlays** in 2026 (Bloomberg, July 2026).

This repo's earlier picks ("AFC teams at 1–8¢", "Bears at 11¢") were the losing side of this pattern. `prediction_market_analyzer.py` now flags cheap contracts as **AVOID** instead of recommending them.

### Risk-free gaps: `arbitrage_scanner.py`
It looks for sets of contracts that pay out more than they cost after fees, whatever the outcome. It reads public market data only and **never places orders**.

```bash
pip install -r requirements.txt
python arbitrage_scanner.py --closing-within-hours 12   # only markets that settle today
python arbitrage_scanner.py --fixture tests/fixtures/sample_markets.json   # offline demo, fake data
```

What to expect:
- **Most scans find nothing.** One study of NBA games on Polymarket found single-market gaps lasted a median of **3.6 seconds**, and only about $559 was extractable across 173 games.
- If it does find something, place **limit orders** at the listed prices, fill the thinnest leg first, and never leave a set half-filled. A half-filled set is a normal bet, not an arbitrage.
- "YES basket" results are only risk-free if the listed outcomes cover every possibility. Read the event rules first.

### Fees and getting paid (Kalshi vs Robinhood)

| | Kalshi direct | Robinhood |
|---|---|---|
| Trading fee | ✓ round_up(M × 0.07 × C × P × (1−P)); M is set per series (1 by default) | ✓ Commission up to 1¢/contract, plus an exchange fee of up to 1¢/contract |
| Scanner flag | *(default)* | `--extra-fee-cents 2` (conservative) |
| Settlement | Usually within ~3 h of the result | Payout available ~1 business day after settlement |
| Withdrawal | ✓ Debit card typically 1–3 h; **winnings** withdrawable right away, but deposits are subject to holds | Instant to debit for a 1.75% fee, or free ACH in 1–5 business days |

For thin, same-day gaps, **Kalshi direct is cheaper and faster**. Money you deposit today can be traded right away, but it may be held before you can withdraw it.

## Sources
- [Makers and Takers: The Economics of the Kalshi Prediction Market](https://www.karlwhelan.com/Papers/Kalshi.pdf) · [CEPR summary](https://cepr.org/voxeu/columns/economics-kalshi-prediction-market)
- [Favorite-longshot bias on Polymarket (arXiv 2609.12878)](https://arxiv.org/pdf/2609.12878) · [Systematic bias in sports prediction markets (arXiv 2607.14430)](https://arxiv.org/pdf/2607.14430)
- Kalshi: [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses) · [Get Series](https://docs.kalshi.com/api-reference/market/get-series) · [Series fee changes](https://docs.kalshi.com/api-reference/exchange/get-series-fee-changes) · [Fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf) · [Debit card withdrawals](https://help.kalshi.com/en/articles/13823802-debit-card-withdrawals) · [Transfers FAQ](https://help.kalshi.com/en/articles/13823791-transfers-faq)
- [Becker, prediction market microstructure (72M Kalshi trades, not peer-reviewed)](https://www.jbecker.dev/research/prediction-market-microstructure) · [NBA arbitrage on Polymarket (arXiv 2605.00864)](https://arxiv.org/abs/2605.00864)
- Robinhood: [Event contracts overview](https://robinhood.com/us/en/support/articles/robinhood-event-contracts/) · [Instant bank transfers](https://robinhood.com/us/en/support/articles/instant-bank-transfers/)
- Plasma: [CSL new donors](https://www.cslplasma.com/donate-in-the-united-states) · [Octapharma new donors](https://www.octapharmaplasma.com/new-donors/) · [BioLife eligibility](https://www.biolifeplasma.com/donation-process/who-can-donate) · [21 CFR 640.65 donation frequency](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-F/part-640/subpart-G/section-640.65)
- Other: [Coinstar help center](https://www.coinstar.com/helpcenter/) · [DoorDash Fast Pay](https://help.doordash.com/en-us/dashers/article/what-is-fastpay) · [TaskRabbit registration fee](https://support.taskrabbit.com/hc/en-us/articles/46260480151579-What-s-the-Registration-Fee)
- Figures gathered from search results on 2026-09-26. Check the current page before relying on an exact fee or limit.
