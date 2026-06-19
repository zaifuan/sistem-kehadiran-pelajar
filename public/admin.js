'use strict';

/* ============================================================
   Dashboard Admin (Fasa 6 + polish Fasa 8.4) — read-only.
   Seksyen: Hari Ini · Belum Isi · Tidak Hadir · Rekod Lepas ·
   Peratus (mingguan/bulanan, formula GAS disahkan) · Kelas & Pelajar.
   Semua data via /api/admin/* (PostgreSQL sahaja, dilindungi auth).
   ============================================================ */

// ── Util (selaras dengan guru.js) ──
const $ = (s) => document.querySelector(s);
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function fetchJSON(url, opts) {
  const res = await fetch(url, { credentials: 'include', ...(opts || {}) });
  if (res.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname);
    throw new Error('Perlu log masuk');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.ralat || ('HTTP ' + res.status));
  return data;
}
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
function localIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtPct(p) { return p == null ? '—' : (Math.round(p * 100) / 100).toFixed(2); }
function pctClass(p) { return p == null ? 'none' : p >= 95 ? 'ok' : p >= 85 ? 'warn' : 'bad'; }
function isStam(kod) { return String(kod || '').indexOf('STAM') === 0; }

// ── Kumpulan tingkatan (Fasa 8.4.2): heading + susunan T1→T5→STAM ──
// Backend telah mengisih ikut kumpulan; frontend hanya menyisip heading bila
// nilai tingkatan bertukar. Item dijangka ada medan `tingkatan`.
const TINGKATAN_LABEL = { T1: 'TINGKATAN 1', T2: 'TINGKATAN 2', T3: 'TINGKATAN 3', T4: 'TINGKATAN 4', T5: 'TINGKATAN 5', STAM: 'STAM' };
function tingkatanLabel(t) { return TINGKATAN_LABEL[t] || (t ? String(t).toUpperCase() : 'LAIN-LAIN'); }
function renderByTingkatan(list, renderItem) {
  let html = '', last = '\u0000';
  for (const it of (list || [])) {
    const t = it.tingkatan || '';
    if (t !== last) { html += `<div class="grp-head">${esc(tingkatanLabel(t))}</div>`; last = t; }
    html += renderItem(it);
  }
  return html;
}

const TABS = ['harian', 'belum', 'tidakhadir', 'rekod', 'peratus', 'kelas'];
const state = {
  tab: 'harian',
  kelasOptDimuat: false,
  loaded: {},
  today: { records: null },
};

// ── Navigasi tab ──
function showTab(name) {
  state.tab = name;
  TABS.forEach((t) => { $('#tab-' + t).hidden = t !== name; });
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  if (!state.loaded[name]) { state.loaded[name] = true; initTab(name); }
  window.scrollTo(0, 0);
}
function initTab(name) {
  if (name === 'belum') loadBelum();
  else if (name === 'tidakhadir') loadTidakHadir();
  else if (name === 'rekod') initRekod();
  else if (name === 'peratus') initPeratus();
  else if (name === 'kelas') loadKelas();
}

// Rekod hari ini (dikongsi: Hari Ini + Tidak Hadir) — ambil sekali, cache.
async function getTodayRecords(force) {
  if (state.today.records && !force) return state.today.records;
  const d = await fetchJSON('/api/admin/records'); // tarikh default = hari ini (server KL)
  state.today.records = d;
  return d;
}

// Senarai kelas untuk dropdown (Rekod Lepas + Peratus) — sekali sahaja.
async function muatKelasOptions() {
  if (state.kelasOptDimuat) return;
  try {
    const d = await fetchJSON('/api/admin/classes');
    let opts = '', lastT = '\u0000';
    for (const k of (d.kelas || [])) {
      const t = k.tingkatan || '';
      if (t !== lastT) {
        if (lastT !== '\u0000') opts += '</optgroup>';
        opts += `<optgroup label="${esc(tingkatanLabel(t))}">`;
        lastT = t;
      }
      opts += `<option value="${esc(k.kod)}">${esc(k.kod)} — ${esc(k.nama || k.kod)}</option>`;
    }
    if (lastT !== '\u0000') opts += '</optgroup>';
    ['#f-kelas', '#p-kelas'].forEach((sel) => { const el = $(sel); if (el) el.insertAdjacentHTML('beforeend', opts); });
    state.kelasOptDimuat = true;
  } catch (_) { /* dropdown kekal "Semua/Sekolah" sahaja jika gagal */ }
}

// ════════════════════════════════════════════════════════════
//  1) HARI INI — hero + statistik + kelas sudah isi
// ════════════════════════════════════════════════════════════
async function loadHariIni() {
  const hero = $('#hero'), grid = $('#stat-grid'), sudah = $('#sudah-body');
  hero.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan ringkasan…</div>';
  grid.hidden = true;
  sudah.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const [s, rec] = await Promise.all([fetchJSON('/api/admin/today-summary'), getTodayRecords(true)]);
    $('#tarikh-strip').textContent = '📅 ' + s.tarikh;
    if (s.tarikh_iso && !$('#f-tarikh').value) $('#f-tarikh').value = s.tarikh_iso;
    renderHero(s);
    renderStats(s);
    renderSudah(rec);
  } catch (err) {
    hero.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
    sudah.innerHTML = '';
    toast('Gagal memuatkan ringkasan', 'bad');
  }
}

function renderHero(s) {
  const jum = s.jumlah_kelas || 0, sudah = s.kelas_sudah_isi || 0;
  const progPct = jum > 0 ? Math.round((sudah / jum) * 100) : 0;
  const pct = fmtPct(s.peratus_kehadiran);
  const sub = s.peratus_kehadiran == null
    ? 'Belum ada kelas mengisi kehadiran'
    : `${s.jumlah_hadir} hadir / ${s.pelajar_direkod_hari_ini} pelajar direkod`;
  $('#hero').innerHTML = `
    <div class="hero-top"><span class="hero-label">Peratus Kehadiran Hari Ini</span></div>
    <div class="hero-pct num">${pct}${s.peratus_kehadiran == null ? '' : '<small>%</small>'}</div>
    <div class="hero-sub">${esc(sub)}</div>
    <div class="hero-bar"><i style="width:${progPct}%"></i></div>
    <div class="hero-prog"><span>Kelas sudah isi</span><span class="num"><b>${sudah}</b> / ${jum}</span></div>`;
}

function renderStats(s) {
  const cards = [
    { v: s.jumlah_kelas, l: 'Jumlah Kelas', c: '' },
    { v: s.kelas_sudah_isi, l: 'Sudah Isi', c: 'ok' },
    { v: s.kelas_belum_isi, l: 'Belum Isi', c: s.kelas_belum_isi > 0 ? 'warn' : 'ok' },
    { v: s.jumlah_pelajar, l: 'Jumlah Pelajar', c: '' },
    { v: s.jumlah_hadir, l: 'Hadir', c: 'ok' },
    { v: s.jumlah_tidak_hadir, l: 'Tidak Hadir', c: s.jumlah_tidak_hadir > 0 ? 'bad' : '' },
    { v: s.jumlah_wakil, l: 'Wakil Sekolah', c: 'wk' },
    { v: fmtPct(s.peratus_kehadiran) + (s.peratus_kehadiran == null ? '' : '%'), l: 'Peratus', c: 'ok' },
  ];
  $('#stat-grid').innerHTML = cards
    .map((c) => `<div class="stat ${c.c}"><b class="num">${c.v == null ? '—' : c.v}</b><span>${esc(c.l)}</span></div>`).join('');
  $('#stat-grid').hidden = false;
}

function renderSudah(rec) {
  const box = $('#sudah-body'), kira = $('#sudah-kira');
  const list = (rec && rec.rekod) || [];
  if (!list.length) {
    kira.hidden = true;
    box.innerHTML = '<div class="empty">Belum ada kelas mengisi kehadiran hari ini.</div>';
    return;
  }
  kira.hidden = false; kira.textContent = list.length;
  box.innerHTML = renderByTingkatan(list, renderRekodKad);
  bindKembang(box);
}

// ════════════════════════════════════════════════════════════
//  2) BELUM ISI
// ════════════════════════════════════════════════════════════
async function loadBelum() {
  const box = $('#belum-body'), kira = $('#belum-kira');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const m = await fetchJSON('/api/admin/missing-classes');
    $('#belum-tarikh').textContent = '📅 ' + m.tarikh + ' · ' + m.kelas_sudah_isi + '/' + m.jumlah_kelas + ' kelas sudah isi';
    const list = m.kelas || [];
    if (!list.length) {
      kira.hidden = true;
      box.innerHTML = `<div class="allset">✓ Semua ${m.jumlah_kelas} kelas sudah mengisi kehadiran hari ini.</div>`;
      return;
    }
    kira.hidden = false; kira.textContent = list.length;
    box.innerHTML = renderByTingkatan(list, (k) => {
      const guru = k.guru_kelas ? esc(k.guru_kelas) : '<span class="lbl">Tiada guru kelas</span>';
      const pemb = k.pembantu_kelas
        ? `<div class="card-meta"><span class="lbl">Pembantu:</span> <span class="pemb">${esc(k.pembantu_kelas)}</span></div>` : '';
      return `<div class="card"><div class="card-row">
          <div class="kod-badge${isStam(k.kod) ? ' stam' : ''}">${esc(k.kod)}</div>
          <div class="card-main"><div class="card-nama">${esc(k.nama || k.kod)}</div>
            <div class="card-meta">${guru}</div>${pemb}</div>
        </div></div>`;
    });
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  3) TIDAK HADIR (hari ini) — ikut kelas, wakil dibezakan
// ════════════════════════════════════════════════════════════
async function loadTidakHadir() {
  const box = $('#th-body'), ring = $('#th-ringkasan');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  ring.hidden = true;
  try {
    const rec = await getTodayRecords();
    $('#th-tarikh').textContent = '📅 ' + rec.tarikh;
    const kelasAda = (rec.rekod || []).filter((x) => (x.tidak_hadir_senarai || []).length || (x.wakil_senarai || []).length);
    const r = rec.ringkasan || {};
    ring.innerHTML = `
      <div class="th"><b class="num">${r.tidak_hadir || 0}</b><span>Tidak Hadir</span></div>
      <div class="wk"><b class="num">${r.wakil || 0}</b><span>Wakil</span></div>
      <div><b class="num">${r.hadir || 0}</b><span>Hadir</span></div>
      <div><b class="num">${fmtPct(r.peratus)}${r.peratus == null ? '' : '%'}</b><span>Peratus</span></div>`;
    ring.hidden = false;

    if (!kelasAda.length) {
      box.innerHTML = '<div class="allset">✓ Tiada pelajar tidak hadir / wakil direkod hari ini.</div>';
      return;
    }
    box.innerHTML = renderByTingkatan(kelasAda, (x) => {
      const th = (x.tidak_hadir_senarai || []);
      const wk = (x.wakil_senarai || []);
      const thRows = th.length
        ? th.map((p) => `<div class="det-row"><span>${esc(p.nama)}</span><span class="sb">${esc(p.sebab || '-')}</span></div>`).join('')
        : '<div class="det-none">Tiada</div>';
      const wkChips = wk.length
        ? wk.map((n) => `<span class="tag-wakil">${esc(n)}</span>`).join('')
        : '<div class="det-none">Tiada</div>';
      return `<div class="card">
        <div class="card-row" style="margin-bottom:6px">
          <div class="kod-badge${isStam(x.kelas) ? ' stam' : ''}">${esc(x.kelas)}</div>
          <div class="card-main"><div class="card-nama">${esc(x.nama_kelas || x.kelas)}</div>
            <div class="card-meta num">${th.length} tidak hadir · ${wk.length} wakil</div></div>
        </div>
        <div class="det-sec"><h4>Tidak Hadir (${th.length})</h4>${thRows}</div>
        <div class="det-sec"><h4>Wakil Sekolah (${wk.length})</h4>${wkChips}</div>
      </div>`;
    });
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  4) REKOD LEPAS
// ════════════════════════════════════════════════════════════
async function initRekod() {
  if (!$('#f-tarikh').value) $('#f-tarikh').value = localIso();
  await muatKelasOptions();
  await loadRekod();
}
async function loadRekod() {
  const box = $('#rekod-body'), ring = $('#rekod-ringkasan');
  const tarikh = $('#f-tarikh').value, kelas = $('#f-kelas').value;
  if (!tarikh) { box.innerHTML = '<p class="hint">Pilih tarikh untuk melihat rekod kehadiran.</p>'; ring.hidden = true; return; }
  ring.hidden = true;
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan rekod…</div>';
  try {
    const qs = new URLSearchParams({ tarikh });
    if (kelas) qs.set('kelas', kelas);
    const d = await fetchJSON('/api/admin/records?' + qs.toString());
    renderRekodRingkasan(d);
    if (!d.jumlah) {
      box.innerHTML = `<div class="empty">Tiada rekod kehadiran pada ${esc(d.tarikh)}${d.kelas ? ' untuk kelas ' + esc(d.kelas) : ''}.</div>`;
      return;
    }
    box.innerHTML = renderByTingkatan(d.rekod, renderRekodKad);
    bindKembang(box);
  } catch (err) {
    ring.hidden = true;
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}
function renderRekodRingkasan(d) {
  const r = d.ringkasan || {}, ring = $('#rekod-ringkasan');
  if (!d.jumlah) { ring.hidden = true; return; }
  ring.innerHTML = `
    <div><b class="num">${r.hadir || 0}</b><span>Hadir</span></div>
    <div class="th"><b class="num">${r.tidak_hadir || 0}</b><span>T/Hadir</span></div>
    <div class="wk"><b class="num">${r.wakil || 0}</b><span>Wakil</span></div>
    <div><b class="num">${fmtPct(r.peratus)}${r.peratus == null ? '' : '%'}</b><span>Peratus</span></div>`;
  ring.hidden = false;
}

// Kad rekod kelas (boleh kembang) — dikongsi Hari Ini + Rekod Lepas
function renderRekodKad(x) {
  const pc = pctClass(x.peratus);
  const masa = x.masa ? `<span class="sep">·</span>${esc(x.masa)}` : '';
  const guruLine = x.guru ? `<div class="det-guru"><span class="lbl">Guru:</span> ${esc(x.guru)}</div>` : '';
  const pembLine = x.pembantu ? `<div class="det-guru"><span class="lbl">Pembantu:</span> ${esc(x.pembantu)}</div>` : '';
  const th = (x.tidak_hadir_senarai || []);
  const wk = (x.wakil_senarai || []);
  const thList = th.length
    ? th.map((p) => `<div class="det-row"><span>${esc(p.nama)}</span><span class="sb">${esc(p.sebab || '-')}</span></div>`).join('')
    : '<div class="det-none">Tiada</div>';
  const wkList = wk.length
    ? wk.map((n) => `<span class="tag-wakil">${esc(n)}</span>`).join('')
    : '<div class="det-none">Tiada</div>';
  return `<div class="rec">
    <div class="rec-head">
      <div class="kod-badge${isStam(x.kelas) ? ' stam' : ''}">${esc(x.kelas)}</div>
      <div class="card-main">
        <div class="card-nama">${esc(x.nama_kelas || x.kelas)}</div>
        <div class="rec-mini num"><b>${x.hadir}</b>/${x.jumlah} hadir<span class="sep">·</span>${x.tidak_hadir} t/hadir<span class="sep">·</span>${x.wakil} wakil${masa}</div>
      </div>
      <span class="rec-pct ${pc} num">${fmtPct(x.peratus)}${x.peratus == null ? '' : '%'}</span>
      <span class="chev">▸</span>
    </div>
    <div class="rec-detail">
      ${guruLine}${pembLine}
      <div class="det-sec"><h4>Tidak Hadir (${th.length})</h4>${thList}</div>
      <div class="det-sec"><h4>Wakil Sekolah (${wk.length})</h4>${wkList}</div>
    </div>
  </div>`;
}
function bindKembang(box) {
  box.querySelectorAll('.rec-head').forEach((h) => {
    h.addEventListener('click', () => h.closest('.rec').classList.toggle('open'));
  });
}

// ════════════════════════════════════════════════════════════
//  5) PERATUS — mingguan + bulanan (formula GAS disahkan)
// ════════════════════════════════════════════════════════════
async function initPeratus() {
  await muatKelasOptions();
  await loadPeratus();
}
async function loadPeratus() {
  const wk = $('#wk-body'), mo = $('#mo-body');
  const kelas = $('#p-kelas').value;
  const scope = kelas ? kelas : 'Sekolah';
  wk.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  mo.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  const q = kelas ? '?kelas=' + encodeURIComponent(kelas) : '';
  try {
    const [w, m] = await Promise.all([
      fetchJSON('/api/admin/weekly' + q),
      fetchJSON('/api/admin/monthly' + q),
    ]);
    wk.innerHTML = (w.minggu && w.minggu.length)
      ? w.minggu.slice().reverse().map((x) => pbar(
          `${x.isnin.slice(0, 5)}–${x.jumaat.slice(0, 5)}`,
          `Minggu ${x.minggu} · ${x.hadir}/${x.jumlah} · ${x.hari} hari`, x.peratus)).join('')
      : `<div class="empty">Tiada data mingguan untuk ${esc(scope)}.</div>`;
    mo.innerHTML = (m.bulan && m.bulan.length)
      ? m.bulan.slice().reverse().map((x) => pbar(
          x.label, `${x.hadir}/${x.jumlah} · ${x.hari} hari`, x.peratus)).join('')
      : `<div class="empty">Tiada data bulanan untuk ${esc(scope)}.</div>`;
  } catch (err) {
    wk.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
    mo.innerHTML = '';
  }
}
function pbar(label, sub, peratus) {
  const pc = pctClass(peratus);
  const w = peratus == null ? 0 : Math.max(0, Math.min(100, peratus));
  return `<div class="pbar">
    <div class="pbar-top"><span class="pbar-lbl num">${esc(label)}</span><span class="pbar-pct ${pc} num">${fmtPct(peratus)}${peratus == null ? '' : '%'}</span></div>
    <div class="pbar-sub num">${esc(sub)}</div>
    <div class="pbar-track"><i class="${pc}" style="width:${w}%"></i></div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  6) KELAS & PELAJAR
// ════════════════════════════════════════════════════════════
async function loadKelas() {
  const box = $('#kelas-body'), kira = $('#kelas-kira');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const d = await fetchJSON('/api/admin/classes');
    kira.hidden = false; kira.textContent = d.jumlah;
    if (!d.jumlah) { box.innerHTML = '<div class="empty">Tiada kelas aktif.</div>'; return; }
    box.innerHTML = renderByTingkatan(d.kelas, (k) => {
      const guru = k.guru_kelas ? esc(k.guru_kelas) : '<span class="lbl">Tiada guru kelas</span>';
      const pemb = k.pembantu_kelas
        ? `<div class="card-meta"><span class="lbl">Pembantu:</span> <span class="pemb">${esc(k.pembantu_kelas)}</span></div>` : '';
      return `<div class="rec" data-kod="${esc(k.kod)}">
        <div class="rec-head">
          <div class="kod-badge${isStam(k.kod) ? ' stam' : ''}">${esc(k.kod)}</div>
          <div class="card-main"><div class="card-nama">${esc(k.nama || k.kod)}</div>
            <div class="card-meta">${guru}</div>${pemb}</div>
          <span class="cnt-pill num">${k.jumlah_pelajar}</span>
          <span class="chev">▸</span>
        </div>
        <div class="rec-detail"><div class="stud-body"><div class="det-none">Ketuk untuk papar pelajar…</div></div></div>
      </div>`;
    });
    box.querySelectorAll('.rec-head').forEach((h) => {
      h.addEventListener('click', () => {
        const rec = h.closest('.rec');
        rec.classList.toggle('open');
        if (rec.classList.contains('open') && !rec.dataset.dimuat) muatPelajar(rec);
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}
async function muatPelajar(rec) {
  const kod = rec.dataset.kod;
  const body = rec.querySelector('.stud-body');
  body.innerHTML = '<div class="det-none">Memuatkan pelajar…</div>';
  try {
    const d = await fetchJSON('/api/admin/classes/' + encodeURIComponent(kod) + '/students');
    rec.dataset.dimuat = '1';
    const list = d.pelajar || [];
    if (!list.length) { body.innerHTML = '<div class="det-none">Tiada pelajar dalam kelas ini.</div>'; return; }
    const rows = list.map((p, i) => {
      const stat = p.status && p.status !== 'aktif' ? `<span class="stud-stat">${esc(p.status)}</span>` : '';
      return `<div class="stud-row"><span class="stud-no num">${i + 1}.</span><span class="stud-nama">${esc(p.nama)}</span>${stat}</div>`;
    }).join('');
    body.innerHTML = `<div class="stud-head num">${d.jumlah_pelajar} pelajar aktif</div>${rows}`;
  } catch (err) {
    body.innerHTML = `<div class="err">Gagal: ${esc(err.message)}</div>`;
  }
}

// ── Refresh ikut tab semasa ──
async function refresh() {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  try {
    state.today.records = null; // segar semula cache hari ini
    if (state.tab === 'harian') await loadHariIni();
    else if (state.tab === 'belum') await loadBelum();
    else if (state.tab === 'tidakhadir') await loadTidakHadir();
    else if (state.tab === 'rekod') await loadRekod();
    else if (state.tab === 'peratus') await loadPeratus();
    else if (state.tab === 'kelas') await loadKelas();
  } finally {
    setTimeout(() => btn.classList.remove('spin'), 400);
  }
}

// ── Init ──
document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
// Tunjuk link Super Admin hanya untuk SUPER_ADMIN (Fasa 9).
(async function initSuperadminLink() {
  try {
    const me = await fetchJSON('/api/auth/me');
    if (me && me.user && me.user.role === 'SUPER_ADMIN') {
      const btn = $('#btn-superadmin');
      if (btn) btn.hidden = false;
    }
  } catch (_) { /* bukan SUPER_ADMIN atau belum login → link kekal tersembunyi */ }
})();
$('#btn-refresh').addEventListener('click', refresh);
$('#f-tarikh').addEventListener('change', loadRekod);
$('#f-kelas').addEventListener('change', loadRekod);
$('#p-kelas').addEventListener('change', loadPeratus);
$('#f-tarikh').value = localIso();

state.loaded.harian = true;
loadHariIni();
