# Sparkle World: parental consent by form, phone call or video call

*COPPA lets an operator confirm a parent's consent in several ways (16 CFR 312.5(b)(2)). Sparkle
World normally uses the card method: the first payment for the Family Plan records verified consent
by itself (docs/ACCOUNTS.md §6.7, §11.4). This page is for the families who don't pay by card: a
family with a **free pass** (`admin comp`) that wants **Play with friends** and the
**walkie-talkie** for its children. It gives the form to print (§1) and the steps for a call or a
video call (§2). Only the coordinator (the dad) records these consents.*

Recording it: after a valid form, call or video call,
`npm run admin -- consent-verified <email> --method form` (or `call`, `video`). That writes
`verified_at` and an audit record `consent.verified {method}`. The parent then turns the switches on
per child on the Family page, as usual.

---

## 1. The consent form (print this part)

> **Sparkle World: a parent's consent**
>
> Sparkle World is a game for children run by {{SW_OPERATOR_NAME}}, {{SW_OPERATOR_ADDRESS}},
> {{SW_OPERATOR_PHONE}}, {{SW_OPERATOR_EMAIL}}.
>
> **What this form is for.** Your family has a Sparkle World account. Before your children can
> **play with friends** or use the **walkie-talkie**, the law asks us to confirm that a parent
> really agreed. You can agree by signing this form and sending it back to us.
>
> **What we keep, for each child** (you already agreed to this on the Family page): a nickname you
> choose (not her real name), her avatar and its picture, her game progress and her worlds,
> including names she types for worlds and pets, only to run the game.
>
> **What this form allows**, and only for the children you switch it on for, on the Family page:
>
> - **Play with friends:** other children in a game she joins or hosts (only friends the host lets
>   in, whose families also have Sparkle World) see her nickname, her avatar and the world. There is
>   no typing, only 16 friendly phrases.
> - **Walkie-talkie:** those friends hear her voice live while she holds the walkie button. Voices
>   are never recorded or stored.
>
> Both switches stay off until you turn them on for a child, and you can turn them off at any time.
> The full Privacy Notice is at <https://your-site/privacy>.
>
> **Your account's email address:** ____________________________________________
>
> **Your name (printed):** ____________________________________________
>
> ☐ I am the parent or legal guardian of the children in this Sparkle World account, and I am 18 or
> older.
>
> ☐ I agree that my children may play with friends and use the walkie-talkie in Sparkle World, for
> the children I switch these on for on the Family page, as described above.
>
> **Signature:** ______________________________  **Date:** ______________
>
> **Send it back** by one of these: post it to {{SW_OPERATOR_ADDRESS}}, or send a clear photo or
> scan of the signed page from your account's email address to {{SW_OPERATOR_EMAIL}}.

(Before printing, replace the `{{…}}` placeholders and `your-site` with the real operator details
and address; they are the same as on `/privacy`.)

## 2. By phone or video call

The call must be made by the coordinator (the "trained personnel" of the rule is you: read this
page first).

1. **Book it by email** with the account's email address, so you know the call is about that
   account. Give a time and, for a video call, a link.
2. **Check it is the parent.** At the start of the call, send a one-off 6-digit number to the
   account's email address (write it in an email yourself) and ask the parent to read it back. If
   they can't, stop.
3. **Read the "What we keep" and "What this form allows" parts of §1**, and answer questions.
4. **Ask plainly:** "Are you the parent or legal guardian of the children in this account, 18 or
   older, and do you agree that they may play with friends and use the walkie-talkie, for the
   children you switch it on for?" Only a clear "yes" counts.
5. **Record it:** `npm run admin -- consent-verified <email> --method call` (or `video`).
6. **Confirm by email** to the account's address: the date, that you recorded their consent, and
   that they can turn the switches off at any time on the Family page.
7. Don't record the call. Write a short note: date, time, method, the account's email, "consent
   given" (no children's information).

## 3. Keeping the proof

- Keep the signed form (paper, or the scan) or the call note in **one private place**: a locked
  drawer, or one folder in your own storage with 2FA. Not in the game's database, not in email
  forever.
- Keep it as long as the family's account exists, and then as long as the audit log (3 years,
  RETENTION.md); then shred the paper or delete the file.
- If a parent withdraws consent, they switch the features off or delete their account on the
  Family page; you can also run `npm run admin -- show <email>` to check. Keep the old form as proof
  of what was agreed at the time until its retention ends.
