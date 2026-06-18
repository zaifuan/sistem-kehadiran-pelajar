'use strict';

/* ============================================================
   Sebab ketidakhadiran — SALINAN TEPAT dari sistem GAS asal.
   Kategori dengan wakil:true = DIKIRA HADIR (Wakil Sekolah).
   ============================================================ */
const KATEGORI_SEBAB = [
  { nama: '🏫 AKTIVITI LUAR SEKOLAH', wakil: true, sebab: ['WAKIL SEKOLAH'] },
  { nama: '⚠️ ANCAMAN KESELAMATAN', wakil: false, sebab: [
    'BINATANG LIAR / BUAS / BERBISA', 'DICULIK', 'GANGGUAN MISTIK / MAKHLUK HALUS',
    'GANGGUAN KUMPULAN KONGSI GELAP', 'KEBAKARAN', 'PENGGANAS / LANUN',
    'RUSUHAN DI LUAR KAWASAN SEKOLAH', 'UGUTAN DARIPADA PIHAK LUAR', 'MANGSA BULI',
    'TIDAK DAPAT DIKESAN / HILANG'] },
  { nama: '🌊 BENCANA ALAM', wakil: false, sebab: [
    'JEREBU', 'KEMALANGAN', 'BANJIR', 'GEMPA BUMI', 'HUJAN LEBAT / RIBUT TAUFAN',
    'PENCEMARAN UDARA', 'KEMARAU', 'CUACA PANAS', 'CUACA PANAS EL NINO',
    'PENCEMARAN SISA KIMIA', 'PENCEMARAN ALAM', 'TANAH RUNTUH'] },
  { nama: '🚫 DIGANTUNG SEKOLAH', wakil: false, sebab: ['DIGANTUNG SEKOLAH'] },
  { nama: '👨‍👩‍👧 MASALAH KELUARGA', wakil: false, sebab: [
    'BEKERJA', 'BERPINDAH RANDAH', 'PEREBUTAN HAK PENJAGAAN ANAK',
    'MENGIKUT KELUARGA BERCUTI / BERKURSUS', 'MENJAGA / MENGURUSKAN AHLI KELUARGA',
    'MENJAGA AHLI KELUARGA YANG SAKIT', 'KEMATIAN AHLI KELUARGA TERDEKAT',
    'KEMISKINAN / KESEMPITAN HIDUP', 'MASALAH PENGANGKUTAN', 'MENZIARAHI KELUARGA YANG SAKIT',
    'BALIK KAMPUNG', 'BERPINDAH KE LUAR NEGARA', 'KRISIS KELUARGA', 'LARI DARI RUMAH'] },
  { nama: '🧠 MASALAH PERIBADI', wakil: false, sebab: [
    'TEKANAN PERASAAN / TRAUMA', 'KESAKITAN AKIBAT HAID / PERMULAAN HAID'] },
  { nama: '💻 PdPR', wakil: false, sebab: ['PEMBELAJARAN DI RUMAH'] },
  { nama: '📝 PENGGILIRAN PEPERIKSAAN', wakil: false, sebab: ['URUSAN PEPERIKSAAN'] },
  { nama: '📋 KEBENARAN PENGETUA / GURU BESAR', wakil: false, sebab: [
    'HAJI / UMRAH / KEGIATAN AGAMA', 'PEPERIKSAAN / UJIAN SELAIN KPM',
    'PERTANDINGAN / AKTIVITI SELAIN KPM', 'PROSES PERPINDAHAN SEKOLAH',
    'TERLIBAT KES JENAYAH', 'TERLIBAT KES TRAFIK', 'URUSAN RASMI AGENSI KERAJAAN',
    'LATIHAN / UJIAN LESEN MEMANDU', 'TAHANAN PIHAK BERKUASA',
    'PERLINDUNGAN JABATAN KEBAJIKAN MASYARAKAT', 'CUTI SEMESTER', 'MENJALANI LATIHAN INDUSTRI'] },
  { nama: '❌ PONTENG', wakil: false, sebab: [
    'BANGUN LEWAT', 'MALAS KE SEKOLAH', 'KETAGIHAN GAJET',
    'TIDAK MENYIAPKAN KERJA SEKOLAH', 'MALAS KE AKTIVITI KOKURIKULUM'] },
  { nama: '🏥 MASALAH KESIHATAN', wakil: false, sebab: [
    'MAKLUMAN IBU BAPA / PENJAGA', 'KECEDERAAN / PATAH TULANG', 'SURAT CUTI SAKIT HOSPITAL / KLINIK',
    'IMUNISASI RENDAH', 'DEMAM', 'TANTRUM (MBK)', 'TEMUJANJI HOSPITAL / KLINIK',
    'MENJALANI TERAPI / RAWATAN / KUARANTIN', 'TIDAK MELEPASI SARINGAN KESIHATAN (MBK)',
    'MENDAPATKAN RAWATAN TRADISIONAL', 'KEMURUNGAN', 'BATUK KOKOL', 'BEGUK / CACAR AIR',
    'CHIKUNGUNYA', 'COVID-19 BERGEJALA', 'COVID-19 DENGAN KEBENARAN IBU BAPA',
    'COVID-19 KUARANTIN', 'COVID-19 PENGGILIRAN', 'DENGGI', 'SELESEMA BABI / SWINE FLU (H1N1)',
    'HEPATITIS', 'PENYAKIT TANGAN KAKI MULUT / HFMD', 'JAPANESE ENCEPHALITIS (JE)',
    'LEPTOSPIROSIS (PENYAKIT KENCING TIKUS)', 'KUDIS BUTA', 'MALARIA', 'MERS CoV',
    'SAKIT MATA', 'SARS', 'TAUN', 'TIBI', 'SAKIT MISTIK', 'SAKIT MENTAL', 'TEKANAN EMOSI'] },
  { nama: '🏨 SEKOLAH DALAM HOSPITAL', wakil: false, sebab: ['SEKOLAH DALAM HOSPITAL'] },
];

// Susun atur grid kelas (ikut GAS)
const KELAS_GRID = [
  ['1K', '1A', '1M'],
  ['2K', '2A', '2M'],
  ['3K', '3A', '3M'],
  ['4K', '4A', '4M'],
  ['5K', '5A', '5M'],
  ['STAMLULU', 'STAMMARJAN'],
];

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
    // Sesi tamat / belum log masuk → ke halaman log masuk.
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
function tarikhHariIni() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// ── State ──
const state = {
  classesByKod: {},
  kelas: null, namaKelas: '', guru: '',
  pelajar: [],            // [nama]
  status: {},             // { nama: { jenis:'th'|'wakil', sebab } }
  currentNama: null,      // pelajar yang sedang dipilih di modal
  screen: 'kelas',
};

// ── Navigasi skrin ──
function showScreen(name) {
  state.screen = name;
  ['kelas', 'isi', 'sahkan'].forEach((s) => { $('#screen-' + s).hidden = s !== name; });
  $('#bar-ringkasan').hidden = name !== 'isi';
  $('#btn-back').hidden = name === 'kelas';
  $('#topbar-title').textContent =
    name === 'isi' ? (state.kelas || 'Isi Kehadiran') :
    name === 'sahkan' ? 'Sahkan' : 'Isi Kehadiran';
  window.scrollTo(0, 0);
}

// ── Skrin 1: grid kelas ──
async function loadGridKelas() {
  const box = $('#grid-kelas');
  try {
    const d = await fetchJSON('/api/guru/classes');
    state.classesByKod = {};
    d.kelas.forEach((k) => { state.classesByKod[k.kod] = k; });
    box.innerHTML = KELAS_GRID.flat().map((kod) => {
      const k = state.classesByKod[kod];
      const bil = k ? k.pelajar_aktif : 0;
      const isStam = kod.indexOf('STAM') === 0;
      return `<button class="kelas-btn${isStam ? ' stam' : ''}" type="button" data-kod="${esc(kod)}">
        <span class="kod">${esc(kod)}</span>
        <span class="bil num">${bil} pelajar</span>
      </button>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<div class="err">Gagal memuatkan kelas.<br><small>${esc(e.message)}</small></div>`;
  }
}

// ── Skrin 2: senarai pelajar ──
async function openKelas(kod) {
  showScreen('isi');
  state.kelas = kod; state.status = {};
  $('#isi-nama-kelas').textContent = 'Memuatkan…';
  $('#isi-guru').textContent = '';
  $('#cari-pelajar').value = '';
  $('#senarai-pelajar').innerHTML = '<div class="loading"><div class="spinner"></div>Memuatkan pelajar…</div>';
  try {
    const d = await fetchJSON('/api/guru/classes/' + encodeURIComponent(kod) + '/pelajar');
    state.namaKelas = d.nama_kelas || kod;
    state.guru = d.guru_kelas || '';
    state.pelajar = d.pelajar || [];
    $('#isi-nama-kelas').textContent = state.namaKelas + ' (' + kod + ')';
    $('#isi-guru').textContent = state.guru ? ('Guru: ' + state.guru) : 'Tiada guru kelas';
    $('#topbar-title').textContent = kod;
    renderSenarai();
    updateRingkasan();
  } catch (e) {
    $('#senarai-pelajar').innerHTML = `<div class="err">Gagal memuatkan pelajar.<br><small>${esc(e.message)}</small></div>`;
  }
}

function renderSenarai() {
  const filter = ($('#cari-pelajar').value || '').trim().toUpperCase();
  const box = $('#senarai-pelajar');
  if (!state.pelajar.length) { box.innerHTML = '<div class="empty">Tiada pelajar aktif dalam kelas ini.</div>'; return; }
  const senarai = state.pelajar.filter((n) => !filter || n.toUpperCase().indexOf(filter) !== -1);
  if (!senarai.length) { box.innerHTML = '<div class="empty">Tiada nama sepadan dengan carian.</div>'; return; }
  box.innerHTML = senarai.map((nama) => {
    const st = state.status[nama];
    if (st && st.jenis === 'wakil') {
      return `<div class="pcard is-wakil" data-nama="${esc(nama)}">
        <div class="pcol"><div class="pnama">${esc(nama)}</div><div class="pstatus wk">🎽 Wakil Sekolah · dikira hadir</div></div>
        <button class="btn-clear" type="button" data-act="clear" data-nama="${esc(nama)}">↺</button></div>`;
    }
    if (st && st.jenis === 'th') {
      return `<div class="pcard is-th" data-nama="${esc(nama)}">
        <div class="pcol"><div class="pnama">${esc(nama)}</div><div class="pstatus th">Tidak hadir · ${esc(st.sebab)}</div></div>
        <button class="btn-clear" type="button" data-act="clear" data-nama="${esc(nama)}">↺</button></div>`;
    }
    return `<div class="pcard" data-nama="${esc(nama)}">
      <div class="pcol"><div class="pnama">${esc(nama)}</div></div>
      <button class="btn-th" type="button" data-act="th" data-nama="${esc(nama)}">Tidak Hadir</button></div>`;
  }).join('');
}

function updateRingkasan() {
  const jumlah = state.pelajar.length;
  let th = 0, wk = 0;
  Object.keys(state.status).forEach((n) => {
    if (state.status[n].jenis === 'wakil') wk++;
    else if (state.status[n].jenis === 'th') th++;
  });
  $('#r-jumlah').textContent = jumlah;
  $('#r-th').textContent = th;
  $('#r-wakil').textContent = wk;
  $('#r-hadir').textContent = jumlah - th;
}

// ── Modal sebab ──
function bukaModalSebab(nama) {
  state.currentNama = nama;
  $('#sebab-nama').textContent = nama;
  $('#modal-sebab').hidden = false;
  paparKategori();
}
function tutupModalSebab() { $('#modal-sebab').hidden = true; state.currentNama = null; }

function paparKategori() {
  $('#sebab-title').textContent = 'Pilih Sebab';
  $('#sebab-back').hidden = true;
  $('#sebab-list').innerHTML = KATEGORI_SEBAB.map((cat, i) =>
    `<button class="sebab-item${cat.wakil ? ' wakil' : ''}" type="button" data-cat="${i}">
      <span>${esc(cat.nama)}</span><span class="chev">›</span></button>`
  ).join('');
  $('#sebab-list').scrollTop = 0;
}
function paparSubSebab(catIndex) {
  const cat = KATEGORI_SEBAB[catIndex];
  $('#sebab-title').textContent = cat.nama;
  $('#sebab-back').hidden = false;
  $('#sebab-list').innerHTML = cat.sebab.map((sb) =>
    `<button class="sebab-item" type="button" data-sebab="${esc(sb)}" data-cat="${catIndex}">
      <span>${esc(sb)}</span></button>`
  ).join('');
  $('#sebab-list').scrollTop = 0;
}
function pilihSebab(nama, sebab, isWakil) {
  state.status[nama] = { jenis: isWakil ? 'wakil' : 'th', sebab };
  tutupModalSebab();
  renderSenarai();
  updateRingkasan();
}

// ── Skrin 3: sahkan ──
function bukaSahkan() {
  const jumlah = state.pelajar.length;
  const th = [], wk = [];
  Object.keys(state.status).forEach((n) => {
    if (state.status[n].jenis === 'wakil') wk.push(n);
    else if (state.status[n].jenis === 'th') th.push({ nama: n, sebab: state.status[n].sebab });
  });
  const hadir = jumlah - th.length;
  $('#sah-ringkasan').innerHTML = `
    <div><b class="num">${jumlah}</b><span>Jumlah</span></div>
    <div><b class="num">${hadir}</b><span>Hadir</span></div>
    <div class="th"><b class="num">${th.length}</b><span>T/Hadir</span></div>
    <div class="wk"><b class="num">${wk.length}</b><span>Wakil</span></div>`;

  let html = '';
  if (th.length) {
    html += '<div class="sah-box"><h4>Tidak Hadir (' + th.length + ')</h4>' +
      th.map((x) => `<div class="sah-row"><span>${esc(x.nama)}</span><span class="sb">${esc(x.sebab)}</span></div>`).join('') + '</div>';
  }
  if (wk.length) {
    html += '<div class="sah-box"><h4>Wakil Sekolah (' + wk.length + ')</h4>' +
      wk.map((n) => `<div class="sah-row"><span>${esc(n)}</span><span class="sb wk">dikira hadir</span></div>`).join('') + '</div>';
  }
  if (!th.length && !wk.length) {
    html = '<div class="sah-box"><div class="sah-row"><span>Semua pelajar hadir ✅</span></div></div>';
  }
  $('#sah-senarai').innerHTML = html;
  showScreen('sahkan');
}

async function simpan() {
  const btn = $('#btn-sahkan');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const tidakHadir = [], wakil = [];
  Object.keys(state.status).forEach((n) => {
    if (state.status[n].jenis === 'wakil') wakil.push(n);
    else if (state.status[n].jenis === 'th') tidakHadir.push({ nama: n, sebab: state.status[n].sebab });
  });
  try {
    const d = await fetchJSON('/api/guru/kehadiran', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kelas: state.kelas, tidakHadir, wakil }),
    });
    toast(`Disimpan: ${d.kelas} — hadir ${d.hadir}/${d.jumlah} (${d.peratus == null ? '—' : d.peratus + '%'})`, 'ok');
    // Selesai → kembali ke grid, segarkan kiraan kelas
    await loadGridKelas();
    showScreen('kelas');
  } catch (e) {
    toast('Gagal simpan: ' + e.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Sahkan & Simpan';
  }
}

// ── Event wiring ──
$('#grid-kelas').addEventListener('click', (e) => {
  const b = e.target.closest('.kelas-btn');
  if (b) openKelas(b.dataset.kod);
});

$('#senarai-pelajar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const nama = b.dataset.nama;
  if (b.dataset.act === 'th') bukaModalSebab(nama);
  else if (b.dataset.act === 'clear') { delete state.status[nama]; renderSenarai(); updateRingkasan(); }
});

$('#cari-pelajar').addEventListener('input', renderSenarai);

$('#sebab-list').addEventListener('click', (e) => {
  const b = e.target.closest('.sebab-item');
  if (!b) return;
  if (b.dataset.sebab != null) {
    const cat = KATEGORI_SEBAB[Number(b.dataset.cat)];
    pilihSebab(state.currentNama, b.dataset.sebab, !!(cat && cat.wakil));
    return;
  }
  const idx = Number(b.dataset.cat);
  const cat = KATEGORI_SEBAB[idx];
  if (cat.sebab.length === 1) pilihSebab(state.currentNama, cat.sebab[0], !!cat.wakil);
  else paparSubSebab(idx);
});
$('#sebab-back').addEventListener('click', paparKategori);
$('#sebab-close').addEventListener('click', tutupModalSebab);
$('#modal-sebab').addEventListener('click', (e) => { if (e.target.id === 'modal-sebab') tutupModalSebab(); });

$('#btn-simpan').addEventListener('click', bukaSahkan);
$('#btn-reset').addEventListener('click', () => {
  if (!Object.keys(state.status).length) { toast('Tiada tanda untuk diset semula'); return; }
  if (confirm('Set semula? Semua tanda tidak hadir/wakil akan dibuang.')) {
    state.status = {}; renderSenarai(); updateRingkasan();
  }
});
$('#btn-sahkan').addEventListener('click', simpan);
$('#btn-batal-sah').addEventListener('click', () => showScreen('isi'));
$('#btn-back').addEventListener('click', () => {
  if (state.screen === 'sahkan') showScreen('isi');
  else showScreen('kelas');
});

// ── Mula ──
$('#tarikh-hari-ini').textContent = tarikhHariIni();
loadGridKelas();
