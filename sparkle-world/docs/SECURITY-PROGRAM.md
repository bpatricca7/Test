# Sparkle World: written information security program

*COPPA 16 CFR 312.8 asks every operator of a children's service to keep a written information
security program, sized to the operator and the information. Sparkle World is run by one parent
for a small number of families, so this program is short on purpose. It applies from the day
family accounts go live (`SW_ACCOUNTS=optional` or `required`). Written 2026-09-28 with
docs/ACCOUNTS.md; read it again at every yearly review.*

Related documents: [RETENTION.md](RETENTION.md) (what is kept and for how long),
[DATA-MAP.md](DATA-MAP.md) (every piece of information and where it lives),
[INCIDENT.md](INCIDENT.md) (what to do when something goes wrong),
[VENDORS.md](VENDORS.md) (the companies that help run it),
[CONSENT-FORM.md](CONSENT-FORM.md) (consent by form, call or video).

---

## 1. Who is responsible

| Role | Who |
|---|---|
| Coordinator of this program (COPPA 312.8(b)(1)) | the operator named in `SW_OPERATOR_NAME` (the dad): ______________________ |
| Backup person, if the coordinator can't act for more than a week | ______________________ (someone the coordinator trusts; they get no passwords until it is needed, see §7) |

The coordinator does everything below. Nobody else has access to the service or its data.

## 2. What we protect

The information listed in [DATA-MAP.md](DATA-MAP.md): parents' email addresses and consent
records, children's nicknames, avatars, portraits, game progress and worlds (including names they
type), sign-in sessions, and the plan's billing mirror. Walkie-talkie voices pass through the server
live and are never stored. Card numbers never reach us (Stripe keeps them).

## 3. Risk assessment

Done at launch (before phase 2 of the rollout, docs/ACCOUNTS.md §13.1) and again **every year**,
and after any incident or big change (a new vendor, a new kind of data). Write the date and the
answers in the table in §10.

| Risk | How likely | What protects against it |
|---|---|---|
| Someone takes over one of the service accounts (GitHub, Railway, Stripe, the email provider, the domain, the coordinator's own email) | medium | two-step sign-in (2FA or passkey) on every one of them; unique passwords in a password manager; the recovery codes printed and kept at home |
| A secret leaks (a key pasted in a chat, a screenshot, a public repository) | medium | secrets only in Railway → Variables; never in the code, a file, an email or a chat; the Stripe key on the server is a **restricted** key; rotate at once (§6) |
| A bug lets one family see another family's data | low | every `/api` route checks the family (tests: "another family's `:pid` → 404"); the security tests of docs/ACCOUNTS.md §12.7 run on every change |
| Someone guesses sign-in codes or pairing codes | low | codes bound to the browser that asked, 5 tries, rate limits per address, per email and overall |
| A stranger joins a child's game | low | invite codes, the host's **Let in!** tap, friends only between families with the plan, per-child switches off by default |
| The database is copied or lost | low | Postgres only on Railway's private network; daily backups kept 7 days; devices keep their own copy of worlds |
| Personal information ends up in logs | low | code logs counts and error names only; a "log spy" test fails the build if an email, token, code, nickname, world name or IP address is ever logged |
| A dependency is compromised | low | few dependencies (`ws`, `pg`, `stripe`), exact versions, `npm ci` from the lock file, `npm audit` in CI |
| A voice is recorded | very low | the server passes voice frames on and forgets them; a tested invariant (docs/MULTIPLAYER.md Addendum C) |

## 4. Safeguards (what we do every day)

**Accounts and access**
- 2FA (or a passkey) on: GitHub, Railway, Stripe, the email provider (with Microsoft 365: every
  admin account of the Microsoft 365 organization), the domain registrar, and the
  coordinator's own email account (it receives every password reset). Check once a year that it is
  still on.
- Only the coordinator has these accounts. No shared logins. If the backup person ever needs
  access, give them their own login and remove it afterwards.
- Admin work on family data happens only through the admin tool (`npm run admin -- …` via
  `railway ssh`, docs/ACCOUNTS.md §13.8). Its commands write an audit record and print counts and
  ids, never children's content. Never copy the database to a laptop. If Postgres public
  networking is turned on for a moment (§14 step 7), turn it off again the same day.

**Secrets**
- All secrets live in Railway → the game service → Variables, and nowhere else:
  `SW_SECRET`, `STRIPE_SECRET_KEY` (a restricted `rk_live_…` key with only the permissions in
  docs/ACCOUNTS.md §14 step 4), `STRIPE_WEBHOOK_SECRET`, `MAIL_API_KEY` (Resend or Postmark) or
  `MS_CLIENT_SECRET` (Microsoft 365: an app that may only send mail, best limited to the one
  mailbox; DEPLOY-RAILWAY.md step 12a), `DATABASE_URL`.
- The full Stripe secret key (`sk_live_…`) is used once, by hand, for `npm run stripe:setup`, and is
  never stored in Railway.

**The service**
- HTTPS everywhere (`Strict-Transport-Security`); cookies are `__Host-`, `Secure`, `HttpOnly`,
  `SameSite=Lax`.
- Sign-in links, codes, pairing codes and session tokens are random, single-use where possible,
  expire, and are stored only as hashes.
- Postgres is reachable only on Railway's private network.
- Stripe webhooks are accepted only with a valid signature over the exact body.
- Rate limits on sign-in, pairing, checkout and every `/api` route.
- Logs: counts and error names only.
- Data minimisation: nicknames instead of names, no birthdays, no photos, no location, no chat.

**Changes**
- Every change runs the automated suites (docs/ACCOUNTS.md §12: `test:accounts`, `test:billing`,
  `test:saves`, `test:net`, `test:walkie`, the end-to-end test, `smoke`, `site-check`) before it is
  deployed.
- Server changes are read through before they are merged (by the coordinator, or a reviewer he
  asks), with extra care for `server/auth.mjs`, `server/http.mjs` and `server/billing.mjs`.
- Dependencies: exact versions in `package.json`, `npm ci`, `npm audit` in CI; upgrade `stripe` only
  together with the shape check of docs/ACCOUNTS.md §12.4.

## 5. Parent requests (review, download, delete, revoke)

Most of this parents do themselves on the Family page. When a parent writes instead:

1. **Confirm it is really the parent.** Only act on a request that comes from the account's email
   address, or reply to that address and wait for the answer. Never act on a request from another
   address, a phone call alone, or a social media message.
2. Do it with the admin tool:
   - see: `npm run admin -- show <email>` (counts and dates only)
   - download: **never email children's information** (nicknames, portraits, worlds): our email
     provider must not receive it (VENDORS.md). Answer that she can sign in on the Family page with
     a code sent to that address (it works on any device, even if hers was lost) and use
     **Download everything**; help her sign in if she is stuck. `npm run admin -- export` prints
     children's content: use it only to check what a download holds, on the server, and keep no
     copy
   - delete everything: `npm run admin -- delete <email>`
   - a changed email address: `npm run admin -- change-email <old> <new>` (only after the old
     address confirmed it)
3. Answer within **10 business days**.
4. Write the date and what was done (not the children's information) in your own notes.

## 6. Keys: when and how to rotate them

Rotate at once after any suspected leak (see INCIDENT.md), and otherwise once a year:

| Secret | How |
|---|---|
| `STRIPE_SECRET_KEY` (restricted) | Stripe → Developers → API keys → roll the restricted key (same permissions) → paste the new one in Railway → deploy |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → the endpoint → Roll secret (Stripe can keep the old one valid for a while) → Railway → deploy |
| `MAIL_API_KEY` | the email provider → API keys → create a new key, put it in Railway, deploy, then delete the old key |
| `MS_CLIENT_SECRET` (Microsoft 365) | before it expires (it lasts at most 24 months; the calendar reminder of DEPLOY-RAILWAY.md step 12a), or at once after a leak: Entra admin center → App registrations → Glimmer World mail → Certificates & secrets → New client secret → copy its **Value** → Railway `MS_CLIENT_SECRET` → deploy → check a sign-in email arrives → delete the old secret |
| `SW_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → Railway → deploy. Only codes waiting to be typed stop working; nobody is signed out |
| Everyone's sessions | `npm run admin -- sign-out-all` (everyone signs in again) |

## 7. Backups and restore

- Railway Postgres backups: daily, kept 7 days (docs/ACCOUNTS.md §13.4). Check in the Postgres
  service's **Backups** tab that they run.
- **Restore runbook:** restore on **staging** first and check it. After a production restore to
  time T, deletions made after T must be done again: families, children and worlds. Paste the
  `deletion-journal` lines from the Deploy Logs since T (`family=`, `player=`, `world=`; ids only)
  into a file and run `npm run admin -- reapply-deletions --since T --ids <file> --dry-run` to see
  the list, then again without `--dry-run`: it prints the list and asks you to type how many.
  It also reads Stripe's `customer.deleted` events since T, but only those our own delete marked
  (`sw_family_deleted`); a customer you deleted by hand in the Stripe Dashboard is printed for you
  to check and its family is left alone.
- Do **one restore drill on staging** before launch and write the date in §10.

## 8. Vendors

Each company that handles information for us is listed in [VENDORS.md](VENDORS.md) with what it
receives and its data processing terms. Before adding a new one (or moving the database anywhere
else): update VENDORS.md, DATA-MAP.md, the Privacy Notice and the direct notice first.

## 9. If something goes wrong

Follow [INCIDENT.md](INCIDENT.md): contain, assess, notify, fix, write it down.

## 10. Yearly calendar and record

Every year around the launch date:

- [ ] Read this program, RETENTION.md, DATA-MAP.md, VENDORS.md and INCIDENT.md; fix anything that
      is no longer true.
- [ ] Redo the risk assessment (§3).
- [ ] Check 2FA on every account (§4).
- [ ] Rotate the keys (§6).
- [ ] Check that the retention job runs (the Deploy Logs show a `retention:` line every hour) and
      that backups run.
- [ ] Review each vendor's terms (VENDORS.md).
- [ ] Check that `/privacy`, `/terms` and the home page are still true.

| Date | What was done | By |
|---|---|---|
| ______ | Launch risk assessment | ______ |
| ______ | Restore drill on staging | ______ |
| ______ | Yearly review | ______ |
