// All the money math lives here, separate from the screens, so it's easy to check.

export const FLOOR_MARGIN = 0.10; // lowest sale price still keeps 10% of the sale as profit
export const OLD_DAYS = 90;        // cards held this long are flagged as slow

export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const cents = n => Math.round(n * 100) / 100;
export const cost = c => num(c.buy_price) + num(c.grading_fee);
export const inStock = c => c.status !== 'sold';
export const floorPrice = c => Math.ceil(c / (1 - FLOOR_MARGIN));

export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}
export function daysSince(date) {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date + 'T12:00').getTime()) / 864e5));
}

// period: 'month' | '30' | 'year' | 'all'
export function inPeriod(period, date) {
  if (!date) return false;
  if (period === 'all') return true;
  const d = new Date(date + 'T12:00'), n = new Date();
  if (period === 'month') return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  if (period === 'year') return d.getFullYear() === n.getFullYear();
  return (n - d) / 864e5 <= 30;
}

// Profit and percentages for one period
export function stats(data, period) {
  const inP = d => inPeriod(period, d);
  const sold = data.cards.filter(c => c.status === 'sold' && inP(c.sold_date));
  const sales = sold.reduce((a, c) => a + num(c.sold_price), 0);
  const cogs = sold.reduce((a, c) => a + cost(c), 0);
  const tables = data.shows.filter(s => inP(s.date)).reduce((a, s) => a + num(s.table_cost), 0);
  const other = data.expenses.filter(e => inP(e.date)).reduce((a, e) => a + num(e.amount), 0);
  const net = sales - cogs - tables - other;

  const priced = sold.filter(c => num(c.market_value) > 0);
  const sellPct = priced.length
    ? priced.reduce((a, c) => a + num(c.sold_price), 0) / priced.reduce((a, c) => a + num(c.market_value), 0) * 100
    : NaN;

  const bought = data.cards.filter(c => inP(c.buy_date));
  const boughtPriced = bought.filter(c => num(c.buy_market) > 0);
  const buyPct = boughtPriced.length
    ? boughtPriced.reduce((a, c) => a + num(c.buy_price), 0) / boughtPriced.reduce((a, c) => a + num(c.buy_market), 0) * 100
    : NaN;
  const spent = bought.reduce((a, c) => a + num(c.buy_price), 0);

  return { sold, sales, cogs, tables, other, expenses: tables + other, net, sellPct, buyPct, spent, boughtCount: bought.length };
}

export function split(settings) {
  return { reinvest: num(settings?.reinvest ?? 70), taxes: num(settings?.taxes ?? 20), pay: num(settings?.pay ?? 10) };
}

// What you've earned as pay, all time, minus what you've already taken
export function payStatus(data) {
  const all = stats(data, 'all');
  const sp = split(data.settings);
  const earned = Math.max(0, all.net) * sp.pay / 100;
  const paid = data.payouts.reduce((a, p) => a + num(p.amount), 0);
  return { earned, paid, available: Math.max(0, earned - paid), over: Math.max(0, paid - earned), allNet: all.net };
}

// How much to spend on inventory: replace what sold, plus the reinvest share of profit
export function restock(st, settings) {
  const replace = st.cogs;
  const grow = Math.max(0, st.net) * split(settings).reinvest / 100;
  const budget = replace + grow;
  return { replace, grow, budget, left: budget - st.spent };
}

export function inventory(data) {
  const stock = data.cards.filter(inStock);
  const cost_ = stock.reduce((a, c) => a + cost(c), 0);
  const comps = stock.reduce((a, c) => a + num(c.market_value), 0);
  const old = stock.filter(c => daysSince(c.buy_date) >= OLD_DAYS);
  return {
    count: stock.length,
    grading: stock.filter(c => c.status === 'grading').length,
    cost: cost_, comps,
    at95: comps * 0.95 - cost_,
    old, oldCost: old.reduce((a, c) => a + cost(c), 0),
  };
}

// Split a lot's price across cards by comp value. Shares always add up to exactly what was paid.
export function allocate(comps, paid) {
  const total = comps.reduce((a, c) => a + c, 0);
  if (!total) return comps.map(() => 0);
  const shares = comps.map(c => cents(paid * c / total));
  const diff = cents(paid - shares.reduce((a, b) => a + b, 0));
  let big = 0;
  comps.forEach((c, i) => { if (c > comps[big]) big = i; });
  shares[big] = cents(shares[big] + diff);
  return shares;
}

export function lotProgress(lot, cards) {
  const cs = cards.filter(c => c.lot_id === lot.id);
  const sold = cs.filter(c => c.status === 'sold');
  const left = cs.filter(inStock);
  const back = sold.reduce((a, c) => a + num(c.sold_price), 0);
  const paid = num(lot.total_paid);
  return {
    count: cs.length, sold: sold.length, left: left.length, back, paid,
    leftComps: left.reduce((a, c) => a + num(c.market_value), 0),
    pct: paid ? Math.min(100, back / paid * 100) : 0,
    paidOff: paid > 0 && back >= paid,
  };
}

export function showResult(show, cards) {
  const sold = cards.filter(c => c.status === 'sold' && c.show_id === show.id);
  const sales = sold.reduce((a, c) => a + num(c.sold_price), 0);
  const cardProfit = sales - sold.reduce((a, c) => a + cost(c), 0);
  return { count: sold.length, sales, cardProfit, net: cardProfit - num(show.table_cost) };
}

export function groupBreakdown(st) {
  const groups = [
    ['Sports', c => c.category !== 'pokemon'],
    ['Pokémon', c => c.category === 'pokemon'],
    ['Raw', c => c.type !== 'slab'],
    ['Slabs', c => c.type === 'slab'],
    ['Graded by you', c => num(c.grading_fee) > 0],
  ];
  return groups.map(([name, f]) => {
    const s = st.sold.filter(f);
    const sales = s.reduce((a, c) => a + num(c.sold_price), 0);
    const profit = sales - s.reduce((a, c) => a + cost(c), 0);
    return { name, count: s.length, sales, profit, margin: sales ? profit / sales * 100 : NaN };
  });
}
