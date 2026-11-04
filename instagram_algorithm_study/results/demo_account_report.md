# Account report: SYNTHETIC DEMO DATA (not a real account)

## 1. Your view distribution

- Posts analysed: **150**
- Median views: **4,061** (90% CI 2,037 to 5,556)
- Typical views (geometric mean): **3,585**; arithmetic mean 32,196 (mean/median = 7.9)
- Spread of log views (sd_log): **2.21**  -> a 'normal' post can land anywhere from 394 to 32,627 views
- Your top 10% of posts produced **75%** of all your views.

Track the median and the geometric mean, not the average: one breakout post moves the average a lot and tells you little about what is working.

## 2. Format and length

| Group | Posts | Median views | 90% CI of median |
|---|---:|---:|---:|
| Carousel | 48 | 3,038 | 1,736 to 6,188 |
| Image | 19 | 433 | 182 to 665 |
| Reel | 83 | 6,027 | 4,876 to 7,377 |
| Length <10s | 3 | 422 | 160 to 8,227 |
| Length 10-20s | 27 | 6,364 | 4,904 to 12,709 |
| Length 20-35s | 26 | 6,361 | 3,998 to 26,295 |
| Length 35-60s | 23 | 6,450 | 1,897 to 9,507 |
| Length 60-90s | 4 | 1,014 | 424 to 3,306 |

Overlapping intervals mean the data cannot yet tell those groups apart.

## 3. Which signals track your views

| Signal | Rank correlation with log views | Median value |
|---|---:|---:|
| follows per reach | +0.33 | 0.001983 |
| comments per reach | +0.30 | 0.002882 |
| likes per reach | +0.20 | 0.0335 |
| shares per reach | +0.13 | 0.007606 |
| saves per reach | +0.05 | 0.009974 |

Caveat: these rates are measured on the audience each post actually reached. Posts that travel far are measured on colder audiences, which pulls their rates down, so these correlations *understate* how much the underlying behaviour matters (see the study's 'measurement trap' section). Use them to rank signals, not to size effects.

## 4. What your choices are associated with (regression on log views)

R² = 0.23. Effects are % change in typical views, holding the other rows fixed; 95% intervals use robust (HC3) standard errors.

| Factor | Effect | 95% interval | Evidence |
|---|---:|---:|---|
| format: Carousel (vs Reel) | -46% | -75% to +15% | not distinguishable from zero |
| format: Image (vs Reel) | -93% | -96% to -85% | clear |
| hashtags: +1 | +11% | -12% to +40% | not distinguishable from zero |
| caption: +50 words | +27% | -21% to +106% | not distinguishable from zero |
| gap since previous post: +1 day | +24% | -20% to +93% | not distinguishable from zero |
| trend: per 10 posts | +12% | +3% to +22% | clear |
| posted 17:00-22:59 (vs other hours) | +107% | -11% to +384% | not distinguishable from zero |

This is observational: you chose when and what to post, so these are associations. Confirm anything important with a deliberate test (section 5).

## 5. How many posts you need to test something

Using your own sd_log = 2.21 (two-sided, 5% false-positive rate, 80% power):

| Lift you want to detect | Posts per variant (A vs B) | Pairs if same content, two versions (corr 0.7) |
|---|---:|---:|
| +25% | 1538 | 462 |
| +50% | 466 | 140 |
| +100% | 160 | 49 |
| +200% | 64 | 20 |

If those numbers are bigger than you can post in a month, test big swings (new hook style, new format), use paired tests (same video, two hooks, via Trial Reels), and judge by the median over many posts, never one post.
