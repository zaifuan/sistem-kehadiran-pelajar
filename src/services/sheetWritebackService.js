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
