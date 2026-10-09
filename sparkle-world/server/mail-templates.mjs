// Every email's words (docs/ACCOUNTS.md §10). Plain text plus a simple HTML copy of it: no
// remote images, no tracking, links only to PUBLIC_ORIGIN.
//
// RULE: no email ever contains a child's nickname, avatar, world or pet name ("your family's
// players"), so the email provider never receives children's information. Nothing here reads
// a player; `data` holds only codes, links, dates and flags (tools/test-accounts.mjs checks).
//
//   renderMail(template, { data, cfg, firstTime, notice }) → { subject, text, html }
//     firstTime   signin only: no family has signed in with this address yet (the outbox
//                 decides at send time, so the answer to /api/auth/start never depends on it)
//     notice      { version, sections: [{ title, text }] } for the first sign-in email
//
// The data each template reads (anything else is ignored):
//   signin           { code, link }
//   check            { code }
//   consent_confirm  { at (ms), v }
//   welcome          { trialEnd? (ms), periodEnd? (ms) }
//   friends_ready    {}
//   us_only          { refund? or refundDue? (true when a payment was taken and will be refunded;
//                      billing.mjs sends refundDue) }
//   lapse_warning    { lapsedAt (ms), purgeAfter (ms) }
//   annual_reminder  {}
//   inactive         {}
//   account_deleted  {}

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEMPLATES = Object.freeze(['signin', 'check', 'consent_confirm', 'welcome', 'friends_ready', 'us_only', 'lapse_warning', 'annual_reminder', 'inactive', 'account_deleted']);

/** Templates whose data is secret (codes, links): never logged, scrubbed at send. */
export const SECRET_TEMPLATES = Object.freeze(['signin', 'check']);

export function fmtDate(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return 'soon';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}

const code6 = (v) => (typeof v === 'string' && /^\d{6}$/.test(v) ? v : '');

function footer(cfg) {
  const origin = cfg.publicOrigin;
  const op = cfg.operator || {};
  const who = [op.name, op.address, op.email, op.phone].filter(Boolean).join(' · ');
  return [
    '—',
    'Glimmer World' + (who ? ` is run by ${who}.` : '.'),
    `Family page: ${origin}/account · Privacy Notice: ${origin}/privacy`,
  ].join('\n');
}

function signin({ data, cfg, firstTime, notice }) {
  const code = code6(data.code);
  const link = typeof data.link === 'string' && data.link.startsWith(cfg.publicOrigin + '/') ? data.link : `${cfg.publicOrigin}/account`;
  const lines = [];
  if (firstTime) {
    lines.push('Welcome to Glimmer World!', '', `Your code is: ${code}`);
  } else {
    lines.push('Here is your code to sign in to Glimmer World:', '', code);
  }
  lines.push(
    '',
    'Type it on the page that asked for it. Or open this link to sign in (it asks you once more before signing in):',
    link,
    '',
    'The code and the link work once, for 15 minutes.',
  );
  if (firstTime) {
    lines.push('', 'Before your children play: what Glimmer World keeps, and why' + (notice?.version ? ` (notice version ${notice.version})` : '') + '. You will be asked to agree on the Family page.');
    for (const s of notice?.sections || []) {
      if (s && typeof s.title === 'string' && typeof s.text === 'string') lines.push('', `${s.title} ${s.text}`.trim());
    }
    lines.push('', `The full Privacy Notice: ${cfg.publicOrigin}/privacy`);
  }
  lines.push('', "Didn't ask for this? You can ignore this email: nothing happens without the code.");
  return { subject: `Your Glimmer World code: ${code}`, text: lines.join('\n') };
}

function check({ data }) {
  const code = code6(data.code);
  return {
    subject: `Your Glimmer World check code: ${code}`,
    text: [
      'Someone signed in to your Glimmer World Family page asked to do something that needs a quick email check (like turning on playing with friends, downloading, setting up a kid\'s device or deleting).',
      '',
      `Your code: ${code}`,
      '',
      'Type it on the page that asked for it. It works once, for 15 minutes.',
      '',
      "Wasn't you? Don't type the code anywhere. Sign in on the Family page and choose Sign out everywhere.",
    ].join('\n'),
  };
}

function consentConfirm({ data, cfg }) {
  return {
    subject: 'You agreed to Glimmer World keeping your children\'s game information',
    text: [
      `You agreed on ${fmtDate(data.at)} that Glimmer World may keep your children's nicknames, avatars, game progress and worlds to run the game for them` + (Number.isInteger(data.v) ? ` (notice version ${data.v}).` : '.'),
      '',
      'Playing with friends and the walkie-talkie stay off until you switch them on for each child on the Family page.',
      '',
      `Changed your mind? On the Family page (${cfg.publicOrigin}/account) choose Delete our account, and everything is deleted at once. You can also reply to this email.`,
    ].join('\n'),
  };
}

function welcome({ data, cfg }) {
  const trial = Number.isFinite(Number(data.trialEnd)) && data.trialEnd !== null && data.trialEnd !== undefined;
  const lines = ['Thank you! Your Glimmer World Membership is on.', '', `The membership: ${cfg.priceText}, for the whole family, with everything included. It is the only plan there is: no tiers, no add-ons, and nothing to buy inside the game, ever.`];
  if (trial) {
    lines.push('', `Your free days end on ${fmtDate(data.trialEnd)}. Cancel before ${fmtDate(data.trialEnd)} and you won't be charged.`);
  }
  lines.push(
    '',
    'It renews every month until you cancel.',
    `To cancel: on the Family page (${cfg.publicOrigin}/account) choose Cancel the plan, or reply to this email. Cancelling stops the next payment; the membership keeps working until the end of the month you paid for.`,
    '',
    'Next: add your players on the Family page and set up the kids\' devices.',
  );
  return { subject: 'Welcome to your Glimmer World Membership', text: lines.join('\n') };
}

function friendsReady({ cfg }) {
  return {
    subject: 'Playing with friends can now be switched on',
    text: [
      'Your first payment went through, which is how we confirm that a grown-up said yes.',
      '',
      `Playing with friends and the walkie-talkie can now be switched on for each child on the Family page (${cfg.publicOrigin}/account). They stay off until you switch them on.`,
    ].join('\n'),
  };
}

function usOnly({ data }) {
  return {
    subject: 'Glimmer World is only in the United States for now',
    text: [
      'Sorry! The Glimmer World Membership is only available in the United States for now, so we cancelled it.',
      '',
      data.refund === true || data.refundDue === true ? 'The payment that was taken will be refunded to your card.' : 'No payment was taken.',
    ].join('\n'),
  };
}

function lapseWarning({ data, cfg }) {
  return {
    subject: "Your family's Glimmer World worlds will be deleted soon",
    text: [
      `Your Glimmer World Membership ended on ${fmtDate(data.lapsedAt)}.`,
      '',
      `Your family's players and worlds are kept until ${fmtDate(data.purgeAfter)}, then deleted.`,
      '',
      `To keep them, restart your membership, or download the worlds, on the Family page: ${cfg.publicOrigin}/account`,
    ].join('\n'),
  };
}

function annualReminder({ cfg }) {
  return {
    subject: 'A yearly reminder about your Glimmer World Membership',
    text: [
      `A yearly reminder: your Glimmer World Membership renews every month (${cfg.priceText}) until you cancel.`,
      '',
      `To cancel: on the Family page (${cfg.publicOrigin}/account) choose Cancel the plan, or reply to this email.`,
    ].join('\n'),
  };
}

function inactive({ cfg }) {
  return {
    subject: 'Still using Glimmer World?',
    text: [
      "Nobody in your family has signed in to Glimmer World or played it for two years, but your Glimmer World Membership is still active.",
      '',
      `If you don't need it any more, you can cancel it and delete everything on the Family page: ${cfg.publicOrigin}/account (or reply to this email).`,
    ].join('\n'),
  };
}

function accountDeleted() {
  return {
    subject: 'Your Glimmer World family account was deleted',
    text: [
      'Your Glimmer World family account was deleted, as asked.',
      '',
      '- Your Glimmer World Membership was cancelled, with no further charges.',
      "- Your children's players, worlds and everything else we kept were deleted.",
      '- Our backups roll off within 7 days.',
      '- Stripe keeps the payment records the law requires.',
      '',
      'Thank you for playing Glimmer World.',
    ].join('\n'),
  };
}

const RENDER = {
  signin,
  check,
  consent_confirm: consentConfirm,
  welcome,
  friends_ready: friendsReady,
  us_only: usOnly,
  lapse_warning: lapseWarning,
  annual_reminder: annualReminder,
  inactive,
  account_deleted: accountDeleted,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The HTML copy: paragraphs, and links to our own origin only. */
function toHtml(text, cfg) {
  const origin = cfg.publicOrigin;
  const linkRe = new RegExp(`(${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s)]*)`, 'g');
  const paras = text.split(/\n\n+/).map((p) => {
    const html = esc(p).replace(linkRe, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px">${html}</p>`;
  });
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#3b2e4a;max-width:560px;margin:0 auto;padding:16px">${paras.join('')}</body></html>`;
}

export function renderMail(template, { data = {}, cfg, firstTime = false, notice = null } = {}) {
  const fn = RENDER[template];
  if (!fn) throw new Error('mail: unknown template');
  const { subject, text } = fn({ data: data || {}, cfg, firstTime, notice });
  const full = `${text}\n\n${footer(cfg)}`;
  return { subject, text: full, html: toHtml(full, cfg) };
}

// ---------------------------------------------------------------------------------------------
// the direct notice (§11.3): the text lives in server/notice.mjs (owner B: NOTICE_VERSION,
// noticeSections(cfg), and optionally NOTICE_CHECKBOX or noticeCheckbox(cfg)). The same words go
// to GET /api/notice (the Family page) and to the first sign-in email. Until that file lands,
// this short fallback (version 1) stands in.

const FALLBACK_CHECKBOX = "I'm the parent or legal guardian of the children who will play, I'm 18 or older, and I agree that Glimmer World may keep the information above to run the game for them.";

function fallbackSections(cfg) {
  return [
    { title: 'You gave us your email', text: 'so we can ask your permission and so you can sign in. Children are never asked for an email.' },
    { title: 'With your permission we keep, for each child:', text: 'a nickname you choose (a nickname, please, not a real name), her avatar and its picture, her game progress and her worlds, including names she types for worlds and pets. We use them only to run the game.' },
    { title: 'We never collect', text: "children's emails, real names, birthdays, photos, location, contacts or recordings. No ads, no analytics, no trackers." },
    { title: 'Playing with friends and the walkie-talkie are off', text: 'until you switch them on for each child on the Family page. Voices are never recorded.' },
    { title: 'How long we keep it:', text: `while your plan is active, and ${cfg.retainDays} days after it ends. When you delete it, it is gone at once, and our backups roll off within 7 days.` },
    { title: 'You can', text: "see, download and delete your children's information and turn any permission off at any time on the Family page." },
    { title: "If you don't finish", text: 'setting up within 14 days, we delete your email address.' },
  ];
}

let noticeModule = null;

/** → { version, sections: [{ title, text }], checkbox } */
export async function loadNotice(cfg) {
  if (!noticeModule) {
    const url = new URL('./notice.mjs', import.meta.url);
    noticeModule = existsSync(fileURLToPath(url)) ? import(url.href).catch(() => null) : Promise.resolve(null);
  }
  const m = await noticeModule;
  if (!m || !Number.isInteger(m.NOTICE_VERSION) || typeof m.noticeSections !== 'function') {
    return { version: 1, minVersion: 1, sections: fallbackSections(cfg), checkbox: FALLBACK_CHECKBOX };
  }
  const checkbox = typeof m.noticeCheckbox === 'function' ? m.noticeCheckbox(cfg) : typeof m.NOTICE_CHECKBOX === 'string' ? m.NOTICE_CHECKBOX : FALLBACK_CHECKBOX;
  const minVersion = Number.isInteger(m.NOTICE_MIN_VERSION) ? Math.min(m.NOTICE_MIN_VERSION, m.NOTICE_VERSION) : m.NOTICE_VERSION;
  return { version: m.NOTICE_VERSION, minVersion, sections: m.noticeSections(cfg), checkbox };
}
