// Card World: screens and interactions.
import * as store from './store.js';
import { data, status } from './store.js';
import {
  num, cents, cost, inStock, floorPrice, today, daysSince, OLD_DAYS,
  stats, split, payStatus, restock, inventory, allocate, lotProgress, showResult, groupBreakdown,
} from './calc.js';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => { n = cents(n || 0); const s = (Number.isInteger(n) ? usd : usd2).format(Math.abs(n)); return n < 0 ? '−' + s : s; };
const pct = n => Number.isFinite(n) ? `${Math.round(n * 10) / 10}%` : '—';
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDate = d => d ? dateFmt.format(new Date(d + 'T12:00')) : '';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const STAR = '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.95 5 3.1 8 10.5 10.5C15.1 14.5 12.95 17.5 12 22.5c-.95-5-3.1-8-10.5-10.5C8.9 9.5 11.05 6.5 12 1.5z"/></svg>';
const radio = name => document.querySelector(`input[name="${name}"]:checked`).value;
const lotName = id => data.lots.find(l => l.id === id)?.name || '';
const showName = id => data.shows.find(s => s.id === id)?.name || '';
const byDateDesc = k => (a, b) => (b[k] || '').localeCompare(a[k] || '');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
const saved = msg => toast(navigator.onLine && !status.failed ? msg : `${msg} · saved on this device`);

// Two-tap delete: first tap arms the button, second tap confirms.
function arm(btn, action, label = 'Tap again to delete') {
  if (btn.classList.contains('armed')) { action(); return; }
  const was = btn.textContent;
  btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = was; } }, 3500);
}

const ui = { view: 'overview', period: 'month', filter: 'stock', q: '', editId: null, mode: 'single' };
try { Object.assign(ui, JSON.parse(localStorage.getItem('cw-ui') || '{}'), { editId: null }); } catch { /* no storage */ }
const saveUi = () => { try { localStorage.setItem('cw-ui', JSON.stringify({ view: ui.view, period: ui.period, filter: ui.filter, mode: ui.mode })); } catch { /* no storage */ } };

/* ---------- navigation ---------- */
const VIEWS = ['overview', 'inventory', 'add', 'shows', 'pay'];
function go(view, { keepEdit = false } = {}) {
  if (!VIEWS.includes(view)) view = 'overview';
  if (view === 'add' && ui.editId && !keepEdit) resetCardForm();
  ui.view = view; saveUi();
  $$('[data-view]').forEach(s => { s.hidden = s.id !== 'v-' + view; });
  $$('.nav button').forEach(b => b.dataset.go === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  scrollTo(0, 0);
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
addEventListener('hashchange', () => go(location.hash.slice(1)));

/* ---------- overview ---------- */
function renderOverview() {
  const st = stats(data, ui.period);
  const periodWord = { month: 'this month', 30: 'in the last 30 days', year: 'this year', all: 'all time' }[ui.period];
  $('#ov-empty').hidden = data.cards.length > 0;
  const margin = st.sales ? st.net / st.sales * 100 : NaN;

  $('#hero').innerHTML = `
    <div>
      <div class="hero-label">${STAR}Profit ${periodWord}</div>
      <div class="big ${st.net < 0 ? 'bad' : ''}">${money(st.net)}</div>
      <div class="hero-sub">${Number.isFinite(margin) ? `${pct(margin)} of sales, after` : 'After'} card costs, tables and expenses</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${money(st.sales)}</b><span>Sales from ${plural(st.sold.length, 'card')}</span></div>
      <div class="stat"><b>${pct(st.sellPct)}</b><span>Avg sell, of comps</span></div>
      <div class="stat"><b>${pct(st.buyPct)}</b><span>Avg buy, of comps</span></div>
      <div class="stat"><b>${money(st.expenses)}</b><span>Tables and expenses</span></div>
    </div>`;

  const sp = split(data.settings), ps = payStatus(data), pos = Math.max(0, st.net);
  $('#ov-pay').innerHTML = `
    <div class="payline">
      <div><div class="muted small">Available to take now</div><div class="mid">${money(ps.available)}</div></div>
      <button class="btn ghost sm" type="button" data-go="pay">Record payout</button>
    </div>
    <div class="splitbar" role="img" aria-label="Profit split: reinvest ${sp.reinvest}%, taxes ${sp.taxes}%, pay ${sp.pay}%">
      <i style="width:${sp.reinvest}%;background:var(--ink)"></i><i style="width:${sp.taxes}%;background:var(--taupe)"></i><i style="width:${sp.pay}%;background:var(--good)"></i>
    </div>
    <div class="legend">
      <div><span class="dot" style="background:var(--ink)"></span>Reinvest<b>${money(pos * sp.reinvest / 100)}</b></div>
      <div><span class="dot" style="background:var(--taupe)"></span>Taxes<b>${money(pos * sp.taxes / 100)}</b></div>
      <div><span class="dot" style="background:var(--good)"></span>You<b>${money(pos * sp.pay / 100)}</b></div>
    </div>
    ${ps.over > 0 ? `<p class="note bad">You've taken ${money(ps.over)} more than your share so far. Hold off until profit catches up.</p>` : ''}`;

  const rs = restock(st, data.settings);
  const fill = rs.budget > 0 ? Math.min(100, st.spent / rs.budget * 100) : 0;
  $('#ov-restock').innerHTML = `
    <div class="payline">
      <div><div class="muted small">Spend on inventory ${periodWord}</div><div class="mid">${money(rs.budget)}</div></div>
      <div class="muted small" style="text-align:right">Bought so far<br><b style="color:var(--ink);font-size:16px">${money(st.spent)}</b></div>
    </div>
    <div class="progress" role="img" aria-label="${Math.round(fill)}% of restock budget spent"><i style="width:${fill}%"></i></div>
    <p class="note muted">${money(rs.replace)} replaces what sold. ${money(rs.grow)} grows your stock.
      ${rs.budget <= 0 ? '' : rs.left >= 0 ? `<b style="color:var(--ink)">${money(rs.left)} left to spend.</b>` : `<span class="warn">${money(-rs.left)} over budget.</span>`}</p>`;

  const inv = inventory(data);
  $('#ov-inv').innerHTML = `
    <div class="kv">
      <div><b>${inv.count}</b><span>Cards${inv.grading ? `, ${inv.grading} at PSA` : ''}</span></div>
      <div><b>${money(inv.cost)}</b><span>Your cost</span></div>
      <div><b>${money(inv.comps)}</b><span>Comp value</span></div>
      <div><b class="${inv.at95 < 0 ? 'bad' : ''}">${money(inv.at95)}</b><span>Profit if it all sells at 95%</span></div>
    </div>
    ${inv.old.length ? `<p class="note warn">${plural(inv.old.length, 'card')} ${inv.old.length === 1 ? 'has' : 'have'} sat ${OLD_DAYS}+ days, holding ${money(inv.oldCost)} of your cash. <button class="btn link" type="button" data-filter-go="old" style="min-height:auto;padding:0;color:inherit;text-decoration:underline">See them</button></p>` : ''}`;

  const rows = groupBreakdown(st);
  $('#ov-groups').innerHTML = `<table>
    <thead><tr><th scope="col">Group</th><th scope="col">Sold</th><th scope="col">Sales</th><th scope="col">Profit</th><th scope="col">Margin</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.name}</td><td>${r.count}</td><td>${money(r.sales)}</td><td class="${r.profit < 0 ? 'bad' : ''}">${money(r.profit)}</td><td>${pct(r.margin)}</td></tr>`).join('')}</tbody>
  </table><p class="note muted small">Before table costs and other expenses.</p>`;

  const recent = data.cards.filter(c => c.status === 'sold').sort(byDateDesc('sold_date')).slice(0, 6);
  $('#ov-recent').innerHTML = recent.length ? `<ul class="list">${recent.map(c => {
    const p = num(c.sold_price) - cost(c), hit = num(c.market_value) && num(c.sold_price) >= num(c.market_value);
    return `<li><div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${fmtDate(c.sold_date)}${c.show_id ? ` · ${esc(showName(c.show_id))}` : ''}</div></div>
      <div class="figs"><div><b>${hit ? STAR : ''}${money(num(c.sold_price))}</b><span class="${p < 0 ? 'bad' : 'good'}">${p < 0 ? '' : '+'}${money(p)}</span></div></div></li>`;
  }).join('')}</ul>` : '<p class="empty-line">Sales show up here as you log them.</p>';
}
$('#period').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ui.period = b.dataset.p; saveUi(); markPressed('#period', b); renderOverview();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-filter-go]'); if (!b) return;
  ui.filter = b.dataset.filterGo; markPressed('#filters', $(`#filters [data-f="${ui.filter}"]`)); go('inventory'); renderInventory();
});
const markPressed = (group, btn) => $$(group + ' button').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));

/* ---------- inventory ---------- */
const FILTERS = {
  stock: inStock,
  sports: c => inStock(c) && c.category !== 'pokemon',
  pokemon: c => inStock(c) && c.category === 'pokemon',
  raw: c => inStock(c) && c.type !== 'slab',
  slab: c => inStock(c) && c.type === 'slab',
  grading: c => c.status === 'grading',
  old: c => inStock(c) && daysSince(c.buy_date) >= OLD_DAYS,
  sold: c => c.status === 'sold',
  all: () => true,
};
function slabBadge(c) {
  if (c.type !== 'slab') return '<div class="slab raw" aria-hidden="true"><small>Raw</small></div>';
  const m = (c.grade || '').match(/^\s*([A-Za-z]*)\s*([\d.]+)\s*$/);
  return `<div class="slab" aria-hidden="true"><small>${esc(m ? (m[1] || 'GRD').toUpperCase() : 'SLAB')}</small><b>${esc(m ? m[2] : '·')}</b></div>`;
}
function cardRow(c) {
  const d = daysSince(c.buy_date);
  const tags = [c.category === 'pokemon' ? 'Pokémon' : 'Sports'];
  if (c.type === 'slab' && c.grade && !/^\s*[A-Za-z]*\s*[\d.]+\s*$/.test(c.grade)) tags.push(esc(c.grade));
  if (c.status === 'grading') tags.push('<span class="tag grading">At PSA</span>');
  else if (c.status === 'sold') tags.push(`<span class="tag sold">Sold ${fmtDate(c.sold_date)}</span>`);
  else if (d >= OLD_DAYS) tags.push(`<span class="tag old">${d} days</span>`);
  else if (c.buy_date) tags.push(`${d}d held`);
  if (c.lot_id) tags.push(esc(lotName(c.lot_id)));
  let amt;
  if (c.status === 'sold') {
    const p = num(c.sold_price) - cost(c);
    amt = `<b>${money(num(c.sold_price))}</b><span class="${p < 0 ? 'bad' : 'good'}">${p < 0 ? '' : '+'}${money(p)}</span>`;
  } else amt = `<b>${money(cost(c))}</b>comp ${money(num(c.market_value))}`;
  return `<li><button type="button" class="card" data-card="${esc(c.id)}">${slabBadge(c)}
    <div style="min-width:0"><div class="name">${esc(c.name)}</div><div class="meta">${tags.map(t => `<span>${t}</span>`).join('')}</div></div>
    <div class="amt">${amt}</div></button></li>`;
}
function renderInventory() {
  const q = ui.q.trim().toLowerCase();
  const list = data.cards.filter(FILTERS[ui.filter] || inStock)
    .filter(c => !q || `${c.name} ${c.grade} ${c.notes} ${lotName(c.lot_id)}`.toLowerCase().includes(q))
    .sort(ui.filter === 'sold' ? byDateDesc('sold_date') : (a, b) => (b.buy_date || '').localeCompare(a.buy_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  $('#inv-count').textContent = list.length ? `${plural(list.length, 'card')}, ${money(list.reduce((a, c) => a + cost(c), 0))} cost` : '';
  $('#cardlist').innerHTML = list.length ? list.map(cardRow).join('')
    : `<li class="empty-line" style="padding:20px 0">${data.cards.length ? 'No cards match.' : 'Your inventory is empty. Use Add to log a buy.'}</li>`;
}
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ui.filter = b.dataset.f; saveUi(); markPressed('#filters', b); renderInventory();
});
$('#search').addEventListener('input', e => { ui.q = e.target.value; renderInventory(); });
$('#cardlist').addEventListener('click', e => { const b = e.target.closest('[data-card]'); if (b) cardSheet(b.dataset.card); });

/* ---------- add one card ---------- */
function syncType() { $('#grade-wrap').hidden = radio('f-type') !== 'slab'; }
function buyHint() {
  const m = num($('#f-market').value), p = num($('#f-price').value);
  $('#buy-hint').innerHTML = m > 0 && p > 0
    ? `That's <b>${pct(p / m * 100)}</b> of comps. Selling at 95% makes <b class="${m * .95 - p < 0 ? 'bad' : 'good'}">${money(m * .95 - p)}</b>.`
    : 'Enter comp and price to see your buy %.';
}
$$('input[name="f-type"]').forEach(r => r.addEventListener('change', syncType));
['#f-market', '#f-price'].forEach(s => $(s).addEventListener('input', buyHint));
$$('[data-pct]').forEach(b => b.addEventListener('click', () => {
  const m = num($('#f-market').value);
  if (!m) { toast('Enter the comp value first'); $('#f-market').focus(); return; }
  $('#f-price').value = cents(m * b.dataset.pct / 100); buyHint();
}));
function resetCardForm() {
  ui.editId = null; $('#cardform').reset();
  $('#f-date').value = today();
  $('#h-add').textContent = 'Log a buy'; $('#f-submit').textContent = 'Add to inventory';
  $('#f-cancel').hidden = true; $('#sold-wrap').hidden = true; $('#fee-wrap').hidden = true; $('#addmode').hidden = false;
  syncType(); buyHint();
}
function editCard(c) {
  closeSheet(); setMode('single'); ui.editId = c.id;
  $('#f-name').value = c.name || '';
  $('#f-cat-' + (c.category === 'pokemon' ? 'pokemon' : 'sports')).checked = true;
  $('#f-type-' + (c.type === 'slab' ? 'slab' : 'raw')).checked = true;
  $('#f-grade').value = c.grade || ''; $('#f-market').value = c.market_value || ''; $('#f-price').value = c.buy_price || '';
  $('#f-date').value = c.buy_date || ''; $('#f-fee').value = c.grading_fee || ''; $('#f-notes').value = c.notes || '';
  $('#fee-wrap').hidden = false; $('#sold-wrap').hidden = c.status !== 'sold';
  $('#f-sold').value = c.sold_price || ''; $('#f-solddate').value = c.sold_date || '';
  $('#h-add').textContent = 'Edit card'; $('#f-submit').textContent = 'Save changes';
  $('#f-cancel').hidden = false; $('#addmode').hidden = true;
  syncType(); buyHint(); go('add', { keepEdit: true });
}
$('#f-cancel').addEventListener('click', () => { resetCardForm(); go('inventory'); });
$('#cardform').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  if (!name) { toast('Add a card name'); $('#f-name').focus(); return; }
  const type = radio('f-type'), market = num($('#f-market').value);
  const fields = {
    name, category: radio('f-cat'), type, grade: type === 'slab' ? $('#f-grade').value.trim() : '',
    market_value: market, buy_price: num($('#f-price').value), buy_date: $('#f-date').value || today(), notes: $('#f-notes').value.trim(),
  };
  if (ui.editId) {
    const c = store.find('cards', ui.editId);
    fields.grading_fee = num($('#f-fee').value);
    if (c?.status === 'sold') { fields.sold_price = num($('#f-sold').value); fields.sold_date = $('#f-solddate').value || c.sold_date; }
    if (c && !num(c.buy_market)) fields.buy_market = market;
    store.update('cards', ui.editId, fields); saved('Saved');
    resetCardForm(); go('inventory');
  } else {
    store.create('cards', { ...fields, buy_market: market, grading_fee: 0, status: 'inventory', sold_price: 0, sold_date: null, show_id: null, lot_id: null });
    saved(`Added ${name}`);
    const keep = { cat: radio('f-cat'), type, date: $('#f-date').value };
    resetCardForm();
    $('#f-cat-' + keep.cat).checked = true; $('#f-type-' + keep.type).checked = true; $('#f-date').value = keep.date;
    syncType(); $('#f-name').focus();
  }
});

/* ---------- add a lot ---------- */
function setMode(m) {
  ui.mode = m; saveUi();
  markPressed('#addmode', $(`#addmode [data-m="${m}"]`));
  $('#lotform').hidden = m !== 'lot'; $('#cardform').hidden = m === 'lot';
  if (m === 'lot' && !$('#lot-rows').children.length) { addLotRow(); addLotRow(); addLotRow(); }
  lotCalc();
}
$('#addmode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
let lotSeq = 0;
function addLotRow(v = {}) {
  const i = ++lotSeq, li = document.createElement('li');
  li.className = 'lotrow';
  li.innerHTML = `<div class="top"><input id="lr-name-${i}" class="lr-name" aria-label="Card name" placeholder="Card name…" autocomplete="off" value="${esc(v.name || '')}">
      <button type="button" class="x" data-rm>Remove</button></div>
    <div class="fields">
      <select id="lr-type-${i}" class="lr-type" aria-label="Raw or slab"><option value="raw">Raw</option><option value="slab"${v.type === 'slab' ? ' selected' : ''}>Slab</option></select>
      <input id="lr-grade-${i}" class="lr-grade" aria-label="Grade" placeholder="PSA 10…" autocomplete="off" value="${esc(v.grade || '')}">
      <span class="money"><input id="lr-comp-${i}" class="lr-comp" aria-label="Comp value" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Comp" value="${v.comp ?? ''}"></span>
    </div><div class="out" aria-live="polite"></div>`;
  $('#lot-rows').appendChild(li);
  return li;
}
const lotRows = () => $$('#lot-rows .lotrow').map(el => ({
  el, name: el.querySelector('.lr-name').value.trim(), type: el.querySelector('.lr-type').value,
  grade: el.querySelector('.lr-grade').value.trim(), comp: num(el.querySelector('.lr-comp').value),
}));
function lotCalc() {
  const rows = lotRows(), named = rows.filter(r => r.name), paid = num($('#l-paid').value);
  const shares = allocate(named.map(r => r.comp), paid), tc = named.reduce((a, r) => a + r.comp, 0);
  rows.forEach(r => {
    const out = r.el.querySelector('.out'), k = named.indexOf(r);
    if (!r.name) out.innerHTML = '';
    else if (!r.comp) out.innerHTML = '<span class="warn">Add a comp so this card takes its share of the cost.</span>';
    else if (!paid) out.textContent = 'Enter the total paid to see this card’s cost.';
    else out.innerHTML = `<span>Cost <b>${money(shares[k])}</b></span><span>Floor <b>${money(floorPrice(shares[k]))}</b></span><span>List at <b>${money(r.comp)}</b></span>`;
  });
  const bp = tc ? paid / tc * 100 : NaN, noComp = named.filter(r => !r.comp).length;
  $('#lot-sum').innerHTML = !named.length ? '<p class="muted" style="margin:0">Add cards above to see how the cost splits.</p>' : `
    <div class="line"><span class="muted">${plural(named.length, 'card')}, total comps</span><b>${money(tc)}</b></div>
    <div class="line"><span class="muted">You paid</span><b>${money(paid)}${paid && tc ? ` · ${pct(bp)} of comps` : ''}</b></div>
    ${paid && tc ? `<div class="line"><span class="muted">Profit if all sell at 95%</span><b class="${tc * .95 - paid < 0 ? 'bad' : 'good'}">${money(tc * .95 - paid)}</b></div>
      <p class="muted small" style="margin:4px 0 0">Floor is the lowest price that still keeps 10% of the sale as profit.</p>` : ''}
    ${noComp ? `<p class="warn small" style="margin:4px 0 0">${plural(noComp, 'card')} without a comp will carry $0 cost.</p>` : ''}`;
}
$('#lotform').addEventListener('input', lotCalc);
$('#lot-rows').addEventListener('click', e => { if (e.target.closest('[data-rm]')) { e.target.closest('.lotrow').remove(); lotCalc(); } });
$('#l-addrow').addEventListener('click', () => { addLotRow().querySelector('input').focus(); lotCalc(); });
$('#l-pastetoggle').addEventListener('click', e => {
  const box = $('#paste-box'); box.hidden = !box.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) $('#l-paste').focus();
});
$('#l-pastebtn').addEventListener('click', () => {
  const lines = $('#l-paste').value.split('\n').map(s => s.trim()).filter(Boolean);
  lotRows().forEach(r => { if (!r.name && !r.comp) r.el.remove(); });
  for (const ln of lines) {
    const m = ln.match(/^(.*?)[,\t]\s*\$?([\d.,]+)\s*$/);
    const name = (m ? m[1] : ln).trim(), gm = name.match(/\b(PSA|BGS|SGC|CGC|TAG)\s*([\d.]+)\b/i);
    addLotRow({ name, comp: m ? num(m[2].replace(/,/g, '')) : '', type: gm ? 'slab' : 'raw', grade: gm ? `${gm[1].toUpperCase()} ${gm[2]}` : '' });
  }
  $('#l-paste').value = ''; lotCalc(); toast(`Added ${plural(lines.length, 'card')}`);
});
$('#lotform').addEventListener('submit', e => {
  e.preventDefault();
  const rows = lotRows().filter(r => r.name), paid = num($('#l-paid').value);
  if (!rows.length) { toast('Add at least one card'); return; }
  if (!paid) { toast('Enter the total you paid'); $('#l-paid').focus(); return; }
  const date = $('#l-date').value || today(), category = radio('l-cat');
  const name = $('#l-name').value.trim() || `Lot from ${fmtDate(date)}`;
  const tc = rows.reduce((a, r) => a + r.comp, 0), shares = allocate(rows.map(r => r.comp), paid), lotId = store.newId();
  store.batch([
    { op: 'upsert', table: 'lots', row: { id: lotId, name, date, total_paid: paid, total_comp: tc, buy_pct: tc ? cents(paid / tc * 100) : 0, card_count: rows.length } },
    ...rows.map((r, i) => ({ op: 'upsert', table: 'cards', row: {
      name: r.name, category, type: r.type, grade: r.type === 'slab' ? r.grade : '', status: 'inventory',
      market_value: r.comp, buy_market: r.comp, buy_price: shares[i], buy_date: date, grading_fee: 0,
      sold_price: 0, sold_date: null, show_id: null, lot_id: lotId, notes: '',
    } })),
  ]);
  saved(`Added ${plural(rows.length, 'card')} from ${name}`);
  $('#lotform').reset(); $('#l-date').value = today(); $('#lot-rows').innerHTML = '';
  addLotRow(); addLotRow(); addLotRow(); lotCalc(); go('inventory');
});

/* ---------- card sheet ---------- */
const sheet = $('#sheet');
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  const first = $('#sheet-body').querySelector('input'); if (first) setTimeout(() => first.focus(), 60);
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });
const sheetHead = title => `<div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="btn ghost sm" type="button" data-close>Close</button></div>`;
const showOptions = sel => '<option value="">Online or other</option>' + [...data.shows].sort(byDateDesc('date'))
  .map(s => `<option value="${esc(s.id)}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}, ${fmtDate(s.date)}</option>`).join('');

function cardSheet(id) {
  const c = store.find('cards', id); if (!c) return;
  const bp = num(c.buy_market) ? num(c.buy_price) / num(c.buy_market) * 100 : NaN;
  const facts = [['Paid', `${money(num(c.buy_price))}${Number.isFinite(bp) ? ` (${pct(bp)})` : ''}`], ['Bought', fmtDate(c.buy_date) || '—'], ['Comp now', money(num(c.market_value))]];
  if (num(c.grading_fee)) facts.push(['Grading fee', money(num(c.grading_fee))]);
  facts.push(['Total cost', money(cost(c))]);
  if (c.lot_id) facts.push(['From lot', esc(lotName(c.lot_id))]);
  if (c.status === 'sold') {
    const sp = num(c.market_value) ? num(c.sold_price) / num(c.market_value) * 100 : NaN, p = num(c.sold_price) - cost(c);
    facts.push(['Sold', `${money(num(c.sold_price))}${Number.isFinite(sp) ? ` (${pct(sp)})` : ''}`],
      ['Sold on', `${fmtDate(c.sold_date)}${c.show_id ? `, ${esc(showName(c.show_id))}` : ''}`],
      ['Profit', `<span class="${p < 0 ? 'bad' : 'good'}">${money(p)}</span>`]);
  } else facts.push(['Floor (10% profit)', money(floorPrice(cost(c)))]);
  const actions = c.status === 'sold' ? '<button class="btn ghost" type="button" data-act="unsell">Undo sale</button>'
    : c.status === 'grading' ? '<button class="btn primary" type="button" data-act="return">Back from PSA</button>'
    : `<button class="btn primary" type="button" data-act="sell">Sell</button>${c.type !== 'slab' ? '<button class="btn ghost" type="button" data-act="psa">Send to PSA</button>' : ''}`;
  openSheet(`${sheetHead(esc(c.name))}
    <p class="muted small" style="margin:-8px 0 0">${c.category === 'pokemon' ? 'Pokémon' : 'Sports'} · ${c.type === 'slab' ? esc(c.grade || 'Slab') : 'Raw'}${c.notes ? ` · ${esc(c.notes)}` : ''}</p>
    <ul class="facts">${facts.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('')}</ul>
    <div class="row">${actions}<button class="btn ghost" type="button" data-act="edit">Edit</button><button class="btn danger" type="button" data-act="del">Delete</button></div>`);
  $('#sheet-body').onclick = e => {
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'edit') editCard(c);
    if (a === 'sell') sellSheet(c);
    if (a === 'psa') psaSheet(c);
    if (a === 'return') returnSheet(c);
    if (a === 'unsell') { store.update('cards', c.id, { status: 'inventory', sold_price: 0, sold_date: null, show_id: null }); saved('Back in stock'); closeSheet(); }
    if (a === 'del') arm(e.target.closest('button'), () => { store.remove('cards', c.id); saved('Deleted'); closeSheet(); });
  };
}
function sellSheet(c) {
  const m = num(c.market_value), fl = floorPrice(cost(c));
  const todayShow = data.shows.find(s => s.date === today())?.id;
  openSheet(`${sheetHead(`Sell ${esc(c.name)}`)}
    <form id="sellform" class="form" novalidate>
      <label class="f">Sold for<span class="money"><input id="s-price" name="sprice" type="number" inputmode="decimal" min="0" step="0.01"></span></label>
      ${m ? `<div class="quick" role="group" aria-label="Price from comp"><span class="muted">Of ${money(m)} comp</span>${[100, 97, 95, 93].map(p => `<button type="button" class="btn ghost sm" data-sp="${p}">${p}%</button>`).join('')}</div>` : ''}
      <p class="hint" id="s-hint" aria-live="polite"></p>
      <div class="grid2">
        <label class="f">Date<input id="s-date" name="sdate" type="date" value="${today()}"></label>
        <label class="f">Where<select id="s-where" name="swhere">${showOptions(todayShow)}</select></label>
      </div>
      <button class="btn primary" type="submit">Mark sold</button>
    </form>`);
  const hint = () => {
    const p = num($('#s-price').value), pr = p - cost(c);
    $('#s-hint').innerHTML = p
      ? `${m ? `<b>${pct(p / m * 100)}</b> of comps. ` : ''}Profit <b class="${pr < 0 ? 'bad' : 'good'}">${money(pr)}</b>.${p < fl ? ` <span class="warn">Below your ${money(fl)} floor.</span>` : ''}`
      : `Cost ${money(cost(c))}. Floor for 10% profit: <b>${money(fl)}</b>.`;
  };
  hint();
  $('#s-price').addEventListener('input', hint);
  $$('[data-sp]').forEach(b => b.addEventListener('click', () => { $('#s-price').value = cents(m * b.dataset.sp / 100); hint(); }));
  $('#sellform').addEventListener('submit', e => {
    e.preventDefault();
    const p = num($('#s-price').value); if (!p) { toast('Enter the sale price'); return; }
    store.update('cards', c.id, { status: 'sold', sold_price: p, sold_date: $('#s-date').value || today(), show_id: $('#s-where').value || null });
    saved(`Sold for ${money(p)}`); closeSheet();
  });
}
function psaSheet(c) {
  openSheet(`${sheetHead('Send to PSA')}
    <form id="psaform" class="form" novalidate>
      <p class="muted" style="margin:0">${esc(c.name)}. The fee is added to this card's cost.</p>
      <label class="f">Grading fee, with shipping<span class="money"><input id="g-fee" name="gfee" type="number" inputmode="decimal" min="0" step="0.01"></span></label>
      <button class="btn primary" type="submit">Mark as at PSA</button>
    </form>`);
  $('#psaform').addEventListener('submit', e => {
    e.preventDefault();
    store.update('cards', c.id, { status: 'grading', grading_fee: num(c.grading_fee) + num($('#g-fee').value) });
    saved('Marked as at PSA'); closeSheet();
  });
}
function returnSheet(c) {
  openSheet(`${sheetHead('Back from PSA')}
    <form id="retform" class="form" novalidate>
      <p class="muted" style="margin:0">${esc(c.name)}</p>
      <div class="grid2">
        <label class="f">Grade<input id="r-grade" name="rgrade" placeholder="PSA 10…" autocomplete="off"></label>
        <label class="f">New comp value<span class="money"><input id="r-market" name="rmarket" type="number" inputmode="decimal" min="0" step="0.01" value="${num(c.market_value) || ''}"></span></label>
      </div>
      <button class="btn primary" type="submit">Add slab to stock</button>
    </form>`);
  $('#retform').addEventListener('submit', e => {
    e.preventDefault();
    const g = $('#r-grade').value.trim() || 'PSA';
    store.update('cards', c.id, { status: 'inventory', type: 'slab', grade: g, market_value: num($('#r-market').value) || num(c.market_value) });
    saved(`${g} added to stock`); closeSheet();
  });
}

/* ---------- shows, lots, expenses ---------- */
function renderShows() {
  const shows = [...data.shows].sort(byDateDesc('date'));
  $('#showlist').innerHTML = shows.length ? shows.map(s => {
    const r = showResult(s, data.cards);
    return `<li><div class="grow"><div class="title">${esc(s.name)}</div><div class="sub">${fmtDate(s.date)} · table ${money(num(s.table_cost))} · ${plural(r.count, 'sale')}</div></div>
      <div class="figs"><div><b>${money(r.sales)}</b>sales</div><div><b class="${r.net < 0 ? 'bad' : 'good'}">${money(r.net)}</b>after table</div></div>
      <button class="x" type="button" data-del="shows:${esc(s.id)}" aria-label="Delete ${esc(s.name)}">Delete</button></li>`;
  }).join('') : '<li class="empty-line">Add a show above, then pick it when you sell. Its results add up here.</li>';

  const lots = [...data.lots].sort(byDateDesc('date'));
  $('#lotlist').innerHTML = lots.length ? lots.map(l => {
    const p = lotProgress(l, data.cards);
    const line = p.paidOff
      ? `<span class="good">Paid off. ${money(p.back - p.paid)} profit so far${p.left ? `, ${p.left} left` : ''}.</span>`
      : `${money(p.paid - p.back)} to go. ${p.left} left, comps ${money(p.leftComps)}.`;
    return `<li><div class="grow"><div class="title">${esc(l.name)}</div>
        <div class="sub">${fmtDate(l.date)} · paid ${money(p.paid)} for ${plural(p.count, 'card')}${num(l.buy_pct) ? ` · ${pct(num(l.buy_pct))} of comps` : ''}</div>
        <div class="progress ${p.paidOff ? 'done' : ''}" role="img" aria-label="${Math.round(p.pct)}% paid back"><i style="width:${p.pct}%"></i></div>
        <div class="sub">${money(p.back)} back from ${p.sold} sold. ${line}</div></div>
      <button class="x" type="button" data-dellot="${esc(l.id)}" aria-label="Delete lot ${esc(l.name)}">Delete</button></li>`;
  }).join('') : '<li class="empty-line">Use Add, then Lot, when you buy a group of cards for one price.</li>';

  const ex = [...data.expenses].sort(byDateDesc('date'));
  $('#explist').innerHTML = ex.length ? ex.map(e => `<li><div class="grow"><div class="title">${esc(e.label)}</div><div class="sub">${fmtDate(e.date)}</div></div>
      <div class="figs"><div><b>${money(num(e.amount))}</b></div></div>
      <button class="x" type="button" data-del="expenses:${esc(e.id)}" aria-label="Delete ${esc(e.label)}">Delete</button></li>`).join('')
    : '<li class="empty-line">No other expenses yet.</li>';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (b) { const [t, id] = b.dataset.del.split(':'); arm(b, () => { store.remove(t, id); saved('Deleted'); }); return; }
  const l = e.target.closest('[data-dellot]');
  if (l) {
    const id = l.dataset.dellot, cs = data.cards.filter(c => c.lot_id === id);
    arm(l, () => { store.batch([...cs.map(c => ({ op: 'delete', table: 'cards', id: c.id })), { op: 'delete', table: 'lots', id }]); saved('Lot deleted'); },
      `Tap again: deletes lot and ${plural(cs.length, 'card')}`);
  }
});
$('#showform').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#sh-name').value.trim(); if (!name) { toast('Add a show name'); $('#sh-name').focus(); return; }
  store.create('shows', { name, date: $('#sh-date').value || today(), table_cost: num($('#sh-table').value) });
  saved('Show added'); $('#showform').reset(); $('#sh-date').value = today();
});
$('#expform').addEventListener('submit', e => {
  e.preventDefault();
  const label = $('#ex-label').value.trim(), amount = num($('#ex-amount').value);
  if (!label || !amount) { toast('Add what it was and the amount'); return; }
  store.create('expenses', { label, amount, date: $('#ex-date').value || today() });
  saved('Expense added'); $('#expform').reset(); $('#ex-date').value = today();
});

/* ---------- pay ---------- */
function renderPay() {
  const ps = payStatus(data), sp = split(data.settings);
  $('#pay-detail').innerHTML = `
    <div class="muted small">Available to take now</div><div class="big">${money(ps.available)}</div>
    <div class="kv" style="margin-top:22px">
      <div><b>${money(Math.max(0, ps.allNet))}</b><span>All-time profit</span></div>
      <div><b>${money(ps.earned)}</b><span>Your ${sp.pay}% share</span></div>
      <div><b>${money(ps.paid)}</b><span>Already taken</span></div>
    </div>
    ${ps.over > 0 ? `<p class="note bad">You've taken ${money(ps.over)} more than your share so far.</p>` : ''}`;
  const po = [...data.payouts].sort(byDateDesc('date'));
  $('#paylist').innerHTML = po.length ? po.map(p => `<li><div class="grow"><div class="title">${money(num(p.amount))}</div><div class="sub">${fmtDate(p.date)}</div></div>
      <button class="x" type="button" data-del="payouts:${esc(p.id)}" aria-label="Delete payout">Delete</button></li>`).join('')
    : '<li class="empty-line">No payouts yet.</li>';
  for (const k of ['reinvest', 'taxes', 'pay']) { const el = $('#sp-' + k); if (document.activeElement !== el) el.value = sp[k]; }
  splitHint();
  const u = status.user?.email || '';
  $('#acct-line').textContent = `${u ? `Signed in as ${u}. ` : ''}${status.pulledAt ? `Last synced ${new Date(status.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}`;
}
function splitHint() {
  const t = ['reinvest', 'taxes', 'pay'].reduce((a, k) => a + num($('#sp-' + k).value), 0);
  $('#split-hint').innerHTML = t === 100 ? 'Adds up to 100%.' : `<span class="bad">Adds up to ${t}%. Make it 100%.</span>`;
}
['reinvest', 'taxes', 'pay'].forEach(k => $('#sp-' + k).addEventListener('input', splitHint));
$('#splitform').addEventListener('submit', e => {
  e.preventDefault();
  const d = { reinvest: num($('#sp-reinvest').value), taxes: num($('#sp-taxes').value), pay: num($('#sp-pay').value) };
  if (d.reinvest + d.taxes + d.pay !== 100) { toast('The three numbers need to add up to 100'); return; }
  store.saveSettings(d); saved('Split saved');
});
$('#payform').addEventListener('submit', e => {
  e.preventDefault();
  const amount = num($('#po-amount').value); if (!amount) { toast('Enter an amount'); return; }
  store.create('payouts', { amount, date: $('#po-date').value || today() });
  saved(`Recorded ${money(amount)} payout`); $('#payform').reset(); $('#po-date').value = today();
});

/* ---------- export / import ---------- */
$('#export').addEventListener('click', async () => {
  const cols = ['name', 'category', 'type', 'grade', 'status', 'buy_date', 'buy_price', 'buy_market', 'grading_fee', 'market_value', 'sold_date', 'sold_price', 'show', 'lot', 'profit', 'notes'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = data.cards.map(c => ({ ...c, show: showName(c.show_id), lot: lotName(c.lot_id), profit: c.status === 'sold' ? (num(c.sold_price) - cost(c)).toFixed(2) : '' }));
  const csv = [cols.join(','), ...rows.map(r => cols.map(k => q(r[k])).join(','))].join('\n');
  const file = new File([csv], `card-world-${today()}.csv`, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; } }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const n = store.importRows(JSON.parse(await f.text()));
    toast(n ? `Imported ${plural(n, 'record')}` : 'That file had nothing to import');
  } catch { toast('That file is not a Card World export'); }
});
$('#sync-now').addEventListener('click', async () => { toast('Syncing…'); await store.sync(); toast(status.failed ? 'Could not reach the server. Your changes are safe on this device.' : 'Up to date'); });
$('#signout').addEventListener('click', e => {
  const n = store.pendingCount();
  if (n) { arm(e.currentTarget, () => signOut(), `${plural(n, 'change')} not uploaded. Tap again to sign out anyway`); return; }
  signOut();
});
async function signOut() { await store.sb.auth.signOut().catch(() => {}); store.resetLocal(); showAuth(); }

/* ---------- sync status ---------- */
function renderSync() {
  const n = status.pending, off = !status.online || status.failed;
  const pill = $('#sync-side');
  pill.dataset.state = n && off ? 'off' : status.syncing ? 'busy' : 'ok';
  pill.innerHTML = `<span class="dot"></span>${n ? (off ? `${plural(n, 'change')} waiting` : 'Syncing…') : off ? 'Offline' : 'Synced'}`;
  const ban = $('#sync-banner');
  ban.hidden = !(n && off);
  if (!ban.hidden) ban.innerHTML = `<b>Offline.</b> ${plural(n, 'change')} saved on this device. ${n === 1 ? 'It uploads' : 'They upload'} when you're back online.`;
}

/* ---------- render all ---------- */
let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { renderOverview(); renderInventory(); renderShows(); renderPay(); renderSync(); });
}
store.onChange(render);
store.onNotice(toast);

/* ---------- sign in ---------- */
let signUpMode = false;
function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; $('#authform').hidden = !store.configured; $('#setup-needed').hidden = store.configured; }
function showApp() { $('#auth').hidden = true; $('#app').hidden = false; render(); }
$('#a-toggle').addEventListener('click', () => {
  signUpMode = !signUpMode;
  $('#a-submit').textContent = signUpMode ? 'Create account' : 'Sign in';
  $('#a-toggle').textContent = signUpMode ? 'Have an account? Sign in' : 'First time? Create your account';
  $('#a-pass').autocomplete = signUpMode ? 'new-password' : 'current-password';
  $('#a-msg').textContent = '';
});
$('#authform').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#a-email').value.trim(), password = $('#a-pass').value, msg = $('#a-msg'), btn = $('#a-submit');
  if (!email || password.length < 8) { msg.textContent = 'Enter your email and a password of at least 8 characters.'; return; }
  if (!navigator.onLine) { msg.textContent = 'You need internet to sign in the first time on this device.'; return; }
  btn.disabled = true; msg.textContent = ''; const label = btn.textContent; btn.textContent = signUpMode ? 'Creating account…' : 'Signing in…';
  const { data: res, error } = signUpMode
    ? await store.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } })
    : await store.sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = label;
  if (error) { msg.textContent = error.message.includes('Invalid login') ? 'Email or password is wrong. Check both and try again.' : error.message; $('#a-pass').focus(); return; }
  if (signUpMode && !res.session) { msg.style.color = 'var(--ink)'; msg.textContent = 'Check your email and tap the link to confirm, then sign in here.'; $('#a-toggle').click(); return; }
  await enter(res.session);
});
async function enter(session) {
  status.user = session?.user || null;
  showApp();
  await store.sync();
}

/* ---------- start ---------- */
function initDates() { ['#f-date', '#l-date', '#sh-date', '#ex-date', '#po-date'].forEach(s => { $(s).value = today(); }); }
async function boot() {
  initDates(); syncType(); buyHint();
  markPressed('#period', $(`#period [data-p="${ui.period}"]`) || $('#period button'));
  markPressed('#filters', $(`#filters [data-f="${ui.filter}"]`) || $('#filters button'));
  setMode(ui.mode === 'lot' ? 'lot' : 'single');
  go(location.hash.slice(1) || ui.view);
  if (!store.configured) { showAuth(); return; }
  const { data: { session } } = await store.sb.auth.getSession();
  if (session) await enter(session);
  else if (store.hasCache() && !navigator.onLine) showApp(); // offline with saved data: keep working
  else showAuth();
  store.sb.auth.onAuthStateChange((evt, s) => {
    if (evt === 'SIGNED_IN' && s && $('#app').hidden) enter(s);
    if (evt === 'TOKEN_REFRESHED' && s) { status.user = s.user; store.flush(); }
  });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
