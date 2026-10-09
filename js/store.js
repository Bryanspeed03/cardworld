// Offline-first data store.
//
// How it works:
// 1. Every change is saved to this device first (localStorage), so the app works with no internet.
// 2. Changes wait in a queue and upload to Supabase in order when the connection is back.
// 3. Each change sends the whole row with a fixed id ("upsert"), so sending it twice is harmless.
// 4. The app pulls a fresh copy of everything from Supabase on start, when you come back online,
//    and when you return to the app. Changes still in the queue are layered on top.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const TABLES = ['lots', 'shows', 'cards', 'expenses', 'payouts', 'settings'];
const KEY = { cache: 'cw-cache-v1', queue: 'cw-queue-v1' };
const SERVER_ONLY = ['user_id', 'created_at', 'updated_at'];

export const configured = !SUPABASE_URL.startsWith('PASTE') && !SUPABASE_KEY.startsWith('PASTE');

// Give up on a request after 15 seconds so a bad signal never freezes the app.
const timedFetch = (url, opts = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
};

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: timedFetch },
    })
  : null;

const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  drop(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

const emptyBase = () => ({ userId: null, pulledAt: null, ...Object.fromEntries(TABLES.map(t => [t, {}])) });
let base = Object.assign(emptyBase(), local.get(KEY.cache) || {});
let queue = local.get(KEY.queue) || [];

export const data = { lots: [], shows: [], cards: [], expenses: [], payouts: [], settings: null };
export const status = { online: navigator.onLine, syncing: false, failed: false, pending: 0, pulledAt: base.pulledAt, user: null };

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

// Rebuild what the screens see: server copy + changes not uploaded yet
function rebuild() {
  const m = Object.fromEntries(TABLES.map(t => [t, { ...base[t] }]));
  for (const op of queue) {
    if (op.op === 'upsert') m[op.table][op.row.id] = op.row;
    else delete m[op.table][op.id];
  }
  for (const t of TABLES) if (t !== 'settings') data[t] = Object.values(m[t]);
  data.settings = Object.values(m.settings)[0] || null;
  status.pending = queue.length;
  status.pulledAt = base.pulledAt;
}
rebuild();

export const hasCache = () => !!base.userId;
export const cachedUser = () => base.userId;
export const find = (table, id) => table === 'settings' ? data.settings : data[table].find(r => r.id === id);
export const newId = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
});

function enqueue(ops) {
  queue.push(...ops);
  const saved = local.set(KEY.queue, queue);
  rebuild(); emit();
  flush();
  return saved;
}

// --- public write API -----------------------------------------------------
export const create = (table, fields) => { const row = { id: newId(), ...fields }; enqueue([{ op: 'upsert', table, row }]); return row; };
export const update = (table, id, patch) => {
  const cur = find(table, id);
  if (!cur) return null;
  const row = { ...cur, ...patch };
  enqueue([{ op: 'upsert', table, row }]);
  return row;
};
export const remove = (table, id) => enqueue([{ op: 'delete', table, id }]);
export const batch = ops => enqueue(ops.map(o => o.op === 'delete' ? o : { ...o, row: o.row.id ? o.row : { id: newId(), ...o.row } }));
export const saveSettings = fields => {
  const cur = data.settings;
  enqueue([{ op: 'upsert', table: 'settings', row: { ...(cur || { id: newId() }), ...fields } }]);
};

// --- syncing ---------------------------------------------------------------
const clean = row => Object.fromEntries(Object.entries(row).filter(([k]) => !SERVER_ONLY.includes(k)));
// Errors that will never succeed on retry (bad data, missing parent row, no permission)
const permanent = res => {
  const s = res.status ?? 0;
  const code = res.error?.code || '';
  if (s === 401 || s === 408 || s === 429 || s === 0) return false;
  return (s >= 400 && s < 500) || /^(22|23|42)/.test(code);
};

let flushing = null, retryTimer = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!sb || !queue.length) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    status.syncing = true; emit();
    let dropped = 0;
    while (queue.length) {
      const op = queue[0];
      let res;
      try {
        res = op.op === 'upsert'
          ? await sb.from(op.table).upsert(clean(op.row), { onConflict: 'id' })
          : await sb.from(op.table).delete().eq('id', op.id);
      } catch (e) { res = { error: e, status: 0 }; }
      if (!res.error) { queue.shift(); local.set(KEY.queue, queue); status.failed = false; continue; }
      if (permanent(res)) { console.warn('Dropped change', op, res.error); queue.shift(); local.set(KEY.queue, queue); dropped++; continue; }
      status.failed = true; break;
    }
    status.syncing = false; rebuild(); emit();
    if (dropped) emitNotice(`${dropped} change${dropped === 1 ? '' : 's'} could not be saved and ${dropped === 1 ? 'was' : 'were'} skipped.`);
    if (queue.length) { clearTimeout(retryTimer); retryTimer = setTimeout(flush, 20000); }
  })().finally(() => { flushing = null; });
  return flushing;
}

let pulling = null;
export function pull() {
  if (pulling) return pulling;
  pulling = (async () => {
    if (!sb) return false;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    if (base.userId && base.userId !== session.user.id) resetLocal();
    const next = emptyBase();
    for (const t of TABLES) {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await sb.from(t).select('*').range(from, from + 999);
        if (error) { status.failed = true; emit(); return false; }
        rows.push(...page);
        if (page.length < 1000) break;
      }
      next[t] = Object.fromEntries(rows.map(r => [r.id, numify(r)]));
    }
    next.userId = session.user.id;
    next.pulledAt = new Date().toISOString();
    base = next;
    local.set(KEY.cache, base);
    status.failed = false;
    rebuild(); emit();
    return true;
  })().finally(() => { pulling = null; });
  return pulling;
}
// Postgres numeric columns come back as strings; make them numbers.
const NUMERIC = ['total_paid', 'total_comp', 'buy_pct', 'table_cost', 'buy_price', 'buy_market', 'market_value', 'grading_fee', 'sold_price', 'amount'];
const numify = r => { for (const k of NUMERIC) if (k in r && r[k] !== null) r[k] = Number(r[k]); return r; };

export async function sync() { await flush(); if (!queue.length) await pull(); }

// --- live updates ------------------------------------------------------------
// Supabase Realtime pushes every insert, update, and delete to other open devices.
// Row Level Security still applies, so a device only hears about its own user's rows.
let channel = null;
export function listen() {
  if (!sb || channel) return;
  channel = sb.channel('cardworld-live');
  for (const t of TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => applyRemote(t, p));
  // After connecting (or reconnecting), pull once to catch anything missed while away
  channel.subscribe(state => { if (state === 'SUBSCRIBED') sync(); });
}
export function stopListening() { if (channel) { sb.removeChannel(channel); channel = null; } }
function applyRemote(table, p) {
  if (!base.userId) return;
  if (p.eventType === 'DELETE') {
    const id = p.old?.id;
    if (!id || !base[table][id]) return;
    delete base[table][id];
  } else {
    const row = p.new;
    if (!row?.id || (row.user_id && row.user_id !== base.userId)) return;
    base[table][row.id] = numify({ ...row });
  }
  local.set(KEY.cache, base);
  rebuild(); emit();
}

let notice = () => {};
export const onNotice = fn => { notice = fn; };
const emitNotice = m => notice(m);

addEventListener('online', () => { status.online = true; status.failed = false; emit(); sync(); });
addEventListener('offline', () => { status.online = false; emit(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) sync(); });
setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) sync(); }, 90000);

// --- account ---------------------------------------------------------------
export function resetLocal() {
  base = emptyBase(); queue = [];
  local.drop(KEY.cache); local.drop(KEY.queue);
  rebuild(); emit();
}
export const pendingCount = () => queue.length;

// Import a file exported from the Claude tracker (or this app's own backup)
export function importRows(payload) {
  const ops = [];
  for (const t of TABLES) for (const row of payload[t] || []) ops.push({ op: 'upsert', table: t, row: clean(row) });
  return enqueue(ops) && ops.length;
}
export const exportAll = () => Object.fromEntries(TABLES.map(t => [t, t === 'settings' ? (data.settings ? [data.settings] : []) : data[t]]));
