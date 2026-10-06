# StreamZW — Product vision

> Draft for discussion. Market claims marked _(verify)_ are working assumptions, not researched facts — validate them before they drive roadmap or pricing decisions.

## One line

**The place Zimbabwean creators get paid for video — in the money people actually hold, on the phones and data bundles people actually have.**

## The problem we are solving

Zimbabwe has no shortage of video talent: comedy skits, gospel, sungura and Zimdancehall, church services, farming and how-to content, local drama, school revision lessons, sports. Almost all of it lives on YouTube, Facebook, TikTok and WhatsApp statuses, and almost none of it earns its makers money:

1. **Global platforms don't pay here.** YouTube Partner Program and Facebook monetisation are limited or unavailable for Zimbabwe-based creators _(verify current eligibility)_, and ad CPMs for Zimbabwean audiences are low even where they are. Creators chase foreign audiences or sponsorship instead of serving their own.
2. **Viewers can't pay the way global platforms expect.** Few people hold international cards. People pay with **EcoCash**, bank transfers (ZIPIT), and cash — in **USD** and **ZiG (ZWG)**, often both in the same week.
3. **Data is the real price of video.** Mobile data is expensive relative to income _(verify)_, so viewers ration it: they download on Wi‑Fi or night bundles and watch later, and they share files over WhatsApp. A platform that only streams at full quality loses them.
4. **Creators are already monetising informally** — selling content in WhatsApp groups, taking EcoCash "subscriptions" by hand, charging at the door for events. It works, but it doesn't scale, offers no protection against piracy, and gives creators no reporting.

## Who we serve

| Persona                     | Who they are                                                                    | What they need from us                                                              |
| --------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **The local creator**       | Comedian, musician, pastor, teacher, filmmaker with a following on social media | Get paid in USD to their EcoCash wallet, fast, with numbers they trust              |
| **The everyday viewer**     | Android phone, prepaid data, EcoCash wallet, mostly USD + some ZiG              | Cheap, small unlocks; content that plays on a weak connection and can be downloaded |
| **The diaspora viewer**     | Zimbabweans in South Africa, the UK and elsewhere _(verify segment sizes)_      | Pay in ZAR/GBP by card; support creators back home; watch content they miss         |
| **The institution** (later) | Churches, schools, tutoring centres, sports clubs                               | Put their content behind a paywall or a members-only subscription                   |

The diaspora is strategically important: they have higher purchasing power and card access, and they pay in hard currency. They are why ZAR is first-class in v1 and why Paystack is in the stack.

## Product principles

1. **Micro by default.** Prices start at 10¢. A day pass costs $0.99. The unit of purchase is one video or one day, never a big commitment. That matches how people already buy airtime and data.
2. **Pay the way you already pay.** EcoCash is the primary checkout, not a bolt-on. One phone number is your account, your login, and your wallet. No email, no password, no card required.
3. **Creators get paid, provably.** Every cent goes through a double-entry ledger. Creators see exactly what each video earned, in USD, and can cash out to EcoCash once they pass a low threshold ($5). Trust in getting paid is the whole product for creators — a single missed or wrong payout costs more than any feature gains.
4. **Respect the bundle.** 240p is a first-class quality, not a fallback. Downloads for offline viewing are in v1. The app should tell the viewer how much data a video will cost before they press play.
5. **USD in the books, local currency at the edges.** The economy is dollarised but ZiG is real, and its rate moves. We account in USD, snapshot every FX rate we use, and never let currency volatility silently eat a creator's earnings.
6. **WhatsApp is the distribution channel.** OTPs arrive on WhatsApp. Video links are designed to be shared into WhatsApp groups and render well there. Growth comes from creators pushing their own audiences to us.

## How it makes money

| Stream              | Split                                                        | Why this shape                                            |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Pay-per-view        | 70% creator / 30% platform, instantly on payment             | Simple to explain; creators see money the same day        |
| Subscriptions       | 55% to a premium pool shared by watch-minutes / 45% platform | Rewards creators whose content keeps subscribers watching |
| Tips on free videos | 90% creator / 10% platform                                   | Lets free content earn without a paywall                  |

The platform's 45% subscription share and 30% PPV share have to cover bandwidth (BunnyCDN), transcoding, payment fees (EcoCash merchant fees, the 2% IMTT on electronic transfers _(verify current rate)_), SMS/WhatsApp OTP costs, and margin. **Bandwidth is the biggest variable cost.** That is a second reason to push 240p/480p defaults and offline downloads: they are good for viewers and for unit economics.

## Why we can win

- **Local payments done properly.** EcoCash USD and ZWG as separate rails, ZIPIT, and Paystack for diaspora cards, all on one ledger. Global platforms will not build this for a market our size.
- **Pricing that fits local incomes.** A 10¢–$2 PPV range and a 99¢ day pass are priced for here, not converted from a US price list.
- **Built for bad networks.** Low-bitrate renditions, offline downloads, small app size.
- **Creators keep their audience relationship.** We make it easy to sell to fans they already have on WhatsApp and Facebook, instead of competing with them for attention in an algorithmic feed.

## What could kill it — and what we do about it

| Risk                                                                                         | Mitigation                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Creators don't trust they'll be paid**                                                     | Ledger-backed earnings, same-day PPV credit, low payout thresholds, payout history visible in the studio. Never ship a money bug.                           |
| **Piracy** — paid videos re-shared on WhatsApp                                               | Signed, short-lived HLS URLs now; watermarking with the buyer's number later. Keep prices low enough that buying is easier than hunting for a pirated copy. |
| **Currency and regulatory shifts** (ZiG rate moves, RBZ rules, forex surrender requirements) | USD canonical accounting, per-currency feature flags, FX snapshotted on every record, admin rate override. Get local legal and tax advice before launch.    |
| **EcoCash dependency** (outages, fee changes, merchant terms)                                | ZIPIT and Paystack as alternate rails from day one; reconcile every payment against provider state.                                                         |
| **Bandwidth costs outrun revenue**                                                           | Default to low renditions, cache aggressively at the CDN, and track cost per watched minute from week one.                                                  |
| **Cold start** — viewers need content, creators need viewers                                 | Launch with a hand-picked cohort of 20–50 creators who already have audiences and already sell informally. Their fans come with them.                       |

## Go-to-market (first 6 months)

1. **Seed creators, not viewers.** Recruit a launch cohort across comedy, music, faith and education. Onboard them personally. Guarantee fast payouts.
2. **Launch PPV + tips first.** These are the easiest to explain ("pay 50¢, watch this") and pay creators immediately. Subscriptions follow once there is enough premium content to make a pass worth buying.
3. **Ride creator audiences.** Every creator gets shareable links and WhatsApp-ready previews. The creator's existing WhatsApp group is the first marketing channel.
4. **Reach the diaspora.** Paystack card checkout and ZAR/GBP pricing, marketed through diaspora community groups.
5. **Android first, web always.** Flutter Android app for offline downloads; the web app for everyone else and for diaspora desktop viewing.

## What success looks like

Measure what proves the core loop — viewers pay, creators earn, creators stay:

- **Creator earnings paid out per month (USD)** — the north-star metric.
- Number of creators earning more than $50/month.
- Paid conversion: share of viewers who make at least one payment.
- Payment success rate per rail (EcoCash USD, EcoCash ZWG, ZIPIT, Paystack).
- Time from payment to creator balance credit (target: under a minute for PPV).
- Bandwidth cost per paid watch-minute.
- Zero ledger discrepancies in the monthly reconciliation.

## Out of scope for now

Live streaming, ads, comments/social features, recommendations ML, iOS. See CLAUDE.md §12. Each is a reasonable phase-2 conversation once the payments loop is proven. Live streaming (church services, events, sports) is the most likely next big bet.

## What this means for the codebase right now

The vision depends on one thing above all: **creators must be able to trust the money.** That makes the payment, ledger, payout and access paths the highest-priority engineering work — ahead of new features. The current fix list in [REVIEW.md](./REVIEW.md) is ordered with that in mind.
