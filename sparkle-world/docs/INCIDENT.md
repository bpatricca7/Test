# Sparkle World: when something goes wrong

*The incident response plan of the security program ([SECURITY-PROGRAM.md](SECURITY-PROGRAM.md)).
One person runs Sparkle World, so this is a checklist to follow calmly, in order. An "incident" is
anything that may have let someone see, change or delete family information they shouldn't, or
that exposed a secret: a leaked key, a hacked account, a bug that showed one family's data to
another, a lost laptop that was signed in, a strange admin action you didn't make.*

Keep this page printed next to the recovery codes.

## 1. Contain (the first hour)

Do whichever of these fit, quickly. None of them loses families' worlds.

- **A secret leaked** (pasted, screenshotted, committed): rotate it now (SECURITY-PROGRAM.md §6).
  For the Stripe key, roll it in Stripe first, then paste the new one in Railway.
- **One of your accounts may be taken over** (GitHub, Railway, Stripe, email provider, registrar,
  your own email): change its password from a device you trust, sign out all its sessions, check
  its 2FA settings and recovery email, and look at its security/audit log for changes you didn't
  make.
- **Sessions may be stolen**: `npm run admin -- sign-out-all` (everyone signs in again; worlds are
  untouched). For one family: `npm run admin -- sign-out-all <email>`.
- **A bug is showing data it shouldn't**: roll back to the previous deployment in Railway (the
  service → Deployments → the last good one → Redeploy), or set `SW_ACCOUNTS=off` and redeploy:
  the game keeps working the way it did before accounts, and nothing is deleted (the family
  worlds stay in the database and on the devices, and come back when accounts are on again).
- **The database may be exposed**: turn off Postgres public networking if it is on; rotate the
  database password (Railway → Postgres → Settings), which also changes `DATABASE_URL` (a reference
  variable, so the game service picks it up on redeploy).

Write down what you saw and the time, before and while you act (§5).

## 2. Assess (the first day)

Answer these, as well as you can:

1. What happened, and when did it start and stop?
2. Which information could have been seen or changed? Use [DATA-MAP.md](DATA-MAP.md): parents'
   emails? children's nicknames, avatars, worlds? sessions? Card numbers are never with us (Stripe
   has them).
3. Which families? (`npm run admin -- stats`, the Deploy Logs, Railway's and Stripe's own logs.)
4. Is it really over?

## 3. Notify

- **Families affected**: if children's or parents' personal information was (or probably was) seen
  by someone who shouldn't have, tell each affected parent by email, without delay, in plain words:
  what happened, what information, what you did, what they can do (for example sign in again,
  delete a world), and how to reach you. Never put children's information in the email itself.
- **State breach laws**: US states have their own breach-notification laws; some require notice to
  the state attorney general or within a fixed number of days, and some count an email address
  with a password, or information about children, as covered. Check the laws of the states where
  the affected families live (the family's billing state is in Stripe), and ask the lawyer who
  reviewed the privacy notice.
- **Stripe**: if payment details or the Stripe account may be involved, contact Stripe support.
- **Railway / the email provider**: if their systems are involved, contact their support.
- **Law enforcement**: if a child may be in danger, or there is a crime, call the police (and the
  NCMEC CyberTipline for anything involving the exploitation of a child: report.cybertip.org).

A simple email to parents (fill in the brackets):

> Subject: Something went wrong at Sparkle World
>
> Hello, I'm [name], who runs Sparkle World. On [date] [what happened, in one or two sentences].
> This may have exposed [which information] for your family. [What I did about it.] [What you can
> do, if anything.] Your children's worlds are [safe / restored]. I'm sorry. If you have any
> question, reply to this email or call [phone].

## 4. Fix and recover

- Fix the cause (a code fix goes through the tests like any change), then redeploy.
- If data was changed or deleted wrongly, restore from a backup on staging first and follow the
  restore runbook (SECURITY-PROGRAM.md §7, including `reapply-deletions`).
- Turn accounts back on (`SW_ACCOUNTS`) only when you are sure.

## 5. Write it down

In one page, kept with the security program: what happened, the times, what information and which
families (count only), what you did, who you told and when, and what will stop it happening again.
Then update the risk assessment (SECURITY-PROGRAM.md §3) and anything in these documents that
turned out to be wrong.

## Useful places

| What | Where |
|---|---|
| Deploy Logs, rollbacks, Variables | Railway → the game service |
| Database backups, password, public networking | Railway → Postgres |
| Webhook deliveries, API keys, disputes | Stripe Dashboard → Developers / Payments |
| Email sending log, API keys | the email provider's dashboard |
| Admin tool | `railway ssh` into the game service, then `npm run admin -- <command>` (docs/ACCOUNTS.md §13.8) |
