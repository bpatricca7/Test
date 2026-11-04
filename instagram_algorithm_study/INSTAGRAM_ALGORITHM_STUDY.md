# Instagram Reach Study (November 2026)

**Thesis:** Instagram distributes content in test-then-expand waves, so reach is a threshold game. Small, real gains in watch time and sends compound into large gains in views.

This study combines three kinds of evidence, and each finding carries a label for the kind it rests on:

| Label | Meaning |
|---|---|
| **[Instagram]** | Stated by Instagram, Meta or Adam Mosseri |
| **[Dataset]** | A large third-party study (Buffer, Metricool, Socialinsider, …), observational |
| **[Model]** | This study's simulation (`funnel_model.py`); reported only when it holds across 13 model variants |
| **[Math]** | Statistics that hold regardless of the platform (`experiment_design.py`) |

The interactive version, with charts, a simulator and a retention calculator, is `instagram_reach_study.html`.

---

## 1. Key findings, ranked by expected impact

1. **The first 3 seconds decide most of a Reel's fate.** [Dataset][Model] Socialinsider measured skip rates of 60.5–65.5% across 9.77M Reels (H1 2026). In the model, +10% watch time gives +27% typical views.
2. **Make things people send to a specific friend.** [Instagram] Mosseri named watch time, likes and sends as the top three signals. Sends matter more for reaching non-followers; likes matter more with followers.
3. **Reach is convex in quality.** [Model] +25% on all three signals gives 3.8× typical views and 4.6× the chance of a 100k post. Across 13 model variants: 2.9–7.3× typical views, 2.7–8.0× the chance of a 100k post.
4. **Originality is a hard gate.** [Instagram]
   - Accounts that repost others' content 10+ times in 30 days lose recommendations. Since April 30, 2026 this covers photos and carousels too.
   - Other apps' watermarks and low resolution reduce discoverability.
5. **Reels for reach, carousels for depth.** [Dataset]
   - Reach: Reels get 1.3–1.4× the reach of carousels and 2.3–3.1× that of images (Buffer, Metricool).
   - Engagement: carousels lead engagement per person reached (6.9% vs Reels 3.3%, Buffer 2026) and earn about 9× the saves of images (Metricool).
6. **Post often while quality holds.** [Dataset][Model]
   - Buffer (2.1M posts, compared within each account): 3–5 posts a week gives about +12% reach per post vs 1–2 a week, and roughly double the follower growth.
   - Model: with a 4% quality drop for each extra weekly post past three, the best rate is 3–4 a week.
7. **Keep your first audience matched to your content.** [Model] A 50%-matched first wave cuts typical views by 86% (1,324 to 186). Bought followers, pods and abrupt niche pivots all cause this mismatch. Test new directions as Trial Reels instead.
8. **Small accounts are not locked out.** [Instagram][Dataset] Public posts are tested on non-followers. Reach rate is 6.65% of followers for 1–5K accounts vs 3.5% for 100K–1M (Socialinsider).
9. **Hashtags are not a reach lever.** [Instagram][Dataset] Posts have been capped at 5 hashtags since December 2025. Posts with hashtags got 31.7% fewer views in Metricool's 24.4M-post study (correlational). Use keywords in the caption and on-screen text instead.
10. **Timing is weak.** [Dataset] Big studies disagree on the best hour (Buffer: Thursday 9am; Later: 5am; Metricool: 8pm).
11. **Most creator tests can't detect anything.** [Math] Detecting a real +50% lift needs about 140–380 posts per version when comparing different videos. Paired tests (the same video with two hooks) cut that by 2–4×.
12. **Judge by the median.** [Model][Math] Mean views are about 9× the median, and the top 10% of posts deliver 77% of views. 65% of Reel views arrive within 3 days (Metricool).

---

## 2. How Instagram decides [Instagram]

### Structure

- **Separate systems.** There is no single algorithm. Feed, Stories, Explore, Reels and Search each rank separately, and connected (followed) content is ranked separately from recommendations (Mosseri, *Instagram Ranking Explained*, 2023).
- **Predictions.** Each system predicts actions: watch, watch to the end, like, send, comment, follow, use the audio, swipe a carousel. It combines those predictions into a score (Meta Transparency Center system cards).
- **Test, then expand.** Posts are shown to a small group first, then expanded if they perform. Trial Reels make this explicit: they go to non-followers first and return metrics after about 24 hours (launched December 2024; open to public accounts with 1K+ followers since mid-2025).

### Signals

| Signal | Statement | Matters most for |
|---|---|---|
| Watch time | Among the "top three signals that matter most for ranking" (Jan 2025) | Reels, all audiences |
| Sends per reach | "Send rates matter more for those who don't follow you" | Non-followers (discovery) |
| Likes per reach | "Like rates matter more for your followers" | Followers |

### Gates: content that won't be recommended at all

- **Recommendations Guidelines.** Recommended content is held to a higher bar than the Community Guidelines. Ineligible content still reaches followers, and if the whole account is ineligible, none of its posts are recommended. Account Status shows whether this applies.
- **Originality.** The aggregator rule (2024; extended to photos and carousels April 30, 2026) applies to accounts that post others' content 10+ times in 30 days.
  - Borders, watermarks, speed changes, new captions or credit do not count as material edits.
  - An account becomes eligible again once most of its recent posts are original.
- **Visible quality.** Blurry or low-resolution Reels, Reels with other apps' watermarks, and mostly-text Reels are less discoverable. Your own logo is fine.
- **AI personas.** Since August 31, 2026, undisclosed AI-generated personas get limited recommendations; the "AI-generated profile" label avoids this.

### Myths Instagram has addressed

| Myth | What Instagram said |
|---|---|
| Link in bio hurts reach | False (Mosseri, July 2025). |
| Resharing to Stories boosts reach | False (April 2026). |
| Many Stories a day lowers reach | It was a bug, now fixed. |
| Shadowbanning | Denied, but recommendations can be limited (see Account Status). |

### Product context

- Reels can run up to 3 minutes (January 2025).
- Views became the main metric in August 2024.
- Skip rate and the retention chart were added to Reels Insights in 2025.
- "Your Algorithm" topic controls arrived on Reels in December 2025, later on Explore and Feed.

---

## 3. What the datasets show [Dataset]

| Topic | Finding | Source |
|---|---|---|
| Reach by format | Reels 1.36× carousels, 2.25× images | Buffer, 4M+ posts, 2022–24 |
| Reach by format | Reels +29% vs carousels, +212% vs images | Metricool, 24.4M posts, Jan–Feb 2026 |
| Engagement per reach (median) | Carousels 6.9%, images 4.4%, Reels 3.3% | Buffer 2026, 45M+ posts |
| Engagement per follower (mean) | Carousels 0.55%, Reels 0.52%, images 0.37% (2025) | Socialinsider, 67.5M posts |
| Saves | Carousels about 9× images | Metricool 2026 |
| Frequency vs reach | Reach per post vs 1–2/wk: 3–5/wk +12%, 6–9/wk +18%, 10+/wk +24% | Buffer, 2.1M posts, 102K accounts (2025) |
| Frequency vs growth | Weekly follower growth by posts/wk: 1–2: 0.12%, 3–5: 0.26%, 6–9: 0.44%, 10+: 0.66% | Buffer, same study |
| Length | Reach rate: 30–60s 5.6%, under 30s 5.2%, over 2 min 3.5% | Socialinsider, 9.77M Reels, H1 2026 |
| Skip rate | 65.5% (1–5K accounts), 60.5% (100K–1M accounts) | Socialinsider, same study |
| Watch time | Average Reel watch time about 8.5 s; 65% of Reel views arrive in the first 3 days | Metricool 2026 |
| Account size | Reels ER per follower: 0.80% (1–5K) down to 0.40% (100K+) | Socialinsider 2026 |
| Hashtags | Posts with ≥1 hashtag: −31.7% views, −33.9% interactions (correlational) | Metricool 2026 |
| Timing | Thursday 9am (Buffer, 9.6M posts) vs 5am (Later, 6M+ posts) vs 6–9pm (Metricool) | Studies disagree |
| Reach trend | Reach rate −14% year over year (Socialinsider, Aug 2026); Reels reach −35% year over year (Metricool, about 40M posts); median ER by reach 7.3% → 5.4% (Buffer) | Several |

**Caveats.**

- **Denominators differ.** Some studies divide engagement by followers (about 0.3–0.6%), others by reach (about 3–7%).
- **Means vs medians.** Some studies report means, which outliers inflate; others report medians.
- **Samples.** Every sample comes from the vendor's own customers (mostly brands), and every study is observational.
- **Verification.** This environment's network policy blocked opening several publisher pages in full. Figures come from the publishers' pages as surfaced by search, and key ones were cross-checked against independent coverage. Re-check exact decimals before quoting them in public.

---

## 4. The reach model [Model]

`funnel_model.py` simulates test-then-expand distribution:

- **First wave.** Size = 6% of followers + a 250-person non-follower test batch.
- **Scoring.** Each wave measures watch time, sends and likes, with binomial and normal sampling noise. The score is a weighted ratio against the pool average, with weights 0.45/0.35/0.20 following Mosseri's order.
- **Promotion.** A post that passes the bar moves to a wave 3.5× larger. The bar rises 0.06 per wave, and audience match decays 14% per wave.
- **Failure.** A post that fails is throttled part-way through that wave.
- **Variation.** Post-to-post quality varies lognormally (σ = 0.30).
- **Calibration.** The constants are assumptions, chosen so that a 5K-follower creator gets a median of about 1,200 views and a 1.6% chance of a 100k post.

**Baseline creator, 5,000 followers**

| Measure | Value |
|---|---|
| Median views | 1,202 |
| Typical (geometric mean) | 1,324 |
| Mean views | 10,400 |
| Share of views from the top 10% of posts | 77% |
| Posts over 10k views | 15.3% |
| Posts over 100k views | 1.6% |

**Single-lever sensitivity** (typical-views multiplier)

| Lever | +10% | +25% | +50% |
|---|---:|---:|---:|
| Watch time | 1.27× | 1.82× | 3.29× |
| Sends per reach | 1.21× | 1.62× | 2.62× |
| Likes per reach | 1.11× | 1.30× | 1.70× |
| All three | 1.71× | 3.80× | 12.6× |

**Robustness.** For +25% on all three signals, typical views rise by:

- 3.68–3.83× across five weightings: Mosseri order, watch-heavy, equal, sends-heavy, likes-heavy.
- 2.87–7.27× across eight sets of platform constants: wave size 2.5×/5×, cooling 0.80/0.93, a flat or steep bar, and a 1,000-person test batch.

The ranking of single levers follows the assumed weights, so it is illustrative. The convexity holds in every variant.

**First-audience match** (typical views): 50% → 186, 70% → 436, 90% → 991, 100% → 1,324.

**Volume** (chance of at least one 100k post in 30 days, by posts per week)

| Posts per week | 1 | 3 | 5 | 7 | 10 | 14 |
|---|---:|---:|---:|---:|---:|---:|
| Quality holds | 6.6% | 18.4% | 28.8% | 37.9% | 49.3% | 61.4% |
| Quality drops 4% per extra post past 3/wk | 6.6% | 18.4% | 14.8% | 10.3% | 2.5% | 0% |

**Measurement trap.** Rank correlation with views:

| Measure | Rank correlation |
|---|---:|
| True quality | 0.84 |
| Realised sends per reach | 0.69 |
| Average share watched | 0.61 |
| Likes per reach | 0.49 |

Posts that travel far are measured on colder audiences, so the rates in Insights understate how much quality matters. Sends per reach is the most faithful visible proxy.

---

## 5. Watch-time math [Model]

**The retention model.** Retention falls from 1 to *h* over the first 3 s (*h* = 1 − skip rate). After that, R(t) = h·e^(−(t−3)/τ), and the half-life is τ·ln 2.

- **The hook scales everything.** Average watch time is proportional to *h* at every length. Going from a 62% to a 50% skip rate means +32% watch time.
- **Best length scales with your half-life.** If ranking rewards both watch time and completion, the best length is about 1–2.75 retention half-lives after the hook, under three different ways of combining them:
  - √(seconds × completion): 1.0 half-lives
  - seconds × share watched: 1.81 half-lives
  - seconds × √(share watched): 2.75 half-lives

---

## 6. Testing that works [Math]

**Sample size.** Posts per version needed to detect a lift in typical views, comparing different videos (two-sided α = 0.05, power 0.80, t-test on log views):

| Lift | sd 0.8 | sd 1.2 | sd 1.6 | sd 2.0 |
|---|---:|---:|---:|---:|
| +25% | 202 | 454 | 808 | 1,262 |
| +50% | 62 | 138 | 245 | 382 |
| +100% | 21 | 48 | 84 | 131 |
| +200% | 9 | 19 | 34 | 53 |

**Paired designs.** Testing the same video in two versions needs a fraction (1 − ρ) of the posts, where ρ is the correlation between the two versions' log views. In the model ρ ≈ 0.77.

**Simulated test.** A better hook (+15% watch time, a true +44% in typical views) is detected:

| Posts per version | Unpaired | Paired |
|---|---:|---:|
| 20 | 10% | 19% |
| 40 | 17% | 37% |
| 80 | 20% | 64% |

**Rules.**

- **Pair tests.** Use the same video with two hooks, for example via Trial Reels, and compare Trial Reels only with other Trial Reels.
- **Test big swings.** They are the only effects one account can detect.
- **Choose with leading indicators.** Pick between versions on skip rate and sends per reach; confirm with median views over a month.
- **Write the hypothesis down first,** and decide in advance what result would change your behaviour.

---

## 7. Playbook

1. **Win the first 3 seconds.**
   - Open on the payoff or the problem; never on a logo, an intro or a greeting.
   - Show motion in frame 1, and put the promise in on-screen text of 7 words or fewer.
   - Cut dead air.
   - Track skip rate against your own median.
2. **Earn sends.**
   - Before publishing, ask *who sends this to whom?*
   - People send things that are relatable about someone they know, useful to keep, surprising, or that express their identity.
3. **Hold attention, then choose the length.**
   - Change something every 2–4 s and save the payoff for late.
   - Make the ending loop back into the start.
   - Aim for 1–2.75 retention half-lives (30–60 s is the overall sweet spot in the datasets).
4. **Stay original and clean.**
   - Post your own footage.
   - Export without other apps' watermarks, at full resolution.
   - Label AI personas.
   - Check Account Status monthly.
5. **Use each format for its job.** Reels for discovery; carousels (8 or more slides) for saves and depth; few single images.
6. **Post often while quality holds.**
   - Start at 3–5 posts a week and scale up while skip rate and sends per reach hold.
   - Never skip a whole week.
   - Use Trial Reels for extra experiments.
7. **Protect your first audience.** No bought followers or engagement, no pods. Keep a recognizable niche, and pivot via Trial Reels.
8. **Collabs.** A collab adds a second, matched first audience. Emplifi reports large lifts for small brands; the figure is confounded.
9. **Search, not hashtags.** Put keywords in the first line of the caption and in on-screen text; use at most 5 specific hashtags; ask real questions to draw comments.

### 30-day plan

| Week | Focus | What to do |
|---|---|---|
| 1 | Baseline | Run `analyze_my_account.py` on your Insights export. Record median views, skip rate, sends per reach and sd_log. |
| 2 | Hook sprint | Post 4–6 paired hook tests via Trial Reels. Keep the winning hook style. |
| 3 | Send sprint | Write a one-line "who sends this to whom" for every post. Compare median sends per reach with week 1. |
| 4 | Scale | Add 1–2 posts a week using the winning patterns. Re-run the analysis; keep what moved the median and drop what didn't. |

### Tactics that backfire

- Buying followers or engagement, engagement pods, follow-for-follow.
- Reposting others' content.
- Uploading with other apps' watermarks.
- Hashtag stuffing.
- Resharing to Stories for a boost.
- Judging a Reel within its first hour.

---

## 8. Files

- `funnel_model.py`: the reach model, sensitivity and robustness checks. Writes `results/funnel_model_results.json`.
- `experiment_design.py`: power analysis, simulated A/B tests and the retention/length model. Writes `results/experiment_design_results.json`.
- `analyze_my_account.py`: runs these statistics on your own Insights CSV export (`--demo` gives a synthetic example).
- `instagram_reach_study.html`: the interactive report.

## 9. Sources

**Instagram and Meta**

- Social Media Today, top three signals (Jan 2025): https://www.socialmediatoday.com/news/instagram-shares-algorithm-insights-2025/738034/
- Social Media Today, like vs send rates: https://www.socialmediatoday.com/news/instagram-engagement-rates-provide-insight-into-reach/821170/
- Social Media Today, Views metric (Aug 2024): https://www.socialmediatoday.com/news/instagram-updates-metrics-to-focus-creators-on-views/723645/
- Instagram Ranking Explained (2023): https://about.instagram.com/blog/announcements/instagram-ranking-explained
- Meta Transparency Center, Explaining ranking: https://transparency.meta.com/features/explaining-ranking/
- Recommendations Guidelines: https://help.instagram.com/313829416281232
- Account Status: https://help.instagram.com/539126347315373
- TechCrunch, original-creator ranking update (Apr 2024): https://techcrunch.com/2024/04/30/instagram-is-updating-its-ranking-systems-to-surface-more-content-from-smaller-original-creators
- Instagram Creators, Rewarding original creators (Apr 2026): https://creators.instagram.com/blog/rewarding-original-creators-on-instagram
- TechCrunch, aggregator crackdown (Apr 2026): https://techcrunch.com/2026/04/30/instagram-restricts-reach-of-content-aggregators-in-new-crackdown/
- 9to5Mac, Trial Reels launch: https://9to5mac.com/2024/12/10/instagrams-new-trial-reels-feature-lets-creators-test-content-with-non-followers
- Business Today, 5-hashtag cap: https://www.businesstoday.in/technology/news/story/no-more-hashtag-stuffing-instagram-limits-hashtag-usage-to-just-5-per-reel-and-post-507444-2025-12-19
- Tubefilter, watermarked Reels less discoverable: https://tubefilter.com/2021/02/10/instagram-reels-with-tiktok-watermark-less-discoverable/
- TechCrunch, undisclosed AI profiles (Aug 2026): https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/
- PetaPixel, link in bio: https://petapixel.com/2025/07/25/link-in-bio-rumor-not-true-says-instagram-chief/
- Social Media Today, Stories reshare hack: https://www.socialmediatoday.com/news/instagram-chief-debunks-popular-engagement-hack/816781/

**Datasets**

- Buffer: https://buffer.com/resources/instagram-reach-engagement-analysis/ , https://buffer.com/resources/how-often-to-post-on-instagram/ , https://buffer.com/resources/data-best-content-format-social-media/ , https://buffer.com/resources/state-of-social-media-engagement-2026/ , https://buffer.com/resources/when-is-the-best-time-to-post-on-instagram/
- Metricool: https://metricool.com/press-release-instagram-study-2026/ , https://metricool.com/instagram-research-study/ , https://metricool.com/press-release-2026-social-media-study/
- Socialinsider: https://www.socialinsider.io/social-media-benchmarks/instagram , https://www.socialinsider.io/blog/instagram-reels-statistics/ , https://www.socialinsider.io/blog/social-media-reach/ , https://www.socialinsider.io/blog/what-to-post-on-social-media/
- Later: https://later.com/blog/best-time-to-post-on-instagram/
