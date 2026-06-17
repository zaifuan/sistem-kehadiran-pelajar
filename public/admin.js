'use strict';

/* ============================================================
   Dashboard Admin Harian (Fasa 6) — read-only.
   Mengekalkan ilham workflow GAS: tumpuan "hari ini",
   kelas sudah/belum isi, peratus harian, + semakan rekod lepas.
   Semua data dibaca melalui /api/admin/* (PostgreSQL sahaja).
   ============================================================ */

// ── Util (selaras dengan guru.js) ──
const $ = (s) => document.querySelector(s);
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
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

const state = { tab: 'harian', kelasOptDimuat: false, rekodPernahMuat: false };

// ── Navigasi tab ──
function showTab(name) {
  state.tab = name;
  $('#tab-harian').hidden = name !== 'harian';
  $('#tab-rekod').hidden = name !== 'rekod';
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.tab === name);
  });
  if (name === 'rekod' && !state.rekodPernahMuat) initRekod();
  window.scrollTo(0, 0);
}

// ════════════════════════════════════════════════════════════
//  TAB 1 — HARI INI
// ════════════════════════════════════════════════════════════
async function loadHarian() {
  const hero = $('#hero');
  const grid = $('#stat-grid');
  const belum = $('#belum-body');
  hero.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan ringkasan…</div>';
  grid.hidden = true;
  belum.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';

  try {
    const [s, m] = await Promise.all([
      fetchJSON('/api/admin/today-summary'),
      fetchJSON('/api/admin/missing-classes'),
    ]);

    $('#tarikh-strip').textContent = '📅 ' + s.tarikh;
    // Set default tarikh rekod ikut "hari ini" server (sekali sahaja)
    if (s.tarikh_iso && !$('#f-tarikh').value) $('#f-tarikh').value = s.tarikh_iso;

    renderHero(s);
    renderStats(s);
    renderBelum(m);
  } catch (err) {
    hero.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
    belum.innerHTML = '';
    toast('Gagal memuatkan ringkasan', 'bad');
  }
}

function renderHero(s) {
  const jum = s.jumlah_kelas || 0;
  const sudah = s.kelas_sudah_isi || 0;
  const progPct = jum > 0 ? Math.round((sudah / jum) * 100) : 0;
  const pct = fmtPct(s.peratus_kehadiran);
  const sub = s.peratus_kehadiran == null
    ? 'Belum ada kelas mengisi kehadiran'
    : `${s.jumlah_hadir} hadir / ${s.pelajar_direkod_hari_ini} pelajar direkod`;

  $('#hero').innerHTML = `
    <div class="hero-top">
      <span class="hero-label">Peratus Kehadiran Hari Ini</span>
    </div>
    <div class="hero-pct num">${pct}${s.peratus_kehadiran == null ? '' : '<small>%</small>'}</div>
    <div class="hero-sub">${esc(sub)}</div>
    <div class="hero-bar"><i style="width:${progPct}%"></i></div>
    <div class="hero-prog">
      <span>Kelas sudah isi</span>
      <span class="num"><b>${sudah}</b> / ${jum}</span>
    </div>`;
}

function renderStats(s) {
  const cards = [
    { v: s.jumlah_kelas, l: 'Jumlah Kelas', c: '' },
    { v: s.kelas_sudah_isi, l: 'Sudah Isi', c: 'ok' },
    { v: s.kelas_belum_isi, l: 'Belum Isi', c: s.kelas_belum_isi > 0 ? 'warn' : 'ok' },
    { v: s.jumlah_pelajar, l: 'Jumlah Pelajar', c: '' },
    { v: s.jumlah_tidak_hadir, l: 'Tidak Hadir', c: s.jumlah_tidak_hadir > 0 ? 'bad' : '' },
    { v: s.jumlah_wakil, l: 'Wakil Sekolah', c: 'wk' },
  ];
  const grid = $('#stat-grid');
  grid.innerHTML = cards
    .map((c) => `<div class="stat ${c.c}"><b class="num">${c.v == null ? '—' : c.v}</b><span>${esc(c.l)}</span></div>`)
    .join('');
  grid.hidden = false;
}

function renderBelum(m) {
  const box = $('#belum-body');
  const kira = $('#belum-kira');
  const list = m.kelas || [];

  if (list.length === 0) {
    kira.hidden = true;
    box.innerHTML = `<div class="allset">✓ Semua ${m.jumlah_kelas} kelas sudah mengisi kehadiran hari ini.</div>`;
    return;
  }
  kira.hidden = false;
  kira.textContent = list.length;
  box.innerHTML = list.map((k) => {
    const guru = k.guru_kelas ? esc(k.guru_kelas) : '<span class="lbl">Tiada guru kelas</span>';
    const pemb = k.pembantu_kelas
      ? `<div class="card-meta"><span class="lbl">Pembantu:</span> <span class="pemb">${esc(k.pembantu_kelas)}</span></div>`
      : '';
    return `
      <div class="card">
        <div class="card-row">
          <div class="kod-badge${isStam(k.kod) ? ' stam' : ''}">${esc(k.kod)}</div>
          <div class="card-main">
            <div class="card-nama">${esc(k.nama || k.kod)}</div>
            <div class="card-meta">${guru}</div>
            ${pemb}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  TAB 2 — REKOD LEPAS
// ════════════════════════════════════════════════════════════
async function initRekod() {
  state.rekodPernahMuat = true;
  if (!$('#f-tarikh').value) $('#f-tarikh').value = localIso();
  await muatKelasOptions();
  await loadRekod();
}

async function muatKelasOptions() {
  if (state.kelasOptDimuat) return;
  try {
    const d = await fetchJSON('/api/dashboard/classes'); // senarai kelas (read-only)
    const sel = $('#f-kelas');
    const opts = (d.kelas || [])
      .map((k) => `<option value="${esc(k.kod)}">${esc(k.kod)} — ${esc(k.nama || k.kod)}</option>`)
      .join('');
    sel.insertAdjacentHTML('beforeend', opts);
    state.kelasOptDimuat = true;
  } catch (_) {
    // Senarai kekal "Semua kelas" sahaja jika gagal — tidak kritikal.
  }
}

async function loadRekod() {
  const box = $('#rekod-body');
  const ring = $('#rekod-ringkasan');
  const tarikh = $('#f-tarikh').value;
  const kelas = $('#f-kelas').value;
  if (!tarikh) { box.innerHTML = '<p class="hint">Pilih tarikh untuk melihat rekod kehadiran.</p>'; ring.hidden = true; return; }

  ring.hidden = true;
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan rekod…</div>';

  try {
    const qs = new URLSearchParams({ tarikh });
    if (kelas) qs.set('kelas', kelas);
    const d = await fetchJSON('/api/admin/records?' + qs.toString());
    renderRekodRingkasan(d);
    renderRekodList(d);
  } catch (err) {
    ring.hidden = true;
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

function renderRekodRingkasan(d) {
  const r = d.ringkasan || {};
  const ring = $('#rekod-ringkasan');
  if (!d.jumlah) { ring.hidden = true; return; }
  ring.innerHTML = `
    <div><b class="num">${r.hadir || 0}</b><span>Hadir</span></div>
    <div class="th"><b class="num">${r.tidak_hadir || 0}</b><span>T/Hadir</span></div>
    <div class="wk"><b class="num">${r.wakil || 0}</b><span>Wakil</span></div>
    <div><b class="num">${fmtPct(r.peratus)}${r.peratus == null ? '' : '%'}</b><span>Peratus</span></div>`;
  ring.hidden = false;
}

function renderRekodList(d) {
  const box = $('#rekod-body');
  if (!d.jumlah) {
    box.innerHTML = `<div class="empty">Tiada rekod kehadiran pada ${esc(d.tarikh)}${d.kelas ? ' untuk kelas ' + esc(d.kelas) : ''}.</div>`;
    return;
  }
  box.innerHTML = d.rekod.map(renderRekodKad).join('');
  // Toggle kembang
  box.querySelectorAll('.rec-head').forEach((h) => {
    h.addEventListener('click', () => h.closest('.rec').classList.toggle('open'));
  });
}

function renderRekodKad(x) {
  const pc = pctClass(x.peratus);
  const masa = x.masa ? `<span class="sep">·</span>${esc(x.masa)}` : '';
  const guruLine = x.guru
    ? `<div class="det-guru"><span class="lbl">Guru:</span> ${esc(x.guru)}</div>`
    : '';
  const pembLine = x.pembantu
    ? `<div class="det-guru"><span class="lbl">Pembantu:</span> ${esc(x.pembantu)}</div>`
    : '';

  const thList = (x.tidak_hadir_senarai || []).length
    ? x.tidak_hadir_senarai.map((p) =>
        `<div class="det-row"><span>${esc(p.nama)}</span><span class="sb">${esc(p.sebab || '-')}</span></div>`).join('')
    : '<div class="det-none">Tiada</div>';

  const wkList = (x.wakil_senarai || []).length
    ? x.wakil_senarai.map((n) => `<span class="tag-wakil">${esc(n)}</span>`).join('')
    : '<div class="det-none">Tiada</div>';

  return `
    <div class="rec">
      <div class="rec-head">
        <div class="kod-badge${isStam(x.kelas) ? ' stam' : ''}">${esc(x.kelas)}</div>
        <div class="card-main">
          <div class="card-nama">${esc(x.nama_kelas || x.kelas)}</div>
          <div class="rec-mini num">
            <b>${x.hadir}</b>/${x.jumlah} hadir<span class="sep">·</span>${x.tidak_hadir} t/hadir<span class="sep">·</span>${x.wakil} wakil${masa}
          </div>
        </div>
        <span class="rec-pct ${pc} num">${fmtPct(x.peratus)}${x.peratus == null ? '' : '%'}</span>
        <span class="chev">▸</span>
      </div>
      <div class="rec-detail">
        ${guruLine}${pembLine}
        <div class="det-sec">
          <h4>Tidak Hadir (${(x.tidak_hadir_senarai || []).length})</h4>
          ${thList}
        </div>
        <div class="det-sec">
          <h4>Wakil Sekolah (${(x.wakil_senarai || []).length})</h4>
          ${wkList}
        </div>
      </div>
    </div>`;
}

// ── Refresh ikut tab semasa ──
async function refresh() {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  try {
    if (state.tab === 'harian') await loadHarian();
    else await loadRekod();
  } finally {
    setTimeout(() => btn.classList.remove('spin'), 400);
  }
}

// ── Init ──
document.querySelectorAll('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
});
$('#btn-refresh').addEventListener('click', refresh);
$('#f-tarikh').addEventListener('change', loadRekod);
$('#f-kelas').addEventListener('change', loadRekod);
$('#f-tarikh').value = localIso(); // nilai awal sebelum data server tiba

loadHarian();
