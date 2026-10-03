// The Stripe fake's hosted pages (docs/ACCOUNTS.md §12.3): a Checkout page at /c/:id and a
// Customer Portal page at /p/:id, plain HTML forms with the buttons the end-to-end test taps.
// Nothing is loaded from anywhere else.

import { COUNTRIES } from './engine.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents, cur = 'usd') => (cur === 'usd' ? '$' : '') + (cents / 100).toFixed(2) + (cur === 'usd' ? '' : ' ' + cur.toUpperCase());
const date = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : '—');

function shell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font:16px/1.4 system-ui,sans-serif;margin:0;background:#f6f9fc;color:#1a1f36}
main{max-width:460px;margin:24px auto;padding:16px;background:#fff;border-radius:10px;box-shadow:0 2px 8px #0002}
h1{font-size:20px} .test{background:#ffde92;color:#a04100;font-weight:700;padding:2px 8px;border-radius:4px;font-size:12px}
button{display:block;width:100%;min-height:44px;margin:8px 0;font:inherit;border:0;border-radius:6px;background:#635bff;color:#fff;cursor:pointer}
button.alt{background:#e3e8ee;color:#1a1f36} label{display:block;margin:12px 0} select{font:inherit;min-height:36px}
.msg{padding:8px;border-radius:6px;background:#fde8e8;color:#8a1b1b} .ok{background:#e6f6ec;color:#155d2c} a{color:#635bff}
</style></head><body><main>
<p><span class="test">TEST MODE · the Stripe fake</span></p>
${body}
</main></body></html>`;
}

/** /c/:id — Checkout. */
export function checkoutPage(engine, session, { message = '' } = {}) {
  if (!session) return shell('Checkout', '<h1>This checkout does not exist.</h1>');
  const m = engine.meta.get(session.id) || {};
  const price = engine.prices.get(m.priceId);
  const trial = m.trialDays;
  const head = `<h1>Glimmer World Membership</h1>
<p>${trial ? `${trial} days free, then ` : ''}${money(price?.unit_amount ?? 0, price?.currency)} a month, plus sales tax where it applies.</p>
${session.custom_text?.terms_of_service_acceptance?.message ? `<p><small>${esc(session.custom_text.terms_of_service_acceptance.message)}</small></p>` : ''}`;
  if (session.status !== 'open') {
    return shell('Checkout', `${head}<p class="msg">This checkout has ${esc(session.status === 'complete' ? 'been paid' : 'expired')}.</p>`);
  }
  if (m.pending) {
    return shell('Checkout', `${head}
<p class="msg">Your bank wants to check it's you (3-D Secure).</p>
<form method="post" action="/c/${esc(session.id)}">
<button name="outcome" value="approve" id="approve">Approve (3-D Secure)</button>
<button name="outcome" value="fail3ds" class="alt" id="fail3ds">Fail the check</button>
</form>`);
  }
  const options = COUNTRIES.map((c) => `<option value="${c}"${c === 'US' ? ' selected' : ''}>${c}</option>`).join('');
  return shell('Checkout', `${head}
${message ? `<p class="msg">${esc(message)}</p>` : ''}
<form method="post" action="/c/${esc(session.id)}">
<label>Country or region <select name="country" id="country">${options}</select></label>
<label><input type="checkbox" name="terms" checked disabled> I agree to the Terms</label>
<button name="outcome" value="ok" id="pay">Pay (4242)</button>
<button name="outcome" value="decline" class="alt" id="decline">Declined</button>
<button name="outcome" value="3ds" class="alt" id="threeds">Needs 3-D Secure</button>
</form>
<p><a href="${esc(session.cancel_url)}" id="back">← Back</a></p>`);
}

/** /p/:id — the Customer Portal. */
export function portalPage(engine, ps, { message = '' } = {}) {
  if (!ps) return shell('Billing', '<h1>This page has expired.</h1>');
  const sub = engine.portalSubscription(ps.customer);
  const card = engine.cards.get(ps.customer) || 'ok';
  let about = '<p>No subscription.</p>';
  if (sub) {
    const end = sub.items.data[0].current_period_end;
    about = `<p id="status">Status: <b>${esc(sub.status)}</b>${sub.cancel_at_period_end ? ` · ends ${date(end)}` : ''}${sub.status === 'trialing' ? ` · trial ends ${date(sub.trial_end)}` : ''}${sub.status === 'active' && !sub.cancel_at_period_end ? ` · renews ${date(end)}` : ''}</p>`;
  }
  return shell('Billing', `<h1>Glimmer World · Billing</h1>
${message ? `<p class="msg ok">${esc(message)}</p>` : ''}
${about}
<p>Card: ${card === 'ok' ? 'Visa •••• 4242' : 'Visa •••• 0341 (will be declined)'}</p>
<form method="post" action="/p/${esc(ps.id)}">
<button name="action" value="cancel_at_period_end" id="cancel">Cancel at period end</button>
<button name="action" value="resume" class="alt" id="resume">Resume</button>
<button name="action" value="cancel_now" class="alt" id="cancel-now">Cancel now</button>
<button name="action" value="update_card" class="alt" id="update-card">Update card</button>
<button name="action" value="card_fails" class="alt" id="card-fails">Card starts failing</button>
</form>
<p><a href="${esc(ps.return_url)}" id="return">← Return to Glimmer World</a></p>`);
}

export function plainPage(title, text) {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}
