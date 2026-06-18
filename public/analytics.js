'use strict';

/* ============================================================
   Analisis Kehadiran / Peratus (Fasa 7) — read-only.
   Memanggil /api/analytics/* (PostgreSQL sahaja). Formula peratus
   mengikut GAS: Σhadir ÷ Σjumlah × 100 (harian/mingguan/bulanan).
   Carta = SVG inline (tiada pustaka luar — konsisten Fasa 4/5/6).
   ============================================================ */

// ── Util ──
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
  t.textContent = msg; t.className = 'toast' + (type ? ' ' + type : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
function fmtPct(p) { return p == null ? '—' : (Math.round(p * 100) / 100).toFixed(2); }
function pctCls(p) { return p == null ? 'none' : p >= 95 ? 'ok' : p >= 85 ? 'warn' : 'bad'; }
function n0(v) { return v == null ? 0 : v; }

// ── Carta bar SVG (tanpa pustaka) ──
function barChart(items, { maxBars = 12, title = '' } = {}) {
  const data = (items || []).slice(-maxBars);
  if (!data.length) return '<div class="empty">Tiada data untuk carta.</div>';
  const W = 340, H = 165, padL = 22, padR = 8, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yOf = (v) => padT + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);
  const n = data.length, slot = plotW / n, bw = Math.min(slot * 0.62, 34);
  const showVal = n <= 12, lblEvery = Math.ceil(n / 8);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carta peratus">`;
  [0, 85, 95, 100].forEach((g) => {
    const y = yOf(g).toFixed(1);
    svg += `<line class="grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"${g === 0 ? '' : ' stroke-dasharray="2 2"'} />`;
    svg += `<text class="gridlabel" x="${padL - 3}" y="${(yOf(g) + 3).toFixed(1)}" text-anchor="end">${g}</text>`;
  });
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    if (d.value != null) {
      const y = yOf(d.value), hgt = (padT + plotH) - y;
      const cls = d.value >= 95 ? 'ok' : d.value >= 85 ? 'warn' : 'bad';
      svg += `<rect class="bar ${cls}" x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hgt, 0).toFixed(1)}" rx="2" />`;
      if (showVal) svg += `<text class="vlabel" x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${Math.round(d.value)}</text>`;
    }
    if (i % lblEvery === 0) svg += `<text class="xlabel" x="${cx.toFixed(1)}" y="${H - padB + 12}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  svg += '</svg>';
  const legend = '<div class="chart-legend"><span class="ok"><i></i>≥95%</span><span class="warn"><i></i>85–94%</span><span class="bad"><i></i>&lt;85%</span></div>';
  return `<div class="chart-card">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="chart">${svg}</div>${legend}</div>`;
}

function pcellHTML(p) { return `<span class="pcell ${pctCls(p)} num">${fmtPct(p)}${p == null ? '' : '%'}</span>`; }

// ── State ──
const state = { tab: 'harian', kelasReady: false, loaded: {}, classCache: {} };

// ── Selects kelas (kongsi senarai) ──
async function loadClassOptions() {
  if (state.kelasReady) return;
  try {
    const d = await fetchJSON('/api/dashboard/classes');
    const opts = (d.kelas || []).map((k) => `<option value="${esc(k.kod)}">${esc(k.kod)} — ${esc(k.nama || k.kod)}</option>`).join('');
    ['#h-kelas', '#w-kelas', '#m-kelas', '#c-kelas', '#s-kelas'].forEach((sel) => {
      const el = $(sel); if (el) el.insertAdjacentHTML('beforeend', opts);
    });
    state.kelasReady = true;
  } catch (_) { /* tidak kritikal */ }
}

async function getClass(kod) {
  if (state.classCache[kod]) return state.classCache[kod];
  const d = await fetchJSON('/api/analytics/class/' + encodeURIComponent(kod));
  state.classCache[kod] = d;
  return d;
}

// ── Navigasi tab ──
function showTab(name) {
  state.tab = name;
  ['harian', 'mingguan', 'bulanan', 'kelas', 'pelajar'].forEach((t) => { $('#tab-' + t).hidden = t !== name; });
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  if (!state.loaded[name]) { state.loaded[name] = true; initTab(name); }
  window.scrollTo(0, 0);
}
function initTab(name) {
  if (name === 'harian') loadHarian();
  else if (name === 'mingguan') loadMingguan();
  else if (name === 'bulanan') loadBulanan();
  // 'kelas' & 'pelajar' dimuat bila select dipilih
}

// ════════════════════════════════════════════════════════════
//  HARIAN
// ════════════════════════════════════════════════════════════
async function loadHarian() {
  const body = $('#h-body'), ring = $('#h-ringkasan');
  body.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  ring.hidden = true;
  const qs = new URLSearchParams();
  const tarikh = $('#h-tarikh').value, bulan = $('#h-bulan').value, kelas = $('#h-kelas').value;
  if (tarikh) qs.set('tarikh', tarikh);
  else if (bulan) qs.set('bulan', bulan);
  if (kelas) qs.set('kelas', kelas);

  try {
    const d = await fetchJSON('/api/analytics/daily?' + qs.toString());
    if (!tarikh && !bulan && d.tarikh_terkini) $('#h-tarikh').value = d.tarikh_terkini;

    const r = d.ringkasan || {};
    ring.innerHTML = `
      <div><b class="num">${n0(r.hadir)}</b><span>Hadir</span></div>
      <div class="th"><b class="num">${n0(r.tidak_hadir)}</b><span>T/Hadir</span></div>
      <div class="wk"><b class="num">${n0(r.wakil)}</b><span>Wakil</span></div>
      <div class="pc"><b class="num">${fmtPct(r.peratus)}${r.peratus == null ? '' : '%'}</b><span>Peratus</span></div>`;
    ring.hidden = false;

    if (!d.jumlah) {
      body.innerHTML = `<div class="empty">Tiada rekod untuk ${esc(d.julat.label)}${d.kelas ? ' · ' + esc(d.kelas) : ''}.</div>`;
      return;
    }
    const rows = d.rekod.map((x) => `
      <tr>
        <td class="num">${esc(x.tarikh)}</td>
        <td><span class="lead">${esc(x.kelas)}</span><div class="sub">${esc(x.nama_kelas || '')}</div></td>
        <td class="num">${x.jumlah}</td>
        <td class="num">${x.hadir}</td>
        <td class="num">${x.tidak_hadir}</td>
        <td class="num">${x.wakil}</td>
        <td>${pcellHTML(x.peratus)}</td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Tarikh</th><th>Kelas</th><th>Jumlah</th><th>Hadir</th><th>T/Hadir</th><th>Wakil</th><th>Peratus</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Jumlah</td><td></td><td class="num">${n0(r.jumlah)}</td><td class="num">${n0(r.hadir)}</td><td class="num">${n0(r.tidak_hadir)}</td><td class="num">${n0(r.wakil)}</td><td>${pcellHTML(r.peratus)}</td></tr></tfoot>
      </table></div>`;
  } catch (err) {
    ring.hidden = true;
    body.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  MINGGUAN
// ════════════════════════════════════════════════════════════
async function loadMingguan() {
  const body = $('#w-body'), chart = $('#w-chart');
  body.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  chart.innerHTML = '';
  const kelas = $('#w-kelas').value;
  try {
    const d = await fetchJSON('/api/analytics/weekly' + (kelas ? '?kelas=' + encodeURIComponent(kelas) : ''));
    const scope = kelas ? kelas : 'Sekolah';
    if (!d.jumlah) { chart.innerHTML = ''; body.innerHTML = '<div class="empty">Tiada data mingguan.</div>'; return; }
    chart.innerHTML = barChart(
      d.minggu.map((m) => ({ label: m.jumaat.slice(0, 5).replace('-', '/'), value: m.peratus })),
      { title: `Trend Mingguan — ${scope}` }
    );
    const rows = d.minggu.slice().reverse().map((m) => `
      <tr>
        <td><span class="lead">${esc(m.isnin.slice(0, 5))}–${esc(m.jumaat.slice(0, 5))}</span><div class="sub">Mgg ${m.minggu} · ${esc(m.jumaat.slice(6))}</div></td>
        <td class="num">${m.hari}</td>
        <td class="num">${m.hadir}</td>
        <td class="num">${m.jumlah}</td>
        <td>${pcellHTML(m.peratus)}</td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Minggu</th><th>Hari</th><th>Hadir</th><th>Jumlah</th><th>Peratus</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (err) {
    chart.innerHTML = '';
    body.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  BULANAN
// ════════════════════════════════════════════════════════════
async function loadBulanan() {
  const body = $('#m-body'), chart = $('#m-chart');
  body.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  chart.innerHTML = '';
  const kelas = $('#m-kelas').value;
  try {
    const d = await fetchJSON('/api/analytics/monthly' + (kelas ? '?kelas=' + encodeURIComponent(kelas) : ''));
    const scope = kelas ? kelas : 'Sekolah';
    if (!d.jumlah) { chart.innerHTML = ''; body.innerHTML = '<div class="empty">Tiada data bulanan.</div>'; return; }
    chart.innerHTML = barChart(
      d.bulan.map((b) => ({ label: b.label_pendek, value: b.peratus })),
      { title: `Trend Bulanan — ${scope}`, maxBars: 12 }
    );
    const rows = d.bulan.slice().reverse().map((b) => `
      <tr>
        <td class="lead">${esc(b.label)}</td>
        <td class="num">${b.hari}</td>
        <td class="num">${b.hadir}</td>
        <td class="num">${b.jumlah}</td>
        <td>${pcellHTML(b.peratus)}</td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Bulan</th><th>Hari</th><th>Hadir</th><th>Jumlah</th><th>Peratus</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (err) {
    chart.innerHTML = '';
    body.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  KELAS
// ════════════════════════════════════════════════════════════
async function loadKelas(kod) {
  const body = $('#c-body');
  if (!kod) { body.innerHTML = '<p class="hint">Pilih kelas untuk melihat peratus harian, mingguan, bulanan & trend.</p>'; return; }
  body.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const d = await getClass(kod);
    const r = d.ringkasan || {};
    const terkini = d.peratus_harian_terkini;
    const pemb = d.pembantu_kelas ? `<p><span class="lbl">Pembantu:</span> ${esc(d.pembantu_kelas)}</p>` : '';

    const wkTbl = d.mingguan.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Minggu</th><th>Hari</th><th>Hadir</th><th>Jumlah</th><th>Peratus</th></tr></thead>
        <tbody>${d.mingguan.slice().reverse().map((m) => `<tr><td><span class="lead">${esc(m.isnin.slice(0, 5))}–${esc(m.jumaat.slice(0, 5))}</span><div class="sub">Mgg ${m.minggu}</div></td><td class="num">${m.hari}</td><td class="num">${m.hadir}</td><td class="num">${m.jumlah}</td><td>${pcellHTML(m.peratus)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">Tiada data mingguan.</div>';

    const moTbl = d.bulanan.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Bulan</th><th>Hari</th><th>Hadir</th><th>Jumlah</th><th>Peratus</th></tr></thead>
        <tbody>${d.bulanan.slice().reverse().map((b) => `<tr><td class="lead">${esc(b.label)}</td><td class="num">${b.hari}</td><td class="num">${b.hadir}</td><td class="num">${b.jumlah}</td><td>${pcellHTML(b.peratus)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">Tiada data bulanan.</div>';

    body.innerHTML = `
      <div class="khead">
        <h2>${esc(d.nama_kelas || d.kelas)}</h2>
        <p><span class="lbl">Guru:</span> ${esc(d.guru_kelas || '—')}</p>
        ${pemb}
      </div>
      <div class="hero">
        <span class="lbl">Peratus Keseluruhan (Σhadir ÷ Σjumlah)</span>
        <div class="pct num">${fmtPct(r.peratus)}${r.peratus == null ? '' : '<small>%</small>'}</div>
        <div class="meta">${n0(r.hadir)} hadir / ${n0(r.jumlah)} jumlah · ${n0(r.hari)} hari direkod${r.dari ? ` · ${esc(r.dari)}–${esc(r.hingga)}` : ''}</div>
        <div class="meta">Harian terkini: ${terkini ? `${esc(terkini.tarikh)} — <b class="num">${fmtPct(terkini.peratus)}%</b>` : '—'}</div>
      </div>
      ${barChart(d.harian.map((h) => ({ label: h.tarikh.slice(0, 5).replace('-', '/'), value: h.peratus })), { title: 'Trend Harian', maxBars: 14 })}
      <h3 class="sub-h">Mingguan</h3>${wkTbl}
      <h3 class="sub-h">Bulanan</h3>${moTbl}`;
  } catch (err) {
    body.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
//  PELAJAR
// ════════════════════════════════════════════════════════════
async function onPilihKelasPelajar() {
  const kod = $('#s-kelas').value;
  const selP = $('#s-pelajar');
  $('#s-body').innerHTML = '<p class="hint">Pilih pelajar.</p>';
  if (!kod) { selP.innerHTML = '<option value="">— Pilih kelas dahulu —</option>'; selP.disabled = true; return; }
  selP.innerHTML = '<option value="">Memuatkan…</option>'; selP.disabled = true;
  try {
    const d = await getClass(kod);
    const opts = (d.pelajar || []).map((p) =>
      `<option value="${p.id}">${esc(p.nama)}${p.status !== 'aktif' ? ' (' + esc(p.status) + ')' : ''}</option>`).join('');
    selP.innerHTML = '<option value="">— Pilih pelajar —</option>' + opts;
    selP.disabled = false;
    if (!d.pelajar || !d.pelajar.length) {
      selP.innerHTML = '<option value="">Tiada pelajar dalam kelas</option>'; selP.disabled = true;
      $('#s-body').innerHTML = '<div class="empty">Tiada senarai pelajar untuk kelas ini.</div>';
    }
  } catch (err) {
    selP.innerHTML = '<option value="">Ralat</option>'; selP.disabled = true;
    $('#s-body').innerHTML = `<div class="err">Gagal memuatkan pelajar: ${esc(err.message)}</div>`;
  }
}

async function loadPelajar() {
  const id = $('#s-pelajar').value;
  const body = $('#s-body');
  if (!id) { body.innerHTML = '<p class="hint">Pilih pelajar.</p>'; return; }
  body.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  const bulan = $('#s-bulan').value;
  try {
    const d = await fetchJSON('/api/analytics/student/' + encodeURIComponent(id) + (bulan ? '?bulan=' + bulan : ''));
    const p = d.pelajar;
    const thList = d.senarai_tidak_hadir.length
      ? `<div class="list">${d.senarai_tidak_hadir.map((x) => `<div class="row"><span class="d num">${esc(x.tarikh)}</span><span class="r">${esc(x.sebab || '-')}</span></div>`).join('')}</div>`
      : '<div class="empty">Tiada hari tidak hadir.</div>';
    const wkList = d.senarai_wakil.length
      ? `<div class="list">${d.senarai_wakil.map((x) => `<div class="row"><span class="d num">${esc(x.tarikh)}</span><span class="tag-wakil">Wakil Sekolah</span></div>`).join('')}</div>`
      : '<div class="empty">Tiada hari wakil.</div>';

    body.innerHTML = `
      <div class="hero">
        <span class="lbl">Peratus Individu${d.julat.mode !== 'semua' ? ' · ' + esc(d.julat.label) : ''}</span>
        <h2>${esc(p.nama)}</h2>
        <div class="meta">Kelas ${esc(p.kelas)} · ${d.hari_direkod} hari direkod${p.status !== 'aktif' ? ' · ' + esc(p.status) : ''}</div>
        <div class="pct num">${fmtPct(d.peratus)}${d.peratus == null ? '' : '<small>%</small>'}</div>
      </div>
      <div class="stat4">
        <div class="ok"><b class="num">${d.hadir}</b><span>Hadir</span></div>
        <div class="th"><b class="num">${d.tidak_hadir}</b><span>Tidak Hadir</span></div>
        <div class="wk"><b class="num">${d.wakil}</b><span>Wakil</span></div>
        <div><b class="num">${d.hari_direkod}</b><span>Hari</span></div>
      </div>
      <h3 class="sub-h">Hari Tidak Hadir (${d.senarai_tidak_hadir.length})</h3>${thList}
      <h3 class="sub-h">Hari Wakil Sekolah (${d.senarai_wakil.length})</h3>${wkList}`;
  } catch (err) {
    body.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ── Refresh ikut tab semasa ──
async function refresh() {
  const btn = $('#btn-refresh'); btn.classList.add('spin');
  try {
    state.classCache = {}; // segar semula
    if (state.tab === 'harian') await loadHarian();
    else if (state.tab === 'mingguan') await loadMingguan();
    else if (state.tab === 'bulanan') await loadBulanan();
    else if (state.tab === 'kelas') await loadKelas($('#c-kelas').value);
    else if (state.tab === 'pelajar') await loadPelajar();
  } finally { setTimeout(() => btn.classList.remove('spin'), 400); }
}

// ── Init ──
document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#btn-refresh').addEventListener('click', refresh);

// Harian: tarikh & bulan saling eksklusif
$('#h-tarikh').addEventListener('change', () => { if ($('#h-tarikh').value) $('#h-bulan').value = ''; loadHarian(); });
$('#h-bulan').addEventListener('change', () => { if ($('#h-bulan').value) $('#h-tarikh').value = ''; loadHarian(); });
$('#h-kelas').addEventListener('change', loadHarian);

$('#w-kelas').addEventListener('change', loadMingguan);
$('#m-kelas').addEventListener('change', loadBulanan);
$('#c-kelas').addEventListener('change', () => loadKelas($('#c-kelas').value));
$('#s-kelas').addEventListener('change', onPilihKelasPelajar);
$('#s-pelajar').addEventListener('change', loadPelajar);
$('#s-bulan').addEventListener('change', loadPelajar);

(async () => {
  await loadClassOptions();
  state.loaded.harian = true;
  loadHarian();
})();
