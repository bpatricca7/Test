// MAIL_MODE=microsoft tests (docs/ACCOUNTS.md §10, §12.3a): `npm run test:mail-microsoft`
// (node:test; the Microsoft 365 fake in tools/ms-graph-fake.mjs; no network).
//
// Config validation; the request shapes (token form, mailbox in the URL, saveToSentItems false,
// recipients, subject and body); the token cache (5 minutes early, one refresh at a time); a 401
// renewing the token once; 429 with Retry-After (waited in place when short, moved to the outbox
// when long, capped); 5xx retried; a 400 about the message stopped, any other 400 retried;
// SW_OPERATOR_EMAIL (the Reply-To) checked at start; 403/404 and sign-in failures logged with the
// likely fix; timeouts; and a real sign-in code email from /api/auth/start to the fake and back
// to /api/auth/verify. The log spy checks at the end that no secret, token, code or address was
// ever logged.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { loadConfig, ConfigError, summarizeConfig, mailboxOf, bareAddress } from '../server/config.mjs';
import { makeTransport, retryAfterMs, MAIL_BACKOFF_MS, MAIL_MAX_TRIES, MAIL_RETRY_AFTER_CAP_MS, MS_TOKEN_EARLY_MS } from '../server/mail.mjs';
import { createAccounts, makeClock } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';
import { noticeSections } from '../server/notice.mjs';
import { openTestDb, installLogSpy } from './testdb.mjs';
import { startMsGraphFake } from './ms-graph-fake.mjs';

const spy = installLogSpy();
const remember = spy.remember;

const TENANT = '1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a0b'; // made-up GUIDs
const CLIENT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SECRET_VALUE = 'Qx8Q~' + randomBytes(18).toString('base64url'); // the shape of a client secret Value
const MAILBOX = 'support@brickoodle.com';
const FROM = 'Glimmer World <Support@Brickoodle.com>';
const PARENT = 'mom.k@example.com';
remember(SECRET_VALUE, MAILBOX, PARENT);

const ENV = Object.freeze({
  SW_ACCOUNTS: 'optional',
  DATABASE_URL: 'postgresql://sw@127.0.0.1:5432/sw',
  PUBLIC_ORIGIN: 'http://localhost:8080',
  SW_SECRET: randomBytes(32).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
  STRIPE_PRICE_ID: 'price_abc123',
  MAIL_MODE: 'microsoft',
  MS_TENANT_ID: TENANT,
  MS_CLIENT_ID: CLIENT,
  MS_CLIENT_SECRET: SECRET_VALUE,
  MAIL_FROM: FROM,
});
const PROD = Object.freeze({
  ...ENV,
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://brickoodle.com',
  STRIPE_SECRET_KEY: 'rk_live_abc123',
  SW_OPERATOR_NAME: 'The Family',
  SW_OPERATOR_EMAIL: 'hello@brickoodle.com',
  SW_OPERATOR_ADDRESS: 'PO Box 1',
  SW_OPERATOR_PHONE: '+1 555 0100',
});

const refuses = (env, re) => {
  let err = null;
  try {
    loadConfig(env);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ConfigError, 'expected a refusal matching ' + re);
  assert.match(err.message, re);
  assert.ok(!err.message.includes('\n'), 'one line');
  assert.ok(!err.message.includes(SECRET_VALUE), 'never the secret');
  return err;
};

// ---------------------------------------------------------------------------------------------

describe('config: MAIL_MODE=microsoft', () => {
  test('a complete setup loads; the mailbox is the address of MAIL_FROM; no MAIL_API_KEY needed', () => {
    const c = loadConfig(PROD);
    assert.deepEqual([c.mailMode, c.msTenantId, c.msClientId, c.msClientSecret, c.msMailbox, c.mailFrom, c.mailApiKey], ['microsoft', TENANT, CLIENT, SECRET_VALUE, MAILBOX, FROM, null]);
    assert.equal(c.production, true, "'microsoft' is a real provider in production");
    assert.deepEqual([c.msLoginBase, c.msGraphBase], [null, null]);
    assert.equal(loadConfig({ ...ENV, MS_TENANT_ID: TENANT.toUpperCase() }).msTenantId, TENANT);
  });
  test('summarizeConfig shows "mail microsoft" and the mailbox domain only', () => {
    const line = summarizeConfig(loadConfig(PROD));
    assert.match(line, /mail microsoft \(brickoodle\.com\)/);
    assert.ok(!line.includes('support') && !line.includes('@') && !line.includes(SECRET_VALUE) && !line.includes(CLIENT) && !line.includes(TENANT), line);
    assert.match(summarizeConfig(loadConfig({ ...ENV, MS_LOGIN_BASE: 'http://localhost:1', MS_GRAPH_BASE: 'http://localhost:1' })), /mail microsoft \(brickoodle\.com, fake\)/);
  });
  test('each variable is required with MAIL_MODE=microsoft, and named', () => {
    for (const k of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET']) refuses({ ...PROD, [k]: '' }, new RegExp(`^Glimmer World will not start: ${k} is missing \\(needed with MAIL_MODE=microsoft\\)$`));
    refuses({ ...PROD, MAIL_FROM: '' }, /MAIL_FROM is missing \(needed with MAIL_MODE=microsoft\)/);
    // not read at all with another mode
    assert.equal(loadConfig({ ...ENV, MAIL_MODE: 'memory', MS_TENANT_ID: 'nonsense' }).msTenantId, null);
  });
  test('wrong shapes refuse the start with one clear line', () => {
    refuses({ ...ENV, MS_TENANT_ID: 'brickoodle.onmicrosoft.com' }, /MS_TENANT_ID must be the Directory \(tenant\) ID/);
    refuses({ ...ENV, MS_CLIENT_ID: '0a1b2c3d' }, /MS_CLIENT_ID must be the Application \(client\) ID/);
    refuses({ ...ENV, MS_CLIENT_SECRET: CLIENT }, /MS_CLIENT_SECRET looks like the secret's ID: copy the secret's Value instead/);
    refuses({ ...ENV, MS_CLIENT_SECRET: 'short' }, /MS_CLIENT_SECRET must be the client secret Value/);
    refuses({ ...ENV, MS_CLIENT_SECRET: SECRET_VALUE + ' ' + SECRET_VALUE }, /MS_CLIENT_SECRET must be the client secret Value/);
    refuses({ ...ENV, MAIL_FROM: 'Glimmer World' }, /MAIL_FROM must name the sending mailbox/);
    refuses({ ...ENV, MAIL_FROM: 'a@b.com, c@d.com' }, /MAIL_FROM must name the sending mailbox/);
    const err = refuses({ ...PROD, MS_TENANT_ID: 'x', MS_CLIENT_ID: 'y', MS_CLIENT_SECRET: CLIENT }, /; .*; /);
    assert.equal(err.problems.length, 3);
  });
  test('MAIL_MODE must be a real provider in production (microsoft counts)', () => {
    refuses({ ...PROD, MAIL_MODE: 'log' }, /MAIL_MODE must be resend, postmark or microsoft in production/);
    refuses({ ...PROD, MAIL_MODE: 'memory' }, /MAIL_MODE must be resend, postmark or microsoft in production/);
  });
  test('SW_OPERATOR_EMAIL (every email\'s Reply-To) must be one bare address: a bad one would stop every email', () => {
    for (const bad of ['Glimmer World <hello@brickoodle.com>', 'hello@brickoodle.com,', 'a@b.com, c@d.com', 'hello@brickoodle', 'hello at brickoodle.com', 'hello@localhost']) {
      refuses({ ...PROD, SW_OPERATOR_EMAIL: bad }, /^Glimmer World will not start: SW_OPERATOR_EMAIL must be one bare address, like hello@your-domain$/);
    }
    // the same rule whatever MAIL_MODE (Resend and Postmark carry it as Reply-To too)
    refuses({ ...PROD, MAIL_MODE: 'resend', MAIL_API_KEY: 're_abc', SW_OPERATOR_EMAIL: 'Glimmer World <hello@brickoodle.com>' }, /SW_OPERATOR_EMAIL must be one bare address/);
    assert.equal(loadConfig({ ...PROD, SW_OPERATOR_EMAIL: 'Hello@Brickoodle.com' }).operator.email, 'Hello@Brickoodle.com');
    // development may use localhost
    assert.equal(loadConfig({ ...ENV, SW_OPERATOR_EMAIL: 'hello@localhost' }).operator.email, 'hello@localhost');
    for (const ok of [['a@b', 0], ['bare', 0], ['a@b.com', 1], ['a@localhost', 1]]) assert.equal(bareAddress(ok[0], true), !!ok[1], ok[0]);
  });
  test('MS_LOGIN_BASE and MS_GRAPH_BASE are for tests only: refused in production (whatever MAIL_MODE), like STRIPE_API_BASE', () => {
    refuses({ ...PROD, MS_LOGIN_BASE: 'http://127.0.0.1:1234' }, /MS_LOGIN_BASE is for tests only and is refused in production/);
    refuses({ ...PROD, MS_GRAPH_BASE: 'http://127.0.0.1:1234' }, /MS_GRAPH_BASE is for tests only and is refused in production/);
    refuses({ ...PROD, MAIL_MODE: 'resend', MAIL_API_KEY: 're_abc', MS_GRAPH_BASE: 'http://127.0.0.1:1234' }, /MS_GRAPH_BASE is for tests only/);
    refuses({ ...ENV, MS_LOGIN_BASE: 'ftp://x' }, /MS_LOGIN_BASE must be an http\(s\) address/);
    const c = loadConfig({ ...ENV, MS_LOGIN_BASE: 'http://127.0.0.1:9/', MS_GRAPH_BASE: 'http://127.0.0.1:9' });
    assert.deepEqual([c.msLoginBase, c.msGraphBase], ['http://127.0.0.1:9', 'http://127.0.0.1:9']);
  });
  test('mailboxOf', () => {
    assert.equal(mailboxOf('Glimmer World <Support@Brickoodle.com>'), 'support@brickoodle.com');
    assert.equal(mailboxOf('support@brickoodle.com'), 'support@brickoodle.com');
    assert.equal(mailboxOf('"Glimmer, World" <support@brickoodle.com>'), 'support@brickoodle.com');
    for (const bad of ['', 'Glimmer', '<>', 'a@b', 'x <a@b.com> <c@d.com>', 'a/b@c.com', 'a?b@c.com']) assert.equal(mailboxOf(bad), null, bad);
  });
  test('the direct notice names Microsoft 365 as the email provider', () => {
    const text = noticeSections({ mailMode: 'microsoft', publicOrigin: 'https://brickoodle.com' }).map((s) => s.text).join(' ');
    assert.match(text, /Microsoft 365 \(our emails\)/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the microsoft transport against the fake', () => {
  let fake;
  let cfg;
  let clock;
  let lines;
  let sleeps;
  const msg = (over = {}) => ({ id: 7, to: PARENT, from: FROM, replyTo: 'hello@brickoodle.com', template: 'check', subject: 'Your check code', text: 'Code: 123456', html: '<!doctype html><p>Code: 123456</p>', ...over });
  const transport = (o = {}) =>
    makeTransport(cfg, {
      log: (l) => {
        lines.push(l);
        spy.log(l);
      },
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...o,
    });
  const sends = () => fake.requests.filter((r) => r.kind === 'send');
  const tokenCalls = () => fake.requests.filter((r) => r.kind === 'token');

  before(async () => {
    fake = await startMsGraphFake({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET_VALUE, mailboxes: [MAILBOX] });
    cfg = loadConfig({ ...ENV, MS_LOGIN_BASE: fake.url, MS_GRAPH_BASE: fake.url });
  });
  after(async () => {
    for (const t of fake.tokens) remember(t);
    await fake.close();
  });
  beforeEach(() => {
    fake.reset();
    clock = 1_800_000_000_000;
    lines = [];
    sleeps = [];
  });

  test('the request shapes: token form, then sendMail for the mailbox with saveToSentItems false', async () => {
    await transport()(msg());
    const [tok, send] = fake.requests;
    assert.equal(tok.kind, 'token');
    assert.equal(tok.path, `/${TENANT}/oauth2/v2.0/token`);
    assert.match(tok.contentType, /^application\/x-www-form-urlencoded/);
    assert.deepEqual(tok.form, { client_id: CLIENT, client_secret: SECRET_VALUE, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
    assert.equal(send.kind, 'send');
    assert.equal(send.path, '/v1.0/users/support@brickoodle.com/sendMail', 'the MAIL_FROM mailbox, in the URL');
    assert.equal(send.status, 202);
    assert.equal(send.auth, `Bearer ${fake.tokens.at(-1)}`);
    assert.match(send.contentType, /^application\/json/);
    assert.deepEqual(send.body, {
      message: {
        subject: 'Your check code',
        body: { contentType: 'HTML', content: '<!doctype html><p>Code: 123456</p>' },
        toRecipients: [{ emailAddress: { address: PARENT } }],
        replyTo: [{ emailAddress: { address: 'hello@brickoodle.com' } }],
      },
      saveToSentItems: false,
    });
    // a template without HTML goes as Text; no reply-to when there is none
    await transport()(msg({ html: '', replyTo: null }));
    assert.deepEqual(fake.sent.at(-1).body.message.body, { contentType: 'Text', content: 'Code: 123456' });
    assert.ok(!('replyTo' in fake.sent.at(-1).body.message));
    assert.deepEqual(lines, [], 'nothing logged when all is well');
  });

  test('the token is kept until 5 minutes before it expires; one refresh at a time', async () => {
    const send = transport();
    await send(msg());
    await send(msg());
    assert.equal(tokenCalls().length, 1, 'cached');
    clock += 3599e3 - MS_TOKEN_EARLY_MS - 1000;
    await send(msg());
    assert.equal(tokenCalls().length, 1, 'still good just before the 5-minute margin');
    clock += 2000;
    await send(msg());
    assert.equal(tokenCalls().length, 2, 'renewed 5 minutes early');
    assert.equal(sends().at(-1).auth, `Bearer ${fake.tokens.at(-1)}`);
    // a cold cache and five emails at once: one token request
    const cold = transport();
    fake.reset();
    await Promise.all([1, 2, 3, 4, 5].map((id) => cold(msg({ id }))));
    assert.deepEqual([tokenCalls().length, sends().length, fake.sent.length], [1, 5, 5]);
    // a very short-lived token is not cached
    fake.reset();
    fake.expiresIn = 120;
    const brief = transport();
    await brief(msg());
    await brief(msg());
    assert.equal(tokenCalls().length, 2);
  });

  test('a 401 drops the token and tries once more with a fresh one', async () => {
    const send = transport();
    await send(msg());
    fake.revokeTokens();
    await send(msg());
    assert.deepEqual(sends().map((r) => r.status), [202, 401, 202]);
    assert.equal(tokenCalls().length, 2);
    assert.deepEqual(lines, []);
    // still 401 with a fresh token: one retry only, then a setup line
    fake.reset();
    fake.failSend({ status: 401, code: 'InvalidAuthenticationToken', times: 2 });
    await assert.rejects(send(msg()), (e) => e.code === 'http_401' && !e.permanent);
    assert.equal(sends().length, 2);
    assert.match(lines.at(-1), /^mail: Microsoft 365 refused the app's token \(401 InvalidAuthenticationToken\): check that MS_TENANT_ID and MS_CLIENT_ID/);
  });

  test('429: a short Retry-After is waited for once in place; a long one goes back to the outbox', async () => {
    const send = transport();
    fake.failSend({ status: 429, headers: { 'Retry-After': '2' }, code: 'ApplicationThrottled' });
    await send(msg());
    assert.deepEqual(sleeps, [2000]);
    assert.deepEqual(sends().map((r) => r.status), [429, 202]);
    fake.reset();
    fake.failSend({ status: 429, headers: { 'Retry-After': '120' }, code: 'ApplicationThrottled' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_429' && e.retryAfterMs === 120000 && !e.permanent);
    assert.deepEqual(sleeps, [2000], 'no long wait in place');
    assert.match(lines.at(-1), /Microsoft 365 is limiting how fast we send \(429\); trying again later/);
    // twice in a row short: waited once, then handed back
    fake.reset();
    fake.failSend({ status: 503, headers: { 'Retry-After': '1' }, times: 2 });
    await assert.rejects(send(msg()), (e) => e.code === 'http_503' && e.retryAfterMs === 1000);
    // no Retry-After: back to the outbox's own backoff
    fake.reset();
    fake.failSend({ status: 500 });
    await assert.rejects(send(msg()), (e) => e.code === 'http_500' && e.retryAfterMs === undefined);
    assert.equal(retryAfterMs('Wed, 21 Oct 2099 07:28:00 GMT', Date.UTC(2099, 9, 21, 7, 27, 0)), 60000);
    assert.equal(retryAfterMs('soon'), null);
    assert.equal(retryAfterMs(null), null);
  });

  test('403 and 404 name the likely fix (never the address or Microsoft\'s own text); 400 is permanent', async () => {
    const send = transport();
    fake.failSend({ status: 403, code: 'ErrorAccessDenied' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_403' && !e.permanent);
    assert.match(lines.at(-1), /^mail: Microsoft 365 refused \(403 ErrorAccessDenied\): the app needs the Mail\.Send application permission with admin consent/);
    // the mailbox does not exist: the fake's message quotes it, the log line does not
    const other = makeTransport({ ...cfg, msMailbox: 'nobody@brickoodle.com' }, { log: (l) => (lines.push(l), spy.log(l)), now: () => clock });
    remember('nobody@brickoodle.com');
    await assert.rejects(other(msg()), (e) => e.code === 'http_404');
    assert.match(lines.at(-1), /^mail: Microsoft 365 refused \(404 ErrorInvalidUser\): mailbox not found: MAIL_FROM must be a mailbox/);
    fake.failSend({ status: 404, code: 'MailboxNotEnabledForRESTAPI' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_404');
    assert.match(lines.at(-1), /has no Exchange Online mailbox/);
    fake.failSend({ status: 400, code: 'ErrorInvalidRecipients' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_400' && e.permanent === true);
    assert.match(lines.at(-1), /refused this email \(400 ErrorInvalidRecipients\); it will not be sent again/);
    fake.failSend({ status: 413, code: 'ErrorMessageSizeExceeded' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_413' && e.permanent === true);
    // any other 400 may be about the setup, not this one message: kept on the slow backoff
    fake.failSend({ status: 400, code: 'ErrorInvalidRequest' });
    await assert.rejects(send(msg()), (e) => e.code === 'http_400' && !e.permanent);
    assert.match(lines.at(-1), /^mail: Microsoft 365 refused \(400 ErrorInvalidRequest\); trying again later$/);
    // the same problem is logged once per 15 minutes, not for every email
    clock += 16 * 60e3;
    const before = lines.length;
    fake.failSend({ status: 403, code: 'ErrorAccessDenied', times: 3 });
    for (let i = 0; i < 3; i++) await assert.rejects(send(msg()));
    assert.equal(lines.length, before + 1);
    for (const l of lines) assert.ok(!/@|Scripted|requested user|Trace ID/.test(l), 'no address, no provider text: ' + l);
  });

  test('sign-in failures: a wrong or expired secret, a wrong app or tenant, an outage', async () => {
    const cases = [
      [{ status: 401, errorCodes: [7000215], error: 'invalid_client' }, /sign-in failed \(401\): the client secret is not right: put the secret's Value \(not its Secret ID\) in MS_CLIENT_SECRET \(AADSTS7000215\)/],
      [{ status: 401, errorCodes: [7000222], error: 'invalid_client' }, /the client secret has expired: make a new one .* \(AADSTS7000222\)/],
      [{ status: 400, errorCodes: [700016], error: 'unauthorized_client' }, /no app with this MS_CLIENT_ID in this tenant/],
      [{ status: 400, errorCodes: [90002], error: 'invalid_request' }, /the tenant was not found: check MS_TENANT_ID/],
      [{ status: 400, errorCodes: [], error: 'invalid_grant' }, /check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET \(invalid_grant\)/],
    ];
    for (const [f, re] of cases) {
      fake.failToken(f);
      await assert.rejects(transport()(msg()), (e) => e.code === `ms_token_${f.status}` && !e.permanent);
      assert.match(lines.at(-1), re);
    }
    assert.equal(sends().length, 0, 'no send without a token');
    fake.failToken({ status: 503, headers: { 'Retry-After': '30' } });
    await assert.rejects(transport()(msg()), (e) => e.code === 'ms_token_503' && e.retryAfterMs === 30000);
    // the real wrong secret, end to end with the fake's own check
    const wrong = makeTransport({ ...cfg, msClientSecret: 'Zz9~' + 'w'.repeat(30) }, { log: (l) => (lines.push(l), spy.log(l)), now: () => clock });
    await assert.rejects(wrong(msg()), (e) => e.code === 'ms_token_401');
    assert.match(lines.at(-1), /AADSTS7000215/);
    for (const l of lines) assert.ok(!l.includes(SECRET_VALUE) && !/Trace ID|Scripted/.test(l), l);
  });

  test('every request has a timeout', async () => {
    fake.hang = 'token';
    let t0 = Date.now();
    await assert.rejects(transport({ timeoutMs: 200 })(msg()), (e) => e.code === 'ms_token_timeout');
    assert.ok(Date.now() - t0 < 5000);
    fake.hang = 'send';
    t0 = Date.now();
    await assert.rejects(transport({ timeoutMs: 200 })(msg()), (e) => e.code === 'ms_send_timeout');
    assert.ok(Date.now() - t0 < 5000);
    assert.match(lines.at(-1), /Microsoft 365 could not be reached \(send: timed out\)/);
  });
});

// ---------------------------------------------------------------------------------------------
// The outbox with the microsoft transport, and a real sign-in through the server.

const DIR = mkdtempSync(path.join(tmpdir(), 'sw-ms-'));
const HTML = path.join(DIR, 'game.html');
writeFileSync(HTML, '<!doctype html><title>Glimmer World</title>');
process.on('exit', () => rmSync(DIR, { recursive: true, force: true }));
const HTTPS = 'https://brickoodle.com';

function call(base, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('the outbox and a sign-in code email through the fake', () => {
  let t;
  let fake;
  let accounts;
  let app;
  let base;
  let clock;
  before(async () => {
    t = await openTestDb();
    fake = await startMsGraphFake({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET_VALUE, mailboxes: [MAILBOX] });
    const cfg = loadConfig({ ...ENV, PUBLIC_ORIGIN: HTTPS, SW_TEST: '1', SW_OPERATOR_EMAIL: 'hello@brickoodle.com', MS_LOGIN_BASE: fake.url, MS_GRAPH_BASE: fake.url });
    clock = makeClock();
    accounts = await createAccounts(cfg, { log: spy.log, db: t.db, clock, timers: false });
    app = createServer({ accounts, htmlPath: HTML, siteDir: path.join(DIR, 'none'), log: spy.log, hsts: cfg.hsts });
    base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  });
  after(async () => {
    for (const tk of fake?.tokens || []) remember(tk);
    await app?.close();
    await accounts?.close?.();
    await fake?.close();
    await t?.close();
  });
  beforeEach(async () => {
    clock.set(0);
    fake.reset();
    await t.reset();
  });

  test('a sign-in code email: /api/auth/start → the outbox → Microsoft Graph → /api/auth/verify', async () => {
    const hd = { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'x-forwarded-for': '203.0.113.7', 'x-sw': '1', origin: HTTPS, 'content-type': 'application/json' };
    remember('203.0.113.7');
    const start = await call(base, 'POST', '/api/auth/start', { headers: hd, body: JSON.stringify({ email: PARENT }) });
    assert.equal(start.status, 202, start.text);
    const login = [].concat(start.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('__Host-sw_login='));
    assert.ok(login);
    remember(login.split('=')[1]);
    const r = await accounts.ctx.jobs.run('outbox');
    assert.deepEqual(r, { sent: 1, failed: 0, stopped: 0 });
    assert.equal(fake.sent.length, 1);
    const { mailbox, body } = fake.sent[0];
    assert.equal(mailbox, MAILBOX);
    assert.equal(body.saveToSentItems, false);
    assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: PARENT } }]);
    assert.deepEqual(body.message.replyTo, [{ emailAddress: { address: 'hello@brickoodle.com' } }]);
    assert.equal(body.message.body.contentType, 'HTML');
    const code = /^Your Glimmer World code: (\d{6})$/.exec(body.message.subject)?.[1];
    assert.ok(code, body.message.subject);
    remember(code);
    assert.ok(body.message.body.content.includes(code));
    const link = /#t=([A-Za-z0-9_-]+)/.exec(body.message.body.content)?.[1];
    if (link) remember(link);
    const row = await t.db.one('select * from outbox');
    assert.ok(row.sent_at && JSON.stringify(row.data) === '{}', 'sent and scrubbed');
    const verify = await call(base, 'POST', '/api/auth/verify', { headers: { ...hd, cookie: login }, body: JSON.stringify({ code }) });
    assert.equal(verify.status, 200, verify.text);
    for (const c of [].concat(verify.headers['set-cookie'] || [])) remember(c.split(';')[0].split('=')[1]);
  });

  test('outbox: a long Retry-After moves the next try (capped at 1 h, never before the backoff); 400 stops at once; 403 keeps the slow backoff', async () => {
    const one = async () => (await t.db.query('select * from outbox order by id desc limit 1')).rows[0];
    const now = () => clock.now();
    // 429 with Retry-After 120 s: next try in 120 s (longer than the 1-minute backoff)
    fake.failSend({ status: 429, headers: { 'Retry-After': '120' } });
    await accounts.ctx.mail.enqueue(t.db, 'friends_ready', PARENT, {});
    let t0 = now();
    await accounts.ctx.jobs.run('outbox');
    let row = await one();
    assert.deepEqual([row.tries, row.last_error], [1, 'http_429']);
    assert.ok(Math.abs(+row.send_after - t0 - 120e3) < 3000, 'Retry-After honored');
    // a huge Retry-After is capped at 1 h
    await t.reset();
    fake.reset();
    fake.failSend({ status: 503, headers: { 'Retry-After': '86400' } });
    await accounts.ctx.mail.enqueue(t.db, 'friends_ready', PARENT, {});
    t0 = now();
    await accounts.ctx.jobs.run('outbox');
    row = await one();
    assert.ok(Math.abs(+row.send_after - t0 - MAIL_RETRY_AFTER_CAP_MS) < 3000, 'capped');
    // a short one: the backoff (1 min) wins
    await t.reset();
    fake.reset();
    fake.failSend({ status: 500 });
    await accounts.ctx.mail.enqueue(t.db, 'friends_ready', PARENT, {});
    t0 = now();
    await accounts.ctx.jobs.run('outbox');
    row = await one();
    assert.ok(Math.abs(+row.send_after - t0 - MAIL_BACKOFF_MS[0]) < 3000);
    // and the retry goes out
    clock.set(2 * 60e3);
    assert.equal((await accounts.ctx.jobs.run('outbox')).sent, 1);
    // 400: stopped at once, data scrubbed
    await t.reset();
    fake.reset();
    fake.failSend({ status: 400, code: 'ErrorInvalidRecipients' });
    await accounts.ctx.mail.enqueue(t.db, 'consent_confirm', PARENT, { at: 1, v: 1 });
    assert.deepEqual(await accounts.ctx.jobs.run('outbox'), { sent: 0, failed: 0, stopped: 1 });
    row = await one();
    assert.deepEqual([row.tries, row.last_error, row.data, row.sent_at], [MAIL_MAX_TRIES, 'http_400', {}, null]);
    // 403 (a setup problem): the email waits on the slow backoff, and goes out once it is fixed
    await t.reset();
    fake.reset();
    fake.failSend({ status: 403, code: 'ErrorAccessDenied', times: 2 });
    clock.set(0);
    await accounts.ctx.mail.enqueue(t.db, 'consent_confirm', PARENT, { at: 1, v: 1 });
    assert.equal((await accounts.ctx.jobs.run('outbox')).failed, 1);
    clock.set(MAIL_BACKOFF_MS[0] + 1000);
    assert.equal((await accounts.ctx.jobs.run('outbox')).failed, 1);
    clock.set(MAIL_BACKOFF_MS[0] + MAIL_BACKOFF_MS[1] + 2000);
    assert.equal((await accounts.ctx.jobs.run('outbox')).sent, 1, 'sent once the permission is fixed');
  });
});

describe('logs', () => {
  test('no secret, token, code, address or IP address was ever logged', () => {
    assert.ok(spy.lines.some((l) => /^mail: Microsoft 365/.test(l)), 'the transport did log its hints through the spy');
    spy.check();
  });
});
