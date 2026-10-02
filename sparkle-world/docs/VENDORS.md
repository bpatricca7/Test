# Sparkle World: vendors

*The companies that help run Sparkle World with family accounts, what each one receives, and
where its data processing terms are. Part of the security program
([SECURITY-PROGRAM.md](SECURITY-PROGRAM.md) §8). Review this page once a year: check each
company's current terms and security page (links move; follow the path given), and that the
settings below are still set. Before adding a vendor, update this page, [DATA-MAP.md](DATA-MAP.md),
the Privacy Notice and the direct notice first.*

Children's information goes to **Railway only** (as our host). Stripe and the email provider never
receive it: that is a rule of the code (docs/ACCOUNTS.md §10, §6.2) and is tested.

## Railway (hosting and the database)

| | |
|---|---|
| What it does | runs the game server and the Postgres database; keeps backups; keeps the Deploy Logs |
| What it receives | everything in DATA-MAP.md §1 (it hosts the database), the server's logs (no personal information in them) |
| Children's information | yes, as our host (service provider) |
| Terms to have in place | Railway's Data Processing Agreement and privacy policy (railway.com → Legal) |
| Settings to check | 2FA on the account; Postgres private networking only (public networking off); backups daily, kept 7 days; the region; Replicas 1; the spending limit |
| Security page | railway.com → Legal / Security |
| Reviewed | ______ |

## Stripe (payments, tax, the customer portal)

| | |
|---|---|
| What it does | Checkout (the payment page), the monthly subscription, the Customer Portal (update card, invoices, cancel), sales tax (Stripe Tax), receipts and failed-payment emails |
| What it receives | the parent's email address, the family's random id as metadata, the card and billing address the parent types on Stripe's page, the plan and its payments |
| Children's information | **never** |
| Terms to have in place | the Stripe Services Agreement and Stripe's Data Processing Agreement (stripe.com → Legal) |
| Settings to check | 2FA; the server has only the **restricted** key (docs/ACCOUNTS.md §14 step 4); the webhook endpoint's API version is `2026-08-26.dahlia` and every delivery shows 2xx; the portal: no plan switching, no quantity, no email editing, cancel at period end; receipts and failed-payment emails on; Radar on |
| Security page | stripe.com → Security |
| Reviewed | ______ |

## The email provider: Microsoft 365 (`MAIL_MODE=microsoft`, the family's choice)

| | |
|---|---|
| What it does | sends our emails (sign-in codes, the consent confirmation, plan emails) from the family's own Microsoft 365 mailbox (for example `support@brickoodle.com`), through Microsoft Graph |
| What it receives | the parent's email address and the text of our emails (codes and links; never children's information). The app's access is the Microsoft Graph `Mail.Send` application permission only (best limited to the one mailbox, DEPLOY-RAILWAY.md step 12a); it cannot read any mailbox |
| Children's information | **never** |
| What it keeps | no copy in Sent Items (`saveToSentItems: false`); Exchange keeps the sent item in the mailbox's Recoverable Items for the deleted-item retention (14 days by default, at most 30) unless the mailbox is on a hold or a retention policy, and a message trace (sender, recipient, subject). Keep the sending mailbox off litigation hold and long retention policies |
| Terms to have in place | the Microsoft Products and Services Data Protection Addendum (DPA), which applies to Microsoft 365 business plans (microsoft.com → Licensing → Product Terms / DPA) |
| Settings to check | 2FA (MFA) on every Microsoft 365 admin; the app registration "Glimmer World mail": only `Mail.Send` (application), or no Entra permission at all and the Exchange RBAC assignment scoped to the one mailbox (step 12a); the client secret's expiry date (a calendar reminder a month before); the domain's SPF, DKIM ([DKIM](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)) and DMARC ([DMARC](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure)); the sending mailbox has no forwarding rules; the secret is only in Railway |
| Security page | microsoft.com → Trust Center |
| Reviewed | ______ |

## Or: Resend or Postmark (one of them, if not Microsoft 365)

| | |
|---|---|
| What it does | sends our emails (sign-in codes, the consent confirmation, plan emails) |
| What it receives | the parent's email address and the text of our emails (codes and links; never children's information) |
| Children's information | **never** |
| Terms to have in place | the provider's Data Processing Agreement (resend.com → Legal, or postmarkapp.com → Legal / Privacy) |
| Settings to check | 2FA; open and click tracking **off**; the shortest message retention it offers; the domain's DKIM, SPF (and Postmark's Return-Path) and DMARC records; the API key is only in Railway |
| Which one we use | ______ (the same as `MAIL_MODE`; the direct notice names it automatically: Resend, Postmark or Microsoft 365) |
| Reviewed | ______ |

## The domain registrar

| | |
|---|---|
| What it does | holds the domain name and its DNS records |
| What it receives | the operator's own contact details (use the registrar's privacy protection); no family information |
| Settings to check | 2FA; domain lock on; auto-renew on; WHOIS privacy on |
| Reviewed | ______ |

## GitHub (the code)

| | |
|---|---|
| What it does | keeps the code; Railway deploys from it; CI runs the tests |
| What it receives | the code only: no family information, no secrets (secrets live in Railway only) |
| Settings to check | 2FA; the repository's collaborators; Railway's GitHub app limited to this repository |
| Reviewed | ______ |

## Not used (on purpose)

No analytics, advertising, error-tracking, session-recording, chat or font services. The game and
the site load nothing from other companies' servers (the font is served by our own server). The
claude.ai version of the game is separate: it runs inside the claude.ai app and saves to the
player's own claude.ai account, not to our server.
