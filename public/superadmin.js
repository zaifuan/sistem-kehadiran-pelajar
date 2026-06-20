'use strict';

/* ============================================================
   Super Admin (Fasa 9) — kawalan sistem.
   Modul: Maklumat Sistem · Akaun · Cuti · Reset (bahaya).
   Semua aksi via /api/superadmin/* (hanya SUPER_ADMIN).
   ============================================================ */

// ── Util (selaras admin.js) ──
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
  toast._t = setTimeout(() => { t.hidden = true; }, 3000);
}
function localIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtTarikh(t) {
  // 'YYYY-MM-DD' -> 'DD-MM-YYYY' untuk paparan
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (t || '—');
}
function fmtMasa(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const TABS = ['sistem', 'akaun', 'cuti', 'reset', 'telegram'];
const state = { tab: 'sistem', loaded: {}, me: null };

// ── Navigasi tab ──
function showTab(name) {
  state.tab = name;
  TABS.forEach((t) => { $('#tab-' + t).hidden = t !== name; });
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  if (!state.loaded[name]) { state.loaded[name] = true; initTab(name); }
  window.scrollTo(0, 0);
}
function initTab(name) {
  if (name === 'sistem') loadSistem();
  else if (name === 'akaun') loadAkaun();
  else if (name === 'cuti') initCuti();
  else if (name === 'reset') initReset();
  else if (name === 'telegram') loadTelegram();
}

// ════════════════════════════════════════════════════════════
//  1) MAKLUMAT SISTEM
// ════════════════════════════════════════════════════════════
async function loadSistem() {
  const box = $('#sa-stats');
  const integ = $('#sa-integrasi');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  integ.innerHTML = '';
  try {
    const s = await fetchJSON('/api/superadmin/summary');
    $('#user-strip').textContent = '👤 ' + (state.me ? esc(state.me.nama || state.me.username) : '') + ' · SUPER_ADMIN';
    const cards = [
      { v: s.jumlah_kelas_aktif, l: 'Kelas Aktif', c: '' },
      { v: s.jumlah_pelajar_aktif, l: 'Pelajar Aktif', c: '' },
      { v: s.jumlah_akaun_aktif, l: 'Akaun Aktif', c: 'ok' },
      { v: s.jumlah_cuti_aktif, l: 'Cuti Aktif', c: '' },
    ];
    box.innerHTML = cards
      .map((c) => `<div class="stat ${c.c}"><b class="num">${c.v == null ? '—' : c.v}</b><span>${esc(c.l)}</span></div>`).join('');

    integ.innerHTML = `
      <div class="card">
        <div class="row-card">
          <div class="row-main">
            <div class="row-title">Telegram</div>
            <div class="row-sub">${esc(s.status_telegram)}</div>
          </div>
          <span class="badge-status off">Belum sedia</span>
        </div>
      </div>
      <div class="card">
        <div class="row-card">
          <div class="row-main">
            <div class="row-title">Google Sheet Sync</div>
            <div class="row-sub">${esc(s.status_google_sheet_sync)}</div>
          </div>
          <span class="badge-status off">Belum sedia</span>
        </div>
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ── Google Sheet Sync (Fasa 10) ──
// Cetus enjin sync sedia ada via /api/superadmin/sync (SUPER_ADMIN sahaja).
async function syncSheet() {
  const btn = $('#btn-sync');
  const box = $('#sync-hasil');
  btn.disabled = true; btn.textContent = 'Menyegerak…';
  box.hidden = false;
  box.className = 'sync-hasil';
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Sedang sync kedua-dua Google Sheet… Jangan tutup halaman.</div>';
  try {
    const d = await fetchJSON('/api/superadmin/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    renderSyncHasil(box, d);
    if (d.status === 'berjaya') toast('Sync selesai.', 'ok');
    else if (d.status === 'gagal') toast('Sync gagal.', 'bad');
    else toast('Sync selesai dengan amaran.', 'ok');
  } catch (err) {
    box.className = 'sync-hasil err';
    box.innerHTML = `<div class="sync-head"><span class="badge-status off">Gagal</span></div>
      <div class="sync-meta">${esc(err.message || 'Ralat tidak diketahui semasa sync.')}</div>`;
    toast(err.message || 'Sync gagal.', 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Sync Google Sheet';
  }
}
function renderSyncHasil(box, d) {
  const st = d.status || 'tidak diketahui';
  const cls = st === 'berjaya' ? 'ok' : (st === 'gagal' ? 'err' : 'warn');
  const pill = st === 'berjaya' ? 'on' : (st === 'gagal' ? 'off' : 'warn');
  const label = st === 'berjaya' ? 'Berjaya' : (st === 'gagal' ? 'Gagal' : 'Sebahagian berjaya');
  box.className = 'sync-hasil ' + cls;
  const langkah = Array.isArray(d.langkah) ? d.langkah : [];
  const steps = langkah.length
    ? langkah.map((l) => {
        const ls = l.status || '';
        const lc = ls === 'berjaya' ? 'on' : (ls === 'gagal' ? 'off' : 'warn');
        const bil = (l.bil != null && l.bil !== '') ? `<span class="sync-step-bil num">${esc(l.bil)}</span>` : '';
        const msg = l.mesej ? `<div class="sync-step-msg">${esc(l.mesej)}</div>` : '';
        return `<div class="sync-step">
          <span class="badge-status ${lc}">${esc(ls || '—')}</span>
          <div class="sync-step-main"><div class="sync-step-nama">${esc(l.nama)}</div>${msg}</div>
          ${bil}
        </div>`;
      }).join('')
    : '<div class="empty">Tiada butiran langkah daripada enjin sync.</div>';
  box.innerHTML = `
    <div class="sync-head">
      <span class="badge-status ${pill}">${esc(label)}</span>
      <div class="sync-meta">
        <div><span class="lbl">Mula:</span> <span class="num">${fmtMasa(d.mula)}</span></div>
        <div><span class="lbl">Tamat:</span> <span class="num">${fmtMasa(d.tamat)}</span></div>
      </div>
    </div>
    <div class="sync-steps">${steps}</div>`;
}

// ════════════════════════════════════════════════════════════
//  2) PENGURUSAN AKAUN
// ════════════════════════════════════════════════════════════
async function loadAkaun() {
  const box = $('#akaun-body'), kira = $('#akaun-kira');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const d = await fetchJSON('/api/superadmin/users');
    kira.hidden = false; kira.textContent = d.jumlah;
    const list = d.pengguna || [];
    if (!list.length) { box.innerHTML = '<div class="empty">Tiada akaun.</div>'; return; }
    box.innerHTML = list.map((u) => {
      const role = u.role || 'LAIN';
      const self = state.me && u.id === state.me.id;
      const nama = u.nama ? esc(u.nama) : '<span class="lbl">—</span>';
      return `<div class="card">
        <div class="row-card">
          <div class="row-main">
            <div class="row-title">${esc(u.username)}${self ? ' <span class="lbl">(anda)</span>' : ''}</div>
            <div class="row-sub"><span class="lbl">Nama:</span> ${nama} · <span class="lbl">Log masuk:</span> ${fmtMasa(u.last_login)}</div>
          </div>
          <span class="badge-role ${esc(role)}">${esc(role)}</span>
          <span class="badge-status ${u.aktif ? 'on' : 'off'}">${u.aktif ? 'Aktif' : 'Nyahaktif'}</span>
          <div class="row-actions">
            <button class="btn ghost btn-sm" data-edit="${u.id}" type="button">Edit</button>
          </div>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => bukaEdit(b.dataset.edit, d.pengguna)));
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

// ── Modal edit akaun ──
let editId = null;
function bukaEdit(id, senarai) {
  const u = senarai.find((x) => String(x.id) === String(id));
  if (!u) return;
  editId = u.id;
  $('#m-username').value = u.username || '';
  $('#m-nama').value = u.nama || '';
  $('#m-password').value = '';
  $('#m-aktif').checked = !!u.aktif;
  $('#m-aktif-label').textContent = u.aktif ? 'Aktif' : 'Nyahaktif';
  $('#modal-edit').hidden = false;
}
function tutupEdit() { $('#modal-edit').hidden = true; editId = null; }
async function simpanEdit() {
  if (!editId) return;
  const body = {};
  const username = $('#m-username').value.trim();
  const nama = $('#m-nama').value.trim();
  const pw = $('#m-password').value;
  const aktif = $('#m-aktif').checked;
  if (username) body.username = username;
  if (nama) body.nama = nama;
  if (pw) body.kata_laluan = pw;
  body.aktif = aktif;

  const btn = $('#modal-simpan');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    await fetchJSON('/api/superadmin/users/' + encodeURIComponent(editId), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    toast('Akaun dikemaskini.', 'ok');
    tutupEdit();
    await loadAkaun();
  } catch (err) {
    toast(err.message || 'Gagal kemaskini.', 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

// ════════════════════════════════════════════════════════════
//  3) TETAPAN CUTI
// ════════════════════════════════════════════════════════════
function initCuti() {
  const hariIni = localIso();
  if (!$('#cuti-mula').value) $('#cuti-mula').value = hariIni;
  if (!$('#cuti-tamat').value) $('#cuti-tamat').value = hariIni;
  loadCuti();
}
async function loadCuti() {
  const box = $('#cuti-body'), kira = $('#cuti-kira');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const d = await fetchJSON('/api/superadmin/holidays');
    kira.hidden = false; kira.textContent = d.jumlah;
    const list = d.cuti || [];
    if (!list.length) { box.innerHTML = '<div class="empty">Tiada cuti lagi.</div>'; return; }
    box.innerHTML = list.map((c) => {
      const cat = c.catatan ? `<div class="cuti-catatan">${esc(c.catatan)}</div>` : '';
      const statusPill = c.aktif
        ? '<span class="badge-status on">Aktif</span>'
        : '<span class="badge-status off">Nyahaktif</span>';
      const hari = Number(c.bilangan_hari) || 1;
      const julat = `<span class="cuti-tarikh num">${esc(fmtTarikh(c.tarikh_mula))}</span>
            <span class="cuti-arrow">→</span>
            <span class="cuti-tarikh num">${esc(fmtTarikh(c.tarikh_tamat))}</span>
            <span class="cuti-hari num">${hari} hari</span>`;
      const namaPadam = `${c.nama_cuti} (${fmtTarikh(c.tarikh_mula)} → ${fmtTarikh(c.tarikh_tamat)})`;
      return `<div class="card">
        <div class="row-card">
          <div class="cuti-main">
            <div class="cuti-nama">${esc(c.nama_cuti)}</div>
            <div class="cuti-julat">${julat}</div>
            ${cat}
          </div>
          ${statusPill}
          <div class="row-actions">
            <button class="btn ghost btn-sm" data-toggle="${c.id}" data-aktif="${c.aktif ? 1 : 0}" type="button">${c.aktif ? 'Nyahaktif' : 'Aktif'}</button>
            <button class="btn ghost btn-sm" data-del="${c.id}" data-nama="${esc(namaPadam)}" type="button">Padam</button>
          </div>
        </div>
      </div>`;
    }).join('');
    bindCutiActions(box);
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}
function bindCutiActions(box) {
  box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleCuti(b.dataset.toggle, b.dataset.aktif === '1')));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => padamCuti(b.dataset.del, b.dataset.nama)));
}
async function tambahCuti() {
  const mula = $('#cuti-mula').value;
  const tamat = $('#cuti-tamat').value;
  const nama = $('#cuti-nama').value.trim();
  const catatan = $('#cuti-catatan').value.trim();
  if (!mula || !tamat || !nama) { toast('Tarikh mula, tarikh tamat dan nama cuti wajib.', 'bad'); return; }
  if (tamat < mula) { toast('Tarikh tamat tidak boleh lebih awal daripada tarikh mula.', 'bad'); return; }
  const btn = $('#btn-tambah-cuti');
  btn.disabled = true; btn.textContent = 'Menambah…';
  try {
    await fetchJSON('/api/superadmin/holidays', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarikh_mula: mula, tarikh_tamat: tamat, nama_cuti: nama, catatan: catatan || undefined }),
    });
    $('#cuti-nama').value = ''; $('#cuti-catatan').value = '';
    toast('Cuti ditambah.', 'ok');
    await loadCuti();
  } catch (err) {
    toast(err.message || 'Gagal tambah cuti.', 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Tambah Cuti';
  }
}
async function toggleCuti(id, semasaAktif) {
  try {
    await fetchJSON('/api/superadmin/holidays/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktif: !semasaAktif }),
    });
    toast(!semasaAktif ? 'Cuti diaktifkan.' : 'Cuti dinyahaktifkan.', 'ok');
    await loadCuti();
  } catch (err) {
    toast(err.message || 'Gagal kemaskini cuti.', 'bad');
  }
}
async function padamCuti(id, nama) {
  const ok = await confirmDialog('Padam Cuti', `Padam "${nama}"? Tindakan ini kekal.`);
  if (!ok) return;
  try {
    await fetchJSON('/api/superadmin/holidays/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Cuti dipadam.', 'ok');
    await loadCuti();
  } catch (err) {
    toast(err.message || 'Gagal padam cuti.', 'bad');
  }
}

// ════════════════════════════════════════════════════════════
//  4) RESET KEHADIRAN (DANGER)
// ════════════════════════════════════════════════════════════
function initReset() {
  if (!$('#r1-tarikh').value) $('#r1-tarikh').value = localIso();
  if (!$('#r2-tarikh').value) $('#r2-tarikh').value = localIso();
  muatKelasReset();
}
async function muatKelasReset() {
  try {
    const d = await fetchJSON('/api/superadmin/classes');
    const opts = (d.kelas || [])
      .map((k) => `<option value="${esc(k.kod)}">${esc(k.kod)} — ${esc(k.nama || k.kod)}</option>`).join('');
    const sel = $('#r1-kelas');
    // kekal option "pilih" pertama
    sel.innerHTML = '<option value="">— Pilih kelas —</option>' + opts;
  } catch (_) { /* dropdown kekal "pilih" jika gagal */ }
}
async function resetKelas() {
  const tarikh = $('#r1-tarikh').value;
  const kelas = $('#r1-kelas').value;
  if (!tarikh) { toast('Pilih tarikh.', 'bad'); return; }
  if (!kelas) { toast('Pilih kelas.', 'bad'); return; }
  const ok = await confirmDialog(
    'Reset Satu Kelas',
    `Padam rekod kehadiran kelas <b>${esc(kelas)}</b> pada <b>${esc(fmtTarikh(tarikh))}</b>?`
      + '<br><br>Rekod utama + senarai tidak hadir/wakil akan dipadam. Kelas lain tidak terjejas.'
  );
  if (!ok) return;
  const btn = $('#btn-reset-kelas');
  btn.disabled = true; btn.textContent = 'Memadam…';
  try {
    const qs = new URLSearchParams({ tarikh, kelas });
    const r = await fetchJSON('/api/superadmin/attendance?' + qs.toString(), { method: 'DELETE' });
    toast(r.mesej || 'Direset.', r.rekod_dipadam > 0 ? 'ok' : 'bad');
  } catch (err) {
    toast(err.message || 'Gagal reset.', 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Reset Kelas Ini';
  }
}
async function resetHari() {
  const tarikh = $('#r2-tarikh').value;
  const sahan = $('#r2-sahan').value.trim();
  if (!tarikh) { toast('Pilih tarikh.', 'bad'); return; }
  if (sahan !== 'SAHKAN') { toast('Taip SAHKAN untuk membenarkan.', 'bad'); return; }
  const ok = await confirmDialog(
    'Reset Semua Kelas',
    `Padam <b>SEMUA</b> rekod kehadiran pada <b>${esc(fmtTarikh(tarikh))}</b>?`
      + '<br><br>Tindakan ini kekal dan tidak boleh diundur.'
  );
  if (!ok) return;
  const btn = $('#btn-reset-hari');
  btn.disabled = true; btn.textContent = 'Memadam…';
  try {
    const qs = new URLSearchParams({ tarikh, sahan });
    const r = await fetchJSON('/api/superadmin/attendance-day?' + qs.toString(), { method: 'DELETE' });
    toast(r.mesej || 'Direset.', r.rekod_dipadam > 0 ? 'ok' : 'bad');
    $('#r2-sahan').value = '';
  } catch (err) {
    toast(err.message || 'Gagal reset.', 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Reset Semua Kelas Tarikh Ini';
  }
}

// ── Modal konfirmasi generik ──
let confirmResolve = null;
function confirmDialog(judul, mesejHtml) {
  return new Promise((resolve) => {
    $('#konfirm-judul').textContent = judul;
    $('#konfirm-mesej').innerHTML = mesejHtml;
    $('#modal-konfirm').hidden = false;
    confirmResolve = resolve;
  });
}
function tutupConfirm(value) {
  $('#modal-konfirm').hidden = true;
  if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
}

// ── Refresh ikut tab semasa ──
async function refresh() {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  try {
    if (state.tab === 'sistem') await loadSistem();
    else if (state.tab === 'akaun') await loadAkaun();
    else if (state.tab === 'cuti') await loadCuti();
    else if (state.tab === 'reset') { /* tiada muat data; tiada aksi */ }
  } finally {
    setTimeout(() => btn.classList.remove('spin'), 400);
  }
}

// ── Init ──
async function init() {
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#btn-refresh').addEventListener('click', refresh);
  $('#btn-admin').addEventListener('click', (e) => { e.preventDefault(); location.href = '/admin'; });

  // Edit akaun
  $('#modal-close').addEventListener('click', tutupEdit);
  $('#modal-batal').addEventListener('click', tutupEdit);
  $('#modal-simpan').addEventListener('click', simpanEdit);
  $('#m-aktif').addEventListener('change', (e) => { $('#m-aktif-label').textContent = e.target.checked ? 'Aktif' : 'Nyahaktif'; });

  // Google Sheet Sync
  $('#btn-sync').addEventListener('click', syncSheet);

  // Cuti
  $('#btn-tambah-cuti').addEventListener('click', tambahCuti);

  // Reset
  $('#btn-reset-kelas').addEventListener('click', resetKelas);
  $('#btn-reset-hari').addEventListener('click', resetHari);

  // Konfirmasi
  $('#konfirm-batal').addEventListener('click', () => tutupConfirm(false));
  $('#konfirm-ok').addEventListener('click', () => tutupConfirm(true));

  // Tutup modal pada latar
  $('#modal-edit').addEventListener('click', (e) => { if (e.target.id === 'modal-edit') tutupEdit(); });
  $('#modal-konfirm').addEventListener('click', (e) => { if (e.target.id === 'modal-konfirm') tutupConfirm(false); });

  // Ketahui siapa pengguna (untuk label "(anda)" + strip)
  try {
    const me = await fetchJSON('/api/auth/me');
    state.me = me.user || null;
  } catch (_) { /* tidak kritikal */ }

  state.loaded.sistem = true;
  loadSistem();
}
init();

// ════════════════════════════════════════════════════════════
//  5) TELEGRAM ASAS (Fasa 11A)
// ════════════════════════════════════════════════════════════
async function loadTelegram() {
  const box = $('#tg-body');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan…</div>';
  try {
    const [s, st, lg] = await Promise.all([
      fetchJSON('/api/superadmin/telegram/settings'),
      fetchJSON('/api/superadmin/telegram/status'),
      fetchJSON('/api/superadmin/telegram/logs'),
    ]);
    const t = s.tetapan;
    const badge = st.dikonfigurasi ? '<span class="badge-status on">Sedia</span>' : '<span class="badge-status off">Belum lengkap</span>';
    box.innerHTML = `
      <div class="block">
        <div class="block-head"><h2>Status Telegram</h2></div>
        <div class="card"><div class="row-card">
          <div class="row-main">
            <div class="row-title">Sambungan</div>
            <div class="row-sub">Token: ${esc(t.token_mask || 'Tidak ditetapkan')}${t.token_sumber ? ' · ' + esc(t.token_sumber) : ''}</div>
            <div class="row-sub">Chat ID: ${esc(t.chat_mask || 'Tidak ditetapkan')}</div>
          </div>${badge}
        </div></div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Tetapan Sambungan</h2></div>
        <div class="card form-card">
          <div class="field">
            <label for="tg-token">Bot Token ${t.token_set ? '<span class="lbl-opt">(tersimpan — kosongkan jika tidak ubah)</span>' : ''}</label>
            <input id="tg-token" type="password" class="inp" autocomplete="off" placeholder="${t.token_set ? '•••••• (tersimpan)' : 'Tampal bot token'}" />
          </div>
          <div class="field">
            <label for="tg-chat">Chat ID</label>
            <input id="tg-chat" type="text" class="inp num" autocomplete="off" value="${esc(t.chat_id || '')}" placeholder="cth: -1001234567890" />
          </div>
          <div class="btn-row">
            <button id="tg-simpan" class="btn primary" type="button">Simpan Tetapan</button>
            <button id="tg-uji" class="btn ghost" type="button">Uji Telegram</button>
          </div>
          <div id="tg-uji-hasil" class="sync-hasil" hidden></div>
        </div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Laporan Harian (Manual)</h2></div>
        <div class="card form-card">
          <p class="field-note">Hantar laporan kehadiran harian ke Telegram. Digunakan selepas semua kelas selesai mengisi kehadiran.</p>
          <button id="tg-daily" class="btn primary" type="button">Hantar Laporan Harian</button>
          <div id="tg-daily-hasil" class="sync-hasil" hidden></div>
        </div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Log Penghantaran <span class="pill">${lg.jumlah}</span></h2></div>
        <div class="list">${lg.jumlah ? lg.log.map(kadLogTg).join('') : '<div class="empty">Tiada log lagi.</div>'}</div>
      </div>`;
    bindTelegram();
  } catch (err) {
    box.innerHTML = `<div class="err">Gagal memuatkan: ${esc(err.message)}</div>`;
  }
}

function kadLogTg(l) {
  const cls = l.status === 'dihantar' ? 'on' : 'off';
  const ref = l.tarikh_rujukan ? ' · ' + fmtTarikh(l.tarikh_rujukan) : '';
  return `<div class="card"><div class="row-card">
      <div class="row-main">
        <div class="row-title">${esc(l.jenis_mesej || '—')}${ref}</div>
        <div class="row-sub num">${esc(l.dihantar_pada || '')}${l.ringkasan ? ' · ' + esc(l.ringkasan) : ''}</div>
      </div>
      <span class="badge-status ${cls}">${esc(String(l.status || '').toUpperCase())}</span>
    </div></div>`;
}

function bindTelegram() {
  $('#tg-simpan').addEventListener('click', simpanTelegram);
  $('#tg-uji').addEventListener('click', ujiTelegram);
  $('#tg-daily').addEventListener('click', () => hantarHarian(false));
}

async function simpanTelegram() {
  const tok = $('#tg-token').value.trim();
  const body = { chat_id: $('#tg-chat').value.trim() };
  if (tok) body.bot_token = tok;
  const btn = $('#tg-simpan'); btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Menyimpan…';
  try {
    await fetchJSON('/api/superadmin/telegram/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Tetapan Telegram disimpan.', 'ok');
    loadTelegram();
  } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = lbl; }
}

async function ujiTelegram() {
  const tok = $('#tg-token').value.trim(), chat = $('#tg-chat').value.trim();
  const box = $('#tg-uji-hasil'); box.hidden = true;
  const btn = $('#tg-uji'); btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Menguji…';
  try {
    if (tok || chat) {
      const body = {}; if (tok) body.bot_token = tok; if (chat) body.chat_id = chat;
      await fetchJSON('/api/superadmin/telegram/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    const d = await fetchJSON('/api/superadmin/telegram/test', { method: 'POST' });
    box.className = 'sync-hasil ok'; box.hidden = false;
    box.innerHTML = `Sambungan OK — bot @${esc(d.bot.username)}.${d.mesej_dihantar ? ' Mesej ujian dihantar.' : ''}${d.amaran ? ' (' + esc(d.amaran) + ')' : ''}`;
    toast('Uji Telegram berjaya.', 'ok');
    if (tok) loadTelegram();
  } catch (err) {
    box.className = 'sync-hasil err'; box.hidden = false; box.innerHTML = `Gagal: ${esc(err.message)}`;
  } finally { btn.disabled = false; btn.textContent = lbl; }
}

async function hantarHarian(force) {
  const box = $('#tg-daily-hasil');
  const btn = $('#tg-daily'); btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Menghantar…';
  try {
    const d = await fetchJSON('/api/superadmin/telegram/daily' + (force ? '?force=1' : ''), { method: 'POST' });
    box.hidden = false;
    if (d.amaran && !d.dihantar) {
      box.className = 'sync-hasil warn';
      box.innerHTML = `${esc(d.mesej)}<br><b>Belum isi:</b> ${esc(d.belum.join(', '))}<div class="btn-row" style="margin-top:10px"><button id="tg-daily-force" class="btn danger" type="button">Hantar Juga</button></div>`;
      $('#tg-daily-force').addEventListener('click', () => hantarHarian(true));
    } else {
      box.className = 'sync-hasil ok'; box.innerHTML = esc(d.mesej);
      toast('Laporan harian dihantar.', 'ok');
      loadTelegram();
    }
  } catch (err) {
    box.className = 'sync-hasil err'; box.hidden = false; box.innerHTML = `Gagal: ${esc(err.message)}`;
  } finally { btn.disabled = false; btn.textContent = lbl; }
}
