"""Cost and resale assumptions for kits sold as packs of parts (USD).

One place for every number the READMEs and the collection table use, so all
kits are priced the same way. Change a value here and rebuild the READMEs
(``kit_readme.py``) and the collection table (``collection_report.py``).

Sources and dates (checked October 2026 from the build environment, which
could not reach lego.com, BrickLink or Rebrickable):
  - Parts: the last Pick a Brick prices in the offline data, from LEGO's 2022
    Bestseller list and a late-2025 listing. Not current prices.
  - 2026 repricing: on September 14, 2026 about a third of Pick a Brick
    elements went up, by 16.7% on average (median 15.4%); tiles and small
    parts were hit hardest (StoneWars, Brick Fanatics).
  - Etsy (US): $0.20 listing, 6.5% transaction fee on item price plus
    shipping, 3% + $0.25 payment processing (2026 fee guides; confirm on
    Etsy's own fee page).
  - USPS Ground Advantage retail from October 4, 2026: $10.05 (1 lb) and
    $11.30 (2 lb) in Zone 1; commercial label prices are lower, far zones
    are about $3-4 higher (Pitney Bowes, ShipStation summaries).
"""
import math

PRICE_DATA = ("Pick a Brick prices last seen in LEGO's 2022 Bestseller list and a late-2025 "
              "listing (offline data; lego.com could not be reached to check current prices)")
REPRICE = 0.10            # base case: 2026 prices about 10% above the data
REPRICE_HIGH = 0.20       # stress case for tile- and small-part-heavy kits
PACKAGING = 3.00          # box, 4-6 bags, card with a link/QR code to the PDF, tape, label
PRINTED_BOOKLET = 4.00    # option: colour print of the PDF booklet (not in the base case)
LABOR_RATE = 15.00        # USD per hour for counting, bagging and packing
SECONDS_PER_PIECE = 3.0   # counting and bagging from sorted stock
PACK_MINUTES = 6.0        # box, card, label, per kit
SHIP_SELLER_PAID = 10.50  # 1-2 lb box, USPS Ground Advantage label, rough US average
ETSY_LISTING, ETSY_TXN, ETSY_PROC, ETSY_PROC_FIXED = 0.20, 0.065, 0.03, 0.25
PRICE_MULTIPLES = (1.6, 2.0, 2.5)   # resale price as a multiple of 2026 parts cost

ASSUMPTIONS = [
    ("Parts, as listed", PRICE_DATA),
    ("Parts, 2026 estimate", f"+{REPRICE:.0%} on the listed prices (stress case +{REPRICE_HIGH:.0%}); "
     "LEGO's September 14, 2026 repricing raised about a third of Pick a Brick elements by 16.7% on "
     "average, hitting tiles and small parts hardest"),
    ("Packaging", f"${PACKAGING:.2f} per kit: box, bags, a card with a link or QR code to the PDF "
     f"booklet, tape and label (a printed colour booklet adds about ${PRINTED_BOOKLET:.2f})"),
    ("Labour", f"${LABOR_RATE:.2f}/hour; {SECONDS_PER_PIECE:.0f} s per piece to count and bag from "
     f"sorted stock, plus {PACK_MINUTES:.0f} min to pack"),
    ("Etsy fees (US)", f"${ETSY_LISTING:.2f} listing + {ETSY_TXN:.1%} transaction + {ETSY_PROC:.0%} "
     f"+ ${ETSY_PROC_FIXED:.2f} processing, on the price the buyer pays"),
    ("Shipping", f"seller-paid (free shipping) ${SHIP_SELLER_PAID:.2f} for a 1-2 lb box by USPS "
     "Ground Advantage; or the buyer pays postage"),
    ("Prices", " / ".join(f"{m:g}x" for m in PRICE_MULTIPLES) + " the 2026 parts estimate, "
     "rounded up to $x9.99; market prices for custom kits were not researched for each resort"),
]


def labour(pieces):
    return LABOR_RATE * (pieces * SECONDS_PER_PIECE / 3600 + PACK_MINUTES / 60)


def etsy_fees(price, shipping_charged=0.0):
    total = price + shipping_charged
    return ETSY_LISTING + (ETSY_TXN + ETSY_PROC) * total + ETSY_PROC_FIXED


def round_price(x):
    """Round up to the next $x9.99."""
    return math.ceil((x + 0.01) / 10) * 10 - 0.01


def unit_costs(parts_cost, pieces, reprice=REPRICE):
    parts = parts_cost * (1 + reprice)
    return dict(parts=parts, packaging=PACKAGING, labour=labour(pieces),
                before_shipping=parts + PACKAGING + labour(pieces))


def scenario(parts_cost, pieces, price, seller_ship=True, reprice=REPRICE):
    c = unit_costs(parts_cost, pieces, reprice)
    if seller_ship:
        fees = etsy_fees(price)
        cost = c["before_shipping"] + SHIP_SELLER_PAID
    else:   # buyer pays postage on top; Etsy also takes its share of that
        fees = etsy_fees(price, SHIP_SELLER_PAID)
        cost = c["before_shipping"]
    profit = price - fees - cost
    return dict(price=price, fees=fees, cost=cost, profit=profit, margin=profit / price)


def price_points(parts_cost):
    base = parts_cost * (1 + REPRICE)
    return [round_price(base * m) for m in PRICE_MULTIPLES]


def break_even(parts_cost, pieces, seller_ship=True, reprice=REPRICE):
    c = unit_costs(parts_cost, pieces, reprice)["before_shipping"]
    ship = SHIP_SELLER_PAID if seller_ship else 0.0
    fixed = c + ship + ETSY_LISTING + ETSY_PROC_FIXED
    extra = 0.0 if seller_ship else (ETSY_TXN + ETSY_PROC) * SHIP_SELLER_PAID
    return (fixed + extra) / (1 - ETSY_TXN - ETSY_PROC)
