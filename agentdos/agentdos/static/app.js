/* AGENTDOS front end. No framework, no build step. */
(() => {
  'use strict';

  // ── constants ──────────────────────────────────────────────────────────────

  const COLS = [
    { key: 'todo', label: 'TODO', empty: 'File not found.' },
    { key: 'doing', label: 'DOING', empty: 'No agents at work.' },
    { key: 'blocked', label: 'NEEDS YOU', empty: 'No questions. Yet.' },
    { key: 'review', label: 'REVIEW', empty: 'Nothing to review.' },
    { key: 'done', label: 'DONE', empty: '0 file(s) completed.' },
  ];
  const COL_KEYS = COLS.map((c) => c.key);
  const COL_LABEL = Object.fromEntries(COLS.map((c) => [c.key, c.label]));
  const PRIOS = ['low', 'normal', 'high', 'urgent'];
  const PRIO_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
  const THEMES = ['norton', 'amber', 'phosphor', 'neon'];
  const THEME_NAMES = { norton: 'Norton', amber: 'Amber', phosphor: 'Phosphor', neon: 'Neon' };
  const KIND = {
    created: 'NEW', claimed: 'CLAIM', progress: 'LOG', comment: 'NOTE', completed: 'FINISH',
    blocked: 'ASK', replied: 'REPLY', approved: 'OK', rejected: 'REJECT', released: 'RELEASE',
    expired: 'TIMEOUT', moved: 'MOVE', edited: 'EDIT', deleted: 'DEL',
  };
  const SPIN = ['|', '/', '-', '\\'];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NARROW = matchMedia('(max-width: 820px)');

  // ── tiny helpers ───────────────────────────────────────────────────────────

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(4, '0');
  const linkify = (html) => html.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('agentdos.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('agentdos.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  // ── state ──────────────────────────────────────────────────────────────────

  const state = {
    board: null,
    tasks: new Map(),
    cols: {},
    config: null,
    sel: null,
    activeCol: 'todo',
    kbCol: false,
    filter: '',
    lastEventId: null,
    logFloor: 0,
    offset: 0,
    token: store.get('token'),
    dialogs: [],
    menu: null,
    dragging: false,
    pendingRender: false,
    history: store.get('history', []),
    histIdx: -1,
    es: null,
    live: null,
    booting: false,
  };

  const now = () => Date.now() + state.offset;

  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, Math.round((now() - Date.parse(iso)) / 1000));
    if (s < 10) return 'now';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function until(iso) {
    const s = Math.round((Date.parse(iso) - now()) / 1000);
    if (s <= 0) return 'expiring';
    return s < 60 ? s + 's' : Math.ceil(s / 60) + 'm';
  }

  const hms = (iso) => new Date(iso).toTimeString().slice(0, 8);

  // ── API ────────────────────────────────────────────────────────────────────

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(method, path, body) {
    const headers = { Accept: 'application/json' };
    const init = { method, headers };
    if (method === 'POST' || method === 'PATCH') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw new ApiError(0, 'Board server unreachable');
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401) {
      askToken();
      throw new ApiError(401, 'Access token required');
    }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText);
    return data;
  }

  // ── loading + live updates ─────────────────────────────────────────────────

  let inflight = null;
  let queued = false;
  let refreshTimer = 0;

  function refresh() {
    if (inflight) { queued = true; return inflight; }
    inflight = (async () => {
      try {
        applyBoard(await api('GET', '/api/board'));
      } catch (e) {
        if (e.status !== 401) setLive(false);
      } finally {
        inflight = null;
        if (queued) { queued = false; refresh(); }
      }
    })();
    return inflight;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 60);
  }

  function connectStream() {
    if (state.es) state.es.close();
    const es = new EventSource('/api/stream' + (state.token ? '?token=' + encodeURIComponent(state.token) : ''));
    es.addEventListener('change', () => { setLive(true); scheduleRefresh(); });
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    state.es = es;
  }

  function setLive(on) {
    if (state.live === on) return;
    state.live = on;
    const el = $('#live');
    el.textContent = on ? '● LIVE' : '○ OFFLINE';
    el.className = 'live ' + (on ? 'on' : 'off');
  }

  function applyBoard(b) {
    state.offset = Date.parse(b.now) - Date.now();
    state.board = b;
    state.tasks = new Map(b.tasks.map((t) => [t.id, t]));
    if (state.sel && !state.tasks.has(state.sel)) state.sel = null;
    announce(b.events);
    renderAll();
    const top = topDialog();
    if (top && top.taskId) refreshTaskDialog(top);
  }

  function announce(events) {
    const maxId = events.length ? events[events.length - 1].id : 0;
    if (state.lastEventId === null) { state.lastEventId = maxId; return; }
    for (const e of events) {
      if (e.id <= state.lastEventId || e.actor === 'human') continue;
      const t = e.task_title ? ` <b>#${pad(e.task_id)}</b> ${esc(e.task_title)}` : '';
      const who = `<b>${esc(e.actor)}</b>`;
      const msg = {
        claimed: [`■ ${who} claimed${t}`, ''],
        completed: [`✓ ${who} finished${t}`, 'ok'],
        blocked: [`? ${who} needs you on${t}<br>“${esc(e.message)}”`, 'ask'],
        released: [`↩ ${who} released${t}`, ''],
        expired: [`⌛ Lease expired on${t}`, ''],
        created: [`+ ${who} added${t}`, ''],
      }[e.kind];
      if (msg) toast(msg[0], { kind: msg[1], onClick: e.task_id && state.tasks.has(e.task_id) ? () => openTask(e.task_id) : null });
    }
    state.lastEventId = Math.max(state.lastEventId, maxId);
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function renderAll() {
    if (!state.board) return;
    if (state.dragging) { state.pendingRender = true; return; }
    renderStats();
    renderBoard();
    renderAgents();
    renderLog();
  }

  function matches(t, f) {
    if (!f) return true;
    const hay = [`#${t.id}`, `#${pad(t.id)}`, t.title, t.description, t.claimed_by, t.assignee, ...t.tags.map((x) => '#' + x)]
      .join('\n').toLowerCase();
    return f.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function sortTasks(key, list) {
    const by = {
      todo: (a, b) => PRIO_RANK[b.priority] - PRIO_RANK[a.priority] || a.id - b.id,
      doing: (a, b) => Date.parse(a.claimed_at || 0) - Date.parse(b.claimed_at || 0),
      blocked: (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
      review: (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
      done: (a, b) => Date.parse(b.completed_at || 0) - Date.parse(a.completed_at || 0),
    }[key];
    return list.sort(by);
  }

  function renderStats() {
    const c = state.board.counts;
    const agents = state.board.agents;
    const working = agents.filter((a) => a.state === 'working').length;
    const online = agents.filter((a) => a.state !== 'offline').length;
    const needs = c.blocked + c.review;
    $('#stats').innerHTML = [
      `<span class="stat">TODO <b>${c.todo}</b></span>`,
      `<span class="stat">DOING <b>${c.doing}</b></span>`,
      c.blocked ? `<span class="stat attn"><span class="${REDUCED ? '' : 'blink'}">■</span> NEEDS YOU <b>${c.blocked}</b></span>` : '',
      `<span class="stat${c.review ? ' attn' : ''}">REVIEW <b>${c.review}</b></span>`,
      `<span class="stat">DONE <b>${c.done}</b></span>`,
      `<span class="stat">AGENTS <b>${working}</b> working / <b>${online}</b> online</span>`,
    ].join('');
    document.title = (needs ? `(${needs}) ` : '') + 'AGENTDOS';
    const f = $('#filter');
    f.hidden = !state.filter;
    f.innerHTML = state.filter ? `FIND: “${esc(state.filter)}” <kbd>(Esc clears)</kbd>` : '';
  }

  function cardHTML(t) {
    const prio = {
      urgent: '<span class="prio p-urgent">!! URGENT</span>',
      high: '<span class="prio p-high">▲ HIGH</span>',
      low: '<span class="prio p-low">▽ low</span>',
    }[t.priority] || '';
    const tags = t.tags.map((x) => `<span class="tag">#${esc(x)}</span>`).join('');
    let who = '';
    if (t.status === 'todo') {
      if (t.assignee === 'human') who = '<span class="who who-human">♦ for me</span>';
      else if (t.assignee) who = `<span class="who">→ ${esc(t.assignee)}</span>`;
    }
    let extra = '';
    if (t.status === 'todo') {
      const by = t.created_by !== 'human' ? `added by ${esc(t.created_by)} · ` : '';
      extra = `<div class="card-line">${by}${ago(t.created_at)}</div>`;
    } else if (t.status === 'doing') {
      const lease = t.lease_expires ? ` · lease ${until(t.lease_expires)}` : '';
      const me = t.claimed_by === 'human' ? 'you' : esc(t.claimed_by);
      extra = `<div class="card-line by"><span class="spin">${REDUCED ? '▶' : SPIN[spinFrame]}</span> ${me} · ${ago(t.claimed_at)}${lease}</div>`;
    } else if (t.status === 'blocked') {
      if (t.question) extra += `<div class="card-line q clamp">? ${esc(t.question)}</div>`;
      extra += `<div class="card-line">asked by ${esc(t.claimed_by || '?')} · ${ago(t.updated_at)}</div>`;
    } else if (t.status === 'review') {
      if (t.result) extra += `<div class="card-line r clamp">✓ ${esc(firstLine(t.result))}</div>`;
      extra += `<div class="card-line">by ${esc(t.claimed_by || '?')} · ${ago(t.updated_at)}</div>`;
    } else if (t.status === 'done') {
      extra = `<div class="card-line">✓ ${t.claimed_by ? 'by ' + esc(t.claimed_by) + ' · ' : ''}${ago(t.completed_at)}</div>`;
    }
    return `<article class="card prio-${t.priority}${t.id === state.sel ? ' sel' : ''}" data-id="${t.id}" draggable="true" tabindex="0"
        aria-selected="${t.id === state.sel}" aria-label="Task ${t.id}: ${esc(t.title)}">
      <div class="card-top"><span class="card-id">#${pad(t.id)}</span>${prio}</div>
      <div class="card-title">${esc(t.title)}</div>
      ${tags || who ? `<div class="card-meta">${tags}${who}</div>` : ''}
      ${extra}
    </article>`;
  }

  function renderBoard() {
    const groups = Object.fromEntries(COL_KEYS.map((k) => [k, []]));
    for (const t of state.tasks.values()) if (matches(t, state.filter)) groups[t.status].push(t);
    const boardEl = $('#board');
    const scroll = Object.fromEntries($$('.col', boardEl).map((c) => [c.dataset.status, $('.col-body', c).scrollTop]));
    const empty = state.tasks.size === 0;
    const hadFocus = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#board .card'));
    boardEl.innerHTML = COLS.map((c) => {
      const list = sortTasks(c.key, groups[c.key]);
      state.cols[c.key] = list.map((t) => t.id);
      const count = state.board.counts[c.key];
      const shown = state.filter ? `${list.length}/${count}` : String(count);
      let emptyMsg = state.filter ? 'No matches.' : c.empty;
      if (empty && c.key === 'todo') emptyMsg += '\n\nType a to-do at the\nC:\\AGENTDOS> prompt below\nand press Enter.';
      const kb = state.kbCol && state.activeCol === c.key && !NARROW.matches ? ' kb' : '';
      return `<section class="col${c.key === state.activeCol ? ' active' : ''}${kb}" data-status="${c.key}" aria-label="${c.label}">
        <h2 class="col-title">${c.label} <span class="count">${shown}</span></h2>
        <div class="col-body">${list.map(cardHTML).join('') || `<p class="empty">${esc(emptyMsg)}</p>`}</div>
      </section>`;
    }).join('');
    for (const [k, top] of Object.entries(scroll)) {
      const body = $(`.col[data-status="${k}"] .col-body`, boardEl);
      if (body) body.scrollTop = top;
    }
    if (hadFocus && state.sel) { const c = $(`.card[data-id="${state.sel}"]`, boardEl); if (c) c.focus({ preventScroll: true }); }
    $('#coltabs').innerHTML = COLS.map((c) => {
      const n = state.board.counts[c.key];
      const attn = (c.key === 'blocked' || c.key === 'review') && n ? ' attn' : '';
      return `<button type="button" role="tab" class="${attn}" data-col="${c.key}" aria-selected="${c.key === state.activeCol}">${c.label} ${n}</button>`;
    }).join('');
  }

  function renderAgents() {
    const agents = state.board.agents;
    const el = $('#agents');
    if (!agents.length) {
      el.innerHTML = '<p class="log-hint pre-line">No agents have checked in yet.\nPress “+ Connect an agent” to hook one up.</p>';
      return;
    }
    const icon = { working: REDUCED ? '▶' : SPIN[spinFrame], idle: '○', offline: '·' };
    el.innerHTML = `<div class="agents-head"><span></span><span>AGENT</span><span>STATE</span><span>TASK</span><span>SEEN</span></div>` +
      agents.map((a) => `<div class="agent ${a.state}">
        <span class="a-state${a.state === 'working' ? ' spin' : ''}">${icon[a.state]}</span>
        <span class="a-name" title="${esc(a.name)}">${esc(a.name)}</span>
        <span class="a-label">${a.state.toUpperCase()}</span>
        <span class="a-task">${a.tasks.map((id) => `<button type="button" data-open="${id}">#${pad(id)}</button>`).join(' ') || '-'}</span>
        <span class="a-seen">${ago(a.last_seen)}</span>
      </div>`).join('');
  }

  function eventText(e) {
    const title = e.task_title ? esc(e.task_title) : '';
    switch (e.kind) {
      case 'claimed': return title;
      case 'moved': case 'edited': return `${title} <span class="log-hint">(${esc(e.message)})</span>`;
      case 'approved': return e.message ? `${title}: ${esc(e.message)}` : title;
      default: return esc(e.message) || title;
    }
  }

  function renderLog() {
    const el = $('#log');
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    const events = state.board.events.filter((e) => e.id > state.logFloor);
    el.innerHTML = events.length
      ? events.map((e) => `<div class="ev k-${esc(e.kind)}"><time>${hms(e.ts)}</time> <span class="ev-actor">${esc(e.actor)}</span> <span class="ev-kind">${KIND[e.kind] || esc(e.kind.toUpperCase())}</span> ${e.task_id && e.task_title ? `<button type="button" class="tid" data-open="${e.task_id}">#${pad(e.task_id)}</button> ` : ''}${eventText(e)}</div>`).join('')
      : '<div class="log-hint">C:\\AGENTDOS&gt; _  waiting for activity…</div>';
    if (stick) el.scrollTop = el.scrollHeight;
  }

  // ── selection + keyboard navigation ────────────────────────────────────────

  function markActiveCol() {
    $$('#board .col').forEach((c) => {
      c.classList.toggle('active', c.dataset.status === state.activeCol);
      c.classList.toggle('kb', state.kbCol && c.dataset.status === state.activeCol && !NARROW.matches);
    });
    $$('#coltabs [data-col]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.col === state.activeCol)));
  }

  function select(id, { scroll = true, focus = false } = {}) {
    state.sel = id;
    const t = state.tasks.get(id);
    if (t) state.activeCol = t.status;
    $$('.card.sel').forEach((c) => { c.classList.remove('sel'); c.setAttribute('aria-selected', 'false'); });
    markActiveCol();
    const card = $(`.card[data-id="${id}"]`);
    if (card) {
      card.classList.add('sel');
      card.setAttribute('aria-selected', 'true');
      if (scroll) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const ae = document.activeElement;
      if (focus || ae === document.body || (ae && ae.classList.contains('card'))) card.focus({ preventScroll: true });
    }
  }

  function nav(dx, dy) {
    state.kbCol = true;
    const t = state.sel && state.tasks.get(state.sel);
    let ci = COL_KEYS.indexOf(t ? t.status : state.activeCol);
    const ids = state.cols[COL_KEYS[ci]] || [];
    let ri = t ? ids.indexOf(t.id) : -1;
    if (dy) {
      if (!ids.length) return;
      ri = ri < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, ri + dy));
      select(ids[ri]);
      return;
    }
    ci = Math.max(0, Math.min(COL_KEYS.length - 1, ci + dx));
    state.activeCol = COL_KEYS[ci];
    const next = state.cols[state.activeCol] || [];
    if (next.length) select(next[Math.max(0, Math.min(next.length - 1, ri < 0 ? 0 : ri))]);
    else {
      state.sel = null;
      $$('.card.sel').forEach((c) => c.classList.remove('sel'));
      markActiveCol();
      const col = $(`#board .col[data-status="${state.activeCol}"]`);
      if (col) col.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function withSel(fn) {
    if (state.sel && state.tasks.has(state.sel)) return fn(state.sel);
    cmdOut('Select a task first: arrow keys, or click a card.', true);
  }

  // ── actions ────────────────────────────────────────────────────────────────

  async function moveTo(id, status) {
    const t = state.tasks.get(id);
    if (!t || t.status === status) return;
    try {
      if (t.status === 'review' && status === 'done') {
        await api('POST', `/api/tasks/${id}/approve`, {});
      } else if (t.status === 'review' && status === 'todo') {
        return openTask(id, 'feedback');
      } else if (t.status === 'blocked' && status === 'todo') {
        return openTask(id, 'reply');
      } else {
        if (t.status === 'doing' && t.claimed_by && t.claimed_by !== 'human') {
          const ok = await confirmBox(`<b>${esc(t.claimed_by)}</b> is working on #${pad(id)} right now.\nMove it to ${COL_LABEL[status]} anyway?`, { yes: 'Move it' });
          if (!ok) return;
        }
        await api('PATCH', `/api/tasks/${id}`, { status });
      }
      cmdOut(`#${pad(id)} → ${COL_LABEL[status]}`);
      flashCard(id);
    } catch (e) { showError(e); }
    refresh();
  }

  function moveDir(id, dir) {
    const order = ['todo', 'doing', 'review', 'done'];
    const t = state.tasks.get(id);
    if (!t) return;
    if (t.status === 'blocked') return openTask(id, 'reply');
    const i = order.indexOf(t.status) + dir;
    if (i < 0 || i >= order.length) return cmdOut(`#${pad(id)} is already in ${COL_LABEL[t.status]}.`, true);
    moveTo(id, order[i]);
  }

  function flashCard(id) {
    setTimeout(() => {
      const c = $(`.card[data-id="${id}"]`);
      if (c && !REDUCED) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
    }, 120);
  }

  async function deleteTask(id) {
    const t = state.tasks.get(id);
    if (!t) return;
    const ok = await confirmBox(`Delete task #${pad(id)}?\n“${esc(t.title)}”\n\nThis cannot be undone.`, { yes: 'Delete', danger: true, title: 'Delete' });
    if (!ok) return false;
    try {
      await api('DELETE', `/api/tasks/${id}`);
      cmdOut(`#${pad(id)} deleted.`);
      if (state.sel === id) state.sel = null;
      refresh();
      return true;
    } catch (e) { showError(e); return false; }
  }

  function parseQuickAdd(text) {
    const data = { tags: [] };
    const words = [];
    for (const w of text.split(/\s+/)) {
      const lw = w.toLowerCase();
      if (lw === '!!' || lw === '!urgent') data.priority = 'urgent';
      else if (lw === '!' || lw === '!high') data.priority = 'high';
      else if (lw === '!low') data.priority = 'low';
      else if (lw === '!normal') data.priority = 'normal';
      else if (/^#[a-z0-9][a-z0-9._-]*$/i.test(w)) data.tags.push(lw.slice(1));
      else if (/^@[a-z0-9][a-z0-9._@-]*$/i.test(w)) data.assignee = ['@me', '@human'].includes(lw) ? 'human' : lw === '@any' ? '' : w.slice(1);
      else if (w) words.push(w);
    }
    data.title = words.join(' ');
    return data;
  }

  async function quickAdd(text) {
    const data = parseQuickAdd(text);
    if (!data.title) return cmdOut('Missing title. Example: add Fix login bug !high #code @claude-1', true);
    try {
      const t = await api('POST', '/api/tasks', data);
      cmdOut(`Task #${pad(t.id)} created.`);
      await refresh();
      select(t.id);
      flashCard(t.id);
    } catch (e) { showError(e); }
  }

  function exportBoard() {
    const blob = new Blob([JSON.stringify(state.board ? state.board.tasks : [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agentdos-board-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    cmdOut('Board exported.');
  }

  function setTheme(name) {
    const theme = THEMES.includes(name) ? name : 'norton';
    document.documentElement.dataset.theme = theme;
    store.set('theme', theme);
    return theme;
  }

  function cycleTheme() {
    const cur = document.documentElement.dataset.theme;
    const next = setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
    cmdOut(`Theme: ${THEME_NAMES[next]}`);
  }

  function toggleClass(cls, key, on) {
    const root = document.documentElement;
    const value = on ?? root.classList.contains(cls);
    root.classList.toggle(cls, !value);
    store.set(key, value);
    return value;
  }

  const ACTIONS = {
    help: () => openHelp(),
    new: () => openNew(),
    view: () => withSel((id) => openTask(id, 'history')),
    edit: () => withSel((id) => openTask(id, 'title')),
    refresh: () => { refresh(); cmdOut('Board refreshed.'); },
    move: () => withSel((id) => moveDir(id, 1)),
    moveback: () => withSel((id) => moveDir(id, -1)),
    find: () => { const c = $('#cmd'); c.value = 'find '; c.focus(); },
    delete: () => withSel(deleteTask),
    menu: () => openMenu(1, 0),
    theme: cycleTheme,
    crt: () => cmdOut('CRT effect ' + (toggleClass('no-crt', 'crt') ? 'on.' : 'off.')),
    dock: () => cmdOut('Dock ' + (toggleClass('no-dock', 'dock') ? 'shown.' : 'hidden.')),
    connect: () => openConnect(),
    protocol: () => window.open('/AGENTS.md', '_blank', 'noopener'),
    about: () => openAbout(),
    boot: () => boot(true),
    export: exportBoard,
    exit: () => openMessage('Exit', 'Cannot exit to DOS.\n\nYour agents are still working.\n(Close the browser tab if you really must.)'),
  };

  function act(name) {
    const [base, arg] = name.split(':');
    if (base === 'theme' && arg) { setTheme(arg); cmdOut(`Theme: ${THEME_NAMES[arg]}`); return; }
    const fn = ACTIONS[base];
    if (fn) fn();
  }

  // ── command line ───────────────────────────────────────────────────────────

  let outTimer = 0;
  function cmdOut(msg, err = false) {
    const el = $('#cmdout');
    el.textContent = msg;
    el.classList.toggle('err', err);
    clearTimeout(outTimer);
    outTimer = setTimeout(() => { el.textContent = ''; }, 6000);
  }

  function parseId(s) {
    const m = String(s || '').match(/#?0*(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function needId(arg, fn) {
    const id = parseId(arg);
    if (!id) return cmdOut('Bad command or file name. Which task? e.g. 12', true);
    if (!state.tasks.has(id)) return cmdOut(`Task #${pad(id)} not found.`, true);
    return fn(id);
  }

  function runCommand(raw) {
    const line = raw.trim();
    if (!line) return;
    state.history = [line, ...state.history.filter((h) => h !== line)].slice(0, 50);
    state.histIdx = -1;
    store.set('history', state.history);
    const word = line.split(/\s+/)[0];
    const arg = line.slice(word.length).trim();
    switch (word.toLowerCase()) {
      case 'help': case '?': case 'h': return openHelp();
      case 'add': case 'new': return arg ? quickAdd(arg) : openNew();
      case 'open': case 'view': case 'edit': case 'type': case 'cat': return needId(arg, (id) => openTask(id));
      case 'done': return needId(arg, (id) => moveTo(id, 'done'));
      case 'approve': return needId(arg, (id) => moveTo(id, 'done'));
      case 'move': case 'mv': {
        const [idPart, col] = arg.split(/\s+/);
        const target = COL_KEYS.find((k) => k === (col || '').toLowerCase() || COL_LABEL[k].toLowerCase().replace(' ', '') === (col || '').toLowerCase());
        if (!target) return cmdOut('Usage: move 12 todo|doing|blocked|review|done', true);
        return needId(idPart, (id) => moveTo(id, target));
      }
      case 'del': case 'rm': case 'delete': case 'erase': return needId(arg, deleteTask);
      case 'find': case 'filter': case 'grep':
        state.filter = arg;
        renderAll();
        return cmdOut(arg ? `Filtering on “${arg}”.` : 'Filter cleared.');
      case 'cls': case 'clear':
        state.logFloor = state.lastEventId || 0;
        renderLog();
        return cmdOut('Log cleared.');
      case 'theme': case 'color':
        if (!arg) return cycleTheme();
        if (!THEMES.includes(arg.toLowerCase())) return cmdOut('Themes: ' + THEMES.join(', '), true);
        setTheme(arg.toLowerCase());
        return cmdOut(`Theme: ${THEME_NAMES[arg.toLowerCase()]}`);
      case 'crt': return act('crt');
      case 'agents': case 'connect': return openConnect();
      case 'ver': return cmdOut(`AGENTDOS Version ${state.config ? state.config.version : '1.0'}`);
      case 'date': case 'time': return cmdOut(new Date().toString());
      case 'dir': case 'ls': {
        const c = state.board ? state.board.counts : {};
        return cmdOut(COLS.map((col) => `${col.label} ${c[col.key] || 0}`).join(' · '));
      }
      case 'export': return exportBoard();
      case 'exit': case 'quit': case 'logout': return act('exit');
      default: return quickAdd(line);
    }
  }

  // ── dialogs ────────────────────────────────────────────────────────────────

  let dlgSeq = 0;
  const topDialog = () => state.dialogs[state.dialogs.length - 1];

  function openDialog({ title, body, buttons = '', size = '', dismissable = false, onClose, onSubmit, cls = '' }) {
    closeMenu();
    const id = 'dlg' + (++dlgSeq);
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="dlg ${size} ${cls}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
      <div class="dlg-frame">
        <button class="dlg-close" type="button" data-close aria-label="Close">[<span>■</span>]</button>
        <h2 class="dlg-title" id="${id}-t">${esc(title)}</h2>
        <div class="dlg-body">${body}</div>
        ${buttons ? `<div class="dlg-buttons">${buttons}</div>` : ''}
      </div>
    </div>`;
    const d = { el: overlay, prevFocus: document.activeElement, onClose, onSubmit, dirty: false };
    d.close = (force = false) => closeDialog(d, force);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && dismissable) d.close();
      if (e.target.closest('[data-close]')) d.close();
    });
    overlay.addEventListener('input', () => { d.dirty = true; });
    $('#modal-root').appendChild(overlay);
    state.dialogs.push(d);
    setTimeout(() => {
      const f = $('[autofocus]', overlay) || $('input:not([type=radio]):not([type=checkbox]), textarea', overlay) || $('.dlg-buttons .btn', overlay);
      if (f) f.focus();
    }, 20);
    return d;
  }

  async function closeDialog(d, force) {
    if (!force && d.dirty && d.confirmDirty) {
      const ok = await confirmBox('Discard your unsaved changes?', { yes: 'Discard', no: 'Keep editing' });
      if (!ok) return;
    }
    const i = state.dialogs.indexOf(d);
    if (i >= 0) state.dialogs.splice(i, 1);
    d.el.remove();
    if (d.onClose) d.onClose();
    if (d.prevFocus && document.contains(d.prevFocus)) d.prevFocus.focus();
  }

  function confirmBox(message, { yes = 'Yes', no = 'No', danger = false, title = 'Confirm' } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const d = openDialog({
        title,
        size: 'narrow',
        cls: danger ? 'error' : '',
        body: `<p style="white-space:pre-line;text-align:center">${message}</p>`,
        buttons: `<button class="btn" type="button" data-yes autofocus>${esc(yes)}</button><button class="btn" type="button" data-no>${esc(no)}</button>`,
        onClose: () => { if (!answered) resolve(false); },
        onSubmit: () => { answered = true; resolve(true); d.close(true); },
      });
      $('[data-yes]', d.el).addEventListener('click', () => { answered = true; resolve(true); d.close(true); });
      $('[data-no]', d.el).addEventListener('click', () => d.close(true));
    });
  }

  function openMessage(title, text) {
    const d = openDialog({
      title, size: 'narrow', dismissable: true,
      body: `<p style="white-space:pre-line;text-align:center">${esc(text)}</p>`,
      buttons: '<button class="btn" type="button" data-close autofocus>OK</button>',
    });
    return d;
  }

  function showError(e) {
    if (e && e.status === 401) return;
    toast(`<b>Error:</b> ${esc(e && e.message ? e.message : String(e))}`, { kind: 'err', ms: 7000 });
  }

  // ── task form ──────────────────────────────────────────────────────────────

  function taskFormHTML(t) {
    const prio = t ? t.priority : 'normal';
    const who = !t || t.assignee === null ? 'any' : t.assignee === 'human' ? 'human' : 'agent';
    const agentNames = state.board ? state.board.agents.map((a) => `<option value="${esc(a.name)}">`).join('') : '';
    return `<form class="task-form" novalidate>
      <div class="field">
        <label for="f-title">Title</label>
        <input class="input" id="f-title" name="title" maxlength="200" required value="${esc(t ? t.title : '')}" placeholder="What needs doing?">
      </div>
      <div class="field">
        <label for="f-desc">Instructions for the agent</label>
        <textarea class="textarea" id="f-desc" name="description" rows="7" maxlength="20000"
          placeholder="Context, links, files, constraints. What does done look like?">${esc(t ? t.description : '')}</textarea>
      </div>
      <fieldset class="field">
        <legend>Priority</legend>
        <div class="radios">${PRIOS.map((p) => `<label class="radio"><input type="radio" name="priority" value="${p}"${p === prio ? ' checked' : ''}><span class="mark"></span>${p[0].toUpperCase() + p.slice(1)}</label>`).join('')}</div>
      </fieldset>
      <fieldset class="field">
        <legend>Who can take it</legend>
        <div class="radios">
          <label class="radio"><input type="radio" name="who" value="any"${who === 'any' ? ' checked' : ''}><span class="mark"></span>Any agent</label>
          <label class="radio"><input type="radio" name="who" value="human"${who === 'human' ? ' checked' : ''}><span class="mark"></span>Only me</label>
          <label class="radio"><input type="radio" name="who" value="agent"${who === 'agent' ? ' checked' : ''}><span class="mark"></span>Agent:</label>
          <input class="input input-inline" name="agent_name" list="agent-names" aria-label="Agent name" placeholder="agent name" value="${who === 'agent' ? esc(t.assignee) : ''}">
          <datalist id="agent-names">${agentNames}</datalist>
        </div>
      </fieldset>
      <div class="field">
        <label for="f-tags">Tags <span class="hint">(agents can filter on these)</span></label>
        <input class="input" id="f-tags" name="tags" placeholder="code, research" value="${esc(t ? t.tags.join(', ') : '')}">
      </div>
      <label class="check"><input type="checkbox" name="review"${!t || t.review ? ' checked' : ''}><span class="mark"></span>Review agent results before they count as DONE</label>
    </form>`;
  }

  function readForm(form) {
    const fd = new FormData(form);
    const who = fd.get('who');
    const name = String(fd.get('agent_name') || '').trim();
    return {
      title: String(fd.get('title') || '').trim(),
      description: String(fd.get('description') || ''),
      priority: fd.get('priority') || 'normal',
      assignee: who === 'human' ? 'human' : who === 'agent' && name ? name : null,
      tags: String(fd.get('tags') || '').split(/[\s,]+/).map((x) => x.replace(/^#/, '')).filter(Boolean),
      review: fd.get('review') === 'on',
    };
  }

  function wireWho(form) {
    const name = $('[name=agent_name]', form);
    name.addEventListener('focus', () => { $('[name=who][value=agent]', form).checked = true; });
  }

  function openNew(prefill = '') {
    const d = openDialog({
      title: 'New Task',
      body: taskFormHTML(null),
      buttons: '<button class="btn" type="button" data-save>Create</button><button class="btn" type="button" data-close>Cancel</button>',
    });
    d.confirmDirty = true;
    const form = $('form', d.el);
    wireWho(form);
    if (prefill) $('#f-title', form).value = prefill;
    const save = async () => {
      const data = readForm(form);
      if (!data.title) { $('#f-title', form).focus(); return cmdOut('A task needs a title.', true); }
      try {
        const t = await api('POST', '/api/tasks', data);
        d.close(true);
        cmdOut(`Task #${pad(t.id)} created.`);
        await refresh();
        select(t.id);
        flashCard(t.id);
      } catch (e) { showError(e); }
    };
    d.onSubmit = save;
    $('[data-save]', d.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  // ── task dialog ────────────────────────────────────────────────────────────

  async function openTask(id, focus = 'title') {
    let t;
    try { t = await api('GET', `/api/tasks/${id}`); } catch (e) { return showError(e); }
    state.sel = id;
    state.activeCol = t.status;
    renderBoard();
    const d = openDialog({
      title: `Task #${pad(id)}`,
      size: 'wide',
      body: `<div class="task-grid">
        <div>${taskFormHTML(t)}</div>
        <div class="task-live">
          <div data-live="status"></div>
          <div data-live="action"></div>
          <div class="panel">
            <div class="panel-title">HISTORY</div>
            <div class="history pre" data-live="history"></div>
          </div>
          <div class="comment-row">
            <input class="input" data-comment placeholder="Add a note for the agent…" aria-label="Add a note" maxlength="8000">
            <button class="btn btn-small" type="button" data-post>Post</button>
          </div>
        </div>
      </div>`,
      buttons: `<button class="btn" type="button" data-save>Save</button>
        <button class="btn danger" type="button" data-delete>Delete</button>
        <button class="btn" type="button" data-close>Close</button>`,
    });
    d.taskId = id;
    d.task = t;
    d.confirmDirty = true;
    const form = $('form', d.el);
    wireWho(form);
    form.addEventListener('input', () => { d.dirty = true; });
    // Notes and reply boxes are not part of "unsaved changes".
    d.el.addEventListener('input', (e) => { if (!form.contains(e.target)) d.dirty = d.formDirty || false; });
    form.addEventListener('input', () => { d.formDirty = true; });
    renderTaskLive(d, t, true);

    const save = async () => {
      const data = readForm(form);
      if (!data.title) { $('#f-title', form).focus(); return cmdOut('A task needs a title.', true); }
      try {
        const updated = await api('PATCH', `/api/tasks/${id}`, data);
        d.dirty = d.formDirty = false;
        d.task = updated;
        renderTaskLive(d, updated, true);
        cmdOut(`#${pad(id)} saved.`);
        toast(`Saved <b>#${pad(id)}</b>`, { ms: 2000 });
        refresh();
      } catch (e) { showError(e); }
    };
    d.onSubmit = save;
    $('[data-save]', d.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    $('[data-delete]', d.el).addEventListener('click', async () => { if (await deleteTask(id)) d.close(true); });

    const post = async () => {
      const input = $('[data-comment]', d.el);
      const message = input.value.trim();
      if (!message) return input.focus();
      try {
        const updated = await api('POST', `/api/tasks/${id}/log`, { message });
        input.value = '';
        renderTaskLive(d, updated);
      } catch (e) { showError(e); }
    };
    $('[data-post]', d.el).addEventListener('click', post);
    $('[data-comment]', d.el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });

    d.el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-do]');
      if (!btn) return;
      const box = $('[data-answer]', d.el);
      const text = box ? box.value.trim() : '';
      try {
        let updated;
        if (btn.dataset.do === 'approve') updated = await api('POST', `/api/tasks/${id}/approve`, { message: text });
        else if (btn.dataset.do === 'reject') {
          if (!text) { box.focus(); return cmdOut('Tell the agent what to change first.', true); }
          updated = await api('POST', `/api/tasks/${id}/reject`, { feedback: text });
        } else if (btn.dataset.do === 'reply') {
          if (!text) { box.focus(); return cmdOut('Type your answer first.', true); }
          updated = await api('POST', `/api/tasks/${id}/reply`, { message: text });
        } else if (btn.dataset.do === 'release') {
          updated = await api('PATCH', `/api/tasks/${id}`, { status: 'todo' });
        } else if (btn.dataset.do === 'mine-done') {
          updated = await api('PATCH', `/api/tasks/${id}`, { status: 'done' });
        }
        if (updated) {
          renderTaskLive(d, updated, true);
          cmdOut(`#${pad(id)} → ${COL_LABEL[updated.status]}`);
          refresh();
        }
      } catch (err) { showError(err); }
    });

    setTimeout(() => {
      const target = {
        title: '#f-title', history: '[data-close].btn', feedback: '[data-answer]', reply: '[data-answer]',
      }[focus];
      const el = target && $(target, d.el);
      if (el) el.focus();
      if (focus === 'history') {
        const h = $('[data-live=history]', d.el);
        h.scrollTop = h.scrollHeight;
      }
    }, 40);
  }

  function renderTaskLive(d, t, forceAction = false) {
    const el = d.el;
    const status = $('[data-live=status]', el);
    let who = '';
    if (t.status === 'doing') who = ` by ${esc(t.claimed_by === 'human' ? 'you' : t.claimed_by)}${t.lease_expires ? ` · lease ${until(t.lease_expires)}` : ''}`;
    else if (t.claimed_by && t.status !== 'todo') who = ` · worked by ${esc(t.claimed_by)}`;
    status.innerHTML = `<p><span class="status-pill st-${t.status}">■ ${COL_LABEL[t.status]}</span>${who}</p>
      <p class="dim">Created ${ago(t.created_at)} ago by ${esc(t.created_by)} · updated ${ago(t.updated_at)} ago</p>`;

    // The action box holds a textarea the human may be typing in: only rebuild it
    // when the status changes.
    const action = $('[data-live=action]', el);
    if (forceAction || action.dataset.status !== t.status || action.dataset.result !== String(t.result ? t.result.length : 0)) {
      action.dataset.status = t.status;
      action.dataset.result = String(t.result ? t.result.length : 0);
      let html = '';
      if (t.status === 'blocked') {
        html = `<div class="panel ask"><div class="panel-title">? ${esc(t.claimed_by || 'An agent')} asks:</div>
          <div class="pre">${linkify(esc(t.question || ''))}</div>
          <div class="action-row" style="display:block">
            <textarea class="textarea" data-answer rows="3" placeholder="Your answer…" aria-label="Your answer"></textarea>
          </div>
          <div class="action-row"><button class="btn btn-small" type="button" data-do="reply">Reply &amp; requeue</button></div>
        </div>`;
      } else if (t.status === 'review') {
        html = `<div class="panel res"><div class="panel-title">✓ RESULT from ${esc(t.claimed_by || 'agent')}</div>
          <pre>${linkify(esc(t.result || '(no result text)'))}</pre></div>
          <div class="panel">
            <textarea class="textarea" data-answer rows="2" placeholder="Feedback (required to send back, optional to approve)" aria-label="Review feedback"></textarea>
            <div class="action-row">
              <button class="btn btn-small" type="button" data-do="approve">✓ Approve → DONE</button>
              <button class="btn btn-small danger" type="button" data-do="reject">↩ Send back → TODO</button>
            </div>
          </div>`;
      } else if (t.status === 'doing') {
        html = t.claimed_by === 'human'
          ? `<div class="panel"><div class="action-row" style="margin-top:0"><button class="btn btn-small" type="button" data-do="mine-done">✓ I finished it</button><button class="btn btn-small" type="button" data-do="release">↩ Back to TODO</button></div></div>`
          : `<div class="panel"><div class="action-row" style="margin-top:0"><button class="btn btn-small danger" type="button" data-do="release">↩ Take it back from ${esc(t.claimed_by)}</button></div></div>`;
        if (t.result) html = `<div class="panel res"><div class="panel-title">Earlier result</div><pre>${linkify(esc(t.result))}</pre></div>` + html;
      } else if (t.result) {
        html = `<div class="panel res"><div class="panel-title">✓ RESULT${t.claimed_by ? ' from ' + esc(t.claimed_by) : ''}</div><pre>${linkify(esc(t.result))}</pre></div>`;
      }
      action.innerHTML = html;
    }

    const hist = $('[data-live=history]', el);
    const stick = hist.scrollHeight - hist.scrollTop - hist.clientHeight < 30;
    hist.innerHTML = (t.events || []).map((e) => `<div class="ev k-${esc(e.kind)}"><time>${hms(e.ts)}</time> <span class="ev-actor">${esc(e.actor)}</span> <span class="ev-kind">${KIND[e.kind] || esc(e.kind.toUpperCase())}</span> ${linkify(esc(e.message))}</div>`).join('') || '<div class="log-hint">No history yet.</div>';
    if (stick || forceAction) hist.scrollTop = hist.scrollHeight;
    d.task = t;
  }

  async function refreshTaskDialog(d) {
    const summary = state.tasks.get(d.taskId);
    if (!summary) {
      if (!d.gone) {
        d.gone = true;
        $('[data-live=status]', d.el).innerHTML = '<p class="status-pill st-blocked">This task was deleted.</p>';
        $$('[data-save], [data-delete], [data-post]', d.el).forEach((b) => { b.disabled = true; });
      }
      return;
    }
    if (d.task && summary.updated_at === d.task.updated_at && summary.status === d.task.status) {
      renderTaskLive(d, Object.assign({}, d.task, { lease_expires: summary.lease_expires }));
      return;
    }
    try {
      const t = await api('GET', `/api/tasks/${d.taskId}`);
      if (state.dialogs.includes(d)) renderTaskLive(d, t);
    } catch { /* next refresh will retry */ }
  }

  // ── help, connect, about, token ────────────────────────────────────────────

  function openHelp() {
    openDialog({
      title: 'Help',
      dismissable: true,
      body: `
        <h3>How it works</h3>
        <p>You put to-dos on the board. Your agents claim them from <b>TODO</b>, work on them in <b>DOING</b>,
        and either ask you something (<b>NEEDS YOU</b>) or hand in a result for <b>REVIEW</b>.
        Approve it and it is <b>DONE</b>; send it back with feedback and it returns to TODO for another try.</p>
        <h3>Keys</h3>
        <dl class="keys">
          <dt>← → ↑ ↓</dt><dd>Select a task</dd>
          <dt>Enter / F3</dt><dd>Open task (history, results, review)</dd>
          <dt>F2 / N</dt><dd>New task</dd>
          <dt>F4</dt><dd>Edit task</dd>
          <dt>F6 / ]</dt><dd>Move task right (approves when in REVIEW)</dd>
          <dt>Shift+F6 / [</dt><dd>Move task left</dd>
          <dt>F7 / /</dt><dd>Find</dd>
          <dt>F8 / Del</dt><dd>Delete task</dd>
          <dt>F9</dt><dd>Menu</dd>
          <dt>F10</dt><dd>Next theme</dd>
          <dt>Esc</dt><dd>Close / clear filter</dd>
          <dt>Ctrl+Enter</dt><dd>Save the open dialog</dd>
          <dt>Drag &amp; drop</dt><dd>Move cards between columns</dd>
        </dl>
        <h3>Command line</h3>
        <p>Anything you type that is not a command becomes a task. Modifiers:
        <b>!high</b> <b>!!</b> (urgent) <b>!low</b> · <b>#tag</b> · <b>@agent-name</b> or <b>@me</b>.</p>
        <div class="code"><pre>Fix the flaky login test !high #code @claude-1
Book dentist appointment @me
OPEN 12 · DONE 12 · MOVE 12 review · DEL 12
FIND auth · CLS · THEME amber · CRT · AGENTS · VER</pre></div>`,
      buttons: '<button class="btn" type="button" data-close autofocus>OK</button>',
    });
  }

  function shellQuote(s) {
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  }

  function connectSnippets(name) {
    const cfg = state.config || { url: location.origin, launcher: ['python3', '/path/to/agentdos/dos.py'], auth: false };
    const launcher = cfg.launcher;
    const run = launcher.map(shellQuote).join(' ');
    const agent = name || 'claude-1';
    const tokenEnv = cfg.auth ? ' --env AGENTDOS_TOKEN=YOUR_TOKEN' : '';
    const env = { AGENTDOS_URL: cfg.url };
    if (cfg.auth) env.AGENTDOS_TOKEN = 'YOUR_TOKEN';
    const prompt = 'Work the AGENTDOS to-do queue. Use claim_next_task to take a task, read it and its history '
      + 'with get_task, do the work, and post short log_progress notes as you go. Finish with complete_task and '
      + 'a summary of what you did and where the output is. If you need a decision from me, use ask_human and '
      + 'move on to the next task. Stop when the queue is empty.';
    return {
      claude: `claude mcp add --scope user --env AGENTDOS_URL=${cfg.url}${tokenEnv} --transport stdio agentdos -- ${run} mcp --agent ${shellQuote(agent)}`,
      headless: `claude -p ${shellQuote(prompt)} --allowedTools 'mcp__agentdos__*'`,
      json: JSON.stringify({ mcpServers: { agentdos: { command: launcher[0], args: [...launcher.slice(1), 'mcp', '--agent', agent], env } } }, null, 2),
      shell: `export AGENTDOS_URL=${cfg.url}${cfg.auth ? '\nexport AGENTDOS_TOKEN=YOUR_TOKEN' : ''}
export AGENTDOS_AGENT=${shellQuote(agent)}
${run} next --json              # claim the next task
${run} log 12 "halfway there"   # progress (renews the lease)
${run} ask 12 "Which branch?"   # need a human decision
${run} done 12 "Shipped in #123"`,
      curl: `curl -s -X POST ${cfg.url}/api/tasks/next \\
  -H 'Content-Type: application/json' -H 'X-Agent: ${agent}'${cfg.auth ? " \\\n  -H 'Authorization: Bearer YOUR_TOKEN'" : ''} -d '{}'

curl -s -X POST ${cfg.url}/api/tasks/12/complete \\
  -H 'Content-Type: application/json' -H 'X-Agent: ${agent}' \\
  -d '{"result": "What I did and where it is"}'`,
      prompt,
    };
  }

  function openConnect() {
    const tabs = [
      ['claude', 'Claude Code'], ['json', 'Other MCP apps'], ['shell', 'Shell'], ['curl', 'HTTP'],
    ];
    const d = openDialog({
      title: 'Connect an Agent',
      size: 'wide',
      dismissable: true,
      body: `
        <p>Each agent gets a name so you can see who is doing what. Agents talk to this board through
        <b>MCP</b> (Claude Code, Claude Desktop and other MCP apps), the <b>dos.py</b> command line, or plain <b>HTTP</b>.
        Full protocol: <a href="/AGENTS.md" target="_blank" rel="noopener">AGENTS.md</a>.</p>
        <div class="field"><label for="c-name">Agent name</label>
          <input class="input" id="c-name" value="claude-1" maxlength="40" style="max-width:20em" autocomplete="off" spellcheck="false"></div>
        <div class="tabs" role="tablist">${tabs.map(([k, l], i) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
        <div data-pane="claude">
          <p>1. Register the board with Claude Code (once):</p>
          <div class="code"><pre data-snip="claude"></pre><button class="btn btn-small copy" type="button" data-copy="claude">Copy</button></div>
          <p>2. In a Claude Code session, ask it to work the queue:</p>
          <div class="code"><pre data-snip="prompt"></pre><button class="btn btn-small copy" type="button" data-copy="prompt">Copy</button></div>
          <p>Or run it unattended, from the folder you want it to work in:</p>
          <div class="code"><pre data-snip="headless"></pre><button class="btn btn-small copy" type="button" data-copy="headless">Copy</button></div>
          <p class="dim">Run several sessions with different --agent names to have a team work the board in parallel.</p>
        </div>
        <div data-pane="json" hidden>
          <p>Most MCP apps (Claude Desktop, IDEs, other agent frameworks) take a server entry like this in their <b>mcpServers</b> config:</p>
          <div class="code"><pre data-snip="json"></pre><button class="btn btn-small copy" type="button" data-copy="json">Copy</button></div>
          <p class="dim">Tools: board, get_task, claim_next_task, claim_task, log_progress, complete_task, ask_human, release_task, create_task.</p>
        </div>
        <div data-pane="shell" hidden>
          <p>Any agent that can run shell commands can use the CLI. Exit code 3 from <b>next</b> means the queue is empty.</p>
          <div class="code"><pre data-snip="shell"></pre><button class="btn btn-small copy" type="button" data-copy="shell">Copy</button></div>
        </div>
        <div data-pane="curl" hidden>
          <p>The JSON API, for agents in any language. Writes need <b>Content-Type: application/json</b>.</p>
          <div class="code"><pre data-snip="curl"></pre><button class="btn btn-small copy" type="button" data-copy="curl">Copy</button></div>
        </div>`,
      buttons: '<button class="btn" type="button" data-close>Done</button>',
    });
    const fill = () => {
      const snips = connectSnippets($('#c-name', d.el).value.trim());
      $$('[data-snip]', d.el).forEach((p) => { p.textContent = snips[p.dataset.snip]; });
      d.snips = snips;
    };
    fill();
    $('#c-name', d.el).addEventListener('input', fill);
    d.dirty = false;
    d.el.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        $$('[data-tab]', d.el).forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
        $$('[data-pane]', d.el).forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
      }
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const text = d.snips[copy.dataset.copy];
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = 'Copied';
        } catch {
          const range = document.createRange();
          range.selectNodeContents(copy.previousElementSibling);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          copy.textContent = 'Ctrl+C';
        }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      }
    });
  }

  const LOGO = [
    String.raw`    _    ____ _____ _   _ _____ ____   ___  ____  `,
    String.raw`   / \  / ___| ____| \ | |_   _|  _ \ / _ \/ ___| `,
    String.raw`  / _ \| |  _|  _| |  \| | | | | | | | | | \___ \ `,
    String.raw` / ___ \ |_| | |___| |\  | | | | |_| | |_| |___) |`,
    String.raw`/_/   \_\____|_____|_| \_| |_| |____/ \___/|____/ `,
  ].join('\n');

  function openAbout() {
    openDialog({
      title: 'About',
      dismissable: true,
      body: `<pre class="ascii-logo">${esc(LOGO)}</pre>
        <p>Agentic To-Do Operating System<br>Version ${esc(state.config ? state.config.version : '1.0.0')}</p>
        <p class="dim">You write the to-dos. Your agents claim them, work them, ask when stuck, and hand results back for review.</p>
        <p class="dim">640K tasks ought to be enough for anybody.</p>`,
      buttons: '<button class="btn" type="button" data-close autofocus>OK</button>',
    });
  }

  let tokenOpen = false;
  function askToken() {
    if (tokenOpen) return;
    tokenOpen = true;
    const d = openDialog({
      title: 'Access Code',
      size: 'narrow',
      body: `<p>This board is protected. Enter the access token it was started with (<b>--token</b> or AGENTDOS_TOKEN).</p>
        <div class="field"><label for="tok">ACCESS CODE:</label><input class="input" id="tok" type="password" autocomplete="current-password" autofocus></div>`,
      buttons: '<button class="btn" type="button" data-ok>Enter</button>',
      onClose: () => { tokenOpen = false; },
    });
    const ok = () => {
      state.token = $('#tok', d.el).value.trim();
      store.set('token', state.token);
      d.close(true);
      connectStream();
      boot2();
    };
    d.onSubmit = ok;
    $('[data-ok]', d.el).addEventListener('click', ok);
    $('#tok', d.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  }

  // ── toasts ─────────────────────────────────────────────────────────────────

  function toast(html, { kind = '', ms = 5000, onClick = null } = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.innerHTML = `<div class="toast-frame">${html}</div>`;
    const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
    el.addEventListener('click', () => { if (onClick) onClick(); remove(); });
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(remove, ms);
  }

  // ── menus ──────────────────────────────────────────────────────────────────

  function menus() {
    const theme = document.documentElement.dataset.theme;
    const crt = !document.documentElement.classList.contains('no-crt');
    const dock = !document.documentElement.classList.contains('no-dock');
    const chk = (on) => (on ? '√' : '');
    return [
      { label: '≡', cls: 'sys', aria: 'System', items: [['About AGENTDOS…', 'about'], ['Replay boot screen', 'boot']] },
      { label: 'File', items: [['New task…', 'new', 'F2'], ['Export board (JSON)', 'export'], '-', ['Exit', 'exit']] },
      { label: 'Task', items: [['Open…', 'view', 'Enter'], ['Edit…', 'edit', 'F4'], ['Move right', 'move', 'F6'], ['Move left', 'moveback', '⇧F6'], '-', ['Delete', 'delete', 'F8']] },
      {
        label: 'View',
        items: [
          ...THEMES.map((t) => [`Theme: ${THEME_NAMES[t]}`, `theme:${t}`, '', chk(t === theme)]),
          '-',
          ['CRT effect', 'crt', '', chk(crt)],
          ['Agents & log dock', 'dock', '', chk(dock)],
          ['Find…', 'find', 'F7'],
          ['Refresh', 'refresh', 'F5'],
        ],
      },
      { label: 'Agents', items: [['Connect an agent…', 'connect'], ['Agent protocol (AGENTS.md)', 'protocol']] },
      { label: 'Help', items: [['Keys & commands', 'help', 'F1'], ['About', 'about']] },
    ];
  }

  function renderMenubar() {
    $('#menus').innerHTML = menus().map((m, i) => `<div class="menu" data-menu="${i}">
      <button class="menu-btn ${m.cls || ''}" type="button" aria-haspopup="true" aria-expanded="false" ${m.aria ? `aria-label="${m.aria}"` : ''}>${m.cls ? m.label : `<span class="hot">${m.label[0]}</span>${m.label.slice(1)}`}</button>
    </div>`).join('');
  }

  function openMenu(index, active = -1) {
    closeMenu();
    const def = menus()[index];
    const host = $(`.menu[data-menu="${index}"]`);
    if (!def || !host) return;
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.setAttribute('role', 'menu');
    dd.innerHTML = `<div class="dropdown-frame">${def.items.map((it) => (it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-act="${it[1]}"><span><span class="check">${it[3] || ''}</span>${esc(it[0])}</span><span class="key">${esc(it[2] || '')}</span></button>`)).join('')}</div>`;
    host.appendChild(dd);
    $('.menu-btn', host).setAttribute('aria-expanded', 'true');
    state.menu = { index, el: dd, active: -1 };
    if (active >= 0) menuFocus(active);
  }

  function closeMenu() {
    if (!state.menu) return;
    state.menu.el.remove();
    $$('.menu-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    state.menu = null;
  }

  function menuFocus(i) {
    const items = $$('button', state.menu.el);
    if (!items.length) return;
    state.menu.active = (i + items.length) % items.length;
    items.forEach((b, j) => b.classList.toggle('active', j === state.menu.active));
    items[state.menu.active].focus();
  }

  function menuKey(e) {
    const n = menus().length;
    const k = e.key;
    if (k === 'Escape' || k === 'F9') { closeMenu(); e.preventDefault(); return true; }
    if (k === 'ArrowRight' || k === 'ArrowLeft') { openMenu((state.menu.index + (k === 'ArrowRight' ? 1 : -1) + n) % n, 0); e.preventDefault(); return true; }
    if (k === 'ArrowDown' || k === 'ArrowUp') { menuFocus(state.menu.active + (k === 'ArrowDown' ? 1 : -1)); e.preventDefault(); return true; }
    if (k === 'Enter' || k === ' ') {
      const b = $$('button', state.menu.el)[state.menu.active];
      if (b) { e.preventDefault(); closeMenu(); act(b.dataset.act); }
      return true;
    }
    if (k === 'Tab') { closeMenu(); return false; }
    return false;
  }

  // ── boot screen ────────────────────────────────────────────────────────────

  let bootSkip = null;
  function boot(force = false) {
    let seen = false;
    try { seen = sessionStorage.getItem('agentdos.booted') === '1'; } catch { /* ignore */ }
    if (REDUCED || (seen && !force)) return Promise.resolve();
    try { sessionStorage.setItem('agentdos.booted', '1'); } catch { /* ignore */ }
    const el = $('#boot');
    const pre = $('#boot-text');
    el.hidden = false;
    el.classList.remove('done');
    pre.innerHTML = '';
    state.booting = true;
    const lines = [
      '<span class="hi">AGENTDOS BIOS v1.00</span>   Copyright (C) 1981-2026',
      'Agentic 80486DX2 processor at 66 MHz',
      'Memory Test: <span data-mem>0</span>K',
      '',
      'Detecting agents ............ OK',
      'Loading HIMEM.SYS ........... OK',
      'Loading BOARD.SYS ........... OK',
      'Mounting C:\\AGENTDOS\\BOARD ... OK',
      '',
      '<span class="hi">Starting AGENTDOS...</span>',
    ];
    return new Promise((resolve) => {
      let i = 0;
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        bootSkip = null;
        el.classList.add('done');
        setTimeout(() => { el.hidden = true; state.booting = false; resolve(); }, 250);
      };
      bootSkip = finish;
      el.onclick = finish;
      const step = () => {
        if (i >= lines.length) { timer = setTimeout(finish, 280); return; }
        pre.insertAdjacentHTML('beforeend', lines[i] + '\n');
        const mem = $('[data-mem]', pre);
        if (i === 2 && mem) {
          let k = 0;
          const count = () => { k += 81920; mem.textContent = Math.min(k, 655360); if (k < 655360) setTimeout(count, 16); else mem.insertAdjacentText('afterend', ' OK'); };
          count();
        }
        i += 1;
        timer = setTimeout(step, i === 3 ? 220 : 85);
      };
      step();
    });
  }

  // ── events ─────────────────────────────────────────────────────────────────

  function onKey(e) {
    if (state.booting) { if (bootSkip) bootSkip(); e.preventDefault(); return; }
    const k = e.key;
    if (state.menu && menuKey(e)) return;

    const top = topDialog();
    if (top) {
      if (k === 'Escape') { e.preventDefault(); top.close(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'Enter' && top.onSubmit) { e.preventDefault(); top.onSubmit(); return; }
      if (k === 'Tab') trapFocus(e, top.el);
      if (/^F\d{1,2}$/.test(k) && k !== 'F5' && k !== 'F11' && k !== 'F12') e.preventDefault();
      return;
    }

    const fkeys = { F1: 'help', F2: 'new', F3: 'view', F4: 'edit', F5: 'refresh', F6: e.shiftKey ? 'moveback' : 'move', F7: 'find', F8: 'delete', F9: 'menu', F10: 'theme' };
    if (fkeys[k] && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      act(fkeys[k]);
      return;
    }

    const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (inField) {
      if (e.target.id === 'cmd') cmdKey(e);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (k) {
      case 'ArrowLeft': e.preventDefault(); nav(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); nav(1, 0); break;
      case 'ArrowUp': e.preventDefault(); nav(0, -1); break;
      case 'ArrowDown': e.preventDefault(); nav(0, 1); break;
      case 'Home': e.preventDefault(); { const ids = state.cols[state.activeCol] || []; if (ids.length) select(ids[0]); } break;
      case 'End': e.preventDefault(); { const ids = state.cols[state.activeCol] || []; if (ids.length) select(ids[ids.length - 1]); } break;
      case 'Enter': if (state.sel) { e.preventDefault(); openTask(state.sel); } break;
      case 'Delete': act('delete'); break;
      case ']': act('move'); break;
      case '[': act('moveback'); break;
      case '/': e.preventDefault(); act('find'); break;
      case '?': e.preventDefault(); act('help'); break;
      case 'Escape':
        if (state.filter) { state.filter = ''; renderAll(); cmdOut('Filter cleared.'); } else if (state.sel || state.kbCol) { state.sel = null; state.kbCol = false; renderBoard(); }
        break;
      default:
        // Start typing anywhere to use the command line.
        if (k.length === 1 && /\S/.test(k)) { const c = $('#cmd'); c.focus(); }
    }
  }

  function cmdKey(e) {
    const input = e.target;
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; input.blur(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!state.history.length) return;
      e.preventDefault();
      state.histIdx = Math.max(-1, Math.min(state.history.length - 1, state.histIdx + (e.key === 'ArrowUp' ? 1 : -1)));
      input.value = state.histIdx < 0 ? '' : state.history[state.histIdx];
    }
  }

  function trapFocus(e, root) {
    const items = $$('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])', root)
      .filter((el) => el.offsetParent !== null && !(el.type === 'radio' && !el.checked));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function wire() {
    document.addEventListener('keydown', onKey);

    $('#cmdline').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#cmd');
      const v = input.value;
      input.value = '';
      runCommand(v);
    });

    document.addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-act]');
      if (actBtn && !actBtn.closest('.dropdown')) { act(actBtn.dataset.act); return; }
      const open = e.target.closest('[data-open]');
      if (open) { openTask(Number(open.dataset.open)); return; }
    });

    // Menus: click to open, hover to switch while open.
    $('#menus').addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown [data-act]');
      if (item) { closeMenu(); act(item.dataset.act); return; }
      const m = e.target.closest('.menu');
      if (!m) return;
      const i = Number(m.dataset.menu);
      if (state.menu && state.menu.index === i) closeMenu(); else openMenu(i);
    });
    $('#menus').addEventListener('mouseover', (e) => {
      const m = e.target.closest('.menu');
      if (state.menu && m && Number(m.dataset.menu) !== state.menu.index && !e.target.closest('.dropdown')) openMenu(Number(m.dataset.menu));
    });
    document.addEventListener('mousedown', (e) => { if (state.menu && !e.target.closest('.menu')) closeMenu(); });

    const board = $('#board');
    board.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = Number(card.dataset.id);
      state.kbCol = false;
      select(id, { scroll: false });
      openTask(id);
    });
    board.addEventListener('focusin', (e) => {
      const card = e.target.closest('.card');
      if (card && Number(card.dataset.id) !== state.sel) select(Number(card.dataset.id), { scroll: false });
    });
    board.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
        e.preventDefault();
        e.stopPropagation();
        openTask(Number(e.target.dataset.id));
      }
    });
    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      state.dragging = true;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    board.addEventListener('dragend', () => {
      state.dragging = false;
      $$('.col.drop-ok').forEach((c) => c.classList.remove('drop-ok'));
      if (state.pendingRender) { state.pendingRender = false; renderAll(); } else $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.col');
      if (!col || !state.dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      $$('.col.drop-ok').forEach((c) => { if (c !== col) c.classList.remove('drop-ok'); });
      col.classList.add('drop-ok');
    });
    board.addEventListener('drop', (e) => {
      const col = e.target.closest('.col');
      if (!col) return;
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain'));
      col.classList.remove('drop-ok');
      if (id) moveTo(id, col.dataset.status);
    });

    $('#coltabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-col]');
      if (!b) return;
      state.activeCol = b.dataset.col;
      markActiveCol();
    });

    NARROW.addEventListener('change', renderAll);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  // ── tickers ────────────────────────────────────────────────────────────────

  let spinFrame = 0;
  function tick() {
    $('#clock').textContent = new Date().toTimeString().slice(0, 8);
  }

  // ── start ──────────────────────────────────────────────────────────────────

  async function boot2() {
    try { state.config = await api('GET', '/api/config'); } catch { /* shown via token prompt or offline */ }
    await refresh();
  }

  function start() {
    setTheme(store.get('theme', 'norton'));
    if (store.get('crt', true) === false) document.documentElement.classList.add('no-crt');
    if (store.get('dock', true) === false) document.documentElement.classList.add('no-dock');
    renderMenubar();
    wire();
    tick();
    setInterval(tick, 1000);
    if (!REDUCED) {
      setInterval(() => {
        spinFrame = (spinFrame + 1) % SPIN.length;
        $$('.spin').forEach((s) => { s.textContent = SPIN[spinFrame]; });
      }, 160);
    }
    setInterval(() => { if (!state.dragging && !state.menu) renderAll(); }, 15000);
    setInterval(refresh, 30000);
    boot();
    connectStream();
    boot2();
  }

  start();
})();
