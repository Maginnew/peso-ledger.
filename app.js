/* Peso Ledger — finanzas personales en pesos.
   Todo vive en este navegador (localStorage). Hacé respaldos desde Ajustes. */
'use strict';

/* =========================================================
   Utilidades
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* ---------- Fechas (siempre 'YYYY-MM-DD', sin zonas horarias) ---------- */
const pad = n => String(n).padStart(2, '0');
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d: d || 1 }; }
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
function addMonthsISO(iso, n, dayOverride) {
  const { y, m, d } = parseISO(iso);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12 + 12) % 12 + 1;
  const day = Math.min(dayOverride || d, daysInMonth(ny, nm));
  return `${ny}-${pad(nm)}-${pad(day)}`;
}
const ymOf = iso => iso.slice(0, 7);
const addMonthsYM = (ym, n) => addMonthsISO(ym + '-01', n).slice(0, 7);
function monthsDiff(ymA, ymB) { const a = parseISO(ymA + '-01'), b = parseISO(ymB + '-01'); return (b.y * 12 + b.m) - (a.y * 12 + a.m); }
function ymLabel(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  return short ? `${MONTHS[m - 1].slice(0, 3)}${String(y).slice(2) !== String(new Date().getFullYear()).slice(2) ? ' ' + String(y).slice(2) : ''}` : `${cap(MONTHS[m - 1])} ${y}`;
}
function dateLabel(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const { y, m, d } = parseISO(iso);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', opts);
}
function daysBetween(a, b) { const A = parseISO(a), B = parseISO(b); return Math.round((new Date(B.y, B.m - 1, B.d) - new Date(A.y, A.m - 1, A.d)) / 864e5); }

/* ---------- Dinero ---------- */
const nfARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nfUSD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const moneyTxt = (v, cur = 'ARS') => cur === 'USD' ? nfUSD.format(v) : nfARS.format(Math.round(v));
const money = (v, cur = 'ARS') => `<span class="amt">${moneyTxt(v, cur)}</span>`;
const pct = (x, d = 0) => (x * 100).toLocaleString('es-AR', { maximumFractionDigits: d }) + '%';
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e3) return '$' + (v / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' k';
  return '$' + Math.round(v);
}
function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[^\d.,\-]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-'); s = s.replace(/-/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return neg ? -n : n;
}

/* =========================================================
   Estado
   ========================================================= */
const STORE_KEY = 'pesoLedger.v1';
const UI_KEY = 'pesoLedger.ui';

const GROUPS = {
  necesidad: { label: 'Necesidades', color: 'var(--s1)', hint: 'Lo que tenés que pagar sí o sí' },
  gusto: { label: 'Gustos', color: 'var(--s2)', hint: 'Lo que elegís darte' },
  ahorro: { label: 'Ahorro', color: 'var(--s3)', hint: 'Lo que guardás o invertís' },
};
const ACCOUNT_TYPES = {
  efectivo: { label: 'Efectivo', icon: '💵' },
  banco: { label: 'Cuenta bancaria', icon: '🏦' },
  billetera: { label: 'Billetera virtual', icon: '📱' },
  tarjeta: { label: 'Tarjeta de crédito', icon: '💳' },
  inversion: { label: 'Ahorro / inversión', icon: '📈' },
};
const TYPE_LABEL = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' };

function defaultCategories() {
  const g = (id, name, icon, group) => ({ id, name, icon, kind: 'gasto', group });
  const i = (id, name, icon) => ({ id, name, icon, kind: 'ingreso', group: null });
  return [
    g('super', 'Supermercado', '🛒', 'necesidad'),
    g('alquiler', 'Alquiler', '🏠', 'necesidad'),
    g('servicios', 'Servicios y expensas', '💡', 'necesidad'),
    g('transporte', 'Transporte', '🚌', 'necesidad'),
    g('salud', 'Salud', '🩺', 'necesidad'),
    g('educacion', 'Educación', '📚', 'necesidad'),
    g('hogar', 'Hogar', '🛋️', 'necesidad'),
    g('impuestos', 'Impuestos', '🧾', 'necesidad'),
    g('delivery', 'Comida afuera', '🍕', 'gusto'),
    g('salidas', 'Salidas', '🎉', 'gusto'),
    g('ropa', 'Ropa', '👕', 'gusto'),
    g('suscripciones', 'Suscripciones', '📺', 'gusto'),
    g('tecnologia', 'Tecnología', '💻', 'gusto'),
    g('viajes', 'Viajes', '✈️', 'gusto'),
    g('regalos', 'Regalos', '🎁', 'gusto'),
    g('otros_g', 'Otros gastos', '📦', 'gusto'),
    g('ahorro', 'Ahorro e inversión', '🐷', 'ahorro'),
    i('sueldo', 'Sueldo', '💼'),
    i('freelance', 'Trabajos extra', '🧑‍💻'),
    i('ventas', 'Ventas', '🏷️'),
    i('rendimientos', 'Rendimientos', '📈'),
    i('otros_i', 'Otros ingresos', '➕'),
  ];
}
function defaultState() {
  return {
    version: 1,
    settings: { usdRate: 1450, theme: 'auto', ipc: '', privacy: false, isDemo: false, lastBackup: null, expectedIncome: 0 },
    accounts: [
      { id: 'efectivo', name: 'Efectivo', type: 'efectivo', currency: 'ARS', initial: 0 },
      { id: 'banco', name: 'Cuenta sueldo', type: 'banco', currency: 'ARS', initial: 0 },
      { id: 'billetera', name: 'Billetera virtual', type: 'billetera', currency: 'ARS', initial: 0 },
      { id: 'tarjeta', name: 'Tarjeta de crédito', type: 'tarjeta', currency: 'ARS', initial: 0 },
      { id: 'usd', name: 'Ahorro en dólares', type: 'inversion', currency: 'USD', initial: 0 },
    ],
    categories: defaultCategories(),
    transactions: [],
    budgets: { groups: { necesidad: 50, gusto: 30, ahorro: 20 }, categories: {} },
    recurring: [],
    goals: [],
  };
}
function migrate(s) {
  const d = defaultState();
  s.settings = { ...d.settings, ...(s.settings || {}) };
  for (const k of ['accounts', 'categories', 'transactions', 'recurring', 'goals']) if (!Array.isArray(s[k])) s[k] = d[k];
  s.budgets = s.budgets || d.budgets;
  s.budgets.groups = { ...d.budgets.groups, ...(s.budgets.groups || {}) };
  s.budgets.categories = s.budgets.categories || {};
  s.version = 1;
  return s;
}

let S = null;
let UI = { view: 'inicio', ym: ymOf(todayISO()), f: { q: '', type: '', cat: '', acc: '', scope: 'mes' } };

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.error(e); }
  return null;
}
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify({ f: UI.f })); } catch (e) { /* sin almacenamiento */ } }
function loadUI() { try { const u = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); if (u?.f) UI.f = { ...UI.f, ...u.f }; } catch (e) { /* nada */ } }

/* ---------- Deshacer ---------- */
let undoSnapshot = null;
function snapshot() { undoSnapshot = JSON.stringify(S); }
function undo() { if (!undoSnapshot) return; S = migrate(JSON.parse(undoSnapshot)); undoSnapshot = null; save(); render(); toast('Listo, se deshizo el cambio'); }

/* =========================================================
   Consultas
   ========================================================= */
const catById = id => S.categories.find(c => c.id === id);
const accById = id => S.accounts.find(a => a.id === id);
const activeAccounts = () => S.accounts.filter(a => !a.archived);
function txARS(t) { return t.currency === 'USD' ? t.amount * (t.rate || S.settings.usdRate) : t.amount; }
function groupOf(t) { return catById(t.categoryId)?.group || 'gusto'; }
function sortTx(a, b) { return b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0); }

function accountBalance(acc, upTo = todayISO()) {
  let b = acc.initial || 0;
  for (const t of S.transactions) {
    if (t.date > upTo) continue;
    if (t.type === 'ingreso' && t.accountId === acc.id) b += t.amount;
    else if (t.type === 'gasto' && t.accountId === acc.id) b -= t.amount;
    else if (t.type === 'transferencia') {
      if (t.accountId === acc.id) b -= t.amount;
      if (t.toAccountId === acc.id) b += (t.amountTo ?? t.amount);
    }
  }
  return round2(b);
}
const toARS = (v, cur) => cur === 'USD' ? v * S.settings.usdRate : v;
function netWorth() { return sum(activeAccounts(), a => toARS(accountBalance(a), a.currency)); }

function monthSummary(ym) {
  const txs = S.transactions.filter(t => t.date.startsWith(ym));
  let income = 0, consumption = 0, saving = 0;
  const byCat = {}, byGroup = { necesidad: 0, gusto: 0, ahorro: 0 };
  for (const t of txs) {
    const v = txARS(t);
    if (t.type === 'ingreso') income += v;
    else if (t.type === 'gasto') {
      const g = groupOf(t);
      byCat[t.categoryId] = (byCat[t.categoryId] || 0) + v;
      byGroup[g] += v;
      if (g === 'ahorro') saving += v; else consumption += v;
    } else if (t.type === 'transferencia') {
      const toInv = accById(t.toAccountId)?.type === 'inversion';
      const fromInv = accById(t.accountId)?.type === 'inversion';
      if (toInv && !fromInv) { saving += v; byGroup.ahorro += v; }
      else if (fromInv && !toInv) { saving -= v; byGroup.ahorro -= v; }
    }
  }
  return { txs, income, consumption, saving, byCat, byGroup, rate: income > 0 ? saving / income : null };
}
const isConsumption = t => t.type === 'gasto' && groupOf(t) !== 'ahorro';

function ipcMonthly() {
  const ipc = parseAmount(S.settings.ipc);
  if (!isFinite(ipc) || ipc <= -100) return null;
  return Math.pow(1 + ipc / 100, 1 / 12) - 1;
}

/* =========================================================
   Cuotas y recurrentes
   ========================================================= */
function makeInstallments(base, n, firstNext) {
  const group = uid();
  const per = Math.floor((base.amount / n) * 100) / 100;
  const out = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? round2(base.amount - per * (n - 1)) : per;
    out.push({ ...base, id: uid(), amount, date: addMonthsISO(base.date, i + (firstNext ? 1 : 0)), installmentGroup: group, installmentIndex: i + 1, installmentCount: n, installmentTotal: base.amount, created: Date.now() + i });
  }
  return out;
}
function runRecurring() {
  const today = todayISO();
  let n = 0;
  for (const r of S.recurring) {
    if (!r.active) continue;
    let guard = 0;
    while (r.next <= today && guard++ < 36) {
      S.transactions.push({ ...r.template, id: uid(), date: r.next, recurringId: r.id, created: Date.now() + n });
      n++;
      r.next = addMonthsISO(r.next, 1, r.day);
    }
  }
  if (n) { save(); setTimeout(() => toast(`Se cargaron ${n} movimiento${n > 1 ? 's' : ''} recurrente${n > 1 ? 's' : ''}`), 400); }
}

/* =========================================================
   Datos de ejemplo
   ========================================================= */
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
function buildDemo() {
  const s = defaultState();
  s.settings.isDemo = true;
  s.settings.ipc = '33';
  s.settings.usdRate = 1450;
  s.accounts.find(a => a.id === 'banco').initial = 420000;
  s.accounts.find(a => a.id === 'efectivo').initial = 45000;
  s.accounts.find(a => a.id === 'billetera').initial = 60000;
  s.accounts.find(a => a.id === 'usd').initial = 1800;
  const r = rng(7);
  const today = todayISO(), cur = ymOf(today), td = parseISO(today).d;
  let created = 1;
  const push = o => s.transactions.push({ id: uid(), note: '', currency: 'ARS', created: created++, ...o });

  for (let k = 11; k >= 0; k--) {
    const ym = addMonthsYM(cur, -k);
    const f = Math.pow(1.024, -k);
    const [y, m] = ym.split('-').map(Number);
    const dim = daysInMonth(y, m);
    const last = k === 0 ? td : dim;
    const R = (base, spread = 0.25) => Math.round(base * f * (1 + (r() - 0.5) * spread) / 10) * 10;
    const add = (day, o) => { if (day <= last) push({ date: `${ym}-${pad(Math.min(day, dim))}`, ...o }); };
    const rday = () => 1 + Math.floor(r() * dim);

    add(1, { type: 'ingreso', amount: Math.round(1650000 * f / 1000) * 1000, accountId: 'banco', categoryId: 'sueldo', note: 'Sueldo' });
    if (r() > 0.45) add(16, { type: 'ingreso', amount: R(260000, 0.6), accountId: 'billetera', categoryId: 'freelance', note: 'Diseño para un cliente' });
    add(2, { type: 'transferencia', amount: R(160000, 0.3), accountId: 'banco', toAccountId: 'usd', note: 'Compra de dólares' });
    add(4, { type: 'transferencia', amount: Math.round(55000 * f / 1000) * 1000, accountId: 'banco', toAccountId: 'efectivo', note: 'Extracción' });
    add(3, { type: 'transferencia', amount: Math.round(150000 * f / 1000) * 1000, accountId: 'banco', toAccountId: 'billetera', note: 'Carga de saldo' });
    add(5, { type: 'gasto', amount: Math.round(390000 * f / 1000) * 1000, accountId: 'banco', categoryId: 'alquiler', note: 'Alquiler' });
    add(8, { type: 'gasto', amount: R(88000, 0.1), accountId: 'banco', categoryId: 'servicios', note: 'Expensas' });
    add(11, { type: 'gasto', amount: R(42000, 0.4), accountId: 'banco', categoryId: 'servicios', note: 'Luz y gas' });
    add(12, { type: 'gasto', amount: R(26000, 0.05), accountId: 'banco', categoryId: 'servicios', note: 'Internet' });
    add(6, { type: 'gasto', amount: R(98000, 0.04), accountId: 'banco', categoryId: 'salud', note: 'Prepaga' });
    add(9, { type: 'gasto', amount: R(15500, 0.05), accountId: 'tarjeta', categoryId: 'suscripciones', note: 'Streaming y música' });
    for (const day of [3, 10, 17, 24]) add(day, { type: 'gasto', amount: R(61000, 0.5), accountId: r() > 0.5 ? 'tarjeta' : 'billetera', categoryId: 'super', note: 'Compra del super' });
    for (let j = 0; j < 2 + Math.floor(r() * 4); j++) add(rday(), { type: 'gasto', amount: R(17000, 0.6), accountId: 'billetera', categoryId: 'delivery', note: ['Pizza', 'Sushi', 'Hamburguesas', 'Empanadas'][Math.floor(r() * 4)] });
    for (let j = 0; j < 1 + Math.floor(r() * 3); j++) add(rday(), { type: 'gasto', amount: R(34000, 0.7), accountId: r() > 0.5 ? 'efectivo' : 'tarjeta', categoryId: 'salidas', note: ['Cine', 'Bar con amigos', 'Recital', 'Cena'][Math.floor(r() * 4)] });
    for (let j = 0; j < 3; j++) add(rday(), { type: 'gasto', amount: R(11000, 0.4), accountId: 'billetera', categoryId: 'transporte', note: 'Carga de transporte' });
    if (r() > 0.6) add(rday(), { type: 'gasto', amount: R(68000, 0.8), accountId: 'tarjeta', categoryId: 'ropa', note: 'Ropa' });
    if (r() > 0.75) add(rday(), { type: 'gasto', amount: R(45000, 0.6), accountId: 'tarjeta', categoryId: 'regalos', note: 'Regalo de cumpleaños' });
    add(20, { type: 'gasto', amount: R(30000, 0.5), accountId: 'efectivo', categoryId: 'otros_g', note: 'Varios' });
  }
  // Compras en cuotas
  const d1 = addMonthsISO(today, -3, 14), d2 = addMonthsISO(today, -5, 20), d3 = `${cur}-${pad(Math.max(1, Math.min(td, 4)))}`;
  s.transactions.push(...makeInstallments({ type: 'gasto', amount: 960000, currency: 'ARS', date: d1, accountId: 'tarjeta', categoryId: 'hogar', note: 'Heladera' }, 6, false));
  s.transactions.push(...makeInstallments({ type: 'gasto', amount: 1440000, currency: 'ARS', date: d2, accountId: 'tarjeta', categoryId: 'tecnologia', note: 'Celular nuevo' }, 12, false));
  s.transactions.push(...makeInstallments({ type: 'gasto', amount: 186000, currency: 'ARS', date: d3, accountId: 'tarjeta', categoryId: 'ropa', note: 'Zapatillas' }, 3, false));
  // Tipo de cambio para las compras de dólares y conversión
  for (const t of s.transactions) {
    if (t.type === 'transferencia' && t.toAccountId === 'usd') {
      const k = monthsDiff(ymOf(t.date), cur);
      const rate = Math.round(1450 * Math.pow(1.012, -k));
      t.amountTo = round2(t.amount / rate);
    }
  }
  // Pago de la tarjeta: el día 9 se paga lo consumido el mes anterior
  for (let k = 10; k >= 0; k--) {
    const ym = addMonthsYM(cur, -k), prev = addMonthsYM(ym, -1);
    const date = `${ym}-09`;
    if (date > today) continue;
    const total = sum(s.transactions.filter(t => t.accountId === 'tarjeta' && t.type === 'gasto' && t.date.startsWith(prev)), t => t.amount);
    if (total > 0) push({ type: 'transferencia', amount: round2(total), accountId: 'banco', toAccountId: 'tarjeta', date, note: 'Pago de tarjeta' });
  }
  s.budgets.categories = { super: 270000, alquiler: 390000, servicios: 160000, transporte: 40000, salud: 100000, hogar: 170000, delivery: 60000, salidas: 70000, ropa: 80000, suscripciones: 16000, tecnologia: 120000 };
  s.goals = [
    { id: uid(), name: 'Fondo de emergencia', icon: '🛟', target: 4500000, saved: 2100000, deadline: addMonthsISO(today, 8) },
    { id: uid(), name: 'Vacaciones de verano', icon: '🏖️', target: 1800000, saved: 650000, deadline: addMonthsISO(today, 3) },
  ];
  s.recurring = [];
  return s;
}

/* =========================================================
   Íconos
   ========================================================= */
const I = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  movimientos: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  analisis: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  presupuestos: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 6"/>',
  metas: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;

/* =========================================================
   Gráficos (SVG a mano)
   ========================================================= */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function barPath(x, y, w, h, r = 4) {
  if (h <= 0.5) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function yAxis(max, L, R, T, ih, w) {
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, y = T + ih - (v / max) * ih;
    g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="${i === 0 ? 'axis-l' : 'grid-l'}"/>`;
    g += `<text x="${L - 8}" y="${y + 4}" text-anchor="end" class="tick tick-v">${compact(v)}</text>`;
  }
  return g;
}
function drawBars(el, data, opt = {}) {
  if (!el) return;
  const w = Math.max(260, el.clientWidth || 600), h = opt.height || 200;
  const L = 50, R = 8, T = 10, B = 24;
  const max = niceMax(Math.max(1, ...data.map(d => d.value)));
  const iw = w - L - R, ih = h - T - B, step = iw / data.length;
  const bw = Math.max(2, Math.min(opt.maxBar || 44, step - 2));
  const every = Math.max(1, Math.ceil(data.length / Math.floor(iw / (opt.labelWidth || 34))));
  let g = yAxis(max, L, R, T, ih, w);
  data.forEach((d, i) => {
    const x = L + i * step + (step - bw) / 2, bh = (Math.max(0, d.value) / max) * ih, y = T + ih - bh;
    g += `<path d="${barPath(x, y, bw, bh)}" fill="${d.color || opt.color || 'var(--s1)'}"${d.dim ? ' opacity=".4"' : ''}/>`;
    if (i % every === 0 || d.forceLabel) g += `<text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" class="tick">${esc(d.label)}</text>`;
    g += `<rect x="${L + i * step}" y="${T}" width="${step}" height="${ih}" fill="transparent" data-tip="${esc(d.tip)}"/>`;
  });
  if (opt.avg) {
    const y = T + ih - (opt.avg / max) * ih;
    g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="avg-l"/><text x="${w - R}" y="${y - 5}" text-anchor="end" class="avg-t">promedio</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opt.label || 'Gráfico de barras')}">${g}</svg>`;
}
function drawLines(el, labels, series, opt = {}) {
  if (!el) return;
  const w = Math.max(260, el.clientWidth || 600), h = opt.height || 220;
  const L = 50, R = 14, T = 12, B = 24;
  const all = series.flatMap(s => s.values).filter(v => v != null);
  const max = niceMax(Math.max(1, ...all));
  const iw = w - L - R, ih = h - T - B, n = labels.length;
  const X = i => L + (n === 1 ? iw / 2 : i * iw / (n - 1));
  const Y = v => T + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.floor(iw / 46)));
  let g = yAxis(max, L, R, T, ih, w);
  labels.forEach((lb, i) => { if (i % every === 0 || i === n - 1) g += `<text x="${X(i)}" y="${h - 6}" text-anchor="middle" class="tick">${esc(lb)}</text>`; });
  g += `<line class="xhair" x1="0" x2="0" y1="${T}" y2="${T + ih}" visibility="hidden"/>`;
  for (const s of series) {
    const pts = s.values.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
    if (!pts.length) continue;
    g += `<path d="M${pts.map(p => p.join(',')).join('L')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 5"' : ''}/>`;
    const lp = pts[pts.length - 1];
    g += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  const colW = n > 1 ? iw / (n - 1) : iw;
  labels.forEach((lb, i) => {
    const tip = `<b>${esc(opt.fullLabels?.[i] || lb)}</b>` + series.map(s => s.values[i] == null ? '' : `<div class="tr"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><span>${moneyTxt(s.values[i])}</span></div>`).join('');
    g += `<rect x="${X(i) - colW / 2}" y="${T}" width="${colW}" height="${ih}" fill="transparent" data-cx="${X(i)}" data-tip="${esc(tip)}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opt.label || 'Gráfico de líneas')}">${g}</svg>`;
}
function hbarList(rows, total) {
  if (!rows.length) return '<div class="empty">Sin gastos en este período.</div>';
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<div class="hbars">${rows.map(r => `
    <div class="hbar" data-tip="${esc(`<b>${esc(r.label)}</b><div class="tr"><span>${moneyTxt(r.value)}</span><span>${total ? pct(r.value / total) : ''}</span></div>`)}">
      <span class="hbar-label">${esc(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color}"></span></span>
      <span class="hbar-val">${moneyTxt(r.value)}</span>
    </div>`).join('')}</div>`;
}

/* =========================================================
   Componentes
   ========================================================= */
function txRow(t, { showDate = false } = {}) {
  const today = todayISO();
  const c = catById(t.categoryId), a = accById(t.accountId), to = accById(t.toAccountId);
  const future = t.date > today;
  let title, ic, cls, sign;
  if (t.type === 'transferencia') { title = t.note || 'Transferencia'; ic = '⇄'; cls = 'tr'; sign = ''; }
  else { title = c ? c.name : 'Sin categoría'; ic = c?.icon || (t.type === 'ingreso' ? '➕' : '📦'); cls = t.type === 'ingreso' ? 'in' : 'out'; sign = t.type === 'ingreso' ? '+' : '−'; }
  const subs = [];
  if (showDate) subs.push(dateLabel(t.date, { day: 'numeric', month: 'short' }));
  if (t.type === 'transferencia') subs.push(`${esc(a?.name || '?')} → ${esc(to?.name || '?')}`);
  else { if (t.note) subs.push(esc(t.note)); subs.push(esc(a?.name || '')); }
  const badges = (t.installmentCount ? `<span class="badge">Cuota ${t.installmentIndex}/${t.installmentCount}</span>` : '')
    + (t.recurringId ? '<span class="badge">Mensual</span>' : '')
    + (future ? '<span class="badge accent">Programado</span>' : '');
  const cur = t.currency || 'ARS';
  const conv = cur === 'USD' && t.type !== 'transferencia' ? `<small>≈ ${moneyTxt(txARS(t))}</small>` : '';
  const toConv = t.type === 'transferencia' && to && to.currency !== (a?.currency || 'ARS') ? `<small>→ ${moneyTxt(t.amountTo ?? t.amount, to.currency)}</small>` : '';
  return `<button class="tx${future ? ' future' : ''}" data-action="edit-tx" data-id="${t.id}">
    <span class="tx-ic">${ic}</span>
    <span class="tx-main"><span class="tx-title">${esc(title)}${badges}</span><span class="tx-sub">${subs.filter(Boolean).join(' · ')}</span></span>
    <span class="tx-amt ${cls}">${sign}${money(t.amount, cur)}${conv}${toConv}</span>
  </button>`;
}
function progress({ name, spent, limit, color, sub }) {
  const p = limit > 0 ? spent / limit : 0;
  const st = limit <= 0 ? '' : p > 1 ? `<span class="status over">⚠ Te pasaste por ${money(spent - limit)}</span>` : p >= 0.85 ? `<span class="status warn">● Quedan ${money(limit - spent)}</span>` : `<span class="status ok">✓ Quedan ${money(limit - spent)}</span>`;
  return `<div class="prog">
    <div class="prog-head"><span class="name">${name}</span><span class="vals">${money(spent)}${limit > 0 ? ` <span class="muted">de ${money(limit)}</span>` : ''}</span></div>
    <div class="track"><span class="fill" style="width:${Math.min(100, p * 100).toFixed(1)}%;background:${p > 1 ? 'var(--crit)' : color}"></span></div>
    <div class="prog-foot">${st}${sub ? ` <span class="muted">${sub}</span>` : ''}</div>
  </div>`;
}
function catOptions(kind, selected, { all = false } = {}) {
  const cats = S.categories.filter(c => !kind || c.kind === kind);
  return (all ? '<option value="">Todas las categorías</option>' : '') + cats.map(c => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
}
function accOptions(selected, { all = false, include } = {}) {
  const list = S.accounts.filter(a => !a.archived || a.id === include || a.id === selected);
  return (all ? '<option value="">Todas las cuentas</option>' : '') + list.map(a => `<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${ACCOUNT_TYPES[a.type]?.icon || ''} ${esc(a.name)}${a.currency === 'USD' ? ' (US$)' : ''}</option>`).join('');
}

/* =========================================================
   Vistas
   ========================================================= */
const VIEWS = {
  inicio: { title: 'Inicio', render: viewInicio, month: true },
  movimientos: { title: 'Movimientos', render: viewMovimientos, month: true },
  analisis: { title: 'Análisis', render: viewAnalisis, month: true },
  presupuestos: { title: 'Presupuestos', render: viewPresupuestos, month: true },
  metas: { title: 'Metas', render: viewMetas, month: false },
  ajustes: { title: 'Ajustes', render: viewAjustes, month: false },
};

/* ---------- Inicio ---------- */
function viewInicio(root) {
  const ym = UI.ym, ms = monthSummary(ym), prev = monthSummary(addMonthsYM(ym, -1));
  const nw = netWorth();
  // Si el mes está en curso, comparar contra el mismo tramo del mes anterior
  const isCur = ym === ymOf(todayISO()), dayNow = parseISO(todayISO()).d;
  const prevSame = isCur ? sum(prev.txs.filter(t => isConsumption(t) && parseISO(t.date).d <= dayNow), txARS) : prev.consumption;
  const msSoFar = isCur ? sum(ms.txs.filter(t => isConsumption(t) && t.date <= todayISO()), txARS) : ms.consumption;
  const dCons = prevSame > 0 ? msSoFar / prevSame - 1 : null;
  const result = ms.income - ms.consumption - ms.saving;
  const acc = activeAccounts();
  const usd = sum(acc.filter(a => a.currency === 'USD'), a => accountBalance(a));

  // Cuotas próximos 6 meses
  const months = Array.from({ length: 6 }, (_, i) => addMonthsYM(ym, i + 1));
  const cuotas = months.map(m => sum(S.transactions.filter(t => t.installmentGroup && t.date.startsWith(m)), txARS));
  const totalCuotas = sum(cuotas);

  // Presupuestos con límite
  const limits = Object.entries(S.budgets.categories).filter(([id, v]) => v > 0 && catById(id));
  const topBudgets = limits.map(([id, lim]) => ({ c: catById(id), lim, spent: ms.byCat[id] || 0 }))
    .sort((a, b) => b.spent / b.lim - a.spent / a.lim).slice(0, 5);

  const last = S.transactions.filter(t => t.date <= todayISO()).sort(sortTx).slice(0, 10);

  root.innerHTML = `
  <div class="grid g-4">
    <div class="card kpi" data-tip="${esc(acc.map(a => `<div class="tr"><span>${esc(a.name)}</span><span>${moneyTxt(accountBalance(a), a.currency)}</span></div>`).join(''))}">
      <div class="label">Patrimonio hoy</div>
      <div class="value">${moneyTxt(nw)}</div>
      <div class="meta">${usd ? `Incluye ${money(usd, 'USD')} a ${moneyTxt(S.settings.usdRate)}` : `${acc.length} cuentas`}</div>
    </div>
    <div class="card kpi">
      <div class="label">Ingresos del mes</div>
      <div class="value">${moneyTxt(ms.income)}</div>
      <div class="meta">${prev.income ? `Mes anterior: ${money(prev.income)}` : '&nbsp;'}</div>
    </div>
    <div class="card kpi">
      <div class="label">Consumo del mes</div>
      <div class="value">${moneyTxt(ms.consumption)}</div>
      <div class="meta">${dCons == null ? 'Necesidades + gustos' : `<span class="${dCons > 0 ? 'delta-bad' : 'delta-good'}">${dCons > 0 ? '▲' : '▼'} ${pct(Math.abs(dCons))}</span> vs. ${isCur ? `el 1 al ${dayNow} del mes anterior` : 'mes anterior'}`}</div>
    </div>
    <div class="card kpi">
      <div class="label">Ahorro del mes</div>
      <div class="value">${moneyTxt(ms.saving)}</div>
      <div class="meta">${ms.rate != null ? `${pct(ms.rate)} de tus ingresos` : 'Sin ingresos cargados'} · Te quedan ${money(result)}</div>
    </div>
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><h2>Presupuestos</h2><span class="sub">${ymLabel(ym)}</span><div class="actions"><button class="btn small ghost" data-nav="presupuestos">Ver todos</button></div></div>
      <div class="stack">
        ${['necesidad', 'gusto', 'ahorro'].map(g => {
          const base = S.settings.expectedIncome || ms.income;
          const lim = base * (S.budgets.groups[g] || 0) / 100;
          return progress({ name: `<i class="group-dot" style="background:${GROUPS[g].color}"></i> ${GROUPS[g].label}`, spent: Math.max(0, ms.byGroup[g]), limit: lim, color: GROUPS[g].color, sub: `${S.budgets.groups[g]}% de tus ingresos` });
        }).join('')}
        ${topBudgets.length ? '<hr style="border:0;border-top:1px solid var(--grid);margin:2px 0">' + topBudgets.map(b => progress({ name: `${b.c.icon} ${esc(b.c.name)}`, spent: b.spent, limit: b.lim, color: GROUPS[b.c.group]?.color || 'var(--s1)' })).join('') : '<p class="hint">Poné límites por categoría en <a href="#presupuestos">Presupuestos</a>.</p>'}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Cuotas ya comprometidas</h2><span class="sub">Próximos seis meses</span></div>
      ${totalCuotas > 0 ? `
        <div class="chart" id="chCuotas"></div>
        <p class="insight" style="margin-top:10px">Ya tenés <b>${money(totalCuotas)}</b> comprometidos en cuotas para los próximos 6 meses${ms.income ? `, un ${pct(cuotas[0] / ms.income)} de tus ingresos del mes que viene` : ''}.</p>
        <div style="margin-top:12px">${activePlans().slice(0, 5).map(p => `
          <div class="set-row"><span class="grow"><span class="t">${esc(p.note || catById(p.categoryId)?.name || 'Compra')}</span><div class="d">${p.remaining} cuota${p.remaining > 1 ? 's' : ''} restante${p.remaining > 1 ? 's' : ''} · termina en ${ymLabel(p.endYM)}</div></span><span class="acc-bal">${money(p.per, p.currency)}<small>por mes</small></span></div>`).join('')}</div>`
      : `<div class="empty">No tenés cuotas pendientes. 🎉<br><span class="hint">Cuando cargues una compra en cuotas, la vas a ver acá mes a mes.</span></div>`}
    </div>
  </div>

  <div class="grid g-2-1">
    <div class="card">
      <div class="card-head"><h2>Movimientos</h2><span class="sub">Los últimos 10</span><div class="actions"><button class="btn small ghost" data-nav="movimientos">Ver todos</button></div></div>
      <div class="tx-list">${last.length ? last.map(t => txRow(t, { showDate: true })).join('') : '<div class="empty">Todavía no cargaste nada.<br><button class="btn primary" data-action="add-tx">+ Cargar el primero</button></div>'}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Cuentas</h2><div class="actions"><button class="btn small ghost" data-nav="ajustes">Editar</button></div></div>
      ${acc.map(a => { const b = accountBalance(a); return `
        <div class="acc-row"><span class="acc-ic">${ACCOUNT_TYPES[a.type]?.icon || '💰'}</span>
          <span><div class="acc-name">${esc(a.name)}</div><div class="acc-type">${ACCOUNT_TYPES[a.type]?.label || ''}</div></span>
          <span class="acc-bal ${b < 0 ? 'neg' : ''}">${money(b, a.currency)}${a.type === 'tarjeta' && b < 0 ? '<small>a pagar</small>' : a.currency === 'USD' ? `<small>≈ ${moneyTxt(toARS(b, 'USD'))}</small>` : ''}</span></div>`; }).join('')}
    </div>
  </div>`;

  if (totalCuotas > 0) drawBars($('#chCuotas'), months.map((m, i) => ({ label: ymLabel(m, true), value: cuotas[i], tip: `<b>${ymLabel(m)}</b><div class="tr"><span>Cuotas</span><span>${moneyTxt(cuotas[i])}</span></div>` })), { height: 170, label: 'Cuotas por mes' });
}
function activePlans() {
  const today = todayISO(), groups = {};
  for (const t of S.transactions) {
    if (!t.installmentGroup) continue;
    (groups[t.installmentGroup] ||= []).push(t);
  }
  return Object.values(groups).map(list => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const pending = list.filter(t => t.date > today);
    if (!pending.length) return null;
    return { ...list[0], per: pending[0].amount, remaining: pending.length, endYM: ymOf(list[list.length - 1].date), totalLeft: sum(pending, t => t.amount) };
  }).filter(Boolean).sort((a, b) => b.totalLeft - a.totalLeft);
}

/* ---------- Movimientos ---------- */
function filteredTx() {
  const f = UI.f, today = todayISO(), q = norm(f.q);
  return S.transactions.filter(t => {
    if (f.scope === 'mes' && !t.date.startsWith(UI.ym)) return false;
    if (f.scope === 'futuro' && t.date <= today) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.cat && t.categoryId !== f.cat) return false;
    if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
    if (q) {
      const hay = norm([t.note, catById(t.categoryId)?.name, accById(t.accountId)?.name, accById(t.toAccountId)?.name, String(t.amount)].join(' '));
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }).sort(sortTx);
}
function viewMovimientos(root) {
  const f = UI.f;
  root.innerHTML = `
  <div class="card">
    <div class="filters">
      <input type="search" id="fq" placeholder="Buscar por nota, categoría, cuenta o monto…" value="${esc(f.q)}" aria-label="Buscar">
      <select id="fscope" aria-label="Período">
        <option value="mes"${f.scope === 'mes' ? ' selected' : ''}>${ymLabel(UI.ym)}</option>
        <option value="todo"${f.scope === 'todo' ? ' selected' : ''}>Todo el historial</option>
        <option value="futuro"${f.scope === 'futuro' ? ' selected' : ''}>Programados (futuros)</option>
      </select>
      <select id="ftype" aria-label="Tipo"><option value="">Todos los tipos</option>${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}"${f.type === k ? ' selected' : ''}>${v}s</option>`).join('')}</select>
      <select id="fcat" aria-label="Categoría">${catOptions(null, f.cat, { all: true })}</select>
      <select id="facc" aria-label="Cuenta">${accOptions(f.acc, { all: true })}</select>
      <button class="btn small ghost" data-action="clear-filters">Limpiar</button>
      <span style="flex:1"></span>
      <button class="btn small" data-action="export-csv">Exportar CSV</button>
      <button class="btn small" data-action="import-csv">Importar CSV</button>
    </div>
    <div class="summary-chips" id="txSummary"></div>
  </div>
  <div class="card"><div class="tx-list" id="txList"></div></div>`;
  const upd = () => {
    f.q = $('#fq').value; f.scope = $('#fscope').value; f.type = $('#ftype').value; f.cat = $('#fcat').value; f.acc = $('#facc').value;
    saveUI(); renderTxList();
  };
  $('#fq').addEventListener('input', upd);
  ['#fscope', '#ftype', '#fcat', '#facc'].forEach(s => $(s).addEventListener('change', upd));
  renderTxList();
}
function renderTxList() {
  const list = filteredTx();
  const inc = sum(list.filter(t => t.type === 'ingreso'), txARS);
  const out = sum(list.filter(t => t.type === 'gasto'), txARS);
  $('#txSummary').innerHTML = `
    <span class="chip">${list.length} movimiento${list.length === 1 ? '' : 's'}</span>
    <span class="chip">Ingresos <b>${money(inc)}</b></span>
    <span class="chip">Gastos <b>${money(out)}</b></span>
    <span class="chip">Neto <b>${money(inc - out)}</b></span>`;
  if (!list.length) {
    $('#txList').innerHTML = `<div class="empty">No hay movimientos con estos filtros.<br><button class="btn primary" data-action="add-tx">+ Cargar movimiento</button></div>`;
    return;
  }
  const MAX = 400;
  let html = '', day = null;
  for (const t of list.slice(0, MAX)) {
    if (t.date !== day) {
      day = t.date;
      const dayOut = sum(list.filter(x => x.date === day && isConsumption(x)), txARS);
      html += `<div class="tx-day"><span>${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: UI.f.scope === 'mes' ? undefined : 'numeric' })}</span><span>${dayOut ? '−' + money(dayOut) : ''}</span></div>`;
    }
    html += txRow(t);
  }
  if (list.length > MAX) html += `<p class="hint" style="text-align:center">Mostrando ${MAX} de ${list.length}. Usá los filtros para acotar.</p>`;
  $('#txList').innerHTML = html;
}

/* ---------- Análisis ---------- */
function viewAnalisis(root) {
  const ym = UI.ym, ms = monthSummary(ym);
  const months = Array.from({ length: 12 }, (_, i) => addMonthsYM(ym, i - 11));
  const nominal = months.map(m => monthSummary(m).consumption);
  const mRate = ipcMonthly();
  const real = mRate != null ? nominal.map((v, i) => v * Math.pow(1 + mRate, 11 - i)) : null;
  const [y, m] = ym.split('-').map(Number);
  const dim = daysInMonth(y, m), today = todayISO();
  const isCur = ym === ymOf(today), daysElapsed = isCur ? parseISO(today).d : dim;
  const perDay = Array.from({ length: dim }, (_, i) => sum(ms.txs.filter(t => isConsumption(t) && parseISO(t.date).d === i + 1), txARS));
  const sofar = sum(perDay.slice(0, daysElapsed));
  const avg = daysElapsed ? sofar / daysElapsed : 0;

  const catRows = Object.entries(ms.byCat).map(([id, v]) => ({ c: catById(id), v })).filter(r => r.c && r.c.group !== 'ahorro' && r.v > 0).sort((a, b) => b.v - a.v);
  const biggest = ms.txs.filter(isConsumption).sort((a, b) => txARS(b) - txARS(a)).slice(0, 8);

  // Comparación en pesos de hoy (si el mes está en curso, se usa el último mes completo)
  let infl = '';
  const refYM = isCur ? addMonthsYM(ym, -1) : ym, baseYM = addMonthsYM(refYM, -12);
  const refV = monthSummary(refYM).consumption, baseV = monthSummary(baseYM).consumption;
  if (mRate != null && baseV > 0 && refV > 0) {
    const then = baseV * Math.pow(1 + mRate, 12);
    const d = refV / then - 1;
    infl = `<p class="insight">En ${ymLabel(baseYM)} consumiste ${money(baseV)}, que en pesos de ${ymLabel(refYM)} son <b>${money(then)}</b>. En ${ymLabel(refYM)} consumiste <b>${money(refV)}</b>: ${Math.abs(d) < 0.005 ? 'lo mismo' : `un <b class="${d > 0 ? 'delta-bad' : 'delta-good'}">${pct(Math.abs(d))} ${d > 0 ? 'más' : 'menos'}</b>`} en términos reales.${isCur ? ' <span class="muted">(Comparamos el último mes completo.)</span>' : ''}</p>`;
  }
  const prevCons = monthSummary(addMonthsYM(ym, -1)).consumption;

  root.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>Tendencia de gastos</h2><span class="sub">Consumo de los últimos 12 meses${isCur ? ' · el último mes todavía está en curso' : ''}</span></div>
    ${real ? `<div class="legend"><span><i style="background:var(--s1)"></i>En pesos de cada mes</span><span><i style="background:var(--s2)"></i>En pesos de ${ymLabel(ym)}</span></div>` : ''}
    <div class="chart" id="chTrend"></div>
    <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:14px">
      <label class="field" style="max-width:240px"><span>Inflación de estos 12 meses %</span><input type="text" inputmode="decimal" id="ipc" value="${esc(S.settings.ipc)}" placeholder="Ej: 33"></label>
      <p class="hint" style="flex:1;min-width:220px;margin:0 0 8px">Ingresá la variación interanual del IPC para comparar en pesos de hoy.</p>
    </div>
    ${infl}
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><h2>Gasto por día</h2><span class="sub">Este período</span></div>
      <div class="chart" id="chDays"></div>
      <div class="summary-chips">
        <span class="chip">Promedio diario <b>${money(avg)}</b></span>
        <span class="chip">Mes anterior completo <b>${money(prevCons)}</b></span>
        <span class="chip">Día más caro <b>${perDay.some(v => v) ? perDay.indexOf(Math.max(...perDay)) + 1 : '–'}</b></span>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Gastos por categoría</h2><span class="sub">${ymLabel(ym)}</span></div>
      <div class="legend"><span><i class="sq" style="background:var(--s1)"></i>Necesidades ${money(ms.byGroup.necesidad)}</span><span><i class="sq" style="background:var(--s2)"></i>Gustos ${money(ms.byGroup.gusto)}</span></div>
      ${hbarList(catRows.map(r => ({ label: `${r.c.icon} ${r.c.name}`, value: r.v, color: GROUPS[r.c.group].color })), ms.consumption)}
    </div>
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><h2>Los gastos más grandes</h2><span class="sub">${ymLabel(ym)}</span></div>
      <div class="tx-list">${biggest.length ? biggest.map(t => txRow(t, { showDate: true })).join('') : '<div class="empty">Sin gastos en este período.</div>'}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Ingresos vs. consumo</h2><span class="sub">Últimos 12 meses</span></div>
      <div class="legend"><span><i style="background:var(--s1)"></i>Ingresos</span><span><i style="background:var(--s2)"></i>Consumo</span></div>
      <div class="chart" id="chInOut"></div>
      ${(() => {
        const sums = months.map(mm => monthSummary(mm));
        const withInc = sums.filter(s => s.income > 0);
        const avgRate = withInc.length ? sum(withInc, s => s.saving) / sum(withInc, s => s.income) : null;
        return avgRate != null ? `<p class="insight" style="margin-top:10px">En el último año ahorraste en promedio el <b>${pct(avgRate)}</b> de lo que ganaste.</p>` : '';
      })()}
    </div>
  </div>`;

  const short = months.map(mm => ymLabel(mm, true)), full = months.map(mm => ymLabel(mm));
  const series = [{ name: 'En pesos de cada mes', values: nominal, color: 'var(--s1)' }];
  if (real) series.push({ name: `En pesos de ${ymLabel(ym)}`, values: real, color: 'var(--s2)' });
  drawLines($('#chTrend'), short, series, { height: 230, fullLabels: full, label: 'Tendencia de consumo' });
  drawBars($('#chDays'), perDay.map((v, i) => ({ label: String(i + 1), value: v, dim: isCur && i + 1 > daysElapsed, tip: `<b>${dateLabel(`${ym}-${pad(i + 1)}`)}</b><div class="tr"><span>Consumo</span><span>${moneyTxt(v)}</span></div>` })), { height: 190, avg, labelWidth: 26, label: 'Gasto por día' });
  const incs = months.map(mm => monthSummary(mm).income);
  drawLines($('#chInOut'), short, [{ name: 'Ingresos', values: incs, color: 'var(--s1)' }, { name: 'Consumo', values: nominal, color: 'var(--s2)' }], { height: 200, fullLabels: full, label: 'Ingresos vs consumo' });

  $('#ipc').addEventListener('change', e => { S.settings.ipc = e.target.value.trim(); save(); render(); });
}

/* ---------- Presupuestos ---------- */
function viewPresupuestos(root) {
  const ym = UI.ym, ms = monthSummary(ym), prev = monthSummary(addMonthsYM(ym, -1));
  const G = S.budgets.groups;
  const totalPct = (+G.necesidad || 0) + (+G.gusto || 0) + (+G.ahorro || 0);
  const base = S.settings.expectedIncome || ms.income;
  const cats = S.categories.filter(c => c.kind === 'gasto');
  const totalLim = sum(cats, c => S.budgets.categories[c.id] || 0);
  const [y, m] = ym.split('-').map(Number), dim = daysInMonth(y, m);
  const isCur = ym === ymOf(todayISO()), left = isCur ? dim - parseISO(todayISO()).d + 1 : 0;

  root.innerHTML = `
  <div class="banner">Necesidades y gustos cuentan como consumo. El ahorro no.<span class="spacer"></span>
    <label class="check" style="gap:6px">Ingreso base
      <input type="text" inputmode="decimal" class="inline-input" id="expInc" value="${S.settings.expectedIncome ? nfNum.format(S.settings.expectedIncome) : ''}" placeholder="${esc(nfNum.format(Math.round(ms.income)))}">
    </label>
    <span class="hint" style="margin:0">${S.settings.expectedIncome ? 'Ingreso fijo que definiste' : 'Vacío = lo que entró este mes'}</span>
  </div>

  <div class="grid g-3">
    ${['necesidad', 'gusto', 'ahorro'].map(g => {
      const lim = base * (+G[g] || 0) / 100, spent = Math.max(0, ms.byGroup[g]);
      return `<div class="card group-card">
        <div class="card-head"><h2><i class="group-dot" style="background:${GROUPS[g].color}"></i> ${GROUPS[g].label}</h2>
          <div class="actions"><input type="number" min="0" max="100" class="pct-input" data-group="${g}" value="${+G[g] || 0}" aria-label="Porcentaje para ${GROUPS[g].label}"><span class="muted" style="align-self:center">%</span></div></div>
        ${progress({ name: GROUPS[g].hint, spent, limit: lim, color: GROUPS[g].color })}
      </div>`;
    }).join('')}
  </div>
  ${totalPct !== 100 ? `<div class="banner warn">⚠ Los porcentajes suman ${totalPct}%. Lo ideal es que sumen 100%.</div>` : ''}

  <div class="card">
    <div class="card-head"><h2>Límites por categoría</h2><span class="sub">${ymLabel(ym)} · total ${money(totalLim)}</span>
      <div class="actions"><button class="btn small" data-action="budget-from-prev">Usar lo gastado el mes pasado</button></div></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Categoría</th><th>Grupo</th><th class="r">Límite mensual</th><th class="r">Gastado</th><th style="width:28%">Avance</th><th class="r">${isCur ? 'Por día' : 'Restante'}</th></tr></thead>
      <tbody>${cats.map(c => {
        const lim = S.budgets.categories[c.id] || 0, spent = ms.byCat[c.id] || 0, p = lim ? spent / lim : 0;
        const rest = lim - spent;
        return `<tr>
          <td>${c.icon} ${esc(c.name)}</td>
          <td><select data-catgroup="${c.id}" aria-label="Grupo de ${esc(c.name)}">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}"${c.group === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></td>
          <td class="r"><input type="text" inputmode="decimal" class="inline-input" data-limit="${c.id}" value="${lim ? nfNum.format(lim) : ''}" placeholder="Sin límite" aria-label="Límite de ${esc(c.name)}"></td>
          <td class="r">${money(spent)}<div class="muted" style="font-size:12px">mes ant. ${money(prev.byCat[c.id] || 0)}</div></td>
          <td>${lim ? `<div class="track"><span class="fill" style="width:${Math.min(100, p * 100).toFixed(1)}%;background:${p > 1 ? 'var(--crit)' : GROUPS[c.group].color}"></span></div><div class="status ${p > 1 ? 'over' : p >= .85 ? 'warn' : 'ok'}" style="margin-top:4px">${p > 1 ? '⚠ ' : ''}${pct(p)}</div>` : '<span class="muted">—</span>'}</td>
          <td class="r">${lim ? (rest < 0 ? `<span class="neg">${money(rest)}</span>` : isCur && left > 0 ? money(rest / left) : money(rest)) : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;

  $$('[data-group]', root).forEach(inp => inp.addEventListener('change', () => { S.budgets.groups[inp.dataset.group] = clamp(+inp.value || 0, 0, 100); save(); render(); }));
  $$('[data-limit]', root).forEach(inp => inp.addEventListener('change', () => {
    const v = parseAmount(inp.value);
    if (isFinite(v) && v > 0) S.budgets.categories[inp.dataset.limit] = round2(v); else delete S.budgets.categories[inp.dataset.limit];
    save(); render();
  }));
  $$('[data-catgroup]', root).forEach(sel => sel.addEventListener('change', () => { catById(sel.dataset.catgroup).group = sel.value; save(); render(); }));
  $('#expInc').addEventListener('change', e => { const v = parseAmount(e.target.value); S.settings.expectedIncome = isFinite(v) && v > 0 ? v : 0; save(); render(); });
}

/* ---------- Metas ---------- */
function viewMetas(root) {
  const today = todayISO();
  root.innerHTML = `
  <div class="card"><div class="card-head" style="margin:0"><h2>Tus metas de ahorro</h2><span class="sub">Definí un objetivo y registrá lo que vas juntando</span>
    <div class="actions"><button class="btn primary" data-action="new-goal">+ Nueva meta</button></div></div></div>
  ${S.goals.length ? `<div class="grid g-3">${S.goals.map(g => {
    const p = g.target ? g.saved / g.target : 0;
    const monthsLeft = g.deadline ? Math.max(0, monthsDiff(ymOf(today), ymOf(g.deadline))) : null;
    const need = g.target - g.saved;
    const perMonth = monthsLeft ? need / monthsLeft : null;
    return `<div class="card goal">
      <div class="goal-top"><span class="goal-ic">${esc(g.icon || '🎯')}</span><div><h3>${esc(g.name)}</h3><div class="muted" style="font-size:13px">${g.deadline ? `Para ${dateLabel(g.deadline, { month: 'long', year: 'numeric' })}` : 'Sin fecha límite'}</div></div></div>
      <div class="goal-nums">${money(g.saved)} <span class="muted" style="font-size:14px;font-weight:500">de ${money(g.target)}</span></div>
      <div class="track" style="margin:8px 0"><span class="fill" style="width:${Math.min(100, p * 100).toFixed(1)}%;background:var(--s3)"></span></div>
      <div class="prog-foot">${need <= 0 ? '<span class="status ok">✓ ¡Meta cumplida!</span>' : `${pct(p)} completado${perMonth ? ` · Necesitás ${money(perMonth)} por mes` : monthsLeft === 0 ? ' · <span class="status over">Venció el plazo</span>' : ''}`}</div>
      <div class="actions"><button class="btn small primary" data-action="goal-add" data-id="${g.id}">+ Aportar</button><button class="btn small" data-action="goal-sub" data-id="${g.id}">Retirar</button><button class="btn small ghost" data-action="edit-goal" data-id="${g.id}">Editar</button></div>
    </div>`;
  }).join('')}</div>` : '<div class="card"><div class="empty">Todavía no tenés metas. Un buen primer objetivo: un fondo de emergencia de 3 a 6 meses de gastos.</div></div>'}`;
}

/* ---------- Ajustes ---------- */
function viewAjustes(root) {
  const usage = (() => { try { return (localStorage.getItem(STORE_KEY) || '').length; } catch (e) { return 0; } })();
  root.innerHTML = `
  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><h2>Cuentas</h2><div class="actions"><button class="btn small primary" data-action="new-account">+ Cuenta</button></div></div>
      <div class="settings-list">${S.accounts.map(a => `
        <div class="set-row"><span class="acc-ic">${ACCOUNT_TYPES[a.type]?.icon || '💰'}</span>
          <span class="grow"><div class="t">${esc(a.name)} ${a.archived ? '<span class="badge">Archivada</span>' : ''}</div><div class="d">${ACCOUNT_TYPES[a.type]?.label || ''} · ${a.currency} · saldo inicial ${moneyTxt(a.initial || 0, a.currency)}</div></span>
          <span class="acc-bal">${money(accountBalance(a), a.currency)}</span>
          <button class="btn small ghost" data-action="edit-account" data-id="${a.id}">Editar</button></div>`).join('')}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Cotización del dólar</h2></div>
      <label class="field"><span>Pesos por cada US$ (para convertir tus cuentas en dólares)</span><input type="text" inputmode="decimal" id="usdRate" value="${nfNum.format(S.settings.usdRate)}"></label>
      <p class="hint">Cada gasto o ingreso en dólares guarda la cotización del día en que lo cargaste.</p>
      <div class="card-head" style="margin:22px 0 10px"><h2>Apariencia</h2></div>
      <div class="seg" role="radiogroup" aria-label="Tema">
        ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}"${S.settings.theme === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="privOpt"${S.settings.privacy ? ' checked' : ''}> Ocultar montos al abrir (modo privado)</label>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Categorías</h2><span class="sub">Elegí si cada gasto es necesidad, gusto o ahorro</span><div class="actions"><button class="btn small primary" data-action="new-category">+ Categoría</button></div></div>
    <div class="grid g-2">
      ${['gasto', 'ingreso'].map(kind => `<div><h3 style="font-size:13px;color:var(--muted);margin:0 0 4px">${kind === 'gasto' ? 'Gastos' : 'Ingresos'}</h3><div class="settings-list">${S.categories.filter(c => c.kind === kind).map(c => `
        <div class="set-row"><span style="font-size:18px">${c.icon}</span><span class="grow"><div class="t">${esc(c.name)}</div><div class="d">${c.group ? GROUPS[c.group].label : 'Ingreso'} · ${S.transactions.filter(t => t.categoryId === c.id).length} movimientos</div></span>
        <button class="btn small ghost" data-action="edit-category" data-id="${c.id}">Editar</button></div>`).join('')}</div></div>`).join('')}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Movimientos recurrentes</h2><span class="sub">Se cargan solos cada mes (alquiler, sueldo, suscripciones…)</span></div>
    ${S.recurring.length ? `<div class="settings-list">${S.recurring.map(r => { const c = catById(r.template.categoryId); return `
      <div class="set-row"><span style="font-size:18px">${r.template.type === 'transferencia' ? '⇄' : c?.icon || '🔁'}</span>
        <span class="grow"><div class="t">${esc(r.template.note || c?.name || TYPE_LABEL[r.template.type])} ${r.active ? '' : '<span class="badge">Pausado</span>'}</div><div class="d">${TYPE_LABEL[r.template.type]} · día ${r.day} de cada mes · próximo: ${dateLabel(r.next, { day: 'numeric', month: 'short', year: 'numeric' })}</div></span>
        <input type="text" inputmode="decimal" class="inline-input" data-recamount="${r.id}" value="${nfNum.format(r.template.amount)}" aria-label="Monto">
        <button class="btn small ghost" data-action="toggle-rec" data-id="${r.id}">${r.active ? 'Pausar' : 'Reanudar'}</button>
        <button class="btn small ghost danger" data-action="del-rec" data-id="${r.id}">Borrar</button></div>`; }).join('')}</div>`
      : '<div class="empty">No tenés recurrentes. Al cargar un movimiento marcá “Repetir todos los meses”.</div>'}
  </div>

  <div class="card">
    <div class="card-head"><h2>Instalar como app</h2><span class="sub">${isStandalone() ? '✓ Estás usando la app instalada' : 'Ícono propio, ventana propia y funciona sin internet'}</span>
      <div class="actions">${installPrompt ? '<button class="btn small primary" data-action="install-app">⬇ Instalar ahora</button>' : ''}</div></div>
    ${location.protocol === 'file:' ? `<p class="insight">Ahora la estás abriendo como archivo, y así el navegador no deja instalarla. Abrí <b>“Abrir Peso Ledger.bat”</b> (está en la misma carpeta) y vas a ver el botón <b>Instalar app</b> arriba a la derecha.</p>
      <p class="hint">Si ya cargaste datos acá, primero descargá un respaldo y después restauralo en la app instalada: son dos lugares distintos.</p>`
    : isStandalone() ? '<p class="hint">Para desinstalarla: en Windows, clic derecho sobre el ícono en el menú Inicio → Desinstalar. Tus datos siguen guardados en el navegador.</p>'
    : `<p class="insight">${installPrompt ? 'Tocá <b>Instalar ahora</b>.' : 'En Chrome o Edge, buscá el ícono de instalar (⊕) en la barra de direcciones, o en el menú ⋮ elegí <b>Instalar Peso Ledger</b>.'} Va a aparecer en el menú Inicio y vas a poder anclarla a la barra de tareas.</p>`}
  </div>

  <div class="card">
    <div class="card-head"><h2>Tus datos</h2><span class="sub">Todo se guarda solo en este navegador · ${(usage / 1024).toFixed(0)} KB · ${S.transactions.length} movimientos</span></div>
    <div class="settings-list">
      <div class="set-row"><span class="grow"><div class="t">Respaldo completo</div><div class="d">${S.settings.lastBackup ? `Último respaldo: ${dateLabel(S.settings.lastBackup, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Nunca hiciste un respaldo'}. Guardalo en un lugar seguro (Drive, pendrive…).</div></span>
        <button class="btn small primary" data-action="export-json">Descargar respaldo</button><button class="btn small" data-action="import-json">Restaurar respaldo</button></div>
      <div class="set-row"><span class="grow"><div class="t">Planilla (CSV)</div><div class="d">Para abrir en Excel o importar el resumen de tu banco. Columnas: fecha, tipo, monto, categoria, cuenta, nota.</div></span>
        <button class="btn small" data-action="export-csv-all">Exportar todo</button><button class="btn small" data-action="import-csv">Importar CSV</button></div>
      <div class="set-row"><span class="grow"><div class="t">Datos de ejemplo</div><div class="d">Reemplaza todo por datos inventados para probar la app.</div></span><button class="btn small" data-action="load-demo">Cargar ejemplo</button></div>
      <div class="set-row"><span class="grow"><div class="t">Empezar de cero</div><div class="d">Borra todos los movimientos, metas y recurrentes. Mantiene cuentas y categorías.</div></span><button class="btn small danger" data-action="reset">Borrar todo</button></div>
    </div>
    <p class="hint">Atajos: <b>N</b> cargar movimiento · <b>P</b> ocultar montos · <b>←/→</b> cambiar de mes.</p>
  </div>`;

  $('#usdRate').addEventListener('change', e => { const v = parseAmount(e.target.value); if (v > 0) { S.settings.usdRate = v; save(); toast('Cotización actualizada'); } render(); });
  $$('input[name="theme"]', root).forEach(r => r.addEventListener('change', () => { S.settings.theme = r.value; save(); applyTheme(); }));
  $('#privOpt').addEventListener('change', e => { S.settings.privacy = e.target.checked; save(); applyPrivacy(); });
  $$('[data-recamount]', root).forEach(inp => inp.addEventListener('change', () => {
    const r = S.recurring.find(x => x.id === inp.dataset.recamount), v = parseAmount(inp.value);
    if (r && v > 0) { r.template.amount = round2(v); save(); toast('Monto actualizado para los próximos meses'); }
    render();
  }));
}

/* =========================================================
   Formulario de movimiento
   ========================================================= */
let txState = null;
function openTx(id = null, preset = {}) {
  const t = id ? S.transactions.find(x => x.id === id) : null;
  if (id && !t) return;
  const lastAcc = activeAccounts()[0]?.id;
  txState = t ? { ...t, rateStr: t.rate ? nfNum.format(t.rate) : '', applyAll: false } : {
    type: preset.type || UI.lastType || 'gasto',
    amount: '', date: UI.ym === ymOf(todayISO()) ? todayISO() : `${UI.ym}-01`,
    accountId: UI.lastAcc && accById(UI.lastAcc) && !accById(UI.lastAcc).archived ? UI.lastAcc : lastAcc,
    toAccountId: '', amountTo: '', categoryId: '', note: '', installments: 1, firstNext: 0, repeat: false,
  };
  txState.editing = t;
  renderTxForm();
  const d = $('#txDialog');
  if (!d.open) d.showModal();
  setTimeout(() => { const a = $('#txDialog [name="amount"]'); a?.focus(); a?.select(); }, 30);
}
function collectTx() {
  const fm = $('#txForm'); if (!fm) return;
  const fd = new FormData(fm);
  for (const k of ['type', 'amount', 'date', 'accountId', 'toAccountId', 'amountTo', 'categoryId', 'note', 'installments', 'firstNext']) if (fd.has(k)) txState[k] = fd.get(k);
  if (fd.has('rate')) txState.rateStr = fd.get('rate');
  txState.repeat = fd.get('repeat') === 'on';
  txState.applyAll = fd.get('applyAll') === 'on';
}
function renderTxForm() {
  const st = txState, t = st.editing, type = st.type;
  const inst = !!t?.installmentGroup;
  const acc = accById(st.accountId) || activeAccounts()[0];
  const cur = acc?.currency || 'ARS';
  const to = accById(st.toAccountId);
  const cats = S.categories.filter(c => c.kind === (type === 'ingreso' ? 'ingreso' : 'gasto'));
  if (type !== 'transferencia' && !cats.some(c => c.id === st.categoryId)) st.categoryId = '';
  const amtVal = st.amount === '' ? '' : typeof st.amount === 'number' ? nfNum.format(st.amount) : st.amount;
  const toVal = st.amountTo === '' || st.amountTo == null ? '' : typeof st.amountTo === 'number' ? nfNum.format(st.amountTo) : st.amountTo;
  const rateVal = st.rateStr || nfNum.format(S.settings.usdRate);

  $('#txDialog').innerHTML = `
  <form class="modal-card" id="txForm" novalidate autocomplete="off">
    <header><h2>${t ? 'Editar movimiento' : '¿Qué querés cargar?'}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">×</button></header>
    <div class="seg" role="radiogroup" aria-label="Tipo">
      ${Object.entries(TYPE_LABEL).map(([k, v]) => `<label><input type="radio" name="type" value="${k}"${type === k ? ' checked' : ''}${inst ? ' disabled' : ''}><span>${v}</span></label>`).join('')}
    </div>
    ${inst ? `<input type="hidden" name="type" value="${type}">` : ''}
    <label class="field big"><span>Monto (${cur === 'USD' ? 'US$' : 'ARS'})${inst ? ` · cuota ${t.installmentIndex} de ${t.installmentCount}` : ''}</span><input name="amount" inputmode="decimal" placeholder="0" value="${esc(amtVal)}" required autofocus></label>
    <div class="row2">
      <label class="field"><span>Fecha</span><input type="date" name="date" value="${esc(st.date)}" required></label>
      <label class="field"><span>${type === 'transferencia' ? 'Desde' : 'Cuenta'}</span><select name="accountId" data-rerender>${accOptions(st.accountId)}</select></label>
    </div>
    ${type === 'transferencia' ? `
      <div class="row2">
        <label class="field"><span>Hacia</span><select name="toAccountId" data-rerender><option value="">Elegí una cuenta</option>${accOptions(st.toAccountId)}</select></label>
        ${to && to.currency !== cur ? `<label class="field"><span>Monto recibido (${to.currency === 'USD' ? 'US$' : 'ARS'})</span><input name="amountTo" inputmode="decimal" value="${esc(toVal)}" placeholder="0"></label>` : '<span></span>'}
      </div>` : `
      ${cur === 'USD' ? `<label class="field"><span>Cotización (ARS por US$)</span><input name="rate" inputmode="decimal" value="${esc(rateVal)}"></label>` : ''}
      <div class="field"><span>Categoría</span><div class="cat-grid" role="radiogroup" aria-label="Categoría">
        ${cats.map(c => `<label class="cat-chip"><input type="radio" name="categoryId" value="${c.id}"${st.categoryId === c.id ? ' checked' : ''}><span>${c.icon} ${esc(c.name)}</span></label>`).join('')}
      </div></div>`}
    ${type === 'gasto' && !t ? `
      <div class="row2">
        <label class="field"><span>Cuotas</span><input type="number" name="installments" min="1" max="60" step="1" value="${esc(st.installments || 1)}"></label>
        <label class="field"><span>Primera cuota</span><select name="firstNext"><option value="0"${+st.firstNext ? '' : ' selected'}>Este mes</option><option value="1"${+st.firstNext ? ' selected' : ''}>El mes que viene</option></select></label>
      </div>
      <p class="hint" id="cuotaHint" style="margin:-6px 0 0"></p>` : ''}
    <label class="field"><span>Nota</span><input type="text" name="note" value="${esc(st.note || '')}" placeholder="Opcional: ¿en qué fue?" maxlength="140" list="noteList"></label>
    <datalist id="noteList">${[...new Set(S.transactions.slice(-300).map(x => x.note).filter(Boolean))].slice(-40).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${!t ? `<label class="check" id="repeatWrap"><input type="checkbox" name="repeat"${st.repeat ? ' checked' : ''}> Repetir todos los meses</label>` : ''}
    ${inst ? `<label class="check"><input type="checkbox" name="applyAll"${st.applyAll ? ' checked' : ''}> Aplicar categoría, cuenta y nota a todas las cuotas</label>` : ''}
    <p class="form-error" id="txErr"></p>
    <footer>
      ${t ? '<button type="button" class="btn ghost danger" data-del>Borrar</button>' : ''}
      <span class="spacer"></span>
      ${!t ? '<button type="submit" class="btn" value="again">Guardar y cargar otro</button>' : ''}
      <button type="submit" class="btn primary" value="ok">Guardar</button>
    </footer>
  </form>`;

  const fm = $('#txForm');
  $$('input[name="type"]', fm).forEach(r => r.addEventListener('change', () => { collectTx(); UI.lastType = txState.type; renderTxForm(); }));
  $$('[data-rerender]', fm).forEach(s => s.addEventListener('change', () => { collectTx(); renderTxForm(); }));
  fm.amount.addEventListener('blur', () => { const v = parseAmount(fm.amount.value); if (isFinite(v) && v > 0) fm.amount.value = nfNum.format(v); updateCuotaHint(); });
  fm.amount.addEventListener('input', updateCuotaHint);
  fm.installments?.addEventListener('input', updateCuotaHint);
  fm.firstNext?.addEventListener('change', updateCuotaHint);
  $('[data-close]', fm).addEventListener('click', () => $('#txDialog').close());
  $('[data-del]', fm)?.addEventListener('click', () => deleteTx(t));
  fm.addEventListener('submit', e => { e.preventDefault(); submitTx(e.submitter?.value || 'ok'); });
  updateCuotaHint();
}
function updateCuotaHint() {
  const fm = $('#txForm'), h = $('#cuotaHint');
  if (!fm || !h) return;
  const n = parseInt(fm.installments?.value, 10) || 1, v = parseAmount(fm.amount.value);
  const rep = $('#repeatWrap');
  if (rep) rep.hidden = n > 1;
  if (n > 1 && v > 0) {
    const start = addMonthsISO(fm.date.value || todayISO(), +fm.firstNext.value ? 1 : 0);
    const end = addMonthsISO(start, n - 1);
    h.innerHTML = `${n} cuotas de <b>${moneyTxt(v / n)}</b> · de ${ymLabel(ymOf(start))} a ${ymLabel(ymOf(end))}. El monto es el total de la compra.`;
  } else h.textContent = n > 1 ? 'Ingresá el total de la compra y lo dividimos.' : '';
}
function submitTx(mode) {
  collectTx();
  const st = txState, t = st.editing, err = m => { $('#txErr').textContent = m; };
  const amount = parseAmount(st.amount);
  if (!(amount > 0)) return err('Ingresá un monto mayor a cero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date || '')) return err('Elegí una fecha.');
  const acc = accById(st.accountId);
  if (!acc) return err('Elegí una cuenta.');
  const base = { type: st.type, amount: round2(amount), date: st.date, accountId: acc.id, currency: acc.currency, note: (st.note || '').trim() };
  if (st.type === 'transferencia') {
    const to = accById(st.toAccountId);
    if (!to) return err('Elegí la cuenta de destino.');
    if (to.id === acc.id) return err('Las cuentas de origen y destino tienen que ser distintas.');
    base.toAccountId = to.id;
    if (to.currency !== acc.currency) {
      const at = parseAmount(st.amountTo);
      if (!(at > 0)) return err(`Ingresá cuánto recibiste en ${to.name}.`);
      base.amountTo = round2(at);
    }
  } else {
    if (!st.categoryId) return err('Elegí una categoría.');
    base.categoryId = st.categoryId;
    if (acc.currency === 'USD') {
      const r = parseAmount(st.rateStr || S.settings.usdRate);
      base.rate = r > 0 ? r : S.settings.usdRate;
    }
  }
  snapshot();
  if (t) {
    const keep = { id: t.id, created: t.created, recurringId: t.recurringId, installmentGroup: t.installmentGroup, installmentIndex: t.installmentIndex, installmentCount: t.installmentCount, installmentTotal: t.installmentTotal };
    for (const k of ['toAccountId', 'amountTo', 'categoryId', 'rate']) delete t[k];
    Object.assign(t, base, keep);
    if (t.installmentGroup && st.applyAll) {
      for (const o of S.transactions) if (o.installmentGroup === t.installmentGroup) Object.assign(o, { categoryId: t.categoryId, accountId: t.accountId, currency: t.currency, note: t.note });
    }
    toast('Movimiento actualizado');
  } else {
    const n = st.type === 'gasto' ? clamp(parseInt(st.installments, 10) || 1, 1, 60) : 1;
    if (n > 1) {
      S.transactions.push(...makeInstallments(base, n, !!+st.firstNext));
      toast(`Compra cargada en ${n} cuotas`, true);
    } else {
      const tx = { ...base, id: uid(), created: Date.now() };
      if (st.repeat) {
        const day = parseISO(base.date).d;
        const r = { id: uid(), template: { ...base, date: undefined }, day, next: addMonthsISO(base.date, 1, day), active: true };
        delete r.template.date;
        S.recurring.push(r);
        tx.recurringId = r.id;
      }
      S.transactions.push(tx);
      toast(st.repeat ? 'Guardado. Se va a repetir cada mes' : 'Movimiento guardado', true);
    }
    UI.lastAcc = acc.id; UI.lastType = st.type;
  }
  save();
  render();
  if (mode === 'again' && !t) {
    openTx(null, { type: st.type });
    Object.assign(txState, { date: st.date, accountId: st.accountId, categoryId: st.type === 'transferencia' ? '' : st.categoryId });
    renderTxForm();
  } else $('#txDialog').close();
}
async function deleteTx(t) {
  let mode = 'one';
  if (t.installmentGroup) {
    const r = await modal({ title: 'Borrar compra en cuotas', body: `<p>Esta es la cuota ${t.installmentIndex} de ${t.installmentCount}. ¿Qué querés borrar?</p>`, actions: [{ label: 'Cancelar', value: '' }, { label: 'Solo esta cuota', value: 'one' }, { label: 'Todas las cuotas', value: 'all', kind: 'primary danger' }] });
    if (!r.value) return;
    mode = r.value;
  }
  snapshot();
  if (mode === 'all') S.transactions = S.transactions.filter(o => o.installmentGroup !== t.installmentGroup);
  else S.transactions = S.transactions.filter(o => o.id !== t.id);
  save(); $('#txDialog').close(); render();
  toast(mode === 'all' ? 'Se borraron todas las cuotas' : 'Movimiento borrado', true);
}

/* =========================================================
   Modal genérico
   ========================================================= */
function modal({ title, body = '', actions = [{ label: 'Aceptar', value: 'ok', kind: 'primary' }], onMount, validate }) {
  return new Promise(resolve => {
    const d = $('#modal');
    d.innerHTML = `<form class="modal-card" method="dialog" novalidate>
      <header><h2>${title}</h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">×</button></header>
      ${body}
      <p class="form-error" data-err></p>
      <footer><span class="spacer"></span>${actions.map(a => `<button class="btn ${a.kind || ''}" value="${esc(a.value)}">${a.label}</button>`).join('')}</footer>
    </form>`;
    const fm = $('form', d);
    let result = { value: '' };
    fm.addEventListener('submit', e => {
      e.preventDefault();
      const value = e.submitter?.value ?? '';
      const data = Object.fromEntries(new FormData(fm));
      if (value && validate) { const msg = validate(data, value); if (msg) { $('[data-err]', fm).textContent = msg; return; } }
      result = { value, data };
      d.close();
    });
    $('[data-x]', fm).addEventListener('click', () => d.close());
    d.addEventListener('close', () => resolve(result), { once: true });
    d.showModal();
    onMount?.(fm);
    setTimeout(() => $('input:not([type=hidden]), select', fm)?.focus(), 30);
  });
}
const confirmBox = (title, text, label = 'Confirmar', danger = false) =>
  modal({ title, body: `<p>${text}</p>`, actions: [{ label: 'Cancelar', value: '' }, { label, value: 'ok', kind: danger ? 'primary danger' : 'primary' }] }).then(r => r.value === 'ok');

/* ---------- Cuentas ---------- */
async function editAccount(id) {
  const a = id ? accById(id) : null;
  const used = a && S.transactions.some(t => t.accountId === a.id || t.toAccountId === a.id);
  const r = await modal({
    title: a ? 'Editar cuenta' : 'Nueva cuenta',
    body: `
      <label class="field"><span>Nombre</span><input type="text" name="name" value="${esc(a?.name || '')}" maxlength="40" placeholder="Ej: Caja de ahorro"></label>
      <div class="row2">
        <label class="field"><span>Tipo</span><select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}"${a?.type === k ? ' selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
        <label class="field"><span>Moneda</span><select name="currency"${used ? ' disabled' : ''}><option value="ARS"${a?.currency !== 'USD' ? ' selected' : ''}>Pesos (ARS)</option><option value="USD"${a?.currency === 'USD' ? ' selected' : ''}>Dólares (US$)</option></select></label>
      </div>
      <label class="field"><span>Saldo inicial</span><input type="text" inputmode="decimal" name="initial" value="${a?.initial ? nfNum.format(a.initial) : ''}" placeholder="0"></label>
      <p class="hint">Las cuentas tipo “Ahorro / inversión” cuentan como ahorro cuando les transferís plata. En tarjetas, el saldo negativo es lo que debés.</p>
      ${a ? `<label class="check"><input type="checkbox" name="archived"${a.archived ? ' checked' : ''}> Archivar (la oculta sin borrar su historial)</label>` : ''}`,
    actions: [...(a && !used ? [{ label: 'Borrar', value: 'del', kind: 'ghost danger' }] : []), { label: 'Cancelar', value: '' }, { label: 'Guardar', value: 'ok', kind: 'primary' }],
    validate: (d, v) => v === 'ok' && !d.name?.trim() ? 'Poné un nombre.' : null,
  });
  if (!r.value) return;
  snapshot();
  if (r.value === 'del') { S.accounts = S.accounts.filter(x => x.id !== a.id); save(); render(); toast('Cuenta borrada', true); return; }
  const ini = parseAmount(r.data.initial);
  const vals = { name: r.data.name.trim(), type: r.data.type, initial: isFinite(ini) ? round2(ini) : 0, archived: r.data.archived === 'on' };
  if (!used) vals.currency = r.data.currency || 'ARS';
  if (a) Object.assign(a, vals); else S.accounts.push({ id: uid(), currency: 'ARS', ...vals });
  save(); render(); toast('Cuenta guardada');
}

/* ---------- Categorías ---------- */
async function editCategory(id) {
  const c = id ? catById(id) : null;
  const count = c ? S.transactions.filter(t => t.categoryId === c.id).length : 0;
  const r = await modal({
    title: c ? 'Editar categoría' : 'Nueva categoría',
    body: `
      <div class="row2" style="grid-template-columns:90px 1fr">
        <label class="field"><span>Ícono</span><input type="text" name="icon" value="${esc(c?.icon || '🏷️')}" maxlength="4" style="text-align:center;font-size:20px"></label>
        <label class="field"><span>Nombre</span><input type="text" name="name" value="${esc(c?.name || '')}" maxlength="40"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Tipo</span><select name="kind"${c ? ' disabled' : ''}><option value="gasto"${c?.kind !== 'ingreso' ? ' selected' : ''}>Gasto</option><option value="ingreso"${c?.kind === 'ingreso' ? ' selected' : ''}>Ingreso</option></select></label>
        <label class="field"><span>Grupo (solo gastos)</span><select name="group">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}"${(c?.group || 'gusto') === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      </div>
      ${count ? `<p class="hint">Tiene ${count} movimientos. Si la borrás, pasan a otra categoría.</p>` : ''}`,
    actions: [...(c ? [{ label: 'Borrar', value: 'del', kind: 'ghost danger' }] : []), { label: 'Cancelar', value: '' }, { label: 'Guardar', value: 'ok', kind: 'primary' }],
    validate: (d, v) => v === 'ok' && !d.name?.trim() ? 'Poné un nombre.' : null,
  });
  if (!r.value) return;
  if (r.value === 'del') {
    const others = S.categories.filter(x => x.kind === c.kind && x.id !== c.id);
    if (!others.length) return toast('Tiene que quedar al menos una categoría de este tipo');
    let target = null;
    if (count) {
      const r2 = await modal({ title: `Borrar “${esc(c.name)}”`, body: `<label class="field"><span>Mover sus ${count} movimientos a</span><select name="to">${others.map(o => `<option value="${o.id}">${o.icon} ${esc(o.name)}</option>`).join('')}</select></label>`, actions: [{ label: 'Cancelar', value: '' }, { label: 'Borrar categoría', value: 'ok', kind: 'primary danger' }] });
      if (r2.value !== 'ok') return;
      target = r2.data.to;
    }
    snapshot();
    if (target) S.transactions.forEach(t => { if (t.categoryId === c.id) t.categoryId = target; });
    S.recurring.forEach(rr => { if (rr.template.categoryId === c.id) rr.template.categoryId = target || others[0].id; });
    S.categories = S.categories.filter(x => x.id !== c.id);
    delete S.budgets.categories[c.id];
    save(); render(); toast('Categoría borrada', true);
    return;
  }
  snapshot();
  const kind = c ? c.kind : r.data.kind;
  const vals = { name: r.data.name.trim(), icon: r.data.icon.trim() || '🏷️', group: kind === 'gasto' ? r.data.group : null };
  if (c) Object.assign(c, vals); else S.categories.push({ id: uid(), kind, ...vals });
  save(); render(); toast('Categoría guardada');
}

/* ---------- Metas ---------- */
async function editGoal(id) {
  const g = id ? S.goals.find(x => x.id === id) : null;
  const r = await modal({
    title: g ? 'Editar meta' : 'Nueva meta',
    body: `
      <div class="row2" style="grid-template-columns:90px 1fr">
        <label class="field"><span>Ícono</span><input type="text" name="icon" value="${esc(g?.icon || '🎯')}" maxlength="4" style="text-align:center;font-size:20px"></label>
        <label class="field"><span>Nombre</span><input type="text" name="name" value="${esc(g?.name || '')}" maxlength="50" placeholder="Ej: Fondo de emergencia"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Objetivo (ARS)</span><input type="text" inputmode="decimal" name="target" value="${g ? nfNum.format(g.target) : ''}"></label>
        <label class="field"><span>Ya ahorrado</span><input type="text" inputmode="decimal" name="saved" value="${g ? nfNum.format(g.saved) : ''}" placeholder="0"></label>
      </div>
      <label class="field"><span>Fecha límite (opcional)</span><input type="date" name="deadline" value="${esc(g?.deadline || '')}"></label>`,
    actions: [...(g ? [{ label: 'Borrar', value: 'del', kind: 'ghost danger' }] : []), { label: 'Cancelar', value: '' }, { label: 'Guardar', value: 'ok', kind: 'primary' }],
    validate: (d, v) => v !== 'ok' ? null : !d.name?.trim() ? 'Poné un nombre.' : !(parseAmount(d.target) > 0) ? 'Ingresá un objetivo mayor a cero.' : null,
  });
  if (!r.value) return;
  snapshot();
  if (r.value === 'del') { S.goals = S.goals.filter(x => x.id !== g.id); save(); render(); toast('Meta borrada', true); return; }
  const saved = parseAmount(r.data.saved);
  const vals = { name: r.data.name.trim(), icon: r.data.icon.trim() || '🎯', target: round2(parseAmount(r.data.target)), saved: isFinite(saved) ? round2(saved) : 0, deadline: r.data.deadline || null };
  if (g) Object.assign(g, vals); else S.goals.push({ id: uid(), ...vals });
  save(); render(); toast('Meta guardada');
}
async function goalMove(id, sign) {
  const g = S.goals.find(x => x.id === id); if (!g) return;
  const r = await modal({
    title: sign > 0 ? `Aportar a “${esc(g.name)}”` : `Retirar de “${esc(g.name)}”`,
    body: `<label class="field big"><span>Monto</span><input type="text" inputmode="decimal" name="amount" placeholder="0"></label>`,
    actions: [{ label: 'Cancelar', value: '' }, { label: sign > 0 ? 'Aportar' : 'Retirar', value: 'ok', kind: 'primary' }],
    validate: d => !(parseAmount(d.amount) > 0) ? 'Ingresá un monto mayor a cero.' : null,
  });
  if (r.value !== 'ok') return;
  snapshot();
  g.saved = round2(Math.max(0, g.saved + sign * parseAmount(r.data.amount)));
  save(); render();
  toast(g.saved >= g.target ? '¡Llegaste a tu meta! 🎉' : 'Meta actualizada', true);
}

/* =========================================================
   Importar / exportar
   ========================================================= */
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportJSON() {
  S.settings.lastBackup = todayISO(); save();
  download(`peso-ledger-respaldo-${todayISO()}.json`, JSON.stringify(S, null, 1), 'application/json');
  render(); toast('Respaldo descargado');
}
function csvCell(v) { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV(list) {
  const head = ['fecha', 'tipo', 'monto', 'moneda', 'monto_ars', 'categoria', 'grupo', 'cuenta', 'cuenta_destino', 'nota', 'cuota'];
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
    t.date, t.type, String(t.amount).replace('.', ','), t.currency || 'ARS', String(round2(txARS(t))).replace('.', ','),
    catById(t.categoryId)?.name || '', catById(t.categoryId)?.group ? GROUPS[catById(t.categoryId).group].label : '',
    accById(t.accountId)?.name || '', accById(t.toAccountId)?.name || '', t.note || '', t.installmentCount ? `${t.installmentIndex}/${t.installmentCount}` : '',
  ].map(csvCell).join(';'));
  download(`peso-ledger-movimientos-${todayISO()}.csv`, '﻿' + [head.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function parseDateAny(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12) return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return null;
}
async function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return toast('El archivo no tiene filas para importar');
  const head = rows[0].map(norm);
  const col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
  const ci = { date: col('fecha', 'date'), amount: col('monto', 'importe', 'amount', 'valor'), type: col('tipo', 'type'), cat: col('categoria', 'category', 'rubro'), acc: col('cuenta', 'account'), to: col('cuenta_destino', 'destino'), note: col('nota', 'descripcion', 'detalle', 'concepto', 'note') };
  if (ci.acc === ci.to) ci.acc = head.findIndex(h => h === 'cuenta' || h === 'account');
  if (ci.date < 0 || ci.amount < 0) return toast('Necesito al menos las columnas “fecha” y “monto”');
  const out = [], bad = []; const newCats = new Map();
  const findAcc = name => S.accounts.find(a => norm(a.name) === norm(name));
  rows.slice(1).forEach((r, i) => {
    const date = parseDateAny(r[ci.date]); let amount = parseAmount(r[ci.amount]);
    if (!date || !isFinite(amount) || amount === 0) { bad.push(i + 2); return; }
    let type = norm(r[ci.type] || '');
    type = type.startsWith('ing') || type === 'income' ? 'ingreso' : type.startsWith('trans') ? 'transferencia' : type.startsWith('gas') || type === 'expense' ? 'gasto' : (amount < 0 ? 'gasto' : 'ingreso');
    amount = Math.abs(amount);
    const acc = (ci.acc >= 0 && findAcc(r[ci.acc])) || activeAccounts()[0];
    const t = { id: uid(), type, amount: round2(amount), date, accountId: acc.id, currency: acc.currency, note: ci.note >= 0 ? (r[ci.note] || '').trim() : '', created: Date.now() + i };
    if (acc.currency === 'USD') t.rate = S.settings.usdRate;
    if (type === 'transferencia') {
      const to = ci.to >= 0 && findAcc(r[ci.to]);
      if (!to || to.id === acc.id) { bad.push(i + 2); return; }
      t.toAccountId = to.id;
    } else {
      const kind = type === 'ingreso' ? 'ingreso' : 'gasto';
      const cname = ci.cat >= 0 ? (r[ci.cat] || '').trim() : '';
      let c = cname && S.categories.find(x => x.kind === kind && norm(x.name) === norm(cname));
      if (!c && cname) {
        const key = kind + '|' + norm(cname);
        if (!newCats.has(key)) newCats.set(key, { id: uid(), name: cname, icon: '🏷️', kind, group: kind === 'gasto' ? 'gusto' : null });
        c = newCats.get(key);
      }
      t.categoryId = c ? c.id : (kind === 'ingreso' ? 'otros_i' : 'otros_g');
      if (!catById(t.categoryId) && !c) t.categoryId = S.categories.find(x => x.kind === kind)?.id;
    }
    out.push(t);
  });
  if (!out.length) return toast('No encontré filas válidas para importar');
  const ok = await confirmBox('Importar CSV', `Encontré <b>${out.length}</b> movimientos${bad.length ? ` (salteé ${bad.length} filas con errores: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '…' : ''})` : ''}${newCats.size ? ` y voy a crear ${newCats.size} categoría${newCats.size > 1 ? 's' : ''} nueva${newCats.size > 1 ? 's' : ''}` : ''}. ¿Los agrego?`, 'Importar');
  if (!ok) return;
  snapshot();
  S.categories.push(...newCats.values());
  S.transactions.push(...out);
  S.settings.isDemo = false;
  save(); render(); toast(`Se importaron ${out.length} movimientos`, true);
}
async function importJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return toast('El archivo no es un respaldo válido'); }
  if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) return toast('El archivo no es un respaldo de Peso Ledger');
  const ok = await confirmBox('Restaurar respaldo', `El respaldo tiene <b>${data.transactions.length}</b> movimientos y <b>${data.accounts.length}</b> cuentas. Va a <b>reemplazar</b> todo lo que tenés ahora.`, 'Restaurar', true);
  if (!ok) return;
  snapshot();
  S = migrate(data); save(); applyTheme(); render(); toast('Respaldo restaurado', true);
}

/* =========================================================
   Shell: navegación, tema, banner, toast, tooltip
   ========================================================= */
function applyTheme() {
  const th = S.settings.theme;
  if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = th;
  $('#themeBtn').innerHTML = icon(th === 'dark' ? 'moon' : th === 'light' ? 'sun' : 'auto');
  $('#themeBtn').title = `Tema: ${th === 'auto' ? 'automático' : th === 'dark' ? 'oscuro' : 'claro'}`;
}
let privacyOn = false;
function applyPrivacy(v = privacyOn) {
  privacyOn = v;
  document.body.classList.toggle('privacy', v);
  $('#privacyBtn').innerHTML = icon(v ? 'eyeOff' : 'eye');
  $('#privacyBtn').title = v ? 'Mostrar montos (P)' : 'Ocultar montos (P)';
}
function renderNav() {
  const items = Object.entries(VIEWS);
  $('#sideNav').innerHTML = items.map(([k, v]) => `<button data-nav="${k}" class="${UI.view === k ? 'active' : ''}">${icon(k)}<span>${v.title}</span></button>`).join('');
  $('#bottomNav').innerHTML = items.map(([k, v]) => `<button data-nav="${k}" class="${UI.view === k ? 'active' : ''}">${icon(k)}<span>${v.title}</span></button>`).join('');
  const nw = netWorth();
  $('#sideFoot').innerHTML = `Patrimonio <b class="amt">${moneyTxt(nw)}</b><br>US$ ${nfNum.format(S.settings.usdRate)} · ${S.transactions.length} movimientos`;
}
function renderBanner() {
  const b = $('#banner');
  if (S.settings.isDemo) {
    b.innerHTML = `<div class="banner">🧪 Estos son datos de ejemplo para que veas cómo funciona. Ninguno es tuyo.<span class="spacer"></span><button class="btn small primary" data-action="start-fresh">Empezar con mis datos</button></div>`;
    return;
  }
  const days = S.settings.lastBackup ? daysBetween(S.settings.lastBackup, todayISO()) : Infinity;
  if (S.transactions.length >= 15 && days > 14) {
    b.innerHTML = `<div class="banner warn">💾 ${S.settings.lastBackup ? `Hace ${days} días que no hacés un respaldo.` : 'Todavía no hiciste ningún respaldo.'} Tus datos viven solo en este navegador.<span class="spacer"></span><button class="btn small primary" data-action="export-json">Descargar respaldo</button></div>`;
    return;
  }
  b.innerHTML = '';
}
function render() {
  if (!VIEWS[UI.view]) UI.view = 'inicio';
  const v = VIEWS[UI.view];
  $('#viewTitle').textContent = v.title;
  document.title = `${v.title} · Peso Ledger`;
  $('#monthPicker').hidden = !v.month;
  $('#monthLabel').textContent = ymLabel(UI.ym);
  renderNav();
  renderBanner();
  hideTip();
  v.render($('#view'));
}
function go(view) {
  if (location.hash !== '#' + view) location.hash = view; else { UI.view = view; render(); }
  window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(msg, withUndo = false) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (withUndo && undoSnapshot ? '<button data-action="undo">Deshacer</button>' : '');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), withUndo ? 6000 : 2800);
}

const tip = () => $('#tooltip');
let tipSvg = null;
function hideTip() {
  tip().hidden = true;
  if (tipSvg) { tipSvg.querySelector('.xhair')?.setAttribute('visibility', 'hidden'); tipSvg = null; }
}
document.addEventListener('pointermove', e => {
  const el = e.target.closest?.('[data-tip]');
  if (!el || !el.dataset.tip || privacyOn) { hideTip(); return; }
  const tt = tip();
  if (tt.innerHTML !== el.dataset.tip) tt.innerHTML = el.dataset.tip;
  tt.hidden = false;
  const r = tt.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tt.style.left = Math.max(8, x) + 'px'; tt.style.top = Math.max(8, y) + 'px';
  const svg = el.closest('svg');
  if (svg && el.dataset.cx) {
    if (tipSvg && tipSvg !== svg) tipSvg.querySelector('.xhair')?.setAttribute('visibility', 'hidden');
    tipSvg = svg;
    const xh = svg.querySelector('.xhair');
    if (xh) { xh.setAttribute('x1', el.dataset.cx); xh.setAttribute('x2', el.dataset.cx); xh.setAttribute('visibility', 'visible'); }
  } else if (tipSvg) { tipSvg.querySelector('.xhair')?.setAttribute('visibility', 'hidden'); tipSvg = null; }
});
document.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

/* ---------- Acciones (delegación) ---------- */
const ACTIONS = {
  'add-tx': () => openTx(),
  'edit-tx': el => openTx(el.dataset.id),
  'prev-month': () => { UI.ym = addMonthsYM(UI.ym, -1); render(); },
  'next-month': () => { UI.ym = addMonthsYM(UI.ym, 1); render(); },
  'this-month': () => { UI.ym = ymOf(todayISO()); render(); },
  'toggle-privacy': () => applyPrivacy(!privacyOn),
  'toggle-theme': () => { const order = ['auto', 'light', 'dark']; S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3]; save(); applyTheme(); if (UI.view === 'ajustes') render(); },
  'clear-filters': () => { UI.f = { q: '', type: '', cat: '', acc: '', scope: 'mes' }; saveUI(); render(); },
  'export-csv': () => exportCSV(filteredTx()),
  'export-csv-all': () => exportCSV(S.transactions),
  'import-csv': () => $('#fileCsv').click(),
  'export-json': exportJSON,
  'import-json': () => $('#fileJson').click(),
  'new-account': () => editAccount(null),
  'edit-account': el => editAccount(el.dataset.id),
  'new-category': () => editCategory(null),
  'edit-category': el => editCategory(el.dataset.id),
  'new-goal': () => editGoal(null),
  'edit-goal': el => editGoal(el.dataset.id),
  'goal-add': el => goalMove(el.dataset.id, 1),
  'goal-sub': el => goalMove(el.dataset.id, -1),
  'toggle-rec': el => { const r = S.recurring.find(x => x.id === el.dataset.id); if (!r) return; r.active = !r.active; if (r.active) { while (r.next < todayISO()) r.next = addMonthsISO(r.next, 1, r.day); } save(); render(); },
  'del-rec': async el => { if (!(await confirmBox('Borrar recurrente', 'Deja de cargarse cada mes. Los movimientos que ya se cargaron se mantienen.', 'Borrar', true))) return; snapshot(); S.recurring = S.recurring.filter(x => x.id !== el.dataset.id); save(); render(); toast('Recurrente borrado', true); },
  'budget-from-prev': async () => {
    const prev = monthSummary(addMonthsYM(UI.ym, -1));
    if (!Object.keys(prev.byCat).length) return toast('El mes pasado no tiene gastos');
    if (!(await confirmBox('Usar lo gastado el mes pasado', `Vamos a poner como límite de cada categoría lo que gastaste en ${ymLabel(addMonthsYM(UI.ym, -1))}, redondeado. Reemplaza los límites actuales.`, 'Aplicar'))) return;
    snapshot();
    for (const [id, v] of Object.entries(prev.byCat)) if (catById(id)?.group !== 'ahorro' && v > 0) S.budgets.categories[id] = Math.ceil(v / 5000) * 5000;
    save(); render(); toast('Límites actualizados', true);
  },
  'load-demo': async () => { if (!(await confirmBox('Cargar datos de ejemplo', 'Esto <b>reemplaza todos tus datos</b> por datos inventados. Si querés conservarlos, descargá un respaldo antes.', 'Cargar ejemplo', true))) return; snapshot(); S = buildDemo(); save(); render(); toast('Datos de ejemplo cargados', true); },
  'start-fresh': async () => { if (!(await confirmBox('Empezar con tus datos', 'Borramos los datos de ejemplo y arrancás de cero con las cuentas y categorías por defecto. Después podés ajustarlas en <b>Ajustes</b>.', 'Empezar'))) return; snapshot(); const th = S.settings.theme; S = defaultState(); S.settings.theme = th; save(); go('ajustes'); render(); toast('¡Listo! Configurá tus cuentas y saldos iniciales', true); },
  reset: async () => { if (!(await confirmBox('Borrar todo', 'Se borran <b>todos los movimientos, metas, presupuestos y recurrentes</b>. Las cuentas y categorías se mantienen.', 'Borrar todo', true))) return; snapshot(); S.transactions = []; S.goals = []; S.recurring = []; S.budgets.categories = {}; S.settings.isDemo = false; save(); render(); toast('Se borró todo', true); },
  undo: () => { $('#toast').classList.remove('show'); undo(); },
};
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); go(nav.dataset.nav); return; }
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el); }
});
// Cerrar diálogos al tocar el fondo
for (const id of ['#txDialog', '#modal']) {
  $(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); setTimeout(() => openTx(), 0); }
  else if (k === 'p') applyPrivacy(!privacyOn);
  else if (e.key === 'ArrowLeft' && VIEWS[UI.view].month) ACTIONS['prev-month']();
  else if (e.key === 'ArrowRight' && VIEWS[UI.view].month) ACTIONS['next-month']();
});
$('#fileJson').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSON(await f.text()); });
$('#fileCsv').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCSV(await f.text()); });
window.addEventListener('hashchange', () => { UI.view = location.hash.slice(1) || 'inicio'; render(); });
let lastW = innerWidth, rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 30) { lastW = innerWidth; if (!document.querySelector('dialog[open]') && ['inicio', 'analisis'].includes(UI.view)) render(); } }, 200); });
// Si otra pestaña modifica los datos, recargar
window.addEventListener('storage', e => { if (e.key === STORE_KEY && e.newValue) { S = migrate(JSON.parse(e.newValue)); render(); } });

/* =========================================================
   Instalación (PWA)
   ========================================================= */
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function updateInstallUI() {
  $('#installBtn').hidden = !installPrompt || isStandalone();
  if (UI.view === 'ajustes' && !document.querySelector('dialog[open]')) render();
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateInstallUI(); });
window.addEventListener('appinstalled', () => { installPrompt = null; updateInstallUI(); toast('¡Listo! Peso Ledger quedó instalada'); });
ACTIONS['install-app'] = async () => {
  if (!installPrompt) { go('ajustes'); return; }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  updateInstallUI();
};
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker:', err)));
}

/* =========================================================
   Arranque
   ========================================================= */
(function init() {
  S = load();
  if (!S) { S = buildDemo(); save(); }
  loadUI();
  UI.view = location.hash.slice(1) || 'inicio';
  runRecurring();
  applyTheme();
  applyPrivacy(!!S.settings.privacy);
  render();
  // Atajo "Cargar movimiento" del ícono instalado
  if (new URLSearchParams(location.search).has('nuevo')) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => openTx(), 50);
  }
  try { navigator.storage?.persist?.(); } catch (e) { /* opcional */ }
})();
