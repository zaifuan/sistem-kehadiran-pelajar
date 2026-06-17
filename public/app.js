'use strict';

// ── Util ──
const $ = (sel) => document.querySelector(sel);
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function pctTone(p) {
  if (p == null) return 'none';
  if (p >= 95) return 'ok';
  if (p >= 85) return 'warn';
  return 'bad';
}
function fmtPct(p) { return p == null ? '—' : Number(p).toFixed(2) + '%'; }
function fmtMasa(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const spinner = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
const errBox = (msg) => `<div class="err">Gagal memuatkan data.<br><small>${esc(msg)}</small></div>`;

// ── Sync strip (header) ──
async function loadSyncStrip(s) {
  const strip = $('#sync-strip');
  try {
    const d = s || (await fetchJSON('/api/dashboard/summary'));
    if (d.sync_terakhir) {
      const st = d.sync_terakhir.status || '—';
      const tone = st === 'berjaya' ? 'ok' : st === 'gagal' ? 'bad' : 'warn';
      strip.innerHTML = `<span class="sync-dot ${tone}"></span>Sync terakhir: ${esc(st)} • ${fmtMasa(d.sync_terakhir.dijalankan_pada)}`;
    } else {
      strip.innerHTML = `<span class="sync-dot"></span>Belum ada rekod sync`;
    }
  } catch (e) {
    strip.innerHTML = `<span class="sync-dot bad"></span>Status sync tidak tersedia`;
  }
}

// ── 1. Utama ──
async function renderUtama() {
  const box = $('#utama-body');
  box.innerHTML = spinner;
  try {
    const d = await fetchJSON('/api/dashboard/summary');
    loadSyncStrip(d);
    const tone = pctTone(d.peratus_keseluruhan);
    const w = d.peratus_keseluruhan == null ? 0 : Math.max(0, Math.min(100, d.peratus_keseluruhan));
    box.innerHTML = `
      <div class="hero">
        <div class="hero-label">Peratus Kehadiran Keseluruhan</div>
        <div class="hero-pct num t-${tone}">${d.peratus_keseluruhan == null ? '—' : Number(d.peratus_keseluruhan).toFixed(2) + '<small>%</small>'}</div>
        <div class="hero-sub">Terkumpul: jumlah hadir ÷ jumlah pelajar (semua rekod)</div>
        <div class="bar"><i class="b-${tone}" id="hero-bar"></i></div>
      </div>
      <div class="grid">
        <div class="stat"><div class="v num">${d.pelajar_aktif}</div><div class="k">Pelajar aktif</div></div>
        <div class="stat"><div class="v num">${d.kelas_aktif}</div><div class="k">Kelas aktif</div></div>
        <div class="stat"><div class="v num">${d.jumlah_rekod_kehadiran}</div><div class="k">Rekod kehadiran</div></div>
        <div class="stat"><div class="v num">${d.hari_unik}</div><div class="k">Hari direkod</div></div>
        <div class="stat wide">
          <div class="range">
            <div><b class="num">${esc(d.tarikh_terawal || '—')}</b><span>Terawal</span></div>
            <div><b class="num">${esc(d.tarikh_terakhir || '—')}</b><span>Terakhir</span></div>
          </div>
        </div>
      </div>`;
    const bar = $('#hero-bar');
    if (bar) requestAnimationFrame(() => { bar.style.width = w + '%'; });
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

// ── 2. Kelas ──
async function renderKelas() {
  const box = $('#kelas-body');
  box.innerHTML = spinner;
  try {
    const d = await fetchJSON('/api/dashboard/classes');
    if (!d.kelas.length) { box.innerHTML = '<div class="empty">Tiada kelas. Jalankan sync dahulu.</div>'; return; }
    box.innerHTML = '<div class="klist">' + d.kelas.map((k) => {
      const pmb = k.pembantu_kelas ? ` • <span class="pmb">Pmb: ${esc(k.pembantu_kelas)}</span>` : '';
      const guru = k.guru_kelas ? esc(k.guru_kelas) : '<span class="pmb">Tiada guru</span>';
      return `<div class="kcard">
        <div class="kod num">${esc(k.kod)}</div>
        <div class="body">
          <div class="nama">${esc(k.nama || k.kod)}</div>
          <div class="guru">${guru}${pmb}</div>
        </div>
        <div class="cnt"><b class="num">${k.pelajar_aktif}</b><span>pelajar</span></div>
      </div>`;
    }).join('') + '</div>';
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

// ── 3. Kehadiran ──
async function renderKehadiran() {
  const box = $('#kehadiran-body');
  box.innerHTML = spinner;
  try {
    const d = await fetchJSON('/api/dashboard/recent-attendance?limit=50');
    if (!d.rekod.length) { box.innerHTML = '<div class="empty">Tiada rekod kehadiran lagi.</div>'; return; }
    box.innerHTML = '<div class="alist">' + d.rekod.map((r) => {
      const tone = pctTone(r.peratus);
      return `<div class="acard">
        <div class="top">
          <div>
            <div class="when num">${esc(r.tarikh)}</div>
            <div class="who">${esc(r.nama_kelas || r.kelas)} <span class="when">(${esc(r.kelas)})</span></div>
          </div>
          <div class="pill t-${tone}">${fmtPct(r.peratus)}</div>
        </div>
        <div class="mstats">
          <div><b class="num">${r.jumlah}</b><span>Jumlah</span></div>
          <div><b class="num">${r.hadir}</b><span>Hadir</span></div>
          <div class="th"><b class="num">${r.tidak_hadir}</b><span>T/Hadir</span></div>
          <div class="wk"><b class="num">${r.wakil}</b><span>Wakil</span></div>
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

// ── 4. Audit ──
function badge(cls, txt) { return `<span class="badge ${cls}">${esc(txt)}</span>`; }
async function renderAudit() {
  const box = $('#audit-body');
  box.innerHTML = spinner;
  try {
    const [imp, cmp, wrn] = await Promise.all([
      fetchJSON('/api/audit/import-summary'),
      fetchJSON('/api/audit/attendance-compare'),
      fetchJSON('/api/audit/warnings'),
    ]);

    // Import
    const syncSt = imp.sync_logs && imp.sync_logs.sync_terakhir ? imp.sync_logs.sync_terakhir.status : null;
    const syncBadge = syncSt === 'berjaya' ? badge('ok', 'berjaya') : syncSt ? badge('warn', esc(syncSt)) : badge('warn', 'tiada');
    const impCard = `<div class="audit-card">
      <h3>Ringkasan Import ${syncBadge}</h3>
      <div class="kv"><span class="lbl">Kelas</span><span class="val num">${imp.kelas.jumlah}</span></div>
      <div class="kv"><span class="lbl">Pelajar</span><span class="val num">${imp.pelajar.jumlah}</span></div>
      <div class="kv"><span class="lbl">Rekod kehadiran</span><span class="val num">${imp.kehadiran.jumlah}</span></div>
      <div class="kv"><span class="lbl">Raw rows</span><span class="val num">${imp.sheet_raw.jumlah}</span></div>
    </div>`;

    // Formula compare
    const r = cmp.ringkasan;
    const ok = r.ada_beza === 0;
    const cmpCard = `<div class="audit-card">
      <h3>Validasi Formula ${ok ? badge('ok', 'semua padan') : badge('warn', r.ada_beza + ' beza')}</h3>
      <div class="kv"><span class="lbl">Jumlah rekod</span><span class="val num">${r.jumlah_rekod}</span></div>
      <div class="kv"><span class="lbl">Padan</span><span class="val num clear">${r.padan}</span></div>
      <div class="kv"><span class="lbl">Ada beza</span><span class="val num ${ok ? 'clear' : 'flag'}">${r.ada_beza}</span></div>
    </div>`;

    // Warnings
    const w = wrn.ringkasan;
    const totalW = (w.konflik_guru || 0) + (w.tarikh_gagal_normalize || 0) + (w.kelas_tiada_metadata || 0) + (w.pelajar_duplicate || 0);
    const wBadge = totalW === 0 ? badge('ok', 'tiada isu') : badge('warn', totalW + ' isu');
    const flag = (n) => `<span class="val num ${n ? 'flag' : 'clear'}">${n}</span>`;
    const dupS = w.attendance_duplicate_sumber;
    const wCard = `<div class="audit-card">
      <h3>Amaran Data ${wBadge}</h3>
      <div class="kv"><span class="lbl">Konflik guru (Sheet#1 vs #2)</span>${flag(w.konflik_guru)}</div>
      <div class="kv"><span class="lbl">Tarikh gagal normalize</span>${flag(w.tarikh_gagal_normalize)}</div>
      <div class="kv"><span class="lbl">Kelas tiada metadata</span>${flag(w.kelas_tiada_metadata)}</div>
      <div class="kv"><span class="lbl">Pelajar duplicate</span>${flag(w.pelajar_duplicate)}</div>
      <div class="kv"><span class="lbl">Attendance dup (sumber)</span><span class="val num">${esc(dupS)}</span></div>
    </div>`;

    box.innerHTML = impCard + cmpCard + wCard;
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

// ── Navigasi (lazy-load + cache) ──
const RENDERERS = { utama: renderUtama, kelas: renderKelas, kehadiran: renderKehadiran, audit: renderAudit };
const loaded = new Set();
let current = 'utama';

function showView(name) {
  current = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  if (!loaded.has(name)) { loaded.add(name); RENDERERS[name](); }
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});

$('#btn-refresh').addEventListener('click', () => {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  loaded.clear();
  loaded.add(current);
  Promise.resolve(RENDERERS[current]()).finally(() => setTimeout(() => btn.classList.remove('spin'), 500));
});

// ── Mula ──
loadSyncStrip();
loaded.add('utama');
renderUtama();
