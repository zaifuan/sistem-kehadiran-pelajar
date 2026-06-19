import { pool } from '../db/pool.js';
// Fasa 8.4: guna semula formula peratus yang TELAH DISAHKAN (jangan salin/ubah).
import { weekly as analyticsWeekly, monthly as analyticsMonthly } from './analyticsService.js';

// ════════════════════════════════════════════════════════════
//  adminService.js — Dashboard Admin Harian (Fasa 6) + polish (Fasa 8.4)
//  BACA SAHAJA dari PostgreSQL. Tiada write-back, tiada Sheet.
//
//  Mengekalkan ilham workflow GAS asal:
//   • Tumpuan "hari ini": kelas sudah/belum isi, peratus harian.
//   • peratus harian   = ΣHADIR ÷ ΣJUMLAH × 100 (kelas yang sudah isi).
//   • wakil sekolah    = direkod berasingan, DIKIRA HADIR (tidak ditolak).
//   • tidak hadir      = absentee sebenar (bukan wakil).
//  Konsisten dengan guruService.js (Fasa 5): hadir = jumlah − tidak_hadir.
// ════════════════════════════════════════════════════════════

// ── Tarikh "hari ini" ikut zon Asia/Kuala_Lumpur (server authoritative) ──
function todayKL() {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  })
    .formatToParts(new Date())
    .forEach((p) => { parts[p.type] = p.value; });
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, display: `${parts.day}-${parts.month}-${parts.year}` };
}

// Tukar 'YYYY-MM-DD' → 'DD-MM-YYYY' (untuk paparan bila SQL tiada baris)
function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

// Sahkan & normalkan tarikh input (terima 'YYYY-MM-DD'); jika tidak sah → null
function normIsoDate(v) {
  const sv = (v === undefined || v === null) ? '' : String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sv)) return null;
  const d = new Date(sv + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  // Pastikan tarikh sebenar (elak 2026-02-31 dll.)
  const iso = d.toISOString().slice(0, 10);
  return iso === sv ? sv : null;
}

function numOrNull(p) { return p === null || p === undefined ? null : Number(p); }
function s(v) { return v === undefined || v === null ? '' : String(v).trim(); }

// Susunan kumpulan tingkatan untuk paparan (Fasa 8.4.2): T1→T2→…→T5 kemudian STAM.
// Nota: jika diisih abjad, 'STAM' < 'T1' (didahulukan secara salah); CASE ini
// memastikan STAM berada di KUMPULAN TERAKHIR. NULL/lain → 99 (paling akhir).
const ORDER_TINGKATAN = `CASE c.tingkatan
  WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3
  WHEN 'T4' THEN 4 WHEN 'T5' THEN 5 WHEN 'STAM' THEN 6
  ELSE 99 END`;

// ════════════════════════════════════════════════════════════
//  GET /api/admin/today-summary
//  Kiraan ringkas untuk dashboard admin "hari ini".
// ════════════════════════════════════════════════════════════
export async function todaySummary() {
  const t = todayKL();

  // Agregat hari ini (hanya kelas berstatus 'aktif')
  const agg = await pool.query(
    `WITH aktif AS (
       SELECT kod FROM classes WHERE status = 'aktif'
     ),
     hari AS (
       SELECT r.class_kod, r.jumlah, r.hadir, r.tidak_hadir, r.wakil
       FROM attendance_records r
       JOIN aktif a ON a.kod = r.class_kod
       WHERE r.tarikh = $1::date
     )
     SELECT
       (SELECT COUNT(*) FROM aktif)::int                         AS jumlah_kelas,
       (SELECT COUNT(DISTINCT class_kod) FROM hari)::int         AS kelas_sudah_isi,
       COALESCE(SUM(h.hadir), 0)::int                            AS jumlah_hadir,
       COALESCE(SUM(h.tidak_hadir), 0)::int                      AS jumlah_tidak_hadir,
       COALESCE(SUM(h.wakil), 0)::int                            AS jumlah_wakil,
       COALESCE(SUM(h.jumlah), 0)::int                           AS pelajar_direkod,
       ROUND(SUM(h.hadir)::numeric / NULLIF(SUM(h.jumlah), 0) * 100, 2) AS peratus
     FROM hari h`,
    [t.iso]
  );
  const a = agg.rows[0];

  // Jumlah pelajar (enrolmen): utamakan jadual students; fallback snapshot terkini
  const pel = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status='aktif')::int AS aktif FROM students`
  );
  let jumlahPelajar = pel.rows[0].aktif;
  let sumberJumlahPelajar = 'students';
  if (!jumlahPelajar) {
    const fb = await pool.query(
      `SELECT COALESCE(SUM(jumlah), 0)::int AS enrol FROM (
         SELECT DISTINCT ON (class_kod) class_kod, jumlah
         FROM attendance_records
         ORDER BY class_kod, tarikh DESC
       ) t`
    );
    jumlahPelajar = fb.rows[0].enrol;
    sumberJumlahPelajar = 'snapshot';
  }

  return {
    ok: true,
    tarikh: t.display,
    tarikh_iso: t.iso,
    jumlah_kelas: a.jumlah_kelas,
    kelas_sudah_isi: a.kelas_sudah_isi,
    kelas_belum_isi: Math.max(a.jumlah_kelas - a.kelas_sudah_isi, 0),
    jumlah_pelajar: jumlahPelajar,
    sumber_jumlah_pelajar: sumberJumlahPelajar,
    jumlah_hadir: a.jumlah_hadir,
    jumlah_tidak_hadir: a.jumlah_tidak_hadir,
    jumlah_wakil: a.jumlah_wakil,
    pelajar_direkod_hari_ini: a.pelajar_direkod,
    peratus_kehadiran: numOrNull(a.peratus),
  };
}

// ════════════════════════════════════════════════════════════
//  GET /api/admin/missing-classes
//  Senarai "Belum Isi" hari ini: kod, nama, guru, pembantu (jika ada).
// ════════════════════════════════════════════════════════════
export async function missingClasses() {
  const t = todayKL();
  const r = await pool.query(
    `SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas
     FROM classes c
     WHERE c.status = 'aktif'
       AND NOT EXISTS (
         SELECT 1 FROM attendance_records r
         WHERE r.class_kod = c.kod AND r.tarikh = $1::date
       )
     ORDER BY ${ORDER_TINGKATAN}, c.kod`,
    [t.iso]
  );
  const jum = await pool.query(
    `SELECT COUNT(*)::int AS jumlah_kelas FROM classes WHERE status = 'aktif'`
  );
  const jumlahKelas = jum.rows[0].jumlah_kelas;
  const belum = r.rowCount;
  return {
    ok: true,
    tarikh: t.display,
    tarikh_iso: t.iso,
    jumlah_kelas: jumlahKelas,
    kelas_sudah_isi: Math.max(jumlahKelas - belum, 0),
    kelas_belum_isi: belum,
    kelas: r.rows.map((x) => ({
      kod: x.kod,
      nama: x.nama,
      tingkatan: x.tingkatan || null,
      guru_kelas: x.guru_kelas || null,
      pembantu_kelas: x.pembantu_kelas || null,
    })),
  };
}

// ════════════════════════════════════════════════════════════
//  GET /api/admin/records?tarikh=YYYY-MM-DD&kelas=KOD
//  Rekod kehadiran bagi tarikh dipilih (+ tapis kelas pilihan).
//  Termasuk senarai tidak hadir (nama + sebab) & senarai wakil.
// ════════════════════════════════════════════════════════════
export async function records(query = {}) {
  const t = todayKL();
  const iso = normIsoDate(query.tarikh) || t.iso; // default: hari ini
  const kelas = s(query.kelas).toUpperCase();

  const params = [iso];
  let kelasFilter = '';
  if (kelas) {
    params.push(kelas);
    kelasFilter = ' AND r.class_kod = $2';
  }

  const r = await pool.query(
    `SELECT
       r.class_kod                         AS kelas,
       c.nama                              AS nama_kelas,
       c.tingkatan                         AS tingkatan,
       COALESCE(r.guru, c.guru_kelas)      AS guru,
       c.pembantu_kelas                    AS pembantu,
       r.jumlah, r.hadir, r.tidak_hadir, r.wakil, r.peratus,
       COALESCE(NULLIF(r.masa_raw, ''),
                to_char(r.masa_isi AT TIME ZONE 'Asia/Kuala_Lumpur', 'HH24:MI')) AS masa,
       r.sumber,
       COALESCE((
         SELECT json_agg(json_build_object('nama', ab.nama_pelajar, 'sebab', ab.sebab)
                         ORDER BY ab.nama_pelajar)
         FROM attendance_absentees ab WHERE ab.record_id = r.id
       ), '[]'::json) AS tidak_hadir_senarai,
       COALESCE((
         SELECT json_agg(w.nama_pelajar ORDER BY w.nama_pelajar)
         FROM attendance_representatives w WHERE w.record_id = r.id
       ), '[]'::json) AS wakil_senarai
     FROM attendance_records r
     LEFT JOIN classes c ON c.kod = r.class_kod
     WHERE r.tarikh = $1::date${kelasFilter}
     ORDER BY ${ORDER_TINGKATAN}, r.class_kod`,
    params
  );

  let sumHadir = 0, sumTh = 0, sumWk = 0, sumJum = 0;
  const rekod = r.rows.map((x) => {
    sumHadir += x.hadir || 0;
    sumTh += x.tidak_hadir || 0;
    sumWk += x.wakil || 0;
    sumJum += x.jumlah || 0;
    return {
      kelas: x.kelas,
      nama_kelas: x.nama_kelas,
      tingkatan: x.tingkatan || null,
      guru: x.guru || null,
      pembantu: x.pembantu || null,
      jumlah: x.jumlah,
      hadir: x.hadir,
      tidak_hadir: x.tidak_hadir,
      wakil: x.wakil,
      peratus: numOrNull(x.peratus),
      masa: x.masa || null,
      sumber: x.sumber || null,
      tidak_hadir_senarai: Array.isArray(x.tidak_hadir_senarai) ? x.tidak_hadir_senarai : [],
      wakil_senarai: Array.isArray(x.wakil_senarai) ? x.wakil_senarai : [],
    };
  });

  return {
    ok: true,
    tarikh: isoToDisplay(iso),
    tarikh_iso: iso,
    kelas: kelas || null,
    jumlah: r.rowCount,
    ringkasan: {
      jumlah_pelajar: sumJum,
      hadir: sumHadir,
      tidak_hadir: sumTh,
      wakil: sumWk,
      peratus: sumJum > 0 ? Math.round((sumHadir / sumJum) * 10000) / 100 : null,
    },
    rekod,
  };
}

// ════════════════════════════════════════════════════════════
//  FASA 8.4 — Tambahan Page Admin (BACA SAHAJA, PostgreSQL).
//  Tiada baca/tulis Google Sheet. Formula peratus mingguan/bulanan
//  DIDELEGASI kepada analyticsService (formula GAS yang disahkan).
// ════════════════════════════════════════════════════════════

// GET /api/admin/weekly?kelas= — peratus mingguan (sekolah / kelas)
// Delegasi 100% kepada analyticsService.weekly (Σhadir ÷ Σjumlah × 100, Isnin–Jumaat).
export async function weekly(query = {}) {
  return analyticsWeekly(query || {});
}

// GET /api/admin/monthly?kelas=&tahun= — peratus bulanan (sekolah / kelas)
// Delegasi 100% kepada analyticsService.monthly (Σhadir ÷ Σjumlah × 100).
export async function monthly(query = {}) {
  return analyticsMonthly(query || {});
}

// GET /api/admin/classes — senarai kelas + bilangan pelajar (untuk "Kelas & Pelajar")
export async function classesWithCounts() {
  const r = await pool.query(
    `SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas,
        COALESCE((SELECT COUNT(*) FROM students s
                  WHERE s.class_kod = c.kod AND s.status = 'aktif'), 0)::int AS jumlah_pelajar
     FROM classes c
     WHERE c.status = 'aktif'
     ORDER BY ${ORDER_TINGKATAN}, c.kod`
  );
  return {
    ok: true,
    jumlah: r.rowCount,
    kelas: r.rows.map((x) => ({
      kod: x.kod,
      nama: x.nama,
      tingkatan: x.tingkatan || null,
      guru_kelas: x.guru_kelas || null,
      pembantu_kelas: x.pembantu_kelas || null,
      jumlah_pelajar: x.jumlah_pelajar,
    })),
  };
}

// GET /api/admin/classes/:kod/students — senarai pelajar bagi satu kelas
export async function classStudents(kodRaw) {
  const kod = s(kodRaw).toUpperCase();
  const info = await pool.query(
    `SELECT kod, nama, tingkatan, guru_kelas, pembantu_kelas, status
     FROM classes WHERE kod = $1`,
    [kod]
  );
  if (info.rowCount === 0) {
    const err = new Error(`Kelas '${kod}' tidak dijumpai`);
    err.status = 404;
    throw err;
  }
  const st = await pool.query(
    `SELECT nama, status FROM students
     WHERE class_kod = $1
     ORDER BY (status = 'aktif') DESC, nama`,
    [kod]
  );
  const c = info.rows[0];
  const aktif = st.rows.filter((x) => x.status === 'aktif').length;
  return {
    ok: true,
    kelas: {
      kod: c.kod,
      nama: c.nama,
      tingkatan: c.tingkatan || null,
      guru_kelas: c.guru_kelas || null,
      pembantu_kelas: c.pembantu_kelas || null,
    },
    jumlah_pelajar: aktif,
    jumlah_semua: st.rowCount,
    pelajar: st.rows.map((x) => ({ nama: x.nama, status: x.status })),
  };
}
