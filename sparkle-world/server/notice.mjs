// The direct notice to parents (COPPA 16 CFR 312.4(c); docs/ACCOUNTS.md §11.3): one source for the
// Family page (GET /api/notice), the first sign-in email and the tests. Plain text only: pages
// insert it with textContent, emails use it as it is. Never any child's information in here.
//
//   NOTICE_VERSION                  the version of the text below; bump it whenever the text changes
//   NOTICE_MIN_VERSION              the oldest version an agreement still counts for. Raise it to
//                                   NOTICE_VERSION when a change matters: parents who agreed to an
//                                   older version then see the notice again on the Family page,
//                                   and until they agree no player is added and no switch goes on
//   noticeSections(cfg)             → [{ title, text }]          (the pinned contract, §15.2)
//   noticeCheckbox(cfg)             → the one checkbox's label (never pre-ticked)
//   notice(cfg)                     → { version, date, title, sections, checkbox, privacyPath }
//                                     (what GET /api/notice answers, §5.2)
//   noticeSummary(cfg)              → a short paragraph for the first sign-in email (§10 `signin`)
//   renewalSentence(cfg, {trial})   → the auto-renewal sentence next to Stripe Checkout's
//                                     "I agree" box (§11.10; Checkout custom_text)
//   pricePhrase(cfg)                → "$5.99 plus tax" (from SW_PRICE_TEXT)
//   FRIENDS_SWITCH_NOTICE, WALKIE_SWITCH_NOTICE   the per-child switch notices (§9.2, §11.5)
//
// `cfg` is loadConfig()'s object; only these fields are read: mpConsent, retainDays, trialDays,
// priceText, mailMode, publicOrigin, operator { name, email, address, phone }. Missing operator
// details (development) read "[SW_OPERATOR_… not set]"; production refuses to start without them.

export const NOTICE_VERSION = 1;
export const NOTICE_MIN_VERSION = 1;
export const NOTICE_DATE = '2026-09-28';

export const NOTICE_TITLE = 'Before your children play: what Sparkle World keeps, and why.';

/** The Play with friends switch's own notice (one per child, off by default). */
export const FRIENDS_SWITCH_NOTICE =
  'Other players in a game she joins or hosts see her nickname, her avatar and the world. Only friends the host lets in, whose families have Sparkle World too. No typing, only 16 friendly phrases.';

/** The walkie-talkie switch's own notice: the game's GATE_NOTE (src/net/walkie/gate.js), word for word. */
export const WALKIE_SWITCH_NOTICE = 'Voices go live only to friends in this game, are never recorded, and stop when the button is let go.';

const PROVIDER_NAMES = { resend: 'Resend', postmark: 'Postmark', microsoft: 'Microsoft 365' };

function op(cfg, key) {
  const v = cfg?.operator?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : `[SW_OPERATOR_${key.toUpperCase()} not set]`;
}

/** "$5.99 plus tax" from SW_PRICE_TEXT ("$5.99 a month, plus sales tax where it applies"). */
export function pricePhrase(cfg = {}) {
  const text = String(cfg.priceText || '$5.99 a month, plus sales tax where it applies');
  const amount = (/\$\s?\d+(?:\.\d{2})?/.exec(text) || ['$5.99'])[0].replace(/\s/g, '');
  if (/tax\s+included|including\s+tax|includes\s+tax/i.test(text)) return `${amount}, tax included`;
  if (/plus[^.]*tax/i.test(text)) return `${amount} plus tax`;
  return amount;
}

function friendsConsentSentence(cfg) {
  if (cfg?.mpConsent === 'email_plus') {
    return 'Playing with friends can be switched on as soon as you agree here. The walkie-talkie switch becomes available once we have confirmed that a grown-up said yes: your first payment does that.';
  }
  return 'These switches become available once we have confirmed that a grown-up said yes: your first payment does that.';
}

/** The direct notice, section by section (§11.3). */
export function noticeSections(cfg = {}) {
  const provider = PROVIDER_NAMES[cfg.mailMode] || 'our email provider';
  const retain = Number.isFinite(cfg.retainDays) ? cfg.retainDays : 90;
  const privacy = (cfg.publicOrigin || '') + '/privacy';
  return [
    {
      title: 'You gave us your email',
      text: 'so we can ask your permission and so you can sign in. Children are never asked for an email.',
    },
    {
      // 16 CFR 312.4(c)(1)(ii): consent is needed, and without it nothing is collected, used or disclosed
      title: 'We need your permission first',
      text: "if you don't agree, we don't collect, use or share anything about your children.",
    },
    {
      title: 'With your permission we keep, for each child',
      text:
        'a nickname you choose (a nickname, please, not a real name), her avatar and its picture, her game progress (stickers, coins, outfits, settings) and her worlds, including names she types for worlds and pets. ' +
        'We use them only to run the game: to save her worlds on our server so they follow her between devices and survive a browser clearing its data.',
    },
    {
      title: 'We never collect',
      text: "children's emails, real names, birthdays, photos, location, contacts or recordings. No ads, no analytics, no trackers.",
    },
    {
      title: 'Playing with friends and the walkie-talkie are off',
      text:
        'until you switch them on for each child on the Family page. When on, the other children in the same game (only friends the host lets in, whose families also have Sparkle World) see her nickname, avatar and the world, and hear her voice live while she holds the walkie button. ' +
        'Voices are never recorded. You can agree to saving without agreeing to playing with friends. ' +
        friendsConsentSentence(cfg),
    },
    {
      title: 'Who helps us run it',
      text:
        `Railway (hosting and database). Stripe (your payments) and ${provider} (our emails) receive only your email and payment details, never your children's information. ` +
        "We don't sell or share information for advertising.",
    },
    {
      title: 'How long we keep it',
      text: `while your plan is active, and ${retain} days after it ends (so you can come back). When you delete it, it is gone at once, and our backups roll off within 7 days. Details in the Privacy Notice.`,
    },
    {
      title: 'You can',
      text: `see, download and delete your children's information and turn any permission off at any time on the Family page, or by writing to ${op(cfg, 'email')}.`,
    },
    {
      title: "If you don't finish",
      text: "setting up: if you don't agree to this notice within 14 days, we delete your email address; if you agree but don't start the Family Plan within 30 days, we delete it then.",
    },
    {
      title: 'Who runs Sparkle World',
      text: `Sparkle World is run by ${op(cfg, 'name')}, ${op(cfg, 'address')}, ${op(cfg, 'phone')}, ${op(cfg, 'email')}. The full Privacy Notice: ${privacy}`,
    },
  ];
}

/** The one checkbox (the page never ticks it for the parent). */
export function noticeCheckbox() {
  return "I'm the parent or legal guardian of the children who will play, I'm 18 or older, and I agree that Sparkle World may keep the information above to run the game for them.";
}

/** GET /api/notice's answer. */
export function notice(cfg = {}) {
  return {
    version: NOTICE_VERSION,
    minVersion: NOTICE_MIN_VERSION,
    date: NOTICE_DATE,
    title: NOTICE_TITLE,
    sections: noticeSections(cfg),
    checkbox: noticeCheckbox(cfg),
    privacyPath: '/privacy',
  };
}

/** A short version for the first sign-in email (§10 `signin`): no child's information, a link to all of it. */
export function noticeSummary(cfg = {}) {
  const privacy = (cfg.publicOrigin || '') + '/privacy';
  return [
    "Before your children play, Sparkle World asks your permission to keep a nickname, an avatar, game progress and worlds for each child, only to run the game. Without it, we don't collect, use or share anything about them.",
    "We never collect children's emails, real names, birthdays, photos, location, contacts or recordings. No ads, no analytics, no trackers.",
    'Playing with friends and the walkie-talkie stay off until you switch them on for each child on the Family page.',
    `You will read the whole notice on the Family page before agreeing. The Privacy Notice: ${privacy}`,
  ].join(' ');
}

/** The sentence next to Stripe Checkout's Terms box (§11.10, ROSCA and state auto-renewal laws). */
export function renewalSentence(cfg = {}, { trial = false } = {}) {
  const price = pricePhrase(cfg);
  const days = Number.isFinite(cfg.trialDays) ? cfg.trialDays : 0;
  const start = trial && days > 0 ? `After ${days === 7 ? 'the free week' : `${days} free days`}, my` : 'My';
  return `I agree to the Terms. ${start} Family Plan renews every month at ${price} until I cancel; I can cancel any time on the Family page.`;
}
