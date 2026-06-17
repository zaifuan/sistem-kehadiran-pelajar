import { pool } from '../db/pool.js';

// ── Tarikh & masa "hari ini" ikut zon Asia/Kuala_Lumpur (server authoritative) ──
function todayKL() {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const d = {};
  f.formatToParts(new Date()).forEach((p) => { d[p.type] = p.value; });
  const masa = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return { iso: `${d.year}-${d.month}-${d.day}`, display: `${d.day}-${d.month}-${d.year}`, masa };
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function s(v) { return v === undefined || v === null ? '' : String(v).trim(); }

// ── Senarai kelas (untuk grid pilih kelas) ──
export async function getClasses() {
  const r = await pool.query(`
    SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas,
      (SELECT COUNT(*) FROM students s WHERE s.class_kod=c.kod AND s.status='aktif')::int AS pelajar_aktif
    FROM classes c
    ORDER BY c.tingkatan NULLS LAST, c.kod`);
  return { ok: true, jumlah: r.rowCount, kelas: r.rows };
}

// ── Senarai pelajar aktif bagi satu kelas ──
export async function getPelajar(kod) {
  const info = await pool.query(
    'SELECT kod, nama, guru_kelas, pembantu_kelas FROM classes WHERE kod=$1', [kod]
  );
  if (info.rowCount === 0) {
    const err = new Error(`Kelas '${kod}' tidak dijumpai`);
    err.status = 404;
    throw err;
  }
  const pel = await pool.query(
    `SELECT nama FROM students WHERE class_kod=$1 AND status='aktif' ORDER BY nama`, [kod]
  );
  return {
    ok: true,
    kelas: info.rows[0].kod,
    nama_kelas: info.rows[0].nama,
    guru_kelas: info.rows[0].guru_kelas,
    pembantu_kelas: info.rows[0].pembantu_kelas,
    jumlah: pel.rowCount,
    pelajar: pel.rows.map((x) => x.nama),
  };
}

// ── Simpan kehadiran ke PostgreSQL (upsert tarikh+kelas; TIADA write-back Sheet) ──
// payload: { kelas, tidakHadir:[{nama,sebab}], wakil:[nama] }
//   wakil sekolah DIKIRA HADIR; tidak hadir sebenar = bukan wakil.
//   hadir = jumlah - tidak_hadir ; peratus = hadir/jumlah*100
export async function simpanKehadiran(payload) {
  const kelas = s(payload && payload.kelas);
  if (!kelas) { const e = new Error('Kelas wajib diisi'); e.status = 400; throw e; }

  let tidakHadir = Array.isArray(payload.tidakHadir) ? payload.tidakHadir : [];
  let wakil = Array.isArray(payload.wakil) ? payload.wakil : [];

  // Normalisasi + keselamatan
  wakil = wakil.map((n) => s(n)).filter(Boolean);
  const setWakil = new Set(wakil.map((n) => n.toUpperCase()));
  tidakHadir = tidakHadir
    .map((x) => ({ nama: s(x && x.nama), sebab: s(x && x.sebab) }))
    .filter((x) => x.nama && !setWakil.has(x.nama.toUpperCase())); // wakil menang jika bertindih

  const client = await pool.connect();
  try {
    const info = await client.query('SELECT kod, nama, guru_kelas FROM classes WHERE kod=$1', [kelas]);
    if (info.rowCount === 0) { const e = new Error(`Kelas '${kelas}' tidak dijumpai`); e.status = 404; throw e; }
    const namaKelas = info.rows[0].nama;
    const guru = info.rows[0].guru_kelas;

    const jr = await client.query(
      `SELECT COUNT(*)::int AS n FROM students WHERE class_kod=$1 AND status='aktif'`, [kelas]
    );
    const jumlah = jr.rows[0].n;
    const th = tidakHadir.length;
    const wk = wakil.length;
    const hadir = jumlah - th;
    const peratus = jumlah > 0 ? round2((hadir / jumlah) * 100) : null;
    const t = todayKL();

    await client.query('BEGIN');
    const rec = await client.query(
      `INSERT INTO attendance_records
         (tarikh, tarikh_raw, class_kod, jumlah, hadir, tidak_hadir, wakil, peratus, guru, masa_isi, masa_raw, sumber)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10, 'server')
       ON CONFLICT (tarikh, class_kod) DO UPDATE SET
         tarikh_raw=EXCLUDED.tarikh_raw, jumlah=EXCLUDED.jumlah, hadir=EXCLUDED.hadir,
         tidak_hadir=EXCLUDED.tidak_hadir, wakil=EXCLUDED.wakil, peratus=EXCLUDED.peratus,
         guru=EXCLUDED.guru, masa_isi=now(), masa_raw=EXCLUDED.masa_raw, sumber='server'
       RETURNING id`,
      [t.iso, t.display, kelas, jumlah, hadir, th, wk, peratus, guru, t.masa]
    );
    const recordId = rec.rows[0].id;

    // Ganti bersih anak rekod (idempotent — elak duplicate)
    await client.query('DELETE FROM attendance_absentees WHERE record_id=$1', [recordId]);
    await client.query('DELETE FROM attendance_representatives WHERE record_id=$1', [recordId]);
    for (const a of tidakHadir) {
      await client.query(
        'INSERT INTO attendance_absentees (record_id, nama_pelajar, sebab) VALUES ($1,$2,$3)',
        [recordId, a.nama, a.sebab || null]
      );
    }
    for (const n of wakil) {
      await client.query(
        'INSERT INTO attendance_representatives (record_id, nama_pelajar) VALUES ($1,$2)',
        [recordId, n]
      );
    }
    await client.query('COMMIT');

    return {
      ok: true,
      tarikh: t.display,
      kelas,
      nama_kelas: namaKelas,
      jumlah,
      hadir,
      tidak_hadir: th,
      wakil: wk,
      peratus,
      mesej: 'Kehadiran disimpan.',
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}
