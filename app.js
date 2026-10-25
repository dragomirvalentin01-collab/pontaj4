// Supabase client initialization using bundled Supabase JS module
import { createClient } from './vendor/supabase.esm.js';

const SUPABASE_URL = 'https://nkqncfxmarlcwvzqzzbl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rcW5jZnhtYXJsY3d2enF6emJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjU5MTgsImV4cCI6MjEwNTg0MTkxOH0.leTOr62c4uuKy1R8FbeYTvtCMm6927tsFMzXdl7qbiI';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
const STATUS = { lucru: 'Lucru', concediu: 'Concediu', liber: 'Liber', medical: 'Medical' };
const STATUS_OK = ['lucru', 'concediu', 'liber', 'medical'];

function normStatus(t) {
  return STATUS_OK.includes(t) ? t : 'lucru';
}

let monday = getMonday(new Date());
let deferredPrompt = null;

const $ = (s) => document.querySelector(s);
const daysEl = $('#days');
const histEl = $('#history');

// Auth & Cloud state
let currentUser = null;
let authMode = 'signin';
let cloudSyncTimer = null;
let isCloudPulling = false;

// Date & Week utility functions
function getMonday(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekKey(dt) {
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const w = 1 + Math.round((d - firstThu) / (7 * 864e5));
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

function legacyWeekKey(dt) {
  const m = getMonday(dt);
  const y = m.getFullYear();
  const onejan = new Date(y, 0, 1);
  const w = Math.ceil(((m - onejan) / 864e5 + onejan.getDay() + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function fmtDate(d) {
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
}

function roDec(h) {
  return h.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h';
}

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );
}

function isWeekKey(k) {
  return /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(k || '');
}

function isTimeStr(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
}

function isPauseStr(p) {
  if (p == null || p === '') return true;
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 && n <= 600;
}

function toMin(t) {
  if (!isTimeStr(t)) return null;
  const [a, b] = t.split(':').map(Number);
  return a * 60 + b;
}

function sanitizeDay(v) {
  v = v && typeof v === 'object' ? v : {};
  const s = isTimeStr(v.s) ? v.s : '';
  const e = isTimeStr(v.e) ? v.e : '';
  const p = isPauseStr(v.p) ? (v.p == null ? '' : String(v.p)) : '';
  const t = STATUS_OK.includes(v.t) ? v.t : 'lucru';
  const n = typeof v.n === 'string' ? v.n.slice(0, 200) : '';
  return { s, p, e, t, n };
}

function calcDay(s, p, e, t) {
  if (t && t !== 'lucru') return 0;
  const a = toMin(s),
    b = toMin(e);
  if (a == null || b == null) return 0;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  const pause = parseInt(p || '0', 10);
  if (!Number.isFinite(pause) || pause < 0) return Math.max(0, d);
  return Math.max(0, d - Math.min(600, pause));
}

function hm(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// LocalStorage namespaced per cont
const LS_OWNER = 'pontaj:owner';
const K_THEME = 'pontaj:theme';

function lsScope() {
  return 'pontaj:' + (currentUser ? currentUser.id : 'local') + ':';
}

function kWeek(k) {
  return lsScope() + k;
}

function kTs(k) {
  return lsScope() + k + ':ts';
}

function kIndex() {
  return lsScope() + 'index';
}

function migrateLegacyScope() {
  if (!currentUser) return;
  const owner = localStorage.getItem(LS_OWNER);
  if (owner === currentUser.id || owner !== null) return;

  const legacy = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k.indexOf('pontaj:') !== 0) continue;
    if (k === LS_OWNER || k === K_THEME) continue;
    if (!isWeekKey(k.slice(7))) continue;
    legacy.push(k);
  }

  if (legacy.length) {
    const scope = lsScope();
    legacy.forEach((k) => {
      const wk = k.slice(7);
      localStorage.setItem(scope + wk, localStorage.getItem(k));
      localStorage.removeItem(k);
    });
    const oldIdx = localStorage.getItem('pontaj:index');
    if (oldIdx) {
      localStorage.setItem(scope + 'index', oldIdx);
      localStorage.removeItem('pontaj:index');
    }
  }
  localStorage.setItem(LS_OWNER, currentUser.id);
}

function loadWeek(k) {
  try {
    return JSON.parse(localStorage.getItem(kWeek(k))) || {};
  } catch {
    return {};
  }
}

let histT = null;
function scheduleHistory() {
  clearTimeout(histT);
  histT = setTimeout(() => {
    try {
      renderHistory();
    } catch {}
  }, 300);
}

function saveWeek() {
  const k = weekKey(monday);
  const data = {};
  document.querySelectorAll('.day').forEach((el, i) => {
    const raw = {
      s: el.querySelector('.in-s').value,
      p: el.querySelector('.in-p').value,
      e: el.querySelector('.in-e').value,
      t: el.dataset.status || 'lucru',
      n: el.querySelector('.in-n')?.value || '',
    };
    data[i] = sanitizeDay(raw);
  });
  localStorage.setItem(kWeek(k), JSON.stringify(data));
  localStorage.setItem(kTs(k), String(Date.now()));
  const idx = getIndex();
  if (!idx.includes(k)) {
    idx.push(k);
    idx.sort().reverse();
    localStorage.setItem(kIndex(), JSON.stringify(idx.slice(0, 52)));
  }
  scheduleHistory();
  scheduleCloudPush(k);
}

function getIndex() {
  try {
    return JSON.parse(localStorage.getItem(kIndex())) || [];
  } catch {
    return [];
  }
}

function showSaveToast() {
  const el = $('#save-toast');
  if (!el) return;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2000);
}

function setCloudDot(state, msg) {
  const el = $('#cloud-dot');
  if (!el) return;
  el.classList.remove('ok', 'sync', 'err');
  el.hidden = false;
  if (state === 'ok') {
    el.classList.add('ok');
    el.textContent = '✓';
    el.removeAttribute('title');
  } else if (state === 'sync') {
    el.classList.add('sync');
    el.textContent = '▶';
  } else if (state === 'err') {
    el.classList.add('err');
    el.textContent = '✗';
    if (msg) el.title = msg;
  } else {
    el.textContent = '✓';
  }
}

function scheduleCloudPush(k) {
  if (!currentUser) return;
  clearTimeout(cloudSyncTimer);
  setCloudDot('sync');
  cloudSyncTimer = setTimeout(() => cloudPushWeek(k), 700);
}

async function cloudPushWeek(k) {
  if (!currentUser) return;
  const data = loadWeek(k);
  const hasData = Object.values(data).some((v) => v.s || v.p || v.e || (v.t && v.t !== 'lucru'));
  try {
    if (!hasData) {
      const { error } = await supabase
        .from('pontaj_weeks')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('week_key', k);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('pontaj_weeks')
        .upsert({ user_id: currentUser.id, week_key: k, data }, { onConflict: 'user_id,week_key' });
      if (error) throw error;
    }
    setCloudDot('ok');
    showSaveToast();
  } catch (e) {
    console.warn('cloud push failed', e);
    setCloudDot('err', e.message || 'eroare');
  }
}

async function cloudDeleteWeek(k) {
  if (!currentUser) return;
  try {
    const { error } = await supabase
      .from('pontaj_weeks')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('week_key', k);
    if (error) throw error;
    setCloudDot('ok');
  } catch (e) {
    console.warn('cloud delete failed', e);
    setCloudDot('err', e.message);
  }
}

async function cloudPull() {
  if (!currentUser || isCloudPulling) return;
  isCloudPulling = true;
  setCloudDot('sync');
  try {
    const { data, error } = await supabase
      .from('pontaj_weeks')
      .select('week_key,data,updated_at')
      .order('week_key', { ascending: false })
      .limit(52);
    if (error) throw error;
    const idx = [];
    const pushLater = [];
    (data || []).forEach((row) => {
      if (!isWeekKey(row.week_key)) return;
      const k = row.week_key;
      const cloudTs = row.updated_at ? Date.parse(row.updated_at) : 0;
      const localTs = Number(localStorage.getItem(kTs(k)) || 0);
      const local = loadWeek(k);
      const localHas = Object.values(local).some(
        (v) => v && (v.s || v.p || v.e || (v.t && v.t !== 'lucru')),
      );
      if (localHas && localTs > cloudTs) {
        idx.push(k);
        pushLater.push(k);
        return;
      }
      try {
        const clean = {};
        Object.keys(row.data || {}).forEach((di) => {
          if (!/^[0-6]$/.test(di)) return;
          clean[di] = sanitizeDay(row.data[di]);
        });
        localStorage.setItem(kWeek(k), JSON.stringify(clean));
        if (cloudTs) localStorage.setItem(kTs(k), String(cloudTs));
        idx.push(k);
      } catch {}
    });
    pushLater.forEach((k) => cloudPushWeek(k));
    const localIdx = getIndex();
    localIdx.forEach((k) => {
      if (!idx.includes(k) && isWeekKey(k)) {
        const localData = loadWeek(k);
        const hasData = Object.values(localData).some(
          (v) => v.s || v.p || v.e || (v.t && v.t !== 'lucru'),
        );
        if (hasData && !idx.includes(k)) {
          cloudPushWeek(k);
          idx.push(k);
        }
      }
    });
    idx.sort().reverse();
    localStorage.setItem(kIndex(), JSON.stringify(idx.slice(0, 52)));
    setCloudDot('ok');
    render();
  } catch (e) {
    console.warn('cloud pull failed', e);
    setCloudDot('err', e.message);
    render();
  } finally {
    isCloudPulling = false;
  }
}

function render() {
  const m = new Date(monday);
  const end = new Date(m);
  end.setDate(end.getDate() + 6);
  const wr = $('#week-range');
  if (wr) wr.textContent = `${fmtDate(m)} – ${fmtDate(end)}`;
  const wkn = weekKey(monday);
  const wn = $('#week-num');
  if (wn) wn.textContent = 'Săptămâna ' + Number(wkn.split('-W')[1]);
  if (wr) {
    const off = wkn !== weekKey(new Date());
    wr.classList.toggle('back', off);
    if (off) wr.title = 'Înapoi la săptămâna curentă';
    else wr.removeAttribute('title');
  }
  const wk = weekKey(monday);
  const wl = $('#week-label');
  if (wl) wl.textContent = 'Săpt. ' + wk;

  try {
    if (!localStorage.getItem(kWeek(wk))) {
      const lk = legacyWeekKey(monday);
      if (lk !== wk) {
        const old = localStorage.getItem(kWeek(lk));
        if (old) {
          localStorage.setItem(kWeek(wk), old);
          localStorage.removeItem(kWeek(lk));
        }
      }
    }
  } catch {}

  const saved = loadWeek(wk);
  const todayStr = new Date().toDateString();
  if (!daysEl) return;
  daysEl.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const dt = new Date(m);
    dt.setDate(dt.getDate() + i);
    const v = sanitizeDay(saved[i]);
    const st = normStatus(v.t);
    const isWeekend = i >= 5;
    const card = document.createElement('div');
    card.className =
      'day st-' +
      st +
      (dt.toDateString() === todayStr ? ' today' : '') +
      (isWeekend ? ' is-weekend' : '');
    card.dataset.date = dt.toISOString().slice(0, 10);
    card.dataset.status = st;
    card.innerHTML = `
      <div class="day-head">
        <div><b>${DAYS[i]}</b> <span>${fmtDate(dt)}</span>${isWeekend ? ' <span class="weekend-badge">Weekend</span>' : ''}</div>
        <span class="day-total"></span>
      </div>
      <div class="status-row" role="group" aria-label="Status ${DAYS[i]}">
        ${STATUS_OK.map((k) => `<button type="button" class="st-btn${k === st ? ' on-' + k : ''}" data-st="${k}" aria-pressed="${k === st}">${k === 'lucru' ? '💼 ' : k === 'concediu' ? '🌿 ' : k === 'liber' ? '☀️ ' : '🏥 '}${STATUS[k]}</button>`).join('')}
      </div>
      <div class="time-wrap"${st !== 'lucru' ? ' hidden' : ''}>
        <div class="grid3">
          <label>🕐 Început<input type="text" inputmode="none" readonly placeholder="--:--" class="in-s" aria-haspopup="dialog" value="${esc(v.s)}"></label>
          <label>⏸️ Pauză (min)<input type="number" class="in-p" min="0" max="600" step="5" inputmode="numeric" value="${esc(v.p)}" placeholder="30"></label>
          <label>🏁 Sfârșit<input type="text" inputmode="none" readonly placeholder="--:--" class="in-e" aria-haspopup="dialog" value="${esc(v.e)}"></label>
        </div>
        <div class="chips-row" style="display:flex;justify-space-between;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">
          <div class="chips">${[0, 15, 30, 45, 60].map((x) => `<button type="button" class="chip" data-p="${x}" aria-pressed="${String(v.p || '') === String(x)}">${x}</button>`).join('')}</div>
          <div class="presets" style="display:flex;gap:4px">
            <button type="button" class="btn small ghost btn-preset" data-s="08:00" data-e="16:30" data-p="30" title="Setează 08:00 - 16:30">08-16:30</button>
            <button type="button" class="btn small ghost btn-preset" data-s="09:00" data-e="17:30" data-p="30" title="Setează 09:00 - 17:30">09-17:30</button>
          </div>
        </div>
        <div style="margin-top:8px">
          <input type="text" class="in-n" placeholder="📝 Note / Proiect (opțional)" value="${esc(v.n || '')}" maxlength="200" style="font-size:13px;padding:8px 10px">
        </div>
      </div>
    `;
    daysEl.appendChild(card);
  }

  daysEl.querySelectorAll('.st-btn').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const card = b.closest('.day');
      const st = b.dataset.st;
      card.dataset.status = st;
      card.classList.remove('st-lucru', 'st-concediu', 'st-liber', 'st-medical');
      card.classList.add('st-' + st);
      card.querySelectorAll('.st-btn').forEach((x) => {
        const on = x.dataset.st === st;
        x.classList.remove('on-lucru', 'on-concediu', 'on-liber', 'on-medical');
        if (on) x.classList.add('on-' + st);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const tw = card.querySelector('.time-wrap');
      if (tw) tw.hidden = st !== 'lucru';
      recalc();
      saveWeek();
    }),
  );

  daysEl.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', () => {
      recalc();
      saveWeek();
    }),
  );

  daysEl.querySelectorAll('.in-s,.in-e').forEach((inp) => {
    inp.addEventListener('click', () => openClock(inp));
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openClock(inp);
      }
    });
  });

  daysEl.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', (ev) => {
      ev.preventDefault();
      const card = c.closest('.day');
      card.querySelector('.in-p').value = c.dataset.p;
      recalc();
      saveWeek();
    }),
  );

  daysEl.querySelectorAll('.btn-preset').forEach((bp) =>
    bp.addEventListener('click', (ev) => {
      ev.preventDefault();
      const card = bp.closest('.day');
      card.querySelector('.in-s').value = bp.dataset.s;
      card.querySelector('.in-e').value = bp.dataset.e;
      card.querySelector('.in-p').value = bp.dataset.p;
      recalc();
      saveWeek();
    }),
  );

  recalc();
  renderHistory();
}

function recalc() {
  let total = 0,
    days = 0;
  document.querySelectorAll('.day').forEach((card) => {
    const st = normStatus(card.dataset.status);
    const s = card.querySelector('.in-s').value;
    const p = card.querySelector('.in-p').value;
    const e = card.querySelector('.in-e').value;
    const min = calcDay(s, p, e, st);
    total += min;
    if (min > 0) days++;
    const out = card.querySelector('.day-total');
    out.classList.toggle('bare', st !== 'lucru');
    if (st !== 'lucru') {
      out.innerHTML = `<span class="day-badge b-${st}">${STATUS[st]}</span>`;
    } else {
      out.textContent = min > 0 ? `${roDec(min / 60)} (${hm(min)})` : '—';
    }
    card.querySelectorAll('.chip').forEach((c) => {
      const on = String(p || '') === c.dataset.p;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });

  const td = $('#total-dec');
  if (td) td.textContent = roDec(total / 60);
  const th = $('#total-hm');
  if (th) th.textContent = `${days} ${days === 1 ? 'zi lucrată' : 'zile lucrate'}`;

  updateProgress(total);
}

// Target saptamanal & progress
const K_TARGET = 'pontaj:target';
const DEFAULT_TARGET = 38;

function getTarget() {
  try {
    const v = parseFloat(localStorage.getItem(K_TARGET));
    if (Number.isFinite(v) && v > 0 && v <= 80) return v;
  } catch {}
  return DEFAULT_TARGET;
}

function setTarget(h) {
  localStorage.setItem(K_TARGET, String(h));
}

function updateProgress(totalMin) {
  const fill = $('#progress-fill');
  if (!fill) return;
  const targetMin = getTarget() * 60;
  const scale = Math.max(totalMin, targetMin, 1);
  const inTarget = Math.min(totalMin, targetMin);
  const over = Math.max(0, totalMin - targetMin);

  fill.style.width = (inTarget / scale) * 100 + '%';
  fill.classList.toggle('complete', totalMin >= targetMin && over <= 0);
  fill.classList.toggle('over', over > 0);

  const ot = $('#progress-ot');
  if (ot) {
    ot.style.width = (over / scale) * 100 + '%';
    ot.classList.toggle('warn', over > targetMin * 0.2);
  }

  const label = $('#progress-label');
  if (label) label.textContent = roDec(totalMin / 60) + ' / ' + getTarget() + ' h';

  const badge = $('#ot-badge');
  if (badge) {
    badge.hidden = over <= 0;
    if (over > 0) badge.textContent = '+' + roDec(over / 60) + ' 🔥';
  }

  const st = $('#total-status');
  if (st) {
    const r = targetMin > 0 ? totalMin / targetMin : 0;
    st.textContent = totalMin <= 0 ? '' : r < 0.5 ? '🌱' : r < 1 ? '💪' : over > 0 ? '🔥' : '✅';
  }
}

function renderHistory() {
  if (!histEl) return;
  const idx = getIndex().filter(isWeekKey);
  histEl.innerHTML = idx.length ? '' : '<li class="muted">Nicio săptămână salvată încă.</li>';
  idx.slice(0, 12).forEach((k) => {
    let tot = 0;
    const d = loadWeek(k);
    Object.values(d).forEach((raw) => {
      const v = sanitizeDay(raw);
      tot += calcDay(v.s, v.p, v.e, v.t);
    });
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = k;
    const sub = document.createElement('span');
    sub.className = 'muted';
    sub.textContent = `${roDec(tot / 60)} • ${hm(tot)}`;
    const left = document.createElement('span');
    left.append(b, document.createElement('br'), sub);

    const open = document.createElement('button');
    open.className = 'btn small';
    open.textContent = 'Deschide';
    open.setAttribute('aria-label', 'Deschide săptămâna ' + k);
    open.onclick = () => {
      const [y, w] = k.split('-W');
      monday = mondayFromWeek(+y, +w);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Șterge săptămâna ' + k);
    del.onclick = async () => {
      if (!confirm('Ștergi ' + k + '?')) return;
      localStorage.removeItem(kWeek(k));
      localStorage.removeItem(kTs(k));
      localStorage.setItem(kIndex(), JSON.stringify(getIndex().filter((x) => x !== k)));
      await cloudDeleteWeek(k);
      renderHistory();
      recalc();
      if (weekKey(monday) === k) render();
    };

    const right = document.createElement('span');
    right.append(open, ' ', del);
    li.append(left, right);
    histEl.appendChild(li);
  });
}

function mondayFromWeek(y, w) {
  const jan4 = new Date(y, 0, 4);
  const d = getMonday(jan4);
  d.setDate(d.getDate() + (w - 1) * 7);
  return d;
}

// Main Actions & Handlers
$('#btn-prev') &&
  ($('#btn-prev').onclick = () => {
    monday.setDate(monday.getDate() - 7);
    render();
  });

$('#btn-next') &&
  ($('#btn-next').onclick = () => {
    monday.setDate(monday.getDate() + 7);
    render();
  });

$('#week-range') &&
  ($('#week-range').onclick = () => {
    const now = getMonday(new Date());
    if (weekKey(now) !== weekKey(monday)) {
      monday = now;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

$('#btn-quick-fill') &&
  ($('#btn-quick-fill').onclick = () => {
    const cards = document.querySelectorAll('.day');
    for (let i = 0; i < 5; i++) {
      const card = cards[i];
      if (!card) continue;
      card.dataset.status = 'lucru';
      card.classList.remove('st-lucru', 'st-concediu', 'st-liber', 'st-medical');
      card.classList.add('st-lucru');
      card.querySelectorAll('.st-btn').forEach((x) => {
        const on = x.dataset.st === 'lucru';
        x.classList.remove('on-lucru', 'on-concediu', 'on-liber', 'on-medical');
        if (on) x.classList.add('on-lucru');
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const tw = card.querySelector('.time-wrap');
      if (tw) tw.hidden = false;
      card.querySelector('.in-s').value = '08:00';
      card.querySelector('.in-e').value = '16:30';
      card.querySelector('.in-p').value = '30';
    }
    recalc();
    saveWeek();
  });

$('#btn-edit-target') &&
  ($('#btn-edit-target').onclick = () => {
    const cur = getTarget();
    const val = prompt('Introdu ținta săptămânală de ore (ex: 38 sau 40):', cur);
    if (val !== null) {
      const num = parseFloat(val.replace(',', '.'));
      if (Number.isFinite(num) && num > 0 && num <= 80) {
        setTarget(num);
        recalc();
      } else {
        alert('Te rugăm să introduci un număr valid între 1 și 80.');
      }
    }
  });

$('#btn-csv') &&
  ($('#btn-csv').onclick = () => {
    const m = new Date(monday);
    let csv = 'Zi,Data,Status,Inceput,Pauza_min,Sfarsit,Ore,Note\n';
    for (let i = 0; i < 7; i++) {
      const card = document.querySelectorAll('.day')[i];
      const raw = {
        s: card.querySelector('.in-s').value,
        p: card.querySelector('.in-p').value,
        e: card.querySelector('.in-e').value,
        t: card.dataset.status || 'lucru',
        n: card.querySelector('.in-n')?.value || '',
      };
      const v = sanitizeDay(raw);
      const st = normStatus(v.t);
      const min = calcDay(v.s, v.p, v.e, st);
      const dt = new Date(m);
      dt.setDate(dt.getDate() + i);
      const dateStr = dt.toISOString().slice(0, 10);
      const hoursStr = (min / 60).toFixed(2).replace('.', ',');
      const noteEsc = `"${(v.n || '').replace(/"/g, '""')}"`;
      csv += `"${DAYS[i]}","${dateStr}","${STATUS[st]}","${v.s}","${v.p}","${v.e}","${hoursStr}",${noteEsc}\n`;
    }
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Pontaj_${weekKey(monday)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

$('#btn-monthly') &&
  ($('#btn-monthly').onclick = () => {
    const dlg = $('#dlg-monthly');
    const cnt = $('#monthly-content');
    if (!dlg || !cnt) return;

    const idx = getIndex().filter(isWeekKey);
    let totalMin = 0,
      workDays = 0,
      leaveDays = 0,
      medicalDays = 0,
      freeDays = 0;

    idx.forEach((k) => {
      const d = loadWeek(k);
      Object.values(d).forEach((raw) => {
        const v = sanitizeDay(raw);
        const min = calcDay(v.s, v.p, v.e, v.t);
        if (v.t === 'lucru' && min > 0) {
          totalMin += min;
          workDays++;
        } else if (v.t === 'concediu') leaveDays++;
        else if (v.t === 'medical') medicalDays++;
        else if (v.t === 'liber') freeDays++;
      });
    });

    const totalHours = (totalMin / 60).toFixed(2).replace('.', ',');
    cnt.innerHTML = `
    <div style="display:grid;gap:12px">
      <p style="margin:0"><b>Istoric înregistrat:</b> ${idx.length} săptămâni salvate</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--bg);padding:12px;border-radius:12px;border:1px solid var(--line)">
          <div class="muted small">Total ore lucrate</div>
          <div style="font-size:22px;font-weight:800;color:var(--acc);margin-top:4px">${totalHours} h</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:12px;border:1px solid var(--line)">
          <div class="muted small">Zile lucrate</div>
          <div style="font-size:22px;font-weight:800;color:var(--ok);margin-top:4px">${workDays} zile</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:12px;border:1px solid var(--line)">
          <div class="muted small">Concediu / Liber</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">🌿 ${leaveDays} • ☀️ ${freeDays}</div>
        </div>
        <div style="background:var(--bg);padding:12px;border-radius:12px;border:1px solid var(--line)">
          <div class="muted small">Concediu Medical</div>
          <div style="font-size:18px;font-weight:700;color:var(--err);margin-top:4px">🏥 ${medicalDays} zile</div>
        </div>
      </div>
      <p class="muted small" style="margin-top:4px">Sinteza calculează toate datele pontate din contul tău.</p>
    </div>
  `;
    if (typeof dlg.showModal === 'function') dlg.showModal();
  });

$('#btn-close-monthly') &&
  ($('#btn-close-monthly').onclick = () => {
    const dlg = $('#dlg-monthly');
    if (dlg && typeof dlg.close === 'function') dlg.close();
  });

$('#btn-print') &&
  ($('#btn-print').onclick = () => {
    const m = new Date(monday);
    let rows = '',
      tot = 0;
    for (let i = 0; i < 7; i++) {
      const card = document.querySelectorAll('.day')[i];
      const raw = {
        s: card.querySelector('.in-s').value,
        p: card.querySelector('.in-p').value,
        e: card.querySelector('.in-e').value,
        t: card.dataset.status || 'lucru',
        n: card.querySelector('.in-n')?.value || '',
      };
      const v = sanitizeDay(raw);
      const st = normStatus(v.t);
      const s = st !== 'lucru' ? '—' : v.s || '—';
      const p = st !== 'lucru' ? '—' : (v.p || '0') + ' min';
      const e = st !== 'lucru' ? '—' : v.e || '—';
      const min = calcDay(v.s, v.p, v.e, st);
      tot += min;
      const dt = new Date(m);
      dt.setDate(dt.getDate() + i);
      const noteText = v.n ? `<br><small style="color:#666">📝 ${esc(v.n)}</small>` : '';
      rows += `<tr><td>${esc(DAYS[i])} ${esc(fmtDate(dt))}${noteText}</td><td>${esc(STATUS[st])}</td><td>${esc(s)}</td><td>${esc(p)}</td><td>${esc(e)}</td><td>${min > 0 ? esc(roDec(min / 60) + ' (' + hm(min) + ')') : '—'}</td></tr>`;
    }
    const email = currentUser && currentUser.email ? esc(currentUser.email) : '';
    $('#print-area').innerHTML =
      `<h1>Pontaj ${esc(weekKey(monday))} — ${esc($('#week-range').textContent)}</h1>${email ? `<p>Angajat: <b>${email}</b></p>` : ''}<p>Total lucrat: <b>${esc(roDec(tot / 60) + ' (' + hm(tot) + ')')}</b></p><table><tr><th>Zi</th><th>Status</th><th>Început</th><th>Pauză</th><th>Sfârșit</th><th>Total</th></tr>${rows}</table>`;
    window.print();
  });

// Theme picker
const THEMES = ['dark', 'light', 'ocean', 'forest', 'berry', 'sunset', 'midnight'];

function setTheme(t) {
  if (!THEMES.includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem(K_THEME, t);
  const mt = $('#meta-theme');
  if (mt) {
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--bg').trim();
    if (bg) mt.content = bg;
  }
  document.querySelectorAll('.theme-opt').forEach((btn) => {
    const active = btn.dataset.theme === t;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const iconMap = {
    dark: '🌙',
    light: '☀️',
    ocean: '🌊',
    forest: '🌲',
    berry: '🍇',
    sunset: '🌅',
    midnight: '🖤',
  };
  const main = $('#btn-theme-pick');
  if (main) main.textContent = iconMap[t] || '🎨';
}

(function themePicker() {
  const pick = $('#btn-theme-pick');
  const dd = $('#theme-dropdown');
  if (pick && dd) {
    pick.addEventListener('click', (ev) => {
      ev.stopPropagation();
      dd.hidden = !dd.hidden;
    });
  }
  document.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setTheme(btn.dataset.theme);
      if (dd) dd.hidden = true;
    });
  });
  document.addEventListener('click', (e) => {
    if (dd && !dd.hidden && !e.target.closest('.theme-picker')) dd.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dd) dd.hidden = true;
  });
})();
setTheme(
  localStorage.getItem(K_THEME) ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
);

// PWA Install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $('#btn-install');
  if (b) b.hidden = false;
});

$('#btn-install') &&
  ($('#btn-install').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  });

// Service Worker Update Check
(function swUpdate() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  function showToast(reg) {
    const toast = $('#sw-toast');
    if (!toast || !reg || !reg.waiting) return;
    toast.hidden = false;
    $('#sw-reload').onclick = () => {
      toast.hidden = true;
      let done = false;
      const force = () => {
        if (done) return;
        done = true;
        window.location.reload();
      };
      try {
        const w = reg.waiting || reg.installing;
        if (w) {
          try {
            w.postMessage('SKIP_WAITING');
          } catch {}
        }
      } catch {}
      setTimeout(force, 1500);
    };
  }
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      if (!reg) return;
      if (reg.waiting) showToast(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showToast(reg);
        });
      });
    })
    .catch(() => {});
})();

// Analog Clock Picker
let ckTarget = null,
  ckH = 8,
  ckM = 0,
  ckMode = 'h',
  ckReturnFocus = null;
const ckPad = (n) => String(n).padStart(2, '0');

function ckClose(returnFocus) {
  try {
    $('#dlg-clock').close();
  } catch {}
  if (returnFocus !== false && ckReturnFocus && document.contains(ckReturnFocus)) {
    try {
      ckReturnFocus.focus();
    } catch {}
  }
  ckReturnFocus = null;
}

function openClock(inp) {
  ckTarget = inp;
  ckReturnFocus = document.activeElement;
  const m = (inp.value || '').match(/^(\d{1,2}):(\d{2})$/);
  const now = new Date();
  ckH = m ? Math.min(23, +m[1]) : now.getHours();
  ckM = m ? Math.min(59, +m[2]) : (Math.round(now.getMinutes() / 5) * 5) % 60;
  if (!Number.isFinite(ckH)) ckH = now.getHours();
  if (!Number.isFinite(ckM)) ckM = 0;
  ckMode = 'h';
  ckDraw();
  const d = $('#dlg-clock');
  if (d && typeof d.showModal === 'function') {
    d.showModal();
    try {
      $('#ck-ok').focus();
    } catch {}
  }
}

function ckNum(x, y, label, sel, kind) {
  const aria = kind === 'h' ? 'Ora ' + label : 'Minutul ' + label;
  return `<g class="ck-tap" data-v="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}"><circle cx="${x}" cy="${y}" r="17" class="${sel ? 'ck-sel' : ''}"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="${sel ? 'ck-selt' : ''}">${esc(label)}</text></g>`;
}

function ckHand(ang, r) {
  const x2 = 130 + Math.cos(ang) * r;
  const y2 = 130 + Math.sin(ang) * r;
  return `<line x1="130" y1="130" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="ck-hand"/><circle cx="130" cy="130" r="5" class="ck-handdot"/>`;
}

function ckDraw() {
  const ch = $('#ck-h');
  if (ch) ch.textContent = ckPad(ckH);
  const cm = $('#ck-m');
  if (cm) cm.textContent = ckPad(ckM);
  if (ch) ch.classList.toggle('on', ckMode === 'h');
  if (cm) cm.classList.toggle('on', ckMode === 'm');
  const fine = $('#ck-fine');
  if (fine) fine.hidden = ckMode !== 'm';
  const cx = 130,
    cy = 130;
  let h = '<circle cx="130" cy="130" r="124" class="ck-bg"/>';

  if (ckMode === 'h') {
    const outer = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    const inner = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      h += ckNum(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96, outer[i], ckH === outer[i], 'h');
      h += ckNum(cx + Math.cos(a) * 58, cy + Math.sin(a) * 58, inner[i], ckH === inner[i], 'h');
    }
    const oi = outer.indexOf(ckH);
    const inr = oi < 0;
    const pos = inr ? inner.indexOf(ckH) : oi;
    h += ckHand((pos / 12) * Math.PI * 2 - Math.PI / 2, inr ? 58 : 96);
  } else {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      h += ckNum(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96, ckPad(i * 5), ckM === i * 5, 'm');
    }
    h += ckHand((ckM / 60) * Math.PI * 2 - Math.PI / 2, 96);
  }
  const face = $('#ck-face');
  if (face) face.innerHTML = h;
}

function ckPick(v) {
  if (ckMode === 'h') {
    ckH = +v % 24;
    ckMode = 'm';
  } else {
    ckM = +v % 60;
  }
  ckDraw();
  try {
    const sel = $('#ck-face .ck-tap[tabindex]');
    if (sel) sel.focus();
  } catch {}
}

$('#ck-face') &&
  $('#ck-face').addEventListener('click', (ev) => {
    const g = ev.target.closest('.ck-tap');
    if (!g) return;
    ckPick(g.dataset.v);
  });

$('#ck-face') &&
  $('#ck-face').addEventListener('keydown', (ev) => {
    const g = ev.target.closest('.ck-tap');
    if (!g) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ckPick(g.dataset.v);
    }
  });

$('#ck-h') &&
  ($('#ck-h').onclick = () => {
    ckMode = 'h';
    ckDraw();
  });
$('#ck-h') &&
  $('#ck-h').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ckMode = 'h';
      ckDraw();
    }
  });
$('#ck-m') &&
  ($('#ck-m').onclick = () => {
    ckMode = 'm';
    ckDraw();
  });
$('#ck-m') &&
  $('#ck-m').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ckMode = 'm';
      ckDraw();
    }
  });
$('#ck-dec') &&
  ($('#ck-dec').onclick = () => {
    ckM = (ckM + 59) % 60;
    ckDraw();
  });
$('#ck-inc') &&
  ($('#ck-inc').onclick = () => {
    ckM = (ckM + 1) % 60;
    ckDraw();
  });
$('#ck-cancel') && ($('#ck-cancel').onclick = () => ckClose(true));
$('#ck-clear') &&
  ($('#ck-clear').onclick = () => {
    if (ckTarget) {
      ckTarget.value = '';
      ckTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ckClose(true);
  });
$('#ck-ok') &&
  ($('#ck-ok').onclick = () => {
    if (ckTarget) {
      ckTarget.value = ckPad(ckH) + ':' + ckPad(ckM);
      ckTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ckClose(true);
  });

try {
  $('#dlg-clock') &&
    $('#dlg-clock').addEventListener('close', () => {
      if (ckReturnFocus && document.contains(ckReturnFocus)) {
        try {
          ckReturnFocus.focus();
        } catch {}
      }
      ckReturnFocus = null;
    });
} catch {}

// Auth UI & Handlers
function setAuthError(msg) {
  const el = $('#auth-error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function updateAuthTabs() {
  $('#tab-signin') && $('#tab-signin').classList.toggle('on', authMode === 'signin');
  $('#tab-signup') && $('#tab-signup').classList.toggle('on', authMode === 'signup');
  const btn = $('#btn-auth');
  if (btn) btn.textContent = authMode === 'signup' ? 'Creează cont' : 'Intră în cont';
}

$('#tab-signin') &&
  ($('#tab-signin').onclick = () => {
    authMode = 'signin';
    updateAuthTabs();
    setAuthError('');
  });
$('#tab-signup') &&
  ($('#tab-signup').onclick = () => {
    authMode = 'signup';
    updateAuthTabs();
    setAuthError('');
  });

$('#form-auth') &&
  $('#form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
    const email = $('#auth-email')?.value.trim();
    const pass = $('#auth-pass')?.value;
    if (!email || !pass) return setAuthError('Completează emailul și parola.');
    if (pass.length < 6) return setAuthError('Parola trebuie să aibă minim 6 caractere.');
    const btn = $('#btn-auth');
    const orig = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Se procesează…';
    }

    try {
      let res;
      if (authMode === 'signup') {
        res = await supabase.auth.signUp({ email, password: pass });
        if (res.error) throw res.error;
        if (!res.data.session) {
          setAuthError('Cont creat! Verifică emailul dacă e nevoie, apoi intră în cont.');
          authMode = 'signin';
          updateAuthTabs();
          return;
        }
      } else {
        res = await supabase.auth.signInWithPassword({ email, password: pass });
        if (res.error) throw res.error;
      }
    } catch (err) {
      setAuthError(err.message || 'Eroare la autentificare');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
    }
  });

$('#btn-google') &&
  $('#btn-google').addEventListener('click', async () => {
    setAuthError('');
    const btn = $('#btn-google');
    if (btn) btn.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
    } catch (err) {
      setAuthError(
        err.message ||
          'Google login indisponibil. Activează providerul Google în Supabase Dashboard → Authentication → Providers.',
      );
      if (btn) btn.disabled = false;
    }
  });

$('#btn-logout') &&
  $('#btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

function showAuthView() {
  const a = $('#auth-card'),
    c = $('#app-content'),
    l = $('#auth-loading'),
    ub = $('#user-bar');
  if (a) a.hidden = false;
  if (c) c.hidden = true;
  if (l) l.hidden = true;
  if (ub) ub.hidden = true;
}

function showAppView(user) {
  const a = $('#auth-card'),
    c = $('#app-content'),
    l = $('#auth-loading'),
    ub = $('#user-bar'),
    ue = $('#user-email');
  if (a) a.hidden = true;
  if (c) c.hidden = false;
  if (l) l.hidden = true;
  if (ub) ub.hidden = false;
  if (ue) ue.textContent = user?.email || '';
  const av = $('#user-avatar');
  if (av) av.textContent = ((user?.email || '?').trim().charAt(0) || '?').toUpperCase();
}

async function handleOAuthCode() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (code) {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (error) {
        console.warn('exchangeCode error', error);
        setAuthError(error.message || 'Autentificarea Google a eșuat.');
      }
      url.searchParams.delete('code');
      window.history.replaceState(
        {},
        document.title,
        url.pathname + url.search + window.location.hash,
      );
    } catch (e) {
      console.warn('exchange failed', e);
      setAuthError(e.message || 'Autentificarea Google a eșuat.');
    }
  }
}

async function initAuth() {
  updateAuthTabs();

  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      handleAuthEvent(event, session);
    }, 0);
  });

  const url = new URL(window.location.href);
  const oErr = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (oErr && !url.searchParams.get('code')) {
    showAuthView();
    try {
      setAuthError('Loginul a eșuat: ' + decodeURIComponent(String(oErr).replace(/\+/g, ' ')));
    } catch {
      setAuthError('Loginul a eșuat. Încearcă din nou.');
    }
    try {
      url.searchParams.delete('error');
      url.searchParams.delete('error_code');
      url.searchParams.delete('error_description');
      window.history.replaceState(
        {},
        document.title,
        url.pathname + url.search + window.location.hash,
      );
    } catch {}
    return;
  }

  if (url.searchParams.get('code')) {
    await handleOAuthCode();
    try {
      const { data } = await supabase.auth.getSession();
      currentUser = data.session?.user || null;
      if (!currentUser) {
        showAuthView();
        return;
      }
      migrateLegacyScope();
      await new Promise((r) => setTimeout(r, 500));
      const c = $('#app-content');
      if (c && c.hidden) {
        showAppView(currentUser);
        await cloudPull();
      }
    } catch {
      showAuthView();
    }
    return;
  }

  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  if (currentUser) {
    migrateLegacyScope();
    showAppView(currentUser);
    await cloudPull();
  } else {
    showAuthView();
  }
}

async function handleAuthEvent(event, session) {
  const prevId = currentUser ? currentUser.id : null;
  currentUser = session?.user || null;
  if (currentUser) {
    if (currentUser.id !== prevId) migrateLegacyScope();
    showAppView(currentUser);
    await cloudPull();
  } else {
    monday = getMonday(new Date());
    try {
      render();
    } catch {}
    showAuthView();
  }
}

initAuth();

setTimeout(() => {
  const l = $('#auth-loading');
  if (l && !l.hidden && !currentUser) showAuthView();
}, 3000);
