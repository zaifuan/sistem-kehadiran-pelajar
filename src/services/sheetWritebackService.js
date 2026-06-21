import { config } from '../config.js';
import { readTab, updateRange, appendRows } from './googleSheets.js';

// ════════════════════════════════════════════════════════════
//  WRITE-BACK DATA_KEHADIRAN (Fasa B)
//  Meniru penulisan GAS lama ke tab DATA_KEHADIRAN SAHAJA.
//  - Hormat config.writeback (enabled/dryRun) sepenuhnya.
//  - DRY_RUN: updateRange/appendRows hanya LOG payload, tiada API write.
//  - Tidak menyentuh T1–T5/STAM/PERATUS HARIANMINGGUAN/LAPORAN_BULANAN.
// ════════════════════════════════════════════════════════════

const TAB = 'DATA_KEHADIRAN';

// Normalisasi ringkas tarikh untuk perbandingan (readTab pulang FORMATTED_VALUE = teks).
function normTarikh(v) {
  return String(v == null ? '' : v).trim().replace(/\//g, '-');
}

// Bina satu baris DATA_KEHADIRAN (A–L) IKUT FORMAT GAS LAMA (kehadiran.gs simpanTabData).
//   A TARIKH(DD-MM-YYYY)  B KELAS  C NAMA_KELAS(formal)  D GURU  E JUMLAH  F HADIR
//   G TIDAK_HADIR  H WAKIL  I PERATUS("90.00%")  J SENARAI_TH  K SENARAI_WAKIL  L MASA(HH:MM)
export function buildDataKehadiranRow(f) {
  const tidakHadir = Array.isArray(f.tidakHadir) ? f.tidakHadir : [];
  const wakil = Array.isArray(f.wakil) ? f.wakil : [];
  const jumlah = Number(f.jumlah) || 0;
  const hadir = Number(f.hadir) || 0;
  // GAS: jumlah>0 ? (hadir/jumlah*100).toFixed(2)+'%' : '0%'
  const peratus = jumlah > 0 ? ((hadir / jumlah) * 100).toFixed(2) + '%' : '0%';
  // GAS: tidakHadir.map(p => p.nama+'('+p.sebab+')').join(' | ')
  const senaraiTH = tidakHadir.map((p) => `${s(p && p.nama)}(${s(p && p.sebab)})`).join(' | ');
  // GAS: wakilSekolah.join(' | ')
  const senaraiWakil = wakil.map((n) => s(n)).join(' | ');
  return [
    f.tarikh,                 // A TARIKH
    f.kelas,                  // B KELAS
    f.namaKelas || f.kelas,   // C NAMA_KELAS (formal)
    f.guru || '',             // D GURU
    jumlah,                   // E JUMLAH
    hadir,                    // F HADIR
    tidakHadir.length,        // G TIDAK_HADIR
    wakil.length,             // H WAKIL
    peratus,                  // I PERATUS
    senaraiTH,                // J SENARAI_TH
    senaraiWakil,             // K SENARAI_WAKIL
    f.masa || '',             // L MASA
  ];
}

function s(v) {
  return v == null ? '' : String(v).trim();
}

// Cari nombor baris (1-based; baris 1 = header) bagi (tarikh, kelas).
// Padanan GAS: normTarikh(colA)===tarikh && colB===kelas. Pulang -1 jika tiada.
export function cariBarisDataKehadiran(rows, tarikh, kelas) {
  const tt = normTarikh(tarikh);
  const kk = s(kelas);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (normTarikh(r[0]) === tt && s(r[1]) === kk) return i + 1;
  }
  return -1;
}

// Write-back satu rekod ke DATA_KEHADIRAN (upsert ikut tarikh+kelas).
//   1. Baca tab → cari baris (tarikh,kelas).
//   2. Jumpa  → UPDATE julat baris sama (A{n}:L{n}).
//      Tiada → APPEND satu baris (A:L).
//   - WRITEBACK_ENABLED=false → tiada apa berlaku (tiada baca, tiada tulis).
//   - DRY_RUN=true → updateRange/appendRows hanya log (tiada API write).
//   - deps boleh disuntik untuk ujian: { readTab, updateRange, appendRows }.
export async function writeBackDataKehadiran(fields, deps = {}) {
  if (!config.writeback || !config.writeback.enabled) {
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED' };
  }
  const sid = config.writeback.spreadsheetId;
  if (!sid) return { ok: false, skipped: true, reason: 'NO_SPREADSHEET_ID' };

  const _readTab = deps.readTab || readTab;
  const _updateRange = deps.updateRange || updateRange;
  const _appendRows = deps.appendRows || appendRows;

  const row = buildDataKehadiranRow(fields);

  // 1. Baca tab untuk cari baris (tarikh,kelas) sedia ada.
  const rows = await _readTab(sid, TAB);
  const rowNum = cariBarisDataKehadiran(rows, fields.tarikh, fields.kelas);

  // 2. UPDATE jika jumpa (baris sama — elak duplicate); APPEND jika tidak.
  if (rowNum > 0) {
    return _updateRange(sid, `${TAB}!A${rowNum}:L${rowNum}`, [row]);
  }
  return _appendRows(sid, `${TAB}!A:L`, [row]);
}


// ════════════════════════════════════════════════════════════
//  WRITE-BACK TAB TINGKATAN (Fasa C) — DRY-RUN sahaja
//  Tulis nilai kelas (HADIR/JUMLAH/PERATUS) ke tab T1–T5/STAM,
//  pada sel (baris kelas × lajur tarikh) — MENIRU GAS lama.
//  Fasa C: dry-run sahaja. Tulisan LIVE + recompute % HARIAN/MINGGUAN = Fasa D.
//  Tidak menyentuh PERATUS HARIANMINGGUAN / LAPORAN_BULANAN.
// ════════════════════════════════════════════════════════════

// Susun atur tab tingkatan — IKUT GAS config.gs (TABS_CONFIG).
// rowHadir/rowJumlah/rowPeratus = baris HEADER tarikh setiap blok.
// Sel kelas = row + 1 + indexKelas.
const TAB_TINGKATAN = {
  T1:   { kelas: ['1K', '1A', '1M'],          rowHadir: 5, rowJumlah: 11, rowPeratus: 17 },
  T2:   { kelas: ['2K', '2A', '2M'],          rowHadir: 5, rowJumlah: 11, rowPeratus: 17 },
  T3:   { kelas: ['3K', '3A', '3M'],          rowHadir: 5, rowJumlah: 11, rowPeratus: 17 },
  T4:   { kelas: ['4K', '4A', '4M'],          rowHadir: 5, rowJumlah: 11, rowPeratus: 17 },
  T5:   { kelas: ['5K', '5A', '5M'],          rowHadir: 5, rowJumlah: 11, rowPeratus: 17 },
  STAM: { kelas: ['STAMLULU', 'STAMMARJAN'],  rowHadir: 5, rowJumlah: 9,  rowPeratus: 13 },
};

// Cari tab + indexKelas dari class_kod. Pulang null jika bukan kelas tingkatan.
export function cariTabTingkatan(kelas) {
  const kk = s(kelas);
  for (const [tab, cfg] of Object.entries(TAB_TINGKATAN)) {
    const idx = cfg.kelas.indexOf(kk);
    if (idx >= 0) return { tab, cfg, idx };
  }
  return null;
}

// Nombor lajur (1-based) → huruf A1 (1→A, 26→Z, 27→AA…).
export function colLetter(n) {
  let out = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

// Cari lajur (1-based) yang header tarikhnya = tarikh, pada baris rowHadir.
// Pulang -1 jika tiada. (Padanan GAS: scan rowHadir dari lajur B.)
export function cariLajurTarikh(rows, rowHadir, tarikh) {
  const hdr = rows[rowHadir - 1] || [];
  const tt = normTarikh(tarikh);
  for (let c = 1; c < hdr.length; c++) { // c=1 → lajur B
    if (normTarikh(hdr[c]) === tt) return c + 1;
  }
  return -1;
}

function logMatriksDryRun(o) {
  const baris = [
    '[WRITEBACK-DRYRUN]',
    `Spreadsheet: ${o.sid}`,
    `Tab: ${o.tab}  (kelas ${o.kelas}, index ${o.idx})`,
    `Tarikh: ${o.tarikh}`,
    o.adaLajur
      ? `Operation: UPDATE  (lajur tarikh dijumpai di ${o.lajur})`
      : `Operation: CREATE_COLUMN+UPDATE  (lajur tarikh TIADA → cadang lajur ${o.lajur}; TIDAK ditulis)`,
  ];
  o.sel.forEach((c) => baris.push(`  ${c.range} = ${c.label.padEnd(7)} : ${c.value}`));
  baris.push('PERATUS = pecahan nombor (format sel 0.00%), bukan string.');
  if (!o.adaLajur) {
    baris.push("Nota: penempatan tepat lajur (sebelum lajur 'PERATUS MINGGUAN') + tulis header tarikh = Fasa D.");
  }
  baris.push(`TODO (Fasa D): % HARIAN sekolah baris ${o.rowSekolah}; % MINGGUAN; PERATUS HARIANMINGGUAN.`);
  baris.push('Tiada API write dipanggil.');
  console.log(baris.join('\n'));
}

// Write-back nilai kelas ke tab tingkatan (DRY-RUN sahaja untuk Fasa C).
export async function writeBackTabTingkatan(fields, deps = {}) {
  if (!config.writeback || !config.writeback.enabled) {
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED' };
  }
  const sid = config.writeback.spreadsheetId;
  if (!sid) return { ok: false, skipped: true, reason: 'NO_SPREADSHEET_ID' };

  const found = cariTabTingkatan(fields.kelas);
  if (!found) return { ok: false, skipped: true, reason: 'KELAS_BUKAN_TINGKATAN', kelas: fields.kelas };
  const { tab, cfg, idx } = found;

  const _readTab = deps.readTab || readTab;
  const rows = await _readTab(sid, tab);

  const colNum = cariLajurTarikh(rows, cfg.rowHadir, fields.tarikh);
  const adaLajur = colNum > 0;
  const hdr = rows[cfg.rowHadir - 1] || [];
  const useCol = adaLajur ? colNum : hdr.length + 1; // append ringkas; penempatan tepat = Fasa D
  const L = colLetter(useCol);

  const jumlah = Number(fields.jumlah) || 0;
  const hadir = Number(fields.hadir) || 0;
  const peratusNum = jumlah > 0 ? hadir / jumlah : 0; // GAS: pecahan, format sel 0.00%

  const sel = [
    { range: `${tab}!${L}${cfg.rowHadir + 1 + idx}`,   label: 'HADIR',   value: hadir },
    { range: `${tab}!${L}${cfg.rowJumlah + 1 + idx}`,  label: 'JUMLAH',  value: jumlah },
    { range: `${tab}!${L}${cfg.rowPeratus + 1 + idx}`, label: 'PERATUS', value: peratusNum },
  ];
  const rowSekolah = cfg.rowPeratus + cfg.kelas.length + 1; // % HARIAN sekolah (Fasa D)
  const op = adaLajur ? 'UPDATE' : 'CREATE_COLUMN+UPDATE';

  // Fasa C: DRY-RUN sahaja. Tulisan LIVE ditangguh ke Fasa D (perlu recompute agregat).
  if (config.writeback.dryRun) {
    logMatriksDryRun({ sid, tab, kelas: fields.kelas, idx, tarikh: fields.tarikh, adaLajur, lajur: L, sel, rowSekolah });
    return { ok: true, dryRun: true, tab, op, lajur: L, adaLajur, sel, rowSekolah };
  }
  console.warn(`[WRITEBACK] Tab tingkatan ${tab}: tulisan LIVE ditangguh ke Fasa D — dilangkau (non-fatal).`);
  return { ok: false, skipped: true, reason: 'LIVE_DEFERRED_FASA_D', tab, op, sel };
}


// ════════════════════════════════════════════════════════════
//  PERATUS HARIANMINGGUAN + AGREGAT HARIAN (Fasa D) — DRY-RUN sahaja
//  - Sel peratus kelas + baris 20 (% sekolah) dalam PERATUS HARIANMINGGUAN.
//  - Agregat harian tingkatan: T1–T5 baris 21 / STAM baris 16.
//  - Nilai = pecahan (0.9), format sel 0.00% (IKUT GAS).
//  - Agregat MINGGUAN: lihat Fasa D2.
//  - Tiada tulisan LIVE (Fasa D kekal fail-safe).
// ════════════════════════════════════════════════════════════

const TAB_PERATUS = 'PERATUS HARIANMINGGUAN';

// Baris kelas dalam PERATUS HARIANMINGGUAN — IKUT GAS ROW_PERATUS_TAB.
const ROW_PERATUS_TAB = {
  '1K': 2,  '1A': 3,  '1M': 4,
  '2K': 5,  '2A': 6,  '2M': 7,
  '3K': 8,  '3A': 9,  '3M': 10,
  '4K': 11, '4A': 12, '4M': 13,
  '5K': 14, '5A': 15, '5M': 16,
  'STAMLULU': 17, 'STAMMARJAN': 18,
};
const ROW_PERATUS_SEKOLAH = 20; // % HARIAN sekolah

function pecahan(hadir, jumlah) {
  return jumlah > 0 ? hadir / jumlah : 0;
}

// Kira agregat HARIAN (meniru GAS):
//   sekolah   = SUM(hadir)/SUM(jumlah) atas kelas SUDAH disimpan hari ini (tiada fallback).
//   tingkatan = SUM(hadir saved) / [SUM(jumlah saved) + SUM(jumlah_aktif kelas tab BELUM disimpan)]
//               (fallback GAS: kelas belum isi → tambah jumlah pelajar ke penyebut).
export function kiraAgregatHarian(hariIni, roster) {
  let sH = 0, sJ = 0;
  for (const r of hariIni || []) { sH += Number(r.hadir) || 0; sJ += Number(r.jumlah) || 0; }
  const saved = new Map((hariIni || []).map((r) => [r.class_kod, r]));
  const tingkatan = {};
  for (const c of roster || []) {
    const tg = c.tingkatan;
    if (!tg) continue;
    if (!tingkatan[tg]) tingkatan[tg] = { hadir: 0, jumlah: 0 };
    const rec = saved.get(c.kod);
    if (rec) { tingkatan[tg].hadir += Number(rec.hadir) || 0; tingkatan[tg].jumlah += Number(rec.jumlah) || 0; }
    else { tingkatan[tg].jumlah += Number(c.jumlah_aktif) || 0; }
  }
  return { sekolah: { hadir: sH, jumlah: sJ }, tingkatan };
}

// Write-back PERATUS HARIANMINGGUAN (sel kelas + % sekolah) + agregat harian tingkatan. DRY-RUN.
export async function writeBackPeratusDanAgregat(fields, data = {}, deps = {}) {
  if (!config.writeback || !config.writeback.enabled) {
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED' };
  }
  const sid = config.writeback.spreadsheetId;
  if (!sid) return { ok: false, skipped: true, reason: 'NO_SPREADSHEET_ID' };

  const _readTab = deps.readTab || readTab;
  const agg = kiraAgregatHarian(data.hariIni || [], data.roster || []);
  const sel = [];

  const rowsP = await _readTab(sid, TAB_PERATUS);
  const colP = cariLajurTarikh(rowsP, 1, fields.tarikh);
  const adaP = colP > 0;
  const LP = colLetter(adaP ? colP : ((rowsP[0] || []).length + 1));
  const rowKelas = ROW_PERATUS_TAB[fields.kelas];
  if (rowKelas) {
    sel.push({ range: `'${TAB_PERATUS}'!${LP}${rowKelas}`, label: `PERATUS_KELAS(${fields.kelas})`,
      value: pecahan(Number(fields.hadir) || 0, Number(fields.jumlah) || 0) });
  }
  sel.push({ range: `'${TAB_PERATUS}'!${LP}${ROW_PERATUS_SEKOLAH}`, label: '% HARIAN SEKOLAH',
    value: pecahan(agg.sekolah.hadir, agg.sekolah.jumlah) });

  const found = cariTabTingkatan(fields.kelas);
  let adaT = true, LT = null, rowAgg = null;
  if (found) {
    const rowsT = await _readTab(sid, found.tab);
    const colT = cariLajurTarikh(rowsT, found.cfg.rowHadir, fields.tarikh);
    adaT = colT > 0;
    LT = colLetter(adaT ? colT : ((rowsT[found.cfg.rowHadir - 1] || []).length + 1));
    rowAgg = found.cfg.rowPeratus + found.cfg.kelas.length + 1;
    const tg = agg.tingkatan[found.tab] || { hadir: 0, jumlah: 0 };
    sel.push({ range: `${found.tab}!${LT}${rowAgg}`, label: `% HARIAN ${found.tab}`,
      value: pecahan(tg.hadir, tg.jumlah) });
  }

  const op = (adaP && adaT) ? 'UPDATE' : 'CREATE_COLUMN+UPDATE';

  if (config.writeback.dryRun) {
    const baris = [
      '[WRITEBACK-DRYRUN]', `Spreadsheet: ${sid}`,
      'Modul: PERATUS HARIANMINGGUAN + AGREGAT HARIAN', `Tarikh: ${fields.tarikh}`,
      adaP ? `Lajur tarikh '${TAB_PERATUS}': ${LP} (dijumpai)` : `Lajur tarikh '${TAB_PERATUS}': ${LP} (TIADA → cadang; TIDAK ditulis)`,
    ];
    if (found) baris.push(adaT ? `Lajur tarikh ${found.tab}: ${LT} (dijumpai)` : `Lajur tarikh ${found.tab}: ${LT} (TIADA → cadang; TIDAK ditulis)`);
    baris.push(`Operation: ${op}`);
    sel.forEach((c) => baris.push(`  ${c.range} = ${c.label} : ${c.value}`));
    baris.push('PERATUS = pecahan nombor (format sel 0.00%), bukan string.');
    baris.push('Tiada API write dipanggil.');
    console.log(baris.join('\n'));
    return { ok: true, dryRun: true, op, sel, lajurPeratus: LP, adaLajurPeratus: adaP, lajurTingkatan: LT, adaLajurTingkatan: adaT, agregat: agg };
  }
  console.warn('[WRITEBACK] PERATUS/agregat: tulisan LIVE ditangguh — dilangkau (non-fatal).');
  return { ok: false, skipped: true, reason: 'LIVE_DEFERRED', op, sel };
}


// ════════════════════════════════════════════════════════════
//  AGREGAT MINGGUAN + LAJUR PERATUS MINGGUAN (Fasa D2) — DRY-RUN sahaja
//  Tiru GAS: cariJumaat, tarikhMingguDari, kiraPeratusMingguanTab,
//            kiraPeratusMingguanPeratusTab, janaPeratusMingguanUntuk.
//  - Minggu = Isnin–Jumaat; hanya dicetus jika hari simpan Isnin–Jumaat.
//  - Nilai kelas = ΣHadir(minggu)/ΣJumlah(minggu) — TIADA fallback (ikut GAS).
//  - Sekolah = Σ semua kelas (minggu) → PERATUS HARIANMINGGUAN baris 20.
//  - Tab T{n}: hanya sel kelas (GAS tidak tulis baris sekolah/tingkatan di tab).
//  - Lajur MINGGUAN = selepas lajur tarikh TERAKHIR minggu; jika tiada → CREATE (tidak ditulis).
// ════════════════════════════════════════════════════════════

const _RE_TARIKH = /^\d{2}-\d{2}-\d{4}$/;

// Tarikh (DD-MM-YYYY) ⇄ Date UTC (selamat zon waktu — hari kalendar tetap).
function _parseDMY(str) {
  const [d, m, y] = String(str).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function _fmtDMY(dt) {
  return String(dt.getUTCDate()).padStart(2, '0') + '-' +
         String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + dt.getUTCFullYear();
}
function _toIso(dmy) {
  const [d, m, y] = String(dmy).split('-');
  return `${y}-${m}-${d}`;
}

// GAS cariJumaat: Ahad(0)→+5, Sabtu(6)→−1, Isnin–Jumaat→5−day.
export function cariJumaat(tarikhStr) {
  const d = _parseDMY(tarikhStr);
  const day = d.getUTCDay();
  const offset = day === 0 ? 5 : day === 6 ? -1 : 5 - day;
  const j = new Date(d);
  j.setUTCDate(d.getUTCDate() + offset);
  return _fmtDMY(j);
}

// GAS tarikhMingguDari: dari Jumaat → [Isnin..Jumaat] (5 tarikh DD-MM-YYYY).
export function tarikhMingguDari(tarikhJumaat) {
  const f = _parseDMY(tarikhJumaat);
  const out = [];
  for (let dd = 4; dd >= 0; dd--) {
    const t = new Date(f);
    t.setUTCDate(f.getUTCDate() - dd);
    out.push(_fmtDMY(t));
  }
  return out;
}

// Maklumat minggu untuk satu tarikh simpan (DD-MM-YYYY).
export function kiraMinggu(tarikhDisplay) {
  const day = _parseDMY(tarikhDisplay).getUTCDay();
  const hariMinggu = day >= 1 && day <= 5; // GAS hanya kira mingguan jika Isnin–Jumaat
  const jumaat = cariJumaat(tarikhDisplay);
  const tarikhMinggu = tarikhMingguDari(jumaat);
  return { hariMinggu, day, jumaat, tarikhMinggu,
    isninIso: _toIso(tarikhMinggu[0]), jumaatIso: _toIso(tarikhMinggu[4]) };
}

// Cari lajur tarikh TERAKHIR minggu (1-based) pada baris header tertentu; -1 jika tiada.
function _lajurTarikhTerakhirMinggu(rows, rowHeader, tarikhMinggu) {
  const hdr = rows[rowHeader - 1] || [];
  let kolum = -1;
  for (let col = 2; col <= hdr.length; col++) {
    if (tarikhMinggu.indexOf(normTarikh(hdr[col - 1])) !== -1) kolum = col;
  }
  return kolum;
}

// Write-back agregat MINGGUAN (PERATUS HARIANMINGGUAN semua kelas + sekolah; tab T{n} sel kelas). DRY-RUN.
//   data = { mg: kiraMinggu(...), mingguRows: [{class_kod, tingkatan, hadir, jumlah}] (jumlah Isnin–Jumaat) }.
export async function writeBackMingguan(fields, data = {}, deps = {}) {
  if (!config.writeback || !config.writeback.enabled) {
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED' };
  }
  const sid = config.writeback.spreadsheetId;
  if (!sid) return { ok: false, skipped: true, reason: 'NO_SPREADSHEET_ID' };

  const mg = data.mg || kiraMinggu(fields.tarikh);
  if (!mg.hariMinggu) return { ok: false, skipped: true, reason: 'BUKAN_ISNIN_JUMAAT', mg };

  const _readTab = deps.readTab || readTab;

  // Peta mingguan per kelas (DB; TIADA fallback) + jumlah sekolah.
  const wk = new Map();
  let sekolahH = 0, sekolahJ = 0;
  for (const r of data.mingguRows || []) {
    wk.set(r.class_kod, { hadir: Number(r.hadir) || 0, jumlah: Number(r.jumlah) || 0 });
    sekolahH += Number(r.hadir) || 0;
    sekolahJ += Number(r.jumlah) || 0;
  }

  const selP = [];
  const selT = [];

  // ── PERATUS HARIANMINGGUAN (tarikh di baris 1; scan MINGGUAN sehingga jumpa/tarikh) ──
  const rowsP = await _readTab(sid, TAB_PERATUS);
  const hdr1 = rowsP[0] || [];
  const kTT = _lajurTarikhTerakhirMinggu(rowsP, 1, mg.tarikhMinggu);
  let infoP = { ada: false };
  if (kTT > 0) {
    let kM = -1;
    for (let col = kTT + 1; col <= hdr1.length; col++) {
      const v = normTarikh(hdr1[col - 1]);
      if (v.indexOf('MINGGUAN') !== -1) { kM = col; break; }
      if (_RE_TARIKH.test(v)) break;
    }
    const adaM = kM > 0;
    const useCol = adaM ? kM : kTT + 1;
    const L = colLetter(useCol);
    infoP = { ada: true, adaM, L, useCol, kTT };
    for (const [k, row] of Object.entries(ROW_PERATUS_TAB)) {
      const d = wk.get(k);
      if (d && d.jumlah > 0) {
        selP.push({ range: `'${TAB_PERATUS}'!${L}${row}`, label: `MINGGUAN(${k})`, value: d.hadir / d.jumlah });
      }
    }
    if (sekolahJ > 0) {
      selP.push({ range: `'${TAB_PERATUS}'!${L}${ROW_PERATUS_SEKOLAH}`, label: 'MINGGUAN SEKOLAH', value: sekolahH / sekolahJ });
    }
  }

  // ── Tab T{n}/STAM kelas yang disimpan (tarikh di rowHadir; MINGGUAN = lajur sejurus selepas) ──
  const found = cariTabTingkatan(fields.kelas);
  let infoT = { tab: null };
  if (found) {
    const rowsT = await _readTab(sid, found.tab);
    const hdrH = rowsT[found.cfg.rowHadir - 1] || [];
    const kTTt = _lajurTarikhTerakhirMinggu(rowsT, found.cfg.rowHadir, mg.tarikhMinggu);
    if (kTTt > 0) {
      let kMt = -1;
      const colSelepas = kTTt + 1;
      if (colSelepas <= hdrH.length && normTarikh(hdrH[colSelepas - 1]).indexOf('MINGGUAN') !== -1) kMt = colSelepas;
      const adaMt = kMt > 0;
      const useColT = adaMt ? kMt : kTTt + 1;
      const LT = colLetter(useColT);
      infoT = { tab: found.tab, ada: true, adaM: adaMt, L: LT, useCol: useColT, kTT: kTTt };
      found.cfg.kelas.forEach((k, i) => {
        const d = wk.get(k);
        if (d && d.jumlah > 0) {
          selT.push({ range: `${found.tab}!${LT}${found.cfg.rowPeratus + 1 + i}`, label: `MINGGUAN(${k})`, value: d.hadir / d.jumlah });
        }
      });
    } else {
      infoT = { tab: found.tab, ada: false };
    }
  }

  const adaSemua = (infoP.ada && infoP.adaM) && (!found || (infoT.ada && infoT.adaM));
  const op = adaSemua ? 'UPDATE' : 'CREATE_WEEKLY_COLUMN+UPDATE';

  if (config.writeback.dryRun) {
    const baris = [
      '[WRITEBACK-DRYRUN]', `Spreadsheet: ${sid}`,
      'Modul: AGREGAT MINGGUAN (lajur PERATUS MINGGUAN)',
      `Tarikh simpan: ${fields.tarikh} (Jumaat minggu: ${mg.jumaat})`,
      `Minggu (Isnin–Jumaat): ${mg.tarikhMinggu.join(', ')}`,
    ];
    if (infoP.ada) {
      baris.push(infoP.adaM
        ? `'${TAB_PERATUS}' lajur MINGGUAN: ${infoP.L} (wujud)`
        : `'${TAB_PERATUS}' lajur MINGGUAN: ${infoP.L} (TIADA → CREATE selepas lajur tarikh terakhir minggu; TIDAK ditulis)`);
    } else {
      baris.push(`'${TAB_PERATUS}': tiada lajur tarikh minggu ini → mingguan dilangkau (ikut GAS).`);
    }
    if (found) {
      if (infoT.ada) {
        baris.push(infoT.adaM ? `${found.tab} lajur MINGGUAN: ${infoT.L} (wujud)` : `${found.tab} lajur MINGGUAN: ${infoT.L} (TIADA → CREATE; TIDAK ditulis)`);
      } else {
        baris.push(`${found.tab}: tiada lajur tarikh minggu ini → mingguan dilangkau (ikut GAS).`);
      }
    }
    baris.push(`Operation: ${op}`);
    baris.push(`-- PERATUS HARIANMINGGUAN (${selP.length} sel) --`);
    selP.forEach((c) => baris.push(`  ${c.range} = ${c.label} : ${c.value}`));
    if (found) {
      baris.push(`-- ${found.tab} (${selT.length} sel kelas; GAS tidak tulis baris sekolah/tingkatan di tab) --`);
      selT.forEach((c) => baris.push(`  ${c.range} = ${c.label} : ${c.value}`));
    }
    baris.push('Nilai = pecahan (format sel 0.00%). Tiada fallback mingguan (ikut GAS).');
    baris.push('Tiada API write dipanggil.');
    console.log(baris.join('\n'));
    return { ok: true, dryRun: true, op, mg, selP, selT, infoP, infoT };
  }
  console.warn('[WRITEBACK] Mingguan: tulisan LIVE ditangguh — dilangkau (non-fatal).');
  return { ok: false, skipped: true, reason: 'LIVE_DEFERRED', op };
}


// ════════════════════════════════════════════════════════════
//  LAPORAN_BULANAN (Fasa E) — DRY-RUN sahaja
//  Tiru GAS: semakDanSimpanBulanan + simpanLaporanBulananSheets.
//  - Dijana HANYA pada HARI TERAKHIR BULAN (new Date(tahun,bulan,0)).
//  - 22 lajur: A BULAN/TAHUN, B BIL HARI, C–S 17 kelas (% atau '-'),
//    T JUMLAH HADIR, U JUMLAH PELAJAR, V PERATUS SEKOLAH.
//  - Upsert ikut labelBulan (lajur A): jumpa → UPDATE baris sama; tiada → APPEND (lastRow+1).
//  - Tiada tulisan LIVE.
// ════════════════════════════════════════════════════════════

const TAB_LAPORAN = 'LAPORAN_BULANAN';
const BULAN_NAMA = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
  'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
// Urutan kelas untuk lajur C–S (IKUT GAS urutanKelas / header).
const URUTAN_KELAS_BULANAN = ['1K', '1A', '1M', '2K', '2A', '2M', '3K', '3A', '3M',
  '4K', '4A', '4M', '5K', '5A', '5M', 'STAMLULU', 'STAMMARJAN'];
const TAJUK_BULANAN = ['BULAN/TAHUN', 'BIL HARI', ...URUTAN_KELAS_BULANAN,
  'JUMLAH HADIR', 'JUMLAH PELAJAR', 'PERATUS SEKOLAH'];

// Maklumat bulan untuk satu tarikh simpan (DD-MM-YYYY) — termasuk julat ISO & status hari terakhir.
export function infoBulan(tarikhDisplay) {
  const [d, m, y] = String(tarikhDisplay).split('-').map(Number);
  const hariAkhir = new Date(Date.UTC(y, m, 0)).getUTCDate(); // hari terakhir bulan (m 1-indeks)
  const isAkhir = d === hariAkhir;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    isAkhir, hari: d, bulan: m, tahun: y, hariAkhir,
    labelBulan: `${BULAN_NAMA[m - 1]} ${y}`,
    mulaIso: `${y}-${String(m).padStart(2, '0')}-01`,
    tamatIso: `${ny}-${String(nm).padStart(2, '0')}-01`, // first day next month (eksklusif)
  };
}

// Bina baris LAPORAN_BULANAN (22 lajur) IKUT GAS.
//   bulanData: [{class_kod, hadir, jumlah}] (ΣHadir/ΣJumlah sebulan)   bilHari: hari berbeza
export function buildLaporanBulananRow(inf, bulanData, bilHari) {
  const map = new Map((bulanData || []).map((r) => [r.class_kod, r]));
  let totalH = 0, totalJ = 0;
  const peratusKelas = {};
  for (const k of URUTAN_KELAS_BULANAN) {
    const r = map.get(k);
    const h = r ? Number(r.hadir) || 0 : 0;
    const j = r ? Number(r.jumlah) || 0 : 0;
    totalH += h; totalJ += j;
    peratusKelas[k] = j > 0 ? (h / j * 100).toFixed(2) + '%' : '-';
  }
  const peratusSekolah = totalJ > 0 ? (totalH / totalJ * 100).toFixed(2) + '%' : '-';
  const row = [inf.labelBulan, Number(bilHari) || 0,
    ...URUTAN_KELAS_BULANAN.map((k) => peratusKelas[k]),
    totalH, totalJ, peratusSekolah];
  return { row, totalH, totalJ, peratusSekolah };
}

function logLaporanDryRun(sid, op, range, inf, row) {
  const baris = [
    '[WRITEBACK-DRYRUN]', `Spreadsheet: ${sid}`, 'Modul: LAPORAN_BULANAN',
    `Bulan: ${inf.labelBulan} (HARI TERAKHIR BULAN = ${inf.hariAkhir})`,
    `Operation: ${op}`, `Range: ${range}`, 'Payload (22 lajur):',
  ];
  row.forEach((v, i) => baris.push(`  ${colLetter(i + 1)} ${TAJUK_BULANAN[i]} : ${v}`));
  baris.push('Bulan sama dijana semula → UPDATE baris sama (bukan pendua).');
  baris.push('Tiada API write dipanggil.');
  console.log(baris.join('\n'));
}

// Write-back LAPORAN_BULANAN. DRY-RUN sahaja. data = { bulanData, bilHari }.
export async function writeBackLaporanBulanan(fields, data = {}, deps = {}) {
  if (!config.writeback || !config.writeback.enabled) {
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED' };
  }
  const sid = config.writeback.spreadsheetId;
  if (!sid) return { ok: false, skipped: true, reason: 'NO_SPREADSHEET_ID' };

  const inf = infoBulan(fields.tarikh);

  // GAS: hanya jana pada hari terakhir bulan. Hari biasa → SKIP.
  if (!inf.isAkhir) {
    if (config.writeback.dryRun) {
      console.log([
        '[WRITEBACK-DRYRUN]', 'Modul: LAPORAN_BULANAN', `Tarikh: ${fields.tarikh}`,
        `SKIP — bukan hari terakhir bulan (hari terakhir ${inf.labelBulan} = ${inf.hariAkhir}).`,
        'Tiada API write dipanggil.',
      ].join('\n'));
    }
    return { ok: false, skipped: true, reason: 'BUKAN_HARI_TERAKHIR_BULAN', inf };
  }

  const bilHari = Number(data.bilHari) || 0;
  // GAS: hariSet.size === 0 → tiada data, tidak tulis.
  if (bilHari === 0) {
    if (config.writeback.dryRun) {
      console.log(['[WRITEBACK-DRYRUN]', 'Modul: LAPORAN_BULANAN',
        `${inf.labelBulan}: tiada data rekod bulan ini — dilangkau (ikut GAS).`,
        'Tiada API write dipanggil.'].join('\n'));
    }
    return { ok: false, skipped: true, reason: 'TIADA_DATA_BULAN', inf };
  }

  const { row } = buildLaporanBulananRow(inf, data.bulanData || [], bilHari);
  const lastColL = colLetter(row.length); // V (22)

  const _readTab = deps.readTab || readTab;
  const rows = await _readTab(sid, TAB_LAPORAN);

  // Cari baris ikut labelBulan di lajur A (mulai baris 2). Jumpa → UPDATE; tiada → APPEND (lastRow+1).
  let rowTarget = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String((rows[i] || [])[0] || '').trim() === inf.labelBulan) { rowTarget = i + 1; break; }
  }
  const adaBaris = rowTarget > 0;
  const barisGuna = adaBaris ? rowTarget : (rows.length + 1);
  const range = `${TAB_LAPORAN}!A${barisGuna}:${lastColL}${barisGuna}`;
  const op = adaBaris ? 'UPDATE' : 'APPEND';

  if (config.writeback.dryRun) {
    logLaporanDryRun(sid, op, range, inf, row);
    return { ok: true, dryRun: true, op, range, row, inf };
  }
  console.warn('[WRITEBACK] LAPORAN_BULANAN: tulisan LIVE ditangguh — dilangkau (non-fatal).');
  return { ok: false, skipped: true, reason: 'LIVE_DEFERRED', op, range };
}
