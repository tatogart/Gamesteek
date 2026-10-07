'use strict';

/* ================== Хранилище ================== */

const STORAGE_KEY = 'gamesteek-db-v1';
const emptyDb = () => ({ customers: [], games: [], sales: [], expenses: [] });

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyDb(), ...JSON.parse(raw) };
  } catch (e) { console.warn('Не удалось прочитать базу', e); }
  return emptyDb();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Ошибка сохранения: ' + e.message); }
  if (typeof Cloud !== 'undefined') Cloud.push();
  render();
}

// Обновить запись по id или добавить новую. Запись могли удалить с другого устройства,
// пока была открыта форма, — тогда она просто добавится заново.
function upsert(col, rec) {
  const existing = rec.id && byId(db[col], rec.id);
  if (existing) Object.assign(existing, rec);
  else { rec.id ||= uid(); rec.createdAt ||= Date.now(); db[col].push(rec); }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const byId = (list, id) => list.find(x => x.id === id);

/* ================== Справочники ================== */

const PLATFORMS = ['PS5', 'PS4', 'PS3', 'Xbox Series', 'Xbox One', 'Xbox 360', 'Switch', 'PC', 'Другое'];
const CONDITIONS = { new: 'Новый', used: 'Б/у' };
const TYPES = { disc: 'Диск', usb: 'Флешка' };
const TYPE_ICONS = { disc: '💿', usb: '🔌' };
const typeOf = g => g.type || 'disc'; // старые записи без типа — диски
const STATUSES = { paid: 'Оплачено', pending: 'Ожидает оплаты', cancelled: 'Отменено' };
const PAYMENTS = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод', other: 'Другое' };
const EXPENSE_CATS = ['Доставка', 'Реклама', 'Упаковка', 'Аренда', 'Комиссия площадки', 'Прочее'];

/* ================== Расчёты ================== */

const isActive = s => s.status !== 'cancelled';
const saleRevenue = s => s.qty * s.price;
const saleProfit = s => s.qty * (s.price - s.cost);

function soldQty(gameId) {
  return db.sales.filter(s => s.gameId === gameId && isActive(s)).reduce((a, s) => a + s.qty, 0);
}
// Храним «всего закуплено», остаток считаем — так отмена/удаление продажи сами возвращают диск на склад.
const stockOf = g => (g.purchased || 0) - soldQty(g.id);

function customerStats(customerId) {
  const sales = db.sales.filter(s => s.customerId === customerId && isActive(s));
  return {
    count: sales.length,
    spent: sales.reduce((a, s) => a + saleRevenue(s), 0),
    profit: sales.reduce((a, s) => a + saleProfit(s), 0),
    last: sales.map(s => s.date).sort().pop() || '',
  };
}

function periodRange(p) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = d => d.toISOString().slice(0, 10);
  const local = (yy, mm, dd) => iso(new Date(Date.UTC(yy, mm, dd)));
  switch (p) {
    case 'month': return [local(y, m, 1), local(y, m + 1, 0)];
    case 'prevmonth': return [local(y, m - 1, 1), local(y, m, 0)];
    case 'year': return [local(y, 0, 1), local(y, 11, 31)];
    default: return ['0000-00-00', '9999-12-31'];
  }
}
const inRange = (date, [a, b]) => date >= a && date <= b;

/* ================== Форматирование ================== */

const money = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' ₽';
const fmtDate = d => d ? d.split('-').reverse().join('.') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signCls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const customerName = id => byId(db.customers, id)?.name || 'Без покупателя';
// plain — без значка, для CSV
const gameTitle = (id, plain = false) => {
  const g = byId(db.games, id);
  if (!g) return 'Удалённый товар';
  const extra = typeOf(g) === 'usb' && g.capacity ? `, ${g.capacity} ГБ` : '';
  return `${plain ? '' : TYPE_ICONS[typeOf(g)] + ' '}${g.title} (${g.platform}${extra})`;
};

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function table(el, headers, rows, emptyText) {
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="empty">${emptyText}</td></tr></tbody>`;
    return;
  }
  el.innerHTML =
    '<thead><tr>' + headers.map(h => `<th class="${h.num ? 'num' : ''}">${h.t}</th>`).join('') + '</tr></thead>' +
    '<tbody>' + rows.join('') + '</tbody>';
}

const rowActions = (type, id) =>
  `<td><div class="row-actions">
     <button class="btn small" data-edit="${type}" data-id="${id}">✎</button>
     <button class="btn small danger" data-del="${type}" data-id="${id}">✕</button>
   </div></td>`;

/* ================== Рендер ================== */

let currentView = 'dashboard';

function render() {
  renderDashboard();
  renderSales();
  renderCustomers();
  renderGames();
  renderExpenses();
}

function renderDashboard() {
  const range = periodRange(document.getElementById('period').value);
  const sales = db.sales.filter(s => isActive(s) && inRange(s.date, range));
  const expenses = db.expenses.filter(e => inRange(e.date, range));

  const revenue = sales.reduce((a, s) => a + saleRevenue(s), 0);
  const gross = sales.reduce((a, s) => a + saleProfit(s), 0);
  const exp = expenses.reduce((a, e) => a + e.amount, 0);
  const net = gross - exp;
  const soldOfType = t => sales.filter(s => typeOf(byId(db.games, s.gameId) || {}) === t).reduce((a, s) => a + s.qty, 0);
  const buyers = new Set(sales.map(s => s.customerId).filter(Boolean)).size;
  const debt = db.sales.filter(s => s.status === 'pending' && inRange(s.date, range)).reduce((a, s) => a + saleRevenue(s), 0);
  const stockValue = db.games.reduce((a, g) => a + Math.max(0, stockOf(g)) * g.cost, 0);

  const kpis = [
    ['Выручка', money(revenue)],
    ['Чистая прибыль', money(net), net >= 0 ? 'good' : 'bad'],
    ['Расходы', money(exp)],
    ['Продано дисков', soldOfType('disc')],
    ['Продано флешек', soldOfType('usb')],
    ['Средний чек', money(sales.length ? revenue / sales.length : 0)],
    ['Покупателей', buyers],
    ['Ждём оплату', money(debt)],
    ['Склад по закупке', money(stockValue)],
  ];
  document.getElementById('kpis').innerHTML = kpis.map(([l, v, c]) =>
    `<div class="kpi"><div class="label">${l}</div><div class="value ${c || ''}">${v}</div></div>`).join('');

  renderChart();

  // Топ игр
  const gameAgg = {};
  sales.forEach(s => {
    const a = gameAgg[s.gameId] ||= { qty: 0, rev: 0, profit: 0 };
    a.qty += s.qty; a.rev += saleRevenue(s); a.profit += saleProfit(s);
  });
  const topGames = Object.entries(gameAgg).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5);
  document.getElementById('top-games').innerHTML = topGames.length
    ? '<ul class="list">' + topGames.map(([id, a]) =>
        `<li><span>${esc(gameTitle(id))}<div class="sub">${a.qty} шт · прибыль ${money(a.profit)}</div></span><b>${money(a.rev)}</b></li>`).join('') + '</ul>'
    : '<div class="empty">Нет продаж за период</div>';

  // Топ покупателей
  const custAgg = {};
  sales.filter(s => s.customerId).forEach(s => {
    const a = custAgg[s.customerId] ||= { n: 0, rev: 0 };
    a.n++; a.rev += saleRevenue(s);
  });
  const topCust = Object.entries(custAgg).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5);
  document.getElementById('top-customers').innerHTML = topCust.length
    ? '<ul class="list">' + topCust.map(([id, a]) =>
        `<li><span>${esc(customerName(id))}<div class="sub">${a.n} покуп.</div></span><b>${money(a.rev)}</b></li>`).join('') + '</ul>'
    : '<div class="empty">Нет покупателей за период</div>';

  // Последние продажи
  const recent = [...db.sales].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6);
  document.getElementById('recent-sales').innerHTML = recent.length
    ? '<ul class="list">' + recent.map(s =>
        `<li><span>${esc(gameTitle(s.gameId))}<div class="sub">${fmtDate(s.date)} · ${esc(customerName(s.customerId))} · <span class="badge ${s.status}">${STATUSES[s.status]}</span></div></span><b>${money(saleRevenue(s))}</b></li>`).join('') + '</ul>'
    : '<div class="empty">Продаж пока нет — нажмите «+ Продажа»</div>';

  // Мало на складе
  const low = db.games.map(g => ({ g, st: stockOf(g) })).filter(x => x.st <= 1).sort((a, b) => a.st - b.st).slice(0, 8);
  document.getElementById('low-stock').innerHTML = low.length
    ? '<ul class="list">' + low.map(({ g, st }) =>
        `<li><span>${TYPE_ICONS[typeOf(g)]} ${esc(g.title)}<div class="sub">${TYPES[typeOf(g)]} · ${esc(g.platform)} · ${CONDITIONS[g.condition]}</div></span><b class="${st <= 0 ? 'neg' : ''}">${st} шт</b></li>`).join('') + '</ul>'
    : '<div class="empty">Со складом всё в порядке</div>';
}

function renderChart() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''), rev: 0, profit: 0 });
  }
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  db.sales.filter(isActive).forEach(s => {
    const i = idx[s.date.slice(0, 7)];
    if (i !== undefined) { months[i].rev += saleRevenue(s); months[i].profit += saleProfit(s); }
  });
  db.expenses.forEach(e => {
    const i = idx[e.date.slice(0, 7)];
    if (i !== undefined) months[i].profit -= e.amount;
  });

  const W = 760, H = 240, padL = 56, padB = 28, padT = 10;
  const rawMax = Math.max(1, ...months.map(m => Math.max(m.rev, m.profit)));
  const rawMin = Math.min(0, ...months.map(m => m.profit));
  // «Круглый» шаг шкалы: 1, 2, 5 × 10ⁿ
  const rough = (rawMax - rawMin) / 4, pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(k => k * pow).find(v => v >= rough);
  const min = Math.floor(rawMin / step) * step, max = Math.ceil(rawMax / step) * step;
  const span = max - min;
  const y = v => padT + (H - padT - padB) * (1 - (v - min) / span);
  const colW = (W - padL) / months.length;
  const bw = Math.min(18, colW / 3);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График выручки и прибыли">`;
  for (let v = min; v <= max + step / 2; v += step) {
    svg += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/>` +
      `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = padL + colW * i + colW / 2;
    const bar = (v, x, color) => {
      const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
      return `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(0, bottom - top)}" rx="3" fill="${color}"><title>${m.label}: ${money(v)}</title></rect>`;
    };
    svg += bar(m.rev, cx - bw - 1, 'var(--revenue)') + bar(m.profit, cx + 1, m.profit < 0 ? 'var(--bad)' : 'var(--profit)');
    svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${m.label}</text>`;
  });
  svg += '</svg>';
  document.getElementById('chart').innerHTML = svg +
    '<div class="legend"><span><i style="background:var(--revenue)"></i>Выручка</span><span><i style="background:var(--profit)"></i>Чистая прибыль</span></div>';
}

function renderSales() {
  const q = document.getElementById('sales-search').value.trim().toLowerCase();
  const st = document.getElementById('sales-status').value;
  const list = db.sales
    .filter(s => !st || s.status === st)
    .filter(s => !q || (gameTitle(s.gameId) + ' ' + customerName(s.customerId)).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  table(document.getElementById('sales-table'),
    [{ t: 'Дата' }, { t: 'Покупатель' }, { t: 'Игра' }, { t: 'Кол-во', num: 1 }, { t: 'Цена', num: 1 }, { t: 'Сумма', num: 1 }, { t: 'Прибыль', num: 1 }, { t: 'Оплата' }, { t: 'Статус' }, { t: '' }],
    list.map(s => `<tr>
      <td>${fmtDate(s.date)}</td>
      <td>${esc(customerName(s.customerId))}</td>
      <td>${esc(gameTitle(s.gameId))}</td>
      <td class="num">${s.qty}</td>
      <td class="num">${money(s.price)}</td>
      <td class="num"><b>${money(saleRevenue(s))}</b></td>
      <td class="num ${isActive(s) ? signCls(saleProfit(s)) : 'muted'}">${money(saleProfit(s))}</td>
      <td>${PAYMENTS[s.payment] || '—'}</td>
      <td><span class="badge ${s.status}">${STATUSES[s.status]}</span></td>
      ${rowActions('sale', s.id)}
    </tr>`),
    db.sales.length ? 'Ничего не найдено' : 'Продаж пока нет');
}

function renderCustomers() {
  const q = document.getElementById('customers-search').value.trim().toLowerCase();
  const list = db.customers
    .filter(c => !q || [c.name, c.phone, c.contact, c.city].join(' ').toLowerCase().includes(q))
    .map(c => ({ c, st: customerStats(c.id) }))
    .sort((a, b) => b.st.spent - a.st.spent || a.c.name.localeCompare(b.c.name));

  table(document.getElementById('customers-table'),
    [{ t: 'Имя' }, { t: 'Телефон' }, { t: 'Контакт' }, { t: 'Город' }, { t: 'Покупок', num: 1 }, { t: 'Потратил', num: 1 }, { t: 'Прибыль с него', num: 1 }, { t: 'Последняя' }, { t: '' }],
    list.map(({ c, st }) => `<tr class="clickable" data-open-customer="${c.id}">
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${esc(c.contact) || '—'}</td>
      <td>${esc(c.city) || '—'}</td>
      <td class="num">${st.count}</td>
      <td class="num">${money(st.spent)}</td>
      <td class="num ${signCls(st.profit)}">${money(st.profit)}</td>
      <td>${fmtDate(st.last)}</td>
      ${rowActions('customer', c.id)}
    </tr>`),
    db.customers.length ? 'Ничего не найдено' : 'Покупателей пока нет');
}

function renderGames() {
  const q = document.getElementById('games-search').value.trim().toLowerCase();
  const tf = document.getElementById('games-type').value;
  const pf = document.getElementById('games-platform');
  const platforms = [...new Set(db.games.map(g => g.platform))].sort();
  const cur = pf.value;
  pf.innerHTML = '<option value="">Все платформы</option>' + platforms.map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('');

  const list = db.games
    .filter(g => !tf || typeOf(g) === tf)
    .filter(g => !pf.value || g.platform === pf.value)
    .filter(g => !q || (g.title + ' ' + (g.contents || '')).toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));

  table(document.getElementById('games-table'),
    [{ t: 'Товар' }, { t: 'Тип' }, { t: 'Платформа' }, { t: 'Состояние' }, { t: 'Закупка', num: 1 }, { t: 'Цена продажи', num: 1 }, { t: 'Наценка', num: 1 }, { t: 'Остаток', num: 1 }, { t: 'Продано', num: 1 }, { t: '' }],
    list.map(g => {
      const st = stockOf(g), margin = g.price - g.cost;
      return `<tr>
        <td class="wrap"><b>${esc(g.title)}</b>${g.contents ? `<div class="sub muted">${esc(g.contents)}</div>` : ''}</td>
        <td>${TYPE_ICONS[typeOf(g)]} ${TYPES[typeOf(g)]}${typeOf(g) === 'usb' && g.capacity ? ` · ${g.capacity} ГБ` : ''}</td>
        <td>${esc(g.platform)}</td>
        <td>${CONDITIONS[g.condition]}</td>
        <td class="num">${money(g.cost)}</td>
        <td class="num">${money(g.price)}</td>
        <td class="num ${signCls(margin)}">${money(margin)}</td>
        <td class="num ${st <= 0 ? 'neg' : ''}"><b>${st}</b></td>
        <td class="num">${soldQty(g.id)}</td>
        ${rowActions('game', g.id)}
      </tr>`;
    }),
    db.games.length ? 'Ничего не найдено' : 'Добавьте первый диск или флешку');
}

function renderExpenses() {
  const list = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date));
  table(document.getElementById('expenses-table'),
    [{ t: 'Дата' }, { t: 'Категория' }, { t: 'Комментарий' }, { t: 'Сумма', num: 1 }, { t: '' }],
    list.map(e => `<tr>
      <td>${fmtDate(e.date)}</td>
      <td>${esc(e.category)}</td>
      <td class="wrap">${esc(e.note) || '—'}</td>
      <td class="num neg">${money(e.amount)}</td>
      ${rowActions('expense', e.id)}
    </tr>`),
    'Расходов пока нет');
}

/* ================== Модальные формы ================== */

const modal = document.getElementById('modal');
let onSubmit = null;

function openModal(title, html, submit, okText = 'Сохранить') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-ok').textContent = okText;
  document.getElementById('modal-ok').hidden = !submit;
  onSubmit = submit;
  modal.showModal();
  modal.querySelector('input:not([type=hidden]), select')?.focus();
}

document.getElementById('modal-form').addEventListener('submit', e => {
  if (!onSubmit) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  if (onSubmit(data) !== false) modal.close();
});
document.getElementById('modal-cancel').addEventListener('click', () => modal.close());

const field = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
const opts = (map, sel) => Object.entries(map).map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
const num = v => Number(String(v).replace(',', '.')) || 0;

function customerForm(c = {}, after) {
  openModal(c.id ? 'Покупатель' : 'Новый покупатель', `
    ${field('Имя *', `<input name="name" required value="${esc(c.name)}">`)}
    <div class="field-row">
      ${field('Телефон', `<input name="phone" type="tel" value="${esc(c.phone)}">`)}
      ${field('Telegram / VK / Avito', `<input name="contact" value="${esc(c.contact)}" placeholder="@nickname">`)}
    </div>
    ${field('Город', `<input name="city" value="${esc(c.city)}">`)}
    ${field('Заметка', `<textarea name="note" rows="2">${esc(c.note)}</textarea>`)}
  `, d => {
    const rec = { ...c, name: d.name.trim(), phone: d.phone.trim(), contact: d.contact.trim(), city: d.city.trim(), note: d.note.trim() };
    if (!rec.name) return false;
    upsert('customers', rec);
    save();
    toast('Покупатель сохранён');
    after?.(rec);
  });
}

function gameForm(g = {}) {
  const sold = g.id ? soldQty(g.id) : 0;
  const stock = g.id ? stockOf(g) : 1;
  const pl = g.platform || 'PS5';
  const type = typeOf(g);
  openModal(g.id ? 'Товар' : 'Новый товар', `
    ${field('Тип товара', `<select name="type" id="f-type">${opts(Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, TYPE_ICONS[k] + ' ' + v])), type)}</select>`)}
    ${field('Название *', `<input name="title" id="f-title" required value="${esc(g.title)}">`)}
    <div id="f-usb">
      ${field('Объём флешки, ГБ', `<input name="capacity" type="number" min="0" step="1" value="${g.capacity ?? ''}" placeholder="64">`)}
      ${field('Какие игры записаны', `<textarea name="contents" rows="2" placeholder="GTA V, FIFA 23, Minecraft…">${esc(g.contents)}</textarea>`)}
    </div>
    <div class="field-row">
      ${field('Платформа', `<input name="platform" list="platform-list" value="${esc(pl)}"><datalist id="platform-list">${PLATFORMS.map(p => `<option value="${p}">`).join('')}</datalist>`)}
      ${field('Состояние', `<select name="condition">${opts(CONDITIONS, g.condition || 'new')}</select>`)}
    </div>
    <div class="field-row">
      ${field('Цена закупки, ₽', `<input name="cost" inputmode="decimal" value="${g.cost ?? ''}">`)}
      ${field('Цена продажи, ₽', `<input name="price" inputmode="decimal" value="${g.price ?? ''}">`)}
    </div>
    ${field('Остаток на складе, шт', `<input name="stock" type="number" min="0" step="1" value="${stock}">`)}
    ${sold ? `<p class="hint">Уже продано: ${sold} шт. Остаток уменьшается автоматически при продаже.</p>` : ''}
  `, d => {
    const usb = d.type === 'usb';
    const rec = { ...g, type: d.type, capacity: usb ? Math.round(num(d.capacity)) || '' : '', contents: usb ? d.contents.trim() : '',
      title: d.title.trim(), platform: d.platform.trim() || 'Другое', condition: d.condition, cost: num(d.cost), price: num(d.price), purchased: Math.max(0, Math.round(num(d.stock))) + sold };
    if (!rec.title) return false;
    upsert('games', rec);
    save();
    toast('Товар сохранён');
  });

  const typeSel = document.getElementById('f-type');
  const syncType = () => {
    const usb = typeSel.value === 'usb';
    document.getElementById('f-usb').hidden = !usb;
    document.getElementById('f-title').placeholder = usb ? 'Например, Флешка 64 ГБ — сборка PS3' : 'Например, Elden Ring';
  };
  typeSel.addEventListener('change', syncType);
  syncType();
}

function saleForm(s = {}) {
  if (!db.games.length) {
    toast('Сначала добавьте диск или флешку на склад');
    switchView('games');
    gameForm();
    return;
  }
  const games = [...db.games].sort((a, b) => a.title.localeCompare(b.title));
  const customers = [...db.customers].sort((a, b) => a.name.localeCompare(b.name));
  const gameId = s.gameId || games.find(g => stockOf(g) > 0)?.id || games[0].id;
  const g0 = byId(db.games, gameId);

  openModal(s.id ? 'Продажа' : 'Новая продажа', `
    ${field('Товар *', `<select name="gameId" id="f-game">${games.map(g =>
      `<option value="${g.id}" ${g.id === gameId ? 'selected' : ''}>${TYPE_ICONS[typeOf(g)]} ${esc(g.title)} · ${esc(g.platform)} · ${CONDITIONS[g.condition]} (ост. ${stockOf(g)})</option>`).join('')}</select>`)}
    ${field('Покупатель', `<select name="customerId" id="f-cust"><option value="">— без покупателя —</option><option value="__new">+ Новый покупатель…</option>${customers.map(c =>
      `<option value="${c.id}" ${c.id === s.customerId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}</select>`)}
    <div class="field" id="f-newcust" hidden><label>Имя нового покупателя</label><input name="newCustomer" placeholder="Имя"><input name="newPhone" placeholder="Телефон или @ник" style="margin-top:6px"></div>
    <div class="field-row">
      ${field('Дата', `<input name="date" type="date" required value="${s.date || today()}">`)}
      ${field('Количество', `<input name="qty" type="number" min="1" step="1" value="${s.qty || 1}">`)}
    </div>
    <div class="field-row">
      ${field('Цена продажи за шт, ₽', `<input name="price" id="f-price" inputmode="decimal" value="${s.price ?? g0.price}">`)}
      ${field('Себестоимость за шт, ₽', `<input name="cost" id="f-cost" inputmode="decimal" value="${s.cost ?? g0.cost}">`)}
    </div>
    <div class="field-row">
      ${field('Способ оплаты', `<select name="payment">${opts(PAYMENTS, s.payment || 'transfer')}</select>`)}
      ${field('Статус', `<select name="status">${opts(STATUSES, s.status || 'paid')}</select>`)}
    </div>
    ${field('Комментарий', `<input name="note" value="${esc(s.note)}" placeholder="Доставка, Avito и т.п.">`)}
    <p class="hint" id="f-summary"></p>
  `, d => {
    let customerId = d.customerId;
    if (customerId === '__new') {
      const name = d.newCustomer.trim();
      if (!name) { toast('Введите имя покупателя'); return false; }
      const phone = d.newPhone.trim();
      const c = { id: uid(), createdAt: Date.now(), name, phone: phone.startsWith('@') ? '' : phone, contact: phone.startsWith('@') ? phone : '', city: '', note: '' };
      db.customers.push(c);
      customerId = c.id;
    }
    const rec = { ...s, gameId: d.gameId, customerId, date: d.date, qty: Math.max(1, Math.round(num(d.qty))), price: num(d.price), cost: num(d.cost), payment: d.payment, status: d.status, note: d.note.trim() };
    if (rec.status !== 'cancelled') {
      const g = byId(db.games, rec.gameId);
      const alreadyCounted = s.id && isActive(s) && s.gameId === rec.gameId ? s.qty : 0;
      const available = stockOf(g) + alreadyCounted;
      if (rec.qty > available && !confirm(`На складе только ${available} шт. Всё равно сохранить? Остаток уйдёт в минус.`)) return false;
    }
    upsert('sales', rec);
    save();
    toast('Продажа сохранена');
  });

  const f = document.getElementById('modal-form');
  const summary = () => {
    const qty = num(f.qty.value), price = num(f.price.value), cost = num(f.cost.value);
    const p = qty * (price - cost);
    document.getElementById('f-summary').innerHTML = `Сумма: <b>${money(qty * price)}</b> · Прибыль: <b class="${signCls(p)}">${money(p)}</b>`;
  };
  document.getElementById('f-game').addEventListener('change', e => {
    const g = byId(db.games, e.target.value);
    f.price.value = g.price; f.cost.value = g.cost; summary();
  });
  document.getElementById('f-cust').addEventListener('change', e => {
    document.getElementById('f-newcust').hidden = e.target.value !== '__new';
    if (e.target.value === '__new') f.newCustomer.focus();
  });
  ['qty', 'price', 'cost'].forEach(n => f[n].addEventListener('input', summary));
  summary();
}

function expenseForm(e = {}) {
  openModal(e.id ? 'Расход' : 'Новый расход', `
    <div class="field-row">
      ${field('Дата', `<input name="date" type="date" required value="${e.date || today()}">`)}
      ${field('Сумма, ₽ *', `<input name="amount" inputmode="decimal" required value="${e.amount ?? ''}">`)}
    </div>
    ${field('Категория', `<input name="category" list="exp-cats" value="${esc(e.category || 'Доставка')}"><datalist id="exp-cats">${EXPENSE_CATS.map(c => `<option value="${c}">`).join('')}</datalist>`)}
    ${field('Комментарий', `<input name="note" value="${esc(e.note)}">`)}
  `, d => {
    const rec = { ...e, date: d.date, amount: num(d.amount), category: d.category.trim() || 'Прочее', note: d.note.trim() };
    if (!rec.amount) return false;
    upsert('expenses', rec);
    save();
    toast('Расход сохранён');
  });
}

function customerCard(id) {
  const c = byId(db.customers, id);
  const st = customerStats(id);
  const sales = db.sales.filter(s => s.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
  openModal(c.name, `
    <p class="muted">${[c.phone, c.contact, c.city].filter(Boolean).map(esc).join(' · ') || 'Контакты не указаны'}</p>
    ${c.note ? `<p>${esc(c.note)}</p>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="label">Покупок</div><div class="value">${st.count}</div></div>
      <div class="kpi"><div class="label">Потратил</div><div class="value">${money(st.spent)}</div></div>
    </div>
    ${sales.length ? '<ul class="list">' + sales.map(s =>
      `<li><span>${esc(gameTitle(s.gameId))}<div class="sub">${fmtDate(s.date)} · ${s.qty} шт · <span class="badge ${s.status}">${STATUSES[s.status]}</span></div></span><b>${money(saleRevenue(s))}</b></li>`).join('') + '</ul>'
      : '<div class="empty">Покупок пока нет</div>'}
  `, null);
  document.getElementById('modal-cancel').textContent = 'Закрыть';
  modal.addEventListener('close', () => { document.getElementById('modal-cancel').textContent = 'Отмена'; }, { once: true });
}

/* ================== Удаление ================== */

const COLLECTIONS = { customer: 'customers', game: 'games', sale: 'sales', expense: 'expenses' };
const FORMS = { customer: customerForm, game: gameForm, sale: saleForm, expense: expenseForm };

function remove(type, id) {
  if (type === 'game' && db.sales.some(s => s.gameId === id)) {
    if (!confirm('По этой игре есть продажи. Удалить игру? Продажи останутся, но без названия игры.')) return;
  } else if (type === 'customer' && db.sales.some(s => s.customerId === id)) {
    if (!confirm('У покупателя есть продажи. Удалить? Продажи останутся как «без покупателя».')) return;
  } else if (!confirm('Удалить запись?')) return;
  const key = COLLECTIONS[type];
  db[key] = db[key].filter(x => x.id !== id);
  if (type === 'customer') db.sales.forEach(s => { if (s.customerId === id) s.customerId = ''; });
  save();
  toast('Удалено');
}

/* ================== Экспорт / импорт ================== */

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCsv(rows) {
  const cell = v => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // ; и BOM — чтобы Excel с русской локалью открыл файл корректно
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\n');
}

const CSV = {
  sales: () => [['Дата', 'Покупатель', 'Товар', 'Тип', 'Кол-во', 'Цена', 'Себестоимость', 'Сумма', 'Прибыль', 'Оплата', 'Статус', 'Комментарий'],
    ...db.sales.map(s => [s.date, customerName(s.customerId), gameTitle(s.gameId, true), TYPES[typeOf(byId(db.games, s.gameId) || {})], s.qty, s.price, s.cost, saleRevenue(s), saleProfit(s), PAYMENTS[s.payment], STATUSES[s.status], s.note])],
  customers: () => [['Имя', 'Телефон', 'Контакт', 'Город', 'Покупок', 'Потратил', 'Заметка'],
    ...db.customers.map(c => { const st = customerStats(c.id); return [c.name, c.phone, c.contact, c.city, st.count, st.spent, c.note]; })],
  games: () => [['Товар', 'Тип', 'Объём, ГБ', 'Игры на флешке', 'Платформа', 'Состояние', 'Закупка', 'Цена', 'Остаток', 'Продано'],
    ...db.games.map(g => [g.title, TYPES[typeOf(g)], g.capacity || '', g.contents || '', g.platform, CONDITIONS[g.condition], g.cost, g.price, stockOf(g), soldQty(g.id)])],
  expenses: () => [['Дата', 'Категория', 'Сумма', 'Комментарий'], ...db.expenses.map(e => [e.date, e.category, e.amount, e.note])],
};

function seedDemo() {
  const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const games = [
    ['Elden Ring', 'PS5', 'new', 2800, 3900, 6], ['Marvel\'s Spider-Man 2', 'PS5', 'new', 3500, 4900, 4],
    ['The Last of Us Part II', 'PS4', 'used', 900, 1700, 3], ['God of War Ragnarök', 'PS5', 'used', 2200, 3200, 2],
    ['The Legend of Zelda: Tears of the Kingdom', 'Switch', 'new', 4200, 5600, 3], ['Red Dead Redemption 2', 'Xbox One', 'used', 800, 1500, 5],
    ['GTA V', 'PS4', 'used', 700, 1300, 1], ['Mario Kart 8 Deluxe', 'Switch', 'new', 3600, 4700, 2],
  ].map(([title, platform, condition, cost, price, stock]) => ({ id: uid(), createdAt: Date.now(), type: 'disc', title, platform, condition, cost, price, purchased: stock }));
  games.push(
    { id: uid(), createdAt: Date.now(), type: 'usb', title: 'Флешка 64 ГБ — хиты PS3', capacity: 64, contents: 'GTA V, The Last of Us, Uncharted 3, Red Dead Redemption', platform: 'PS3', condition: 'new', cost: 600, price: 1500, purchased: 5 },
    { id: uid(), createdAt: Date.now(), type: 'usb', title: 'Флешка 128 ГБ — игры для ПК', capacity: 128, contents: 'Minecraft, Terraria, Stardew Valley, Hollow Knight', platform: 'PC', condition: 'new', cost: 900, price: 1900, purchased: 3 },
  );
  const customers = [
    ['Алексей Смирнов', '+7 900 111-22-33', '@alex_games', 'Москва'], ['Мария Иванова', '+7 911 222-33-44', '', 'Санкт-Петербург'],
    ['Дмитрий К.', '', '@dimak', 'Казань'], ['Игорь Петров', '+7 922 333-44-55', 'vk.com/igorp', 'Москва'], ['Анна', '', '@anna_ps', 'Новосибирск'],
  ].map(([name, phone, contact, city]) => ({ id: uid(), createdAt: Date.now(), name, phone, contact, city, note: '' }));
  const sales = [];
  const statuses = ['paid', 'paid', 'paid', 'paid', 'pending', 'cancelled'];
  for (let i = 0; i < 40; i++) {
    const g = games[i % games.length], c = customers[(i * 7) % customers.length];
    g.purchased += 1;
    sales.push({ id: uid(), createdAt: Date.now() + i, gameId: g.id, customerId: i % 9 === 0 ? '' : c.id, date: d(Math.floor(i * 8.5) + (i % 3)), qty: 1,
      price: g.price - (i % 4 === 0 ? 200 : 0), cost: g.cost, payment: ['transfer', 'cash', 'card'][i % 3], status: statuses[i % statuses.length], note: '' });
  }
  const expenses = [];
  for (let m = 0; m < 10; m++) {
    expenses.push({ id: uid(), createdAt: Date.now(), date: d(m * 30 + 5), category: 'Доставка', amount: 600 + m * 40, note: 'СДЭК' });
    if (m % 3 === 0) expenses.push({ id: uid(), createdAt: Date.now(), date: d(m * 30 + 12), category: 'Реклама', amount: 1500, note: 'Продвижение на Avito' });
  }
  db = { customers, games, sales, expenses };
  save();
}

/* ================== Навигация и события ================== */

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  try { localStorage.setItem('gamesteek-view', view); } catch {}
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
}

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) switchView(b.dataset.view);
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action],[data-edit],[data-del],[data-export],[data-open-customer]');
  if (!t) return;
  if (t.dataset.action) {
    ({ 'new-sale': () => saleForm(), 'new-customer': () => customerForm(), 'new-game': () => gameForm(), 'new-expense': () => expenseForm() })[t.dataset.action]();
  } else if (t.dataset.edit) {
    e.stopPropagation();
    FORMS[t.dataset.edit]({ ...byId(db[COLLECTIONS[t.dataset.edit]], t.dataset.id) });
  } else if (t.dataset.del) {
    e.stopPropagation();
    remove(t.dataset.del, t.dataset.id);
  } else if (t.dataset.export) {
    download(`gamesteek-${t.dataset.export}-${today()}.csv`, toCsv(CSV[t.dataset.export]()), 'text/csv;charset=utf-8');
  } else if (t.dataset.openCustomer) {
    customerCard(t.dataset.openCustomer);
  }
});

['sales-search', 'sales-status', 'customers-search', 'games-search', 'games-type', 'games-platform', 'period'].forEach(id =>
  document.getElementById(id).addEventListener('input', render));

document.getElementById('backup').addEventListener('click', () =>
  download(`gamesteek-backup-${today()}.json`, JSON.stringify(db, null, 2), 'application/json'));

document.getElementById('restore').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sales) || !Array.isArray(data.customers)) throw new Error('неверный формат файла');
    if (!confirm('Заменить текущие данные данными из файла?')) return;
    db = { ...emptyDb(), ...data };
    save();
    toast('Данные загружены');
  } catch (err) { toast('Ошибка: ' + err.message); }
});

document.getElementById('demo').addEventListener('click', () => {
  if (db.sales.length + db.customers.length + db.games.length && !confirm('Текущие данные будут заменены демо-данными. Продолжить?')) return;
  seedDemo();
  switchView('dashboard');
  toast('Демо-данные загружены');
});

document.getElementById('wipe').addEventListener('click', () => {
  if (!confirm(typeof Cloud !== 'undefined' && Cloud.active
    ? 'Удалить ВСЕ данные из облака — на всех ваших устройствах? Сначала лучше скачать резервную копию.'
    : 'Удалить ВСЕ данные? Сначала лучше скачать резервную копию.')) return;
  db = emptyDb();
  save();
  toast('Все данные удалены');
});

/* ================== PIN-код ================== */

// Хранится только соль и SHA-256 хеш PIN — сам PIN нигде не сохраняется.
const LOCK_KEY = 'gamesteek-lock';
const UNLOCK_KEY = 'gamesteek-unlocked';

function getLock() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch { return null; }
}

async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function showLock() {
  document.body.classList.add('locked');
  document.getElementById('lock').hidden = false;
  document.getElementById('lock-error').hidden = true;
  const input = document.getElementById('lock-pin');
  input.value = '';
  input.focus();
}

function renderPinSettings() {
  const on = !!getLock();
  document.getElementById('pin-status').textContent = on
    ? 'PIN установлен. Он спрашивается при каждом новом открытии сайта в этом браузере.'
    : 'PIN не установлен — любой, кто откроет сайт в этом браузере, увидит базу.';
  document.getElementById('pin-set').textContent = on ? 'Сменить PIN' : 'Установить PIN';
  document.getElementById('pin-lock').hidden = !on;
  document.getElementById('pin-remove').hidden = !on;
}

document.getElementById('lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const lock = getLock();
  const pin = document.getElementById('lock-pin').value;
  if (lock && await hashPin(pin, lock.salt) !== lock.hash) {
    document.getElementById('lock-error').hidden = false;
    document.getElementById('lock-pin').select();
    return;
  }
  try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch {}
  document.getElementById('lock').hidden = true;
  document.body.classList.remove('locked');
});

document.getElementById('pin-set').addEventListener('click', () => {
  openModal(getLock() ? 'Сменить PIN' : 'Установить PIN', `
    ${field('Новый PIN (минимум 4 символа)', '<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" required>')}
    ${field('Повторите PIN', '<input name="pin2" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" required>')}
    <p class="hint">PIN устанавливается отдельно на каждом устройстве. Если забудете — восстановить нельзя, только очистить данные сайта в браузере.</p>
  `, d => {
    if (d.pin.length < 4) { toast('PIN слишком короткий'); return false; }
    if (d.pin !== d.pin2) { toast('PIN-коды не совпадают'); return false; }
    const salt = uid() + uid();
    hashPin(d.pin, salt).then(hash => {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash }));
      try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch {}
      renderPinSettings();
      toast('PIN установлен');
    });
  });
});

document.getElementById('pin-lock').addEventListener('click', () => {
  try { sessionStorage.removeItem(UNLOCK_KEY); } catch {}
  showLock();
});

document.getElementById('pin-remove').addEventListener('click', () => {
  if (!confirm('Убрать PIN-код?')) return;
  localStorage.removeItem(LOCK_KEY);
  renderPinSettings();
  toast('PIN убран');
});

// Старт
renderPinSettings();
let unlocked = false;
try { unlocked = sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch {}
if (getLock() && !unlocked) showLock();

let startView = location.hash.slice(1);
if (!document.getElementById('view-' + startView)) {
  try { startView = localStorage.getItem('gamesteek-view') || 'dashboard'; } catch { startView = 'dashboard'; }
}
switchView(document.getElementById('view-' + startView) ? startView : 'dashboard');
render();
