// The Microsoft 365 fake (docs/ACCOUNTS.md §12.3a): a local HTTP server that answers the two
// Microsoft calls MAIL_MODE=microsoft makes, so the real transport (server/mail.mjs) runs in the
// tests with no network. Point the app at it with MS_LOGIN_BASE and MS_GRAPH_BASE (both = fake.url;
// tests only, refused in production).
//
//   import { startMsGraphFake } from './ms-graph-fake.mjs';
//   const fake = await startMsGraphFake({ tenantId, clientId, clientSecret, mailboxes: ['support@x.com'] });
//   fake.url                        // MS_LOGIN_BASE and MS_GRAPH_BASE
//   fake.requests                   // every request: { kind: 'token'|'send'|'other', path, status,
//                                   //   form (token), auth, mailbox, body (send JSON) }
//   fake.sent                       // the accepted sendMail bodies: { mailbox, body }
//   fake.tokens                     // the access tokens it issued, in order
//   fake.expiresIn = 3599           // expires_in of the next tokens (seconds)
//   fake.revokeTokens()             // every token issued so far answers 401 (as after a rotation)
//   fake.failSend({ status, headers, code, times })   // the next `times` sendMail calls answer so
//   fake.failToken({ status, errorCodes, times })     // the next `times` token calls answer so
//   fake.hang = 'token'|'send'|null // never answer that kind (for the timeouts)
//   fake.reset()                    // forget requests, scripted failures and revocations (the
//                                   //   tokens issued stay valid, and in fake.tokens)
//   await fake.close()
//
// What it checks, like Microsoft does: the token form (client_id, client_secret, scope
// https://graph.microsoft.com/.default, grant_type client_credentials) for the right tenant
// (wrong secret → 401 invalid_client AADSTS7000215, unknown tenant → 400 AADSTS90002, unknown
// app → 400 AADSTS700016); sendMail's bearer token (unknown or revoked → 401
// InvalidAuthenticationToken), the mailbox (unknown → 404 ErrorInvalidUser, whose message quotes
// the address, as Microsoft's does, so a test can check it is never logged), a JSON body with a
// message → 202 Accepted with no body. Its error texts imitate Microsoft's; nothing here is real.

import http from 'node:http';
import { randomBytes } from 'node:crypto';

export async function startMsGraphFake({ tenantId, clientId, clientSecret, mailboxes = [] } = {}) {
  const issued = new Set();
  const revoked = new Set();
  const fake = {
    url: '',
    requests: [],
    sent: [],
    tokens: [],
    expiresIn: 3599,
    hang: null,
    sendFailures: [],
    tokenFailures: [],
    mailboxes: new Set(mailboxes.map((m) => m.toLowerCase())),
    revokeTokens() {
      for (const t of issued) revoked.add(t);
    },
    failSend({ status = 500, headers = {}, code = null, times = 1 } = {}) {
      for (let i = 0; i < times; i++) fake.sendFailures.push({ status, headers, code });
    },
    failToken({ status = 400, errorCodes = [], error = 'invalid_request', headers = {}, times = 1 } = {}) {
      for (let i = 0; i < times; i++) fake.tokenFailures.push({ status, errorCodes, error, headers });
    },
    reset() {
      fake.requests.length = 0;
      fake.sent.length = 0;
      fake.sendFailures.length = 0;
      fake.tokenFailures.length = 0;
      fake.hang = null;
      fake.expiresIn = 3599;
      revoked.clear();
    },
  };
  const hanging = [];

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const aadError = (res, status, error, code, description, headers = {}) =>
    json(res, status, { error, error_description: `AADSTS${code}: ${description} Trace ID: ${randomBytes(8).toString('hex')}`, error_codes: [code], timestamp: new Date().toISOString() }, headers);
  const graphError = (res, status, code, message, headers = {}) => json(res, status, { error: { code, message } }, headers);

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const u = new URL(req.url, 'http://fake');
      const tokenPath = /^\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(u.pathname);
      const sendPath = /^\/v1\.0\/users\/([^/]+)\/sendMail$/.exec(u.pathname);
      const rec = { kind: tokenPath ? 'token' : sendPath ? 'send' : 'other', method: req.method, path: u.pathname, status: 0 };
      fake.requests.push(rec);
      const answer = (fn) => {
        fn();
        rec.status = res.statusCode;
      };
      if (rec.kind !== 'other' && fake.hang === rec.kind) {
        hanging.push(res);
        return;
      }
      if (req.method !== 'POST' || rec.kind === 'other') return answer(() => graphError(res, 404, 'UnknownPath', 'not here'));

      if (tokenPath) {
        const form = Object.fromEntries(new URLSearchParams(text));
        rec.form = form;
        rec.contentType = req.headers['content-type'] || '';
        const f = fake.tokenFailures.shift();
        if (f) return answer(() => (f.errorCodes.length ? aadError(res, f.status, f.error, f.errorCodes[0], 'Scripted failure.', f.headers) : json(res, f.status, { error: f.error }, f.headers)));
        if (decodeURIComponent(tokenPath[1]).toLowerCase() !== String(tenantId).toLowerCase()) return answer(() => aadError(res, 400, 'invalid_request', 90002, `Tenant '${tokenPath[1]}' not found.`));
        if (form.grant_type !== 'client_credentials') return answer(() => aadError(res, 400, 'unsupported_grant_type', 70003, 'The app requested an unsupported grant type.'));
        if (form.scope !== 'https://graph.microsoft.com/.default') return answer(() => aadError(res, 400, 'invalid_scope', 1002012, 'The provided value for scope is not valid.'));
        if (String(form.client_id).toLowerCase() !== String(clientId).toLowerCase()) return answer(() => aadError(res, 400, 'unauthorized_client', 700016, `Application with identifier '${form.client_id}' was not found in the directory.`));
        if (form.client_secret !== clientSecret) return answer(() => aadError(res, 401, 'invalid_client', 7000215, 'Invalid client secret provided.'));
        const token = 'fake-at-' + (fake.tokens.length + 1) + '-' + randomBytes(12).toString('hex');
        issued.add(token);
        fake.tokens.push(token);
        return answer(() => json(res, 200, { token_type: 'Bearer', expires_in: fake.expiresIn, ext_expires_in: fake.expiresIn, access_token: token }));
      }

      // sendMail
      rec.auth = req.headers.authorization || '';
      rec.mailbox = decodeURIComponent(sendPath[1]);
      rec.rawMailbox = sendPath[1];
      rec.contentType = req.headers['content-type'] || '';
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {}
      rec.body = body;
      const token = /^Bearer (.+)$/.exec(rec.auth)?.[1];
      if (!token || !issued.has(token) || revoked.has(token)) return answer(() => graphError(res, 401, 'InvalidAuthenticationToken', 'Access token validation failure. Invalid audience.'));
      const f = fake.sendFailures.shift();
      if (f) return answer(() => graphError(res, f.status, f.code || `Http${f.status}`, `Scripted failure for '${rec.mailbox}'.`, f.headers));
      if (!fake.mailboxes.has(rec.mailbox.toLowerCase())) return answer(() => graphError(res, 404, 'ErrorInvalidUser', `The requested user '${rec.mailbox}' is invalid.`));
      if (!body || !body.message || !rec.contentType.startsWith('application/json')) return answer(() => graphError(res, 400, 'ErrorInvalidRequest', 'Cannot read the request body.'));
      fake.sent.push({ mailbox: rec.mailbox, body });
      return answer(() => {
        res.writeHead(202);
        res.end();
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = async () => {
    for (const r of hanging.splice(0)) r.destroy();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  };
  return fake;
}
