'use strict';

/* =====================================================================
   ۱) تنظیمات
   ===================================================================== */
const CONFIG = {
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTRrWfxsgmHTXywSfzBFOXd7XVSUJzW0QWoSvvKYicM4n8_Nhi2GmSG90pUS1ruKLxc9CzFcTtwdq_i/pub?output=csv',
  fallbackUrl: 'data/fallback.json',
  refreshMs: 60000,
  timeoutMs: 12000,
  defaultTitle: 'انتخابات شورای مشورتی دانشجویان',
  defaultMainSeats: 5,      // اگر mainSeats در شیت نبود
  defaultReserveSeats: 2,   // اگر reserveSeats در شیت نبود
};

/* =====================================================================
   ۲) نگاشت نام‌ها (Mapping)
   برای سازگاری با شیت، فقط همین بخش را ویرایش کنید.
   فاصله، نیم‌فاصله، _ و - و بزرگی/کوچکی حروف در تطبیق نادیده گرفته می‌شود.
   ===================================================================== */
const MAP = {
  // کلیدهای متا (سطرهای کلید-مقدار یا ستون‌های یک جدول تک‌سطری)
  meta: {
    title:         ['title', 'عنوان'],
    status:        ['status', 'voting status', 'وضعیت', 'وضعیت رأی‌گیری'],
    lastUpdate:    ['lastUpdate', 'last updated', 'updatedAt', 'آخرین به‌روزرسانی', 'زمان به‌روزرسانی'],
    endTime:       ['endTime', 'close time', 'endAt', 'ساعت پایان', 'زمان پایان', 'پایان'],
    showVotes:     ['showCandidateVotes', 'show_votes', 'showVotes', 'showResults', 'نمایش_نتایج', 'نمایش آرا', 'نمایش رأی‌ها'],
    mainSeats:     ['mainSeats', 'main seats', 'اعضای اصلی', 'تعداد اعضای اصلی', 'منتخبین اصلی'],
    reserveSeats:  ['reserveSeats', 'reserve seats', 'alternates', 'علی‌البدل', 'اعضای علی‌البدل', 'تعداد علی‌البدل'],
    totalEligible: ['totalEligible', 'eligible total', 'کل واجدین شرایط', 'تعداد واجدین شرایط'],
    totalVoted:    ['totalVoted', 'total voters', 'کل رأی‌دهندگان', 'تعداد رأی‌دهندگان', 'شرکت‌کنندگان کل'],
  },
  // نام ستون‌ها در جدول‌ها
  columns: {
    type:     ['type', 'kind', 'section', 'نوع', 'بخش', 'دسته'],
    key:      ['key', 'field', 'کلید', 'فیلد', 'پارامتر'],
    value:    ['value', 'مقدار'],
    year:     ['year', 'entry year', 'cohort', 'سال ورودی', 'ورودی', 'سال'],
    eligible: ['eligible', 'total', 'capacity', 'واجدین', 'واجدین شرایط', 'کل', 'تعداد کل', 'کل دانشجویان'],
    voted:    ['voted', 'participants', 'participated', 'شرکت‌کنندگان', 'مشارکت‌کنندگان', 'رأی‌دهندگان', 'تعداد رأی‌دهندگان'],
    name:     ['name', 'candidate', 'candidate name', 'نام', 'کاندیدا', 'نامزد', 'نام کاندیدا', 'نام نامزد'],
    votes:    ['votes', 'vote count', 'رأی', 'آرا', 'آراء', 'تعداد رأی', 'تعداد آرا'],
  },
  // مقادیر ستون نوع (type)
  types: {
    meta:      ['meta', 'متا', 'config', 'setting', 'settings', 'تنظیمات', 'info'],
    entry:     ['entry', 'entries', 'year', 'participation', 'ورودی', 'ورودی‌ها', 'سال ورودی', 'مشارکت'],
    candidate: ['candidate', 'candidates', 'کاندیدا', 'کاندیداها', 'نامزد', 'نامزدها'],
  },
  truthy: ['true', '1', 'yes', 'y', 'on', 'show', 'بله', 'بلی', 'روشن', 'فعال', 'درست', 'نمایش'],
};

/* =====================================================================
   ۳) ابزارهای نرمال‌سازی
   ===================================================================== */
const DIGITS_FA = '۰۱۲۳۴۵۶۷۸۹';
const DIGITS_AR = '٠١٢٣٤٥٦٧٨٩';

function toLatinDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, d => DIGITS_FA.indexOf(d))
    .replace(/[٠-٩]/g, d => DIGITS_AR.indexOf(d));
}

function norm(s) {
  return toLatinDigits(s == null ? '' : s)
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200c\u200d\u200e\u200f\s_\-.:؛;،,]+/g, '')
    .toLowerCase();
}

function buildIndex(group) {
  const idx = new Map();
  for (const [canon, aliases] of Object.entries(group)) {
    idx.set(norm(canon), canon);
    for (const a of aliases) idx.set(norm(a), canon);
  }
  return idx;
}

const META_INDEX = buildIndex(MAP.meta);
const COL_INDEX = buildIndex(MAP.columns);
const TYPE_INDEX = buildIndex(MAP.types);
const TRUTHY = new Set(MAP.truthy.map(norm));

const lookup = (index, s) => index.get(norm(s)) || null;

function num(v) {
  if (v == null) return null;
  const s = toLatinDigits(String(v)).replace(/٫/g, '.').replace(/[,٬،\s%٪]/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const toInt = (v, fallback) => { const n = num(v); return n == null ? fallback : Math.max(0, Math.round(n)); };
const parseBool = v => TRUTHY.has(norm(v));
const cell = (row, i) => (i == null || row[i] == null ? '' : String(row[i]).trim());

/* =====================================================================
   ۴) خواندن CSV
   ===================================================================== */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* =====================================================================
   ۵) ساخت مدل داده از CSV
   پشتیبانی از:
   الف) یک جدول با ستون type (meta / entry / candidate)
   ب) چند جدول جدا با سطر خالی بین آن‌ها (هرکدام سرستون خودش را دارد)
   پ) سطرهای کلید-مقدار ساده (بدون سرستون)
   ت) جدول تک‌سطری متا (سرستون‌ها همان کلیدها)
   ===================================================================== */
function splitBlocks(rows) {
  const blocks = [];
  let cur = [];
  for (const r of rows) {
    if (r.every(c => !String(c).trim())) { if (cur.length) blocks.push(cur); cur = []; }
    else cur.push(r);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function setMeta(model, key, value, isCanon) {
  const canon = isCanon ? key : lookup(META_INDEX, key);
  if (canon) model.meta[canon] = String(value == null ? '' : value).trim();
}

function processBlock(block, model) {
  const head = block[0];
  const cols = {};
  head.forEach((c, i) => { const f = lookup(COL_INDEX, c); if (f && cols[f] == null) cols[f] = i; });

  if (!Object.keys(cols).length) {
    const metaCols = head.map((c, i) => [lookup(META_INDEX, c), i]).filter(([k]) => k);
    if (metaCols.length >= 2 && block.length > 1) {          // جدول تک‌سطری متا
      for (const [k, i] of metaCols) setMeta(model, k, cell(block[1], i), true);
    } else {                                                  // کلید-مقدار بدون سرستون
      for (const r of block) setMeta(model, r[0], r[1]);
    }
    return;
  }

  for (const r of block.slice(1)) {
    let t = cols.type != null ? lookup(TYPE_INDEX, r[cols.type]) : null;
    if (!t) {
      if (cols.name != null || cols.votes != null) t = 'candidate';
      else if (cols.year != null || cols.eligible != null || cols.voted != null) t = 'entry';
      else if (cols.key != null) t = 'meta';
    }
    if (t === 'meta') {
      const k = cell(r, cols.key) || cell(r, cols.name);
      const v = cols.value != null ? cell(r, cols.value) : cell(r, cols.votes);
      if (k) setMeta(model, k, v);
    } else if (t === 'entry') {
      const year = cell(r, cols.year) || cell(r, cols.key);
      if (!year) continue;
      model.entries.push({
        year,
        eligible: num(cell(r, cols.eligible)),
        voted: num(cols.voted != null ? cell(r, cols.voted) : cell(r, cols.value)),
      });
    } else if (t === 'candidate') {
      const name = cell(r, cols.name) || cell(r, cols.key);
      if (!name) continue;
      model.candidates.push({
        name,
        votes: num(cols.votes != null ? cell(r, cols.votes) : cell(r, cols.value)),
      });
    }
  }
}

function modelFromCSV(text) {
  const model = { meta: {}, entries: [], candidates: [] };
  for (const b of splitBlocks(parseCSV(text))) processBlock(b, model);
  return finalize(model);
}

function modelFromJSON(json) {
  const model = { meta: {}, entries: [], candidates: [] };
  for (const [k, v] of Object.entries(json.meta || {})) setMeta(model, k, v);
  for (const e of json.entries || []) {
    model.entries.push({ year: String(e.year), eligible: num(e.eligible), voted: num(e.voted) });
  }
  for (const c of json.candidates || []) {
    model.candidates.push({ name: String(c.name), votes: num(c.votes) });
  }
  return finalize(model);
}

function finalize(model) {
  const m = model.meta;
  const sum = k => model.entries.reduce((a, e) => a + (e[k] || 0), 0);
  const eligible = num(m.totalEligible) ?? (sum('eligible') || null);
  const voted = num(m.totalVoted) ?? (model.entries.length ? sum('voted') : null);
  return {
    meta: {
      title: m.title || CONFIG.defaultTitle,
      status: m.status || '',
      lastUpdate: m.lastUpdate || '',
      endTime: m.endTime || '',
      showVotes: parseBool(m.showVotes),
      mainSeats: toInt(m.mainSeats, CONFIG.defaultMainSeats),
      reserveSeats: toInt(m.reserveSeats, CONFIG.defaultReserveSeats),
      totalEligible: eligible,
      totalVoted: voted,
    },
    entries: model.entries,
    candidates: model.candidates,
  };
}

const isEmptyModel = m =>
  !m.entries.length && !m.candidates.length && !m.meta.status && !m.meta.lastUpdate && !m.meta.endTime;

/* =====================================================================
   ۶) رندر
   ===================================================================== */
const $ = s => document.querySelector(s);
const fmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
const pct = n => fmt.format(Math.round(n * 10) / 10) + '٪';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function progress(percent, color) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const fill = h('div', { class: 'fill' });
  fill.style.width = p + '%';
  if (color) fill.style.setProperty('--c', color);
  return h('div', {
    class: 'track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': Math.round(p),
  }, fill);
}

// رنگ میله: از کاهی (کم) تا آبیِ تمپر (زیاد)، مثل رنگ‌های حرارت‌دهی فولاد
const temperColor = p => `hsl(${Math.round(42 + (215 - 42) * Math.max(0, Math.min(100, p)) / 100)} 55% 42%)`;

function statusState(text) {
  const n = norm(text);
  if (/soon|upcoming|pending|notstarted|شروعنشده|آغازنشده|بزودی|بهزودی|هنوز/.test(n)) return 'pending';
  if (/clos|end|finish|done|بسته|پایان|تمام|خاتمه|اتمام/.test(n)) return 'closed';
  if (/open|active|run|live|باز|جریان|فعال/.test(n)) return 'open';
  return 'neutral';
}

function renderKpis(model) {
  const { totalEligible, totalVoted } = model.meta;
  const rate = totalEligible > 0 && totalVoted != null ? (totalVoted / totalEligible) * 100 : null;
  const cards = [
    ['واجدین شرایط', totalEligible != null ? fmt.format(totalEligible) : '—', 'نفر'],
    ['شرکت‌کنندگان', totalVoted != null ? fmt.format(totalVoted) : '—', 'نفر'],
    ['درصد مشارکت', rate != null ? pct(rate) : '—', ''],
    ['تعداد کاندیداها', fmt.format(model.candidates.length), 'نفر'],
  ];
  $('#kpis').replaceChildren(...cards.map(([label, value, unit]) =>
    h('div', { class: 'kpi' },
      h('span', { class: 'kpi-label', text: label }),
      h('strong', { class: 'kpi-value' }, value, unit && h('span', { class: 'kpi-unit', text: unit })))));
}

function renderYears(model) {
  const box = $('#year-bars');
  if (!model.entries.length) {
    box.replaceChildren(h('p', { class: 'muted', text: 'آمار مشارکت به تفکیک سال ورودی هنوز ثبت نشده است.' }));
    return;
  }
  const entries = [...model.entries];
  if (entries.every(e => num(e.year) != null)) entries.sort((a, b) => num(a.year) - num(b.year));
  const maxVoted = Math.max(1, ...entries.map(e => e.voted || 0));

  const items = entries.map(e => {
    const voted = e.voted || 0;
    const hasBase = e.eligible > 0;
    const p = hasBase ? (voted / e.eligible) * 100 : (voted / maxVoted) * 100;
    const nums = hasBase
      ? `${fmt.format(voted)} از ${fmt.format(e.eligible)} نفر`
      : `${fmt.format(voted)} نفر`;
    return h('li', null,
      h('div', { class: 'bar-head' },
        h('span', { class: 'bar-title', text: `ورودی ${e.year}` }),
        h('span', { class: 'bar-nums' }, nums, hasBase ? ' · ' : '', hasBase && h('span', { class: 'pct', text: pct(p) }))),
      progress(p, temperColor(p)));
  });
  box.replaceChildren(h('ul', { class: 'bars' }, items));
}

function renderCandidates(model) {
  const { showVotes, mainSeats, reserveSeats, totalVoted } = model.meta;
  const box = $('#cand-list');
  const note = $('#cand-note');

  if (!model.candidates.length) {
    $('#cand-h').textContent = 'کاندیداها';
    note.textContent = 'فهرست کاندیداها هنوز اعلام نشده است.';
    box.replaceChildren();
    return;
  }

  if (!showVotes) {
    // آرا و رتبه‌ها عمداً هرگز وارد DOM نمی‌شوند؛ فقط نام‌ها به ترتیب الفبا
    $('#cand-h').textContent = 'فهرست کاندیداها';
    note.textContent = 'تعداد آرا و رتبه‌بندی پس از اعلام رسمی نتایج نمایش داده می‌شود.';
    const names = model.candidates.map(c => c.name).sort((a, b) => a.localeCompare(b, 'fa'));
    box.replaceChildren(h('ul', { class: 'chips' }, names.map(n => h('li', { text: n }))));
    return;
  }

  $('#cand-h').textContent = 'نتایج انتخابات';
  const sorted = [...model.candidates]
    .map(c => ({ ...c, votes: c.votes || 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'fa'));
  const sumVotes = sorted.reduce((a, c) => a + c.votes, 0);
  const base = totalVoted > 0 ? totalVoted : sumVotes;
  note.textContent =
    `${fmt.format(mainSeats)} عضو اصلی و ${fmt.format(reserveSeats)} عضو علی‌البدل. ` +
    (totalVoted > 0 ? 'درصد آرا نسبت به شرکت‌کنندگان محاسبه شده است.' : 'درصد آرا نسبت به مجموع آرا محاسبه شده است.');

  const rows = sorted.map((c, i) => {
    const seat = i < mainSeats ? 'main' : i < mainSeats + reserveSeats ? 'reserve' : '';
    const p = base > 0 ? (c.votes / base) * 100 : 0;
    return h('li', { class: 'cand', 'data-seat': seat },
      h('div', { class: 'cand-top' },
        h('span', { class: 'rank', text: fmt.format(i + 1) }),
        h('span', { class: 'cand-name', text: c.name }),
        seat && h('span', { class: `badge ${seat}`, text: seat === 'main' ? 'منتخب اصلی' : 'علی‌البدل' }),
        h('span', { class: 'cand-votes' }, `${fmt.format(c.votes)} رأی · `, h('span', { class: 'pct', text: pct(p) }))),
      progress(p));
  });
  box.replaceChildren(h('ol', { class: 'ranking' }, rows));
}

function renderStatus(model, source) {
  const m = model.meta;
  $('#page-title').textContent = m.title;
  const pill = $('#status-pill');
  pill.textContent = m.status || 'نامشخص';
  pill.dataset.state = statusState(m.status);
  $('#end-time').textContent = m.endTime || '—';
  $('#updated').textContent = m.lastUpdate || '—';
  $('#source-note').textContent = source === 'live' ? 'منبع: Google Sheets' : 'منبع: نسخه پشتیبان';
  $('#fetched').textContent = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function render(model, source) {
  renderStatus(model, source);
  renderKpis(model);
  renderYears(model);
  renderCandidates(model);
}

/* =====================================================================
   ۷) دریافت داده و رفرش
   ===================================================================== */
let current = null;
let loading = false;
let lastOk = 0;

function showNotice(text) {
  const n = $('#notice');
  n.textContent = text || '';
  n.hidden = !text;
}

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CONFIG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function loadFallback() {
  const text = await fetchText(CONFIG.fallbackUrl);
  return modelFromJSON(JSON.parse(text));
}

async function refresh() {
  if (loading) return;
  loading = true;
  const btn = $('#refresh-btn');
  btn.disabled = true;
  btn.textContent = 'در حال به‌روزرسانی…';
  btn.setAttribute('aria-busy', 'true');

  try {
    const sep = CONFIG.csvUrl.includes('?') ? '&' : '?';
    const model = modelFromCSV(await fetchText(`${CONFIG.csvUrl}${sep}_=${Date.now()}`));
    if (isEmptyModel(model)) throw new Error('empty csv');
    current = model;
    lastOk = Date.now();
    render(model, 'live');
    showNotice('');
  } catch (err) {
    console.warn('CSV load failed:', err);
    if (current) {
      showNotice('به‌روزرسانی ناموفق بود؛ آخرین داده دریافت‌شده نمایش داده می‌شود.');
    } else {
      try {
        current = await loadFallback();
        render(current, 'fallback');
        showNotice('اتصال به منبع داده برقرار نشد؛ نسخه پشتیبان نمایش داده می‌شود.');
      } catch (e2) {
        console.error('Fallback load failed:', e2);
        showNotice('بارگذاری داده‌ها ممکن نیست. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.');
      }
    }
  } finally {
    loading = false;
    btn.disabled = false;
    btn.textContent = 'به‌روزرسانی دستی';
    btn.removeAttribute('aria-busy');
  }
}

function init() {
  $('#refresh-btn').addEventListener('click', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, CONFIG.refreshMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastOk > CONFIG.refreshMs) refresh();
  });
  refresh();
}

if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
