import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { readTab } from './googleSheets.js';

// ── Helper kecil (replika ringkas supaya fail Fasa 2 tidak disentuh) ──
function s(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}
function headerIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    idx[s(h).toUpperCase()] = i;
  });
  return idx;
}
function normTarikh(v) {
  const str = s(v).split(' ')[0];
  let m = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return str;
  return null;
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ════════════════════════════════════════════════════════════
//  1) GET /api/audit/import-summary — kiraan ringkas (DB sahaja)
// ════════════════════════════════════════════════════════════
export async function importSummary() {
  const kelas = await pool.query(`
    SELECT COUNT(*)::int AS jumlah,
           COUNT(*) FILTER (WHERE status='aktif')::int AS aktif,
           COUNT(*) FILTER (WHERE nama = kod)::int AS tanpa_metadata,
           COUNT(*) FILTER (WHERE guru_kelas IS NULL OR guru_kelas='')::int AS tanpa_guru,
           COUNT(*) FILTER (WHERE pembantu_kelas IS NOT NULL AND pembantu_kelas<>'')::int AS ada_pembantu
    FROM classes`);
  const pelajar = await pool.query(`
    SELECT COUNT(*)::int AS jumlah,
           COUNT(DISTINCT nama)::int AS nama_unik,
           COUNT(*) FILTER (WHERE status='aktif')::int AS aktif
    FROM students`);
  const att = await pool.query(`
    SELECT COUNT(*)::int AS jumlah,
           COUNT(DISTINCT tarikh)::int AS hari_unik,
           COUNT(DISTINCT class_kod)::int AS kelas_terlibat,
           to_char(MIN(tarikh),'DD-MM-YYYY') AS tarikh_terawal,
           to_char(MAX(tarikh),'DD-MM-YYYY') AS tarikh_terakhir
    FROM attendance_records`);
  const rawTotal = await pool.query(`SELECT COUNT(*)::int AS jumlah FROM sheet_raw`);
  const rawTab = await pool.query(`
    SELECT tab_name, COUNT(*)::int AS bil FROM sheet_raw GROUP BY tab_name ORDER BY tab_name`);
  const syncStatus = await pool.query(`
    SELECT status, COUNT(*)::int AS bil FROM sync_logs GROUP BY status ORDER BY status`);
  const lastRingkasan = await pool.query(`
    SELECT dijalankan_pada, status, mesej FROM sync_logs
    WHERE jenis='RINGKASAN' ORDER BY id DESC LIMIT 1`);

  let sync_terakhir = null;
  if (lastRingkasan.rowCount > 0) {
    let butiran = null;
    try {
      butiran = JSON.parse(lastRingkasan.rows[0].mesej);
    } catch (_) {
      butiran = null;
    }
    sync_terakhir = {
      dijalankan_pada: lastRingkasan.rows[0].dijalankan_pada,
      status: lastRingkasan.rows[0].status,
      butiran,
    };
  }

  return {
    ok: true,
    dijana_pada: new Date().toISOString(),
    kelas: kelas.rows[0],
    pelajar: pelajar.rows[0],
    kehadiran: att.rows[0],
    sheet_raw: { jumlah: rawTotal.rows[0].jumlah, ikut_tab: rawTab.rows },
    sync_logs: { ikut_status: syncStatus.rows, sync_terakhir },
  };
}

// ════════════════════════════════════════════════════════════
//  2) GET /api/audit/attendance-compare — validasi formula (DB)
//     peratus = HADIR/JUMLAH*100 ; hadir = JUMLAH - TIDAK_HADIR
//     (wakil dikira HADIR). TIDAK overwrite — hanya papar beza.
// ════════════════════════════════════════════════════════════
export async function attendanceCompare() {
  const r = await pool.query(`
    SELECT r.id,
           to_char(r.tarikh,'DD-MM-YYYY') AS tarikh,
           r.class_kod, r.jumlah, r.hadir, r.tidak_hadir, r.wakil, r.peratus,
           (SELECT COUNT(*) FROM attendance_absentees a WHERE a.record_id=r.id)::int AS bil_senarai_th,
           (SELECT COUNT(*) FROM attendance_representatives w WHERE w.record_id=r.id)::int AS bil_senarai_wakil
    FROM attendance_records r
    ORDER BY r.tarikh, r.class_kod`);

  let padan = 0;
  const beza = [];
  const pecahan = {
    peratus_tak_padan: 0,
    hadir_jumlah_tak_padan: 0,
    bil_th_tak_padan: 0,
    bil_wakil_tak_padan: 0,
  };

  for (const row of r.rows) {
    const jenis = [];
    const peratusServer = row.jumlah > 0 ? round2((row.hadir / row.jumlah) * 100) : null;
    const peratusSheet = row.peratus === null ? null : Number(row.peratus);

    if (peratusSheet !== null && peratusServer !== null && Math.abs(peratusSheet - peratusServer) > 0.01) {
      jenis.push('peratus_tak_padan');
      pecahan.peratus_tak_padan++;
    }
    // Wakil dikira HADIR → (hadir + tidak_hadir) mesti == jumlah
    if (row.hadir + row.tidak_hadir !== row.jumlah) {
      jenis.push('hadir_jumlah_tak_padan');
      pecahan.hadir_jumlah_tak_padan++;
    }
    if (row.bil_senarai_th !== row.tidak_hadir) {
      jenis.push('bil_th_tak_padan');
      pecahan.bil_th_tak_padan++;
    }
    if (row.bil_senarai_wakil !== row.wakil) {
      jenis.push('bil_wakil_tak_padan');
      pecahan.bil_wakil_tak_padan++;
    }

    if (jenis.length === 0) {
      padan++;
      continue;
    }
    beza.push({
      tarikh: row.tarikh,
      kelas: row.class_kod,
      jumlah: row.jumlah,
      hadir: row.hadir,
      tidak_hadir: row.tidak_hadir,
      wakil: row.wakil,
      peratus_sheet: peratusSheet,
      peratus_server: peratusServer,
      hadir_dijangka: row.jumlah - row.tidak_hadir,
      bil_senarai_th: row.bil_senarai_th,
      bil_senarai_wakil: row.bil_senarai_wakil,
      jenis_beza: jenis,
    });
  }

  return {
    ok: true,
    dijana_pada: new Date().toISOString(),
    formula: 'peratus = HADIR / JUMLAH * 100 ; hadir = JUMLAH - TIDAK_HADIR (wakil dikira HADIR)',
    nota: 'Data lama TIDAK diubah. Hanya rekod yang ada beza dipaparkan.',
    ringkasan: {
      jumlah_rekod: r.rows.length,
      padan,
      ada_beza: beza.length,
      pecahan_beza: pecahan,
    },
    beza,
  };
}

// ════════════════════════════════════════════════════════════
//  3) GET /api/audit/warnings — isu kualiti data
// ════════════════════════════════════════════════════════════
export async function warnings() {
  // (a) Konflik guru Sheet#1 vs Sheet#2 (dari sync_logs, distinct mesej)
  const guru = await pool.query(`
    SELECT DISTINCT ON (mesej) mesej, dijalankan_pada
    FROM sync_logs WHERE jenis='SHEET1:KONFLIK_GURU'
    ORDER BY mesej, id DESC`);

  // (b) Tarikh gagal normalize (disimpan raw semasa sync)
  const tarikhGagal = await pool.query(`
    SELECT row_index, row_json, disync_pada
    FROM sheet_raw WHERE tab_name='DATA_KEHADIRAN__UNPARSED'
    ORDER BY row_index`);

  // (c) Kelas tiada metadata (heuristik: nama = kod → auto-cipta semasa sync)
  const kelasTiadaMeta = await pool.query(`
    SELECT kod, nama, guru_kelas, status FROM classes WHERE nama = kod ORDER BY kod`);

  // (d) Pelajar duplicate (nama sama merentas >1 kelas)
  const pelajarDup = await pool.query(`
    SELECT nama, COUNT(*)::int AS bil, array_agg(class_kod ORDER BY class_kod) AS kelas
    FROM students GROUP BY nama HAVING COUNT(*) > 1
    ORDER BY bil DESC, nama`);

  // (e) Attendance duplicate berdasarkan tarikh+kelas:
  //     DB dikuatkuasa UNIQUE → 0. Semak SUMBER (DATA_KEHADIRAN) untuk dup yang
  //     mungkin telah dikolaps oleh upsert. Baca read-only; langkau jika gagal.
  let attDupSumber = { dilangkau: false, senarai: [] };
  try {
    const rows = await readTab(config.sheets.kehadiranId, 'DATA_KEHADIRAN');
    if (rows.length) {
      const idx = headerIndex(rows[0]);
      const cT = idx['TARIKH'] ?? 0;
      const cK = idx['KELAS'] ?? 1;
      const seen = new Map();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const kelas = s(row[cK]);
        const t = normTarikh(row[cT]);
        if (!kelas || !t) continue;
        const key = `${t}|${kelas}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      for (const [key, bil] of seen) {
        if (bil > 1) {
          const [tarikh, kelas] = key.split('|');
          attDupSumber.senarai.push({ tarikh, kelas, bil });
        }
      }
      attDupSumber.senarai.sort((a, b) => b.bil - a.bil);
    }
  } catch (e) {
    attDupSumber = { dilangkau: true, sebab: String(e && e.message ? e.message : e), senarai: [] };
  }

  return {
    ok: true,
    dijana_pada: new Date().toISOString(),
    ringkasan: {
      konflik_guru: guru.rowCount,
      tarikh_gagal_normalize: tarikhGagal.rowCount,
      kelas_tiada_metadata: kelasTiadaMeta.rowCount,
      pelajar_duplicate: pelajarDup.rowCount,
      attendance_duplicate_db: 0,
      attendance_duplicate_sumber: attDupSumber.dilangkau ? 'dilangkau' : attDupSumber.senarai.length,
    },
    konflik_guru: guru.rows,
    tarikh_gagal_normalize: tarikhGagal.rows,
    kelas_tiada_metadata: {
      nota: 'Heuristik: nama kelas = kod (auto-cipta semasa sync, tiada dalam METADATA_KELAS).',
      senarai: kelasTiadaMeta.rows,
    },
    pelajar_duplicate: pelajarDup.rows,
    attendance_duplicate: {
      db: '0 (dikuatkuasa UNIQUE tarikh+kelas)',
      sumber_sheet: attDupSumber,
    },
  };
}
