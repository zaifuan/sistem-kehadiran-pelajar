import { pool } from '../db/pool.js';

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/summary
//  Kiraan ringkas + peratus keseluruhan (terkumpul: ΣHADIR/ΣJUMLAH).
// ════════════════════════════════════════════════════════════
export async function summary() {
  const pelajar = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status='aktif')::int AS aktif,
           COUNT(*)::int AS jumlah
    FROM students`);
  const kelas = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status='aktif')::int AS aktif,
           COUNT(*)::int AS jumlah
    FROM classes`);
  const att = await pool.query(`
    SELECT COUNT(*)::int AS jumlah_rekod,
           COUNT(DISTINCT tarikh)::int AS hari_unik,
           to_char(MIN(tarikh),'DD-MM-YYYY') AS tarikh_terawal,
           to_char(MAX(tarikh),'DD-MM-YYYY') AS tarikh_terakhir,
           ROUND(SUM(hadir)::numeric / NULLIF(SUM(jumlah),0) * 100, 2) AS peratus_keseluruhan
    FROM attendance_records`);
  const sync = await pool.query(`
    SELECT dijalankan_pada, status FROM sync_logs
    WHERE jenis='RINGKASAN' ORDER BY id DESC LIMIT 1`);

  const p = att.rows[0].peratus_keseluruhan;
  return {
    ok: true,
    pelajar_aktif: pelajar.rows[0].aktif,
    jumlah_pelajar: pelajar.rows[0].jumlah,
    kelas_aktif: kelas.rows[0].aktif,
    jumlah_kelas: kelas.rows[0].jumlah,
    jumlah_rekod_kehadiran: att.rows[0].jumlah_rekod,
    hari_unik: att.rows[0].hari_unik,
    tarikh_terawal: att.rows[0].tarikh_terawal,
    tarikh_terakhir: att.rows[0].tarikh_terakhir,
    peratus_keseluruhan: p === null ? null : Number(p),
    sync_terakhir: sync.rowCount
      ? { dijalankan_pada: sync.rows[0].dijalankan_pada, status: sync.rows[0].status }
      : null,
  };
}

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/classes
//  Semua kelas + bilangan pelajar aktif (tiada nama pelajar).
// ════════════════════════════════════════════════════════════
export async function classes() {
  const r = await pool.query(`
    SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas, c.status,
      (SELECT COUNT(*) FROM students s WHERE s.class_kod=c.kod AND s.status='aktif')::int AS pelajar_aktif
    FROM classes c
    ORDER BY c.tingkatan NULLS LAST, c.kod`);
  return { ok: true, jumlah: r.rowCount, kelas: r.rows };
}

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/recent-attendance?limit=50
//  Rekod kehadiran terkini (agregat sahaja — TIADA nama pelajar).
// ════════════════════════════════════════════════════════════
export async function recentAttendance(limit = 50) {
  const r = await pool.query(`
    SELECT to_char(r.tarikh,'DD-MM-YYYY') AS tarikh,
           r.class_kod AS kelas, c.nama AS nama_kelas,
           r.jumlah, r.hadir, r.tidak_hadir, r.wakil, r.peratus
    FROM attendance_records r
    LEFT JOIN classes c ON c.kod = r.class_kod
    ORDER BY r.tarikh DESC, r.class_kod
    LIMIT $1`, [limit]);
  return {
    ok: true,
    jumlah: r.rowCount,
    rekod: r.rows.map((x) => ({ ...x, peratus: x.peratus === null ? null : Number(x.peratus) })),
  };
}
