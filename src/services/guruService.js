import { pool } from '../db/pool.js';
import { listKelasKodForUser } from './assignmentService.js';
import { writeBackDataKehadiran, writeBackTabTingkatan, writeBackPeratusDanAgregat, kiraMinggu, writeBackMingguan, infoBulan, writeBackLaporanBulanan } from './sheetWritebackService.js';

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
//   user: { id, role } — jika role GURU, hanya kelas yang ditugaskan dipulang.
//   ADMIN/SUPER_ADMIN (atau user tiada — serasi pemanggil lama) = semua kelas.
export async function getClasses(user) {
  if (user && user.role === 'GURU') {
    const kodList = await listKelasKodForUser(user.id);
    if (kodList.length === 0) return { ok: true, jumlah: 0, kelas: [] };
    const r = await pool.query(`
      SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas,
        (SELECT COUNT(*) FROM students s WHERE s.class_kod=c.kod AND s.status='aktif')::int AS pelajar_aktif
      FROM classes c
      WHERE c.kod = ANY($1)
      ORDER BY c.tingkatan NULLS LAST, c.kod`, [kodList]);
    return { ok: true, jumlah: r.rowCount, kelas: r.rows };
  }
  const r = await pool.query(`
    SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas,
      (SELECT COUNT(*) FROM students s WHERE s.class_kod=c.kod AND s.status='aktif')::int AS pelajar_aktif
    FROM classes c
    ORDER BY c.tingkatan NULLS LAST, c.kod`);
  return { ok: true, jumlah: r.rowCount, kelas: r.rows };
}

// ── Senarai kelas + status isi kehadiran HARI INI (Fasa 8.2) ──
//   status_hari_ini = 'selesai' jika ada attendance_records utk (tarikh hari ini, kelas),
//   selainnya 'belum'. Read-only PostgreSQL — TIADA bacaan/tulisan Google Sheet.
//   Portal guru terbuka → tiada penapisan ikut pengguna.
export async function getClassesStatus() {
  const t = todayKL();
  const r = await pool.query(`
    SELECT c.kod, c.nama, c.tingkatan, c.guru_kelas, c.pembantu_kelas,
      (SELECT COUNT(*) FROM students s WHERE s.class_kod=c.kod AND s.status='aktif')::int AS pelajar_aktif,
      EXISTS (
        SELECT 1 FROM attendance_records a
        WHERE a.class_kod = c.kod AND a.tarikh = $1
      ) AS sudah_isi
    FROM classes c
    ORDER BY c.tingkatan NULLS LAST, c.kod`, [t.iso]);
  const kelas = r.rows.map((k) => ({
    kod: k.kod,
    nama: k.nama,
    tingkatan: k.tingkatan,
    guru_kelas: k.guru_kelas,
    pembantu_kelas: k.pembantu_kelas,
    pelajar_aktif: k.pelajar_aktif,
    status_hari_ini: k.sudah_isi ? 'selesai' : 'belum',
  }));
  return { ok: true, tarikh: t.display, jumlah: kelas.length, kelas };
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

// ── Rekod kehadiran HARI INI bagi kelas (read-only; Fasa UX kemaskini) ──
//   Dipakai Portal Guru untuk pra-isi selepas guru membuka kelas semula.
//   Pulangkan bentuk neutral (nama + sebab) — frontend yang petakan kategori.
//   kelas: kod kelas (akan di-trim). Jika kosong/invalid → 400/404.
//   exists=false jika tiada rekod hari ini. TIADA tulisan ke DB / Google Sheet.
export async function getKehadiranHariIni(kelasRaw) {
  const kelas = s(kelasRaw);
  if (!kelas) { const e = new Error('Kelas wajib diisi'); e.status = 400; throw e; }

  const t = todayKL();
  const r = await pool.query(`
    SELECT a.id, a.class_kod, a.tarikh, a.masa_isi
      FROM attendance_records a
     WHERE a.class_kod = $1 AND a.tarikh = $2
     LIMIT 1`, [kelas, t.iso]);

  if (r.rowCount === 0) {
    return { ok: true, exists: false, class_kod: kelas, tarikh: t.display, masa_isi: null, tidakHadir: [], wakil: [] };
  }

  const rec = r.rows[0];
  const ab = await pool.query(
    'SELECT nama_pelajar, sebab FROM attendance_absentees WHERE record_id=$1 ORDER BY id', [rec.id]
  );
  const rp = await pool.query(
    'SELECT nama_pelajar FROM attendance_representatives WHERE record_id=$1 ORDER BY id', [rec.id]
  );

  const masaDisplay = rec.masa_isi
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(rec.masa_isi))
    : null;

  return {
    ok: true,
    exists: true,
    class_kod: rec.class_kod,
    tarikh: t.display,
    masa_isi: masaDisplay,
    tidakHadir: ab.rows.map((x) => ({ nama: x.nama_pelajar, sebab: x.sebab || '' })),
    wakil: rp.rows.map((x) => x.nama_pelajar),
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

    // Fasa B: write-back DATA_KEHADIRAN selepas commit (NON-FATAL; hormat WRITEBACK_*).
    // Jika gagal, simpanan DB tetap berjaya — hanya log amaran.
    try {
      await writeBackDataKehadiran({
        tarikh: t.display, kelas, namaKelas, guru,
        jumlah, hadir, tidakHadir, wakil, masa: t.masa,
      });
    } catch (e) {
      console.warn('[WRITEBACK] DATA_KEHADIRAN gagal (DB tetap berjaya):', (e && e.message) || e);
    }

    // Fasa C: write-back tab tingkatan T1–T5/STAM (NON-FATAL; dry-run; hormat WRITEBACK_*).
    try {
      await writeBackTabTingkatan({
        tarikh: t.display, kelas, namaKelas, guru,
        jumlah, hadir, tidakHadir, wakil, masa: t.masa,
      });
    } catch (e) {
      console.warn('[WRITEBACK] Tab tingkatan gagal (DB tetap berjaya):', (e && e.message) || e);
    }

    // Fasa D: PERATUS HARIANMINGGUAN + agregat harian (NON-FATAL; dry-run; hormat WRITEBACK_*).
    try {
      const hariIni = (await client.query(
        `SELECT a.class_kod, c.tingkatan, a.hadir, a.jumlah
           FROM attendance_records a JOIN classes c ON c.kod = a.class_kod
          WHERE a.tarikh = $1`, [t.iso])).rows;
      const roster = (await client.query(
        `SELECT c.kod, c.tingkatan,
           (SELECT COUNT(*) FROM students s WHERE s.class_kod = c.kod AND s.status = 'aktif')::int AS jumlah_aktif
           FROM classes c WHERE c.status = 'aktif'`)).rows;
      await writeBackPeratusDanAgregat({ tarikh: t.display, kelas, jumlah, hadir }, { hariIni, roster });
    } catch (e) {
      console.warn('[WRITEBACK] PERATUS/agregat gagal (DB tetap berjaya):', (e && e.message) || e);
    }

    // Fasa D2: agregat MINGGUAN (Isnin–Jumaat) (NON-FATAL; dry-run; hormat WRITEBACK_*).
    try {
      const mg = kiraMinggu(t.display);
      if (mg.hariMinggu) {
        const mingguRows = (await client.query(
          `SELECT a.class_kod, c.tingkatan, SUM(a.hadir)::int AS hadir, SUM(a.jumlah)::int AS jumlah
             FROM attendance_records a JOIN classes c ON c.kod = a.class_kod
            WHERE a.tarikh BETWEEN $1 AND $2
            GROUP BY a.class_kod, c.tingkatan`, [mg.isninIso, mg.jumaatIso])).rows;
        await writeBackMingguan({ tarikh: t.display, kelas }, { mg, mingguRows });
      }
    } catch (e) {
      console.warn('[WRITEBACK] Mingguan gagal (DB tetap berjaya):', (e && e.message) || e);
    }

    // Fasa E: LAPORAN_BULANAN (hanya hari terakhir bulan) (NON-FATAL; dry-run; hormat WRITEBACK_*).
    try {
      const lb = infoBulan(t.display);
      let bulanData = [], bilHari = 0;
      if (lb.isAkhir) {
        bulanData = (await client.query(
          `SELECT a.class_kod, SUM(a.hadir)::int AS hadir, SUM(a.jumlah)::int AS jumlah
             FROM attendance_records a
            WHERE a.tarikh >= $1 AND a.tarikh < $2
            GROUP BY a.class_kod`, [lb.mulaIso, lb.tamatIso])).rows;
        bilHari = (await client.query(
          `SELECT COUNT(DISTINCT a.tarikh)::int AS n FROM attendance_records a
            WHERE a.tarikh >= $1 AND a.tarikh < $2`, [lb.mulaIso, lb.tamatIso])).rows[0].n;
      }
      await writeBackLaporanBulanan({ tarikh: t.display }, { bulanData, bilHari });
    } catch (e) {
      console.warn('[WRITEBACK] LAPORAN_BULANAN gagal (DB tetap berjaya):', (e && e.message) || e);
    }

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
