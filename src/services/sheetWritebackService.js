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
