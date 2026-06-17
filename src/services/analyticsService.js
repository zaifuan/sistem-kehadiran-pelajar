import { pool } from '../db/pool.js';

// ════════════════════════════════════════════════════════════
//  analyticsService.js — Modul PERATUS KEHADIRAN (Fasa 7)
//  BACA SAHAJA dari PostgreSQL. Tiada write-back, tiada Sheet.
//
//  FORMULA — SALINAN TEPAT dari GAS (peratus.gs + laporan.gs):
//   • Harian (kelas)  : hadir / jumlah × 100        (wakil DIKIRA HADIR)
//   • Harian (sekolah): Σhadir ÷ Σjumlah × 100       (semua kelas, tarikh itu)
//   • Mingguan        : Σhadir ÷ Σjumlah × 100       (Isnin–Jumaat minggu itu)
//                       — BUKAN purata harian (kiraPeratusMingguanPeratusTab)
//   • Bulanan         : Σhadir ÷ Σjumlah × 100       (semua tarikh bulan itu)
//                       — bil hari = bilangan tarikh unik (simpanLaporanBulananSheets)
//   • Individu pelajar: hadir = hari direkod − hari tidak hadir; wakil = hari wakil
//                       (diterbit dari senarai nama tidak hadir/wakil — model GAS)
//
//  Sempadan minggu = cariJumaat() GAS. EXTRACT(DOW) Postgres = getDay() JS
//  (0=Ahad … 6=Sabtu), jadi Jumaat minggu = tarikh + offset:
//    Ahad(0) → +5 ; Sabtu(6) → −1 ; Isnin–Jumaat → 5 − dow.
//  Isnin minggu = Jumaat − 4 (tarikhMingguDari).
// ════════════════════════════════════════════════════════════

const BULAN_NAMA = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
  'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

const LO = '0001-01-01'; // sentinel bawah (tiada had)
const HI = '9999-12-31'; // sentinel atas (tiada had)

// Ungkapan SQL Jumaat-minggu (replika cariJumaat GAS)
const JUMAAT_SQL = `(r.tarikh + (CASE
    WHEN EXTRACT(DOW FROM r.tarikh) = 0 THEN 5
    WHEN EXTRACT(DOW FROM r.tarikh) = 6 THEN -1
    ELSE 5 - EXTRACT(DOW FROM r.tarikh) END)::int)`;

function num(p) { return p === null || p === undefined ? null : Number(p); }
function s(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function todayKL() {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, display: `${parts.day}-${parts.month}-${parts.year}` };
}
function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
function normIso(v) {
  const sv = s(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sv)) return null;
  const d = new Date(sv + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === sv ? sv : null;
}
function pad2(n) { return String(n).padStart(2, '0'); }

// Selesaikan julat tarikh dari query: tarikh | bulan(YYYY-MM) | dari/hingga
function resolveBounds(q = {}) {
  const tarikh = normIso(q.tarikh);
  if (tarikh) return { lo: tarikh, hi: tarikh, mode: 'tarikh', label: isoToDisplay(tarikh) };

  const mb = /^(\d{4})-(\d{2})$/.exec(s(q.bulan));
  if (mb) {
    const y = parseInt(mb[1], 10), mo = parseInt(mb[2], 10);
    if (mo >= 1 && mo <= 12) {
      const last = new Date(y, mo, 0).getDate();
      return {
        lo: `${mb[1]}-${mb[2]}-01`, hi: `${mb[1]}-${mb[2]}-${pad2(last)}`,
        mode: 'bulan', label: `${BULAN_NAMA[mo - 1]} ${y}`,
      };
    }
  }
  const dari = normIso(q.dari), hingga = normIso(q.hingga);
  if (dari || hingga) {
    return {
      lo: dari || LO, hi: hingga || HI, mode: 'julat',
      label: `${dari ? isoToDisplay(dari) : '…'} – ${hingga ? isoToDisplay(hingga) : '…'}`,
    };
  }
  return { lo: null, hi: null, mode: 'semua', label: 'Semua' };
}

function bulanLabel(tahun, bulan) { return `${BULAN_NAMA[bulan - 1]} ${tahun}`; }

// ════════════════════════════════════════════════════════════
//  1) GET /api/analytics/daily — Analisis Kehadiran Harian
//     Lajur: Tarikh, Kelas, Jumlah, Hadir, Tidak Hadir, Wakil, Peratus
//     Tapis: tarikh | kelas | bulan | dari/hingga (Rekod Lepas)
// ════════════════════════════════════════════════════════════
export async function daily(q = {}) {
  const kelas = s(q.kelas).toUpperCase();
  let b = resolveBounds(q);

  // Tiada tapisan tarikh → lalai ke tarikh terkini yang ada rekod
  const terkiniRes = await pool.query('SELECT to_char(MAX(tarikh),\'YYYY-MM-DD\') AS t FROM attendance_records');
  const tarikhTerkini = terkiniRes.rows[0].t;
  if (b.mode === 'semua') {
    if (tarikhTerkini) b = { lo: tarikhTerkini, hi: tarikhTerkini, mode: 'tarikh', label: isoToDisplay(tarikhTerkini) };
    else b = { lo: LO, hi: HI, mode: 'semua', label: 'Semua' };
  }

  const params = [b.lo, b.hi];
  let kelasFilter = '';
  if (kelas) { params.push(kelas); kelasFilter = ' AND r.class_kod = $3'; }

  const r = await pool.query(
    `SELECT to_char(r.tarikh,'DD-MM-YYYY') AS tarikh, to_char(r.tarikh,'YYYY-MM-DD') AS tarikh_iso,
            r.class_kod AS kelas, c.nama AS nama_kelas,
            r.jumlah, r.hadir, r.tidak_hadir, r.wakil, r.peratus
     FROM attendance_records r
     LEFT JOIN classes c ON c.kod = r.class_kod
     WHERE r.tarikh BETWEEN $1::date AND $2::date${kelasFilter}
     ORDER BY r.tarikh DESC, c.tingkatan NULLS LAST, r.class_kod`,
    params
  );

  let sh = 0, st = 0, sw = 0, sj = 0;
  const rekod = r.rows.map((x) => {
    sh += x.hadir || 0; st += x.tidak_hadir || 0; sw += x.wakil || 0; sj += x.jumlah || 0;
    return {
      tarikh: x.tarikh, tarikh_iso: x.tarikh_iso, kelas: x.kelas, nama_kelas: x.nama_kelas,
      jumlah: x.jumlah, hadir: x.hadir, tidak_hadir: x.tidak_hadir, wakil: x.wakil, peratus: num(x.peratus),
    };
  });

  return {
    ok: true,
    julat: { mode: b.mode, label: b.label, dari: b.lo, hingga: b.hi },
    kelas: kelas || null,
    tarikh_terkini: tarikhTerkini || null,
    jumlah: r.rowCount,
    ringkasan: {
      jumlah: sj, hadir: sh, tidak_hadir: st, wakil: sw,
      peratus: sj > 0 ? Math.round((sh / sj) * 10000) / 100 : null,
    },
    rekod,
  };
}

// ════════════════════════════════════════════════════════════
//  2) GET /api/analytics/weekly — Analisis Mingguan
//     Σhadir ÷ Σjumlah × 100 (Isnin–Jumaat). BUKAN purata harian.
// ════════════════════════════════════════════════════════════
export async function weekly(q = {}) {
  const kelas = s(q.kelas).toUpperCase();
  const b = resolveBounds(q);
  const lo = b.lo || LO, hi = b.hi || HI;

  const params = [lo, hi];
  let kelasFilter = '';
  if (kelas) { params.push(kelas); kelasFilter = ' AND r.class_kod = $3'; }

  const r = await pool.query(
    `WITH base AS (
       SELECT r.tarikh, r.hadir, r.jumlah, r.tidak_hadir, r.wakil,
              ${JUMAAT_SQL} AS jumaat_d
       FROM attendance_records r
       WHERE r.tarikh BETWEEN $1::date AND $2::date${kelasFilter}
     )
     SELECT to_char(jumaat_d,'DD-MM-YYYY')        AS jumaat,
            to_char(jumaat_d,'YYYY-MM-DD')         AS jumaat_iso,
            to_char(jumaat_d - 4,'DD-MM-YYYY')     AS isnin,
            to_char(jumaat_d - 4,'YYYY-MM-DD')     AS isnin_iso,
            EXTRACT(WEEK FROM jumaat_d)::int        AS minggu,
            EXTRACT(ISOYEAR FROM jumaat_d)::int     AS tahun,
            SUM(hadir)::int AS hadir, SUM(jumlah)::int AS jumlah,
            SUM(tidak_hadir)::int AS tidak_hadir, SUM(wakil)::int AS wakil,
            COUNT(DISTINCT tarikh)::int AS hari,
            ROUND(SUM(hadir)::numeric / NULLIF(SUM(jumlah),0) * 100, 2) AS peratus
     FROM base
     GROUP BY jumaat_d
     ORDER BY jumaat_d`,
    params
  );

  const minggu = r.rows.map((x) => ({
    minggu: x.minggu, tahun: x.tahun,
    isnin: x.isnin, isnin_iso: x.isnin_iso, jumaat: x.jumaat, jumaat_iso: x.jumaat_iso,
    label: `${x.isnin.slice(0, 5)}–${x.jumaat.slice(0, 5)}`,
    hadir: x.hadir, jumlah: x.jumlah, tidak_hadir: x.tidak_hadir, wakil: x.wakil,
    hari: x.hari, peratus: num(x.peratus),
  }));

  return { ok: true, julat: { mode: b.mode, label: b.label }, kelas: kelas || null, jumlah: minggu.length, minggu };
}

// ════════════════════════════════════════════════════════════
//  3) GET /api/analytics/monthly — Analisis Bulanan
//     Σhadir ÷ Σjumlah × 100 ; bil hari = tarikh unik (laporan.gs).
// ════════════════════════════════════════════════════════════
export async function monthly(q = {}) {
  const kelas = s(q.kelas).toUpperCase();
  const tahun = /^\d{4}$/.test(s(q.tahun)) ? parseInt(s(q.tahun), 10) : null;
  const b = resolveBounds(q);
  let lo = b.lo || LO, hi = b.hi || HI;
  if (tahun && b.mode === 'semua') { lo = `${tahun}-01-01`; hi = `${tahun}-12-31`; }

  const params = [lo, hi];
  let kelasFilter = '';
  if (kelas) { params.push(kelas); kelasFilter = ' AND r.class_kod = $3'; }

  const r = await pool.query(
    `SELECT EXTRACT(YEAR FROM r.tarikh)::int  AS tahun,
            EXTRACT(MONTH FROM r.tarikh)::int AS bulan,
            SUM(r.hadir)::int AS hadir, SUM(r.jumlah)::int AS jumlah,
            SUM(r.tidak_hadir)::int AS tidak_hadir, SUM(r.wakil)::int AS wakil,
            COUNT(DISTINCT r.tarikh)::int AS hari,
            ROUND(SUM(r.hadir)::numeric / NULLIF(SUM(r.jumlah),0) * 100, 2) AS peratus
     FROM attendance_records r
     WHERE r.tarikh BETWEEN $1::date AND $2::date${kelasFilter}
     GROUP BY tahun, bulan
     ORDER BY tahun, bulan`,
    params
  );

  const bulan = r.rows.map((x) => ({
    tahun: x.tahun, bulan: x.bulan, label: bulanLabel(x.tahun, x.bulan),
    label_pendek: `${BULAN_NAMA[x.bulan - 1].slice(0, 3)} ${String(x.tahun).slice(2)}`,
    hadir: x.hadir, jumlah: x.jumlah, tidak_hadir: x.tidak_hadir, wakil: x.wakil,
    hari: x.hari, peratus: num(x.peratus),
  }));

  return { ok: true, julat: { mode: b.mode, label: b.label }, kelas: kelas || null, jumlah: bulan.length, bulan };
}

// ════════════════════════════════════════════════════════════
//  4) GET /api/analytics/class/:kelas — Paparan Kelas
//     Peratus harian (terkini) + siri harian/mingguan/bulanan + trend.
//     Sertakan senarai pelajar (id) untuk Paparan Pelajar.
// ════════════════════════════════════════════════════════════
export async function classAnalytics(kodRaw) {
  const kod = s(kodRaw).toUpperCase();
  const info = await pool.query(
    'SELECT kod, nama, tingkatan, guru_kelas, pembantu_kelas, status FROM classes WHERE kod=$1', [kod]
  );
  if (info.rowCount === 0) {
    const err = new Error(`Kelas '${kod}' tidak dijumpai`);
    err.status = 404;
    throw err;
  }

  // Ringkasan terkumpul (Σh/Σj) untuk keseluruhan kelas
  const ring = await pool.query(
    `SELECT COUNT(*)::int AS hari, COALESCE(SUM(hadir),0)::int AS hadir,
            COALESCE(SUM(jumlah),0)::int AS jumlah, COALESCE(SUM(tidak_hadir),0)::int AS tidak_hadir,
            COALESCE(SUM(wakil),0)::int AS wakil,
            ROUND(SUM(hadir)::numeric / NULLIF(SUM(jumlah),0) * 100, 2) AS peratus,
            to_char(MIN(tarikh),'DD-MM-YYYY') AS dari, to_char(MAX(tarikh),'DD-MM-YYYY') AS hingga
     FROM attendance_records WHERE class_kod=$1`, [kod]
  );

  // Siri harian (menaik untuk trend)
  const har = await pool.query(
    `SELECT to_char(r.tarikh,'DD-MM-YYYY') AS tarikh, to_char(r.tarikh,'YYYY-MM-DD') AS tarikh_iso,
            r.jumlah, r.hadir, r.tidak_hadir, r.wakil, r.peratus
     FROM attendance_records r WHERE r.class_kod=$1 ORDER BY r.tarikh`, [kod]
  );
  const harian = har.rows.map((x) => ({
    tarikh: x.tarikh, tarikh_iso: x.tarikh_iso, jumlah: x.jumlah, hadir: x.hadir,
    tidak_hadir: x.tidak_hadir, wakil: x.wakil, peratus: num(x.peratus),
  }));
  const terkini = harian.length ? harian[harian.length - 1] : null;

  // Mingguan & bulanan untuk kelas ini (guna semula fungsi di atas)
  const wk = await weekly({ kelas: kod });
  const mo = await monthly({ kelas: kod });

  // Senarai pelajar (untuk Paparan Pelajar) — aktif dahulu
  const pel = await pool.query(
    `SELECT id, nama, status FROM students WHERE class_kod=$1
     ORDER BY (status='aktif') DESC, nama`, [kod]
  );

  const c = info.rows[0];
  const rr = ring.rows[0];
  return {
    ok: true,
    kelas: c.kod, nama_kelas: c.nama, tingkatan: c.tingkatan,
    guru_kelas: c.guru_kelas || null, pembantu_kelas: c.pembantu_kelas || null, status: c.status,
    ringkasan: {
      hari: rr.hari, hadir: rr.hadir, jumlah: rr.jumlah, tidak_hadir: rr.tidak_hadir,
      wakil: rr.wakil, peratus: num(rr.peratus), dari: rr.dari, hingga: rr.hingga,
    },
    peratus_harian_terkini: terkini ? { tarikh: terkini.tarikh, peratus: terkini.peratus } : null,
    harian,
    mingguan: wk.minggu,
    bulanan: mo.bulan,
    pelajar: pel.rows.map((x) => ({ id: x.id, nama: x.nama, status: x.status })),
  };
}

// ════════════════════════════════════════════════════════════
//  5) GET /api/analytics/student/:id — Paparan Pelajar
//     hadir / tidak hadir / wakil / peratus individu.
//     Diterbit dari senarai nama (model GAS: pelajar = hadir melainkan
//     namanya dalam senarai tidak hadir; wakil = hadir + ditanda wakil).
//     Tapis pilihan: bulan | dari/hingga.
// ════════════════════════════════════════════════════════════
export async function studentAnalytics(idRaw, q = {}) {
  const id = parseInt(s(idRaw), 10);
  if (!Number.isInteger(id) || id < 1) { const e = new Error('ID pelajar tidak sah'); e.status = 400; throw e; }

  const info = await pool.query('SELECT id, class_kod, nama, status FROM students WHERE id=$1', [id]);
  if (info.rowCount === 0) { const e = new Error(`Pelajar id '${id}' tidak dijumpai`); e.status = 404; throw e; }
  const pel = info.rows[0];

  const b = resolveBounds(q);
  const lo = b.lo || LO, hi = b.hi || HI;
  const args = [pel.class_kod, lo, hi, pel.nama];

  // Hari direkod oleh kelas dalam julat (1 baris / tarikh)
  const hariRes = await pool.query(
    `SELECT COUNT(*)::int AS hari FROM attendance_records r
     WHERE r.class_kod=$1 AND r.tarikh BETWEEN $2::date AND $3::date`,
    [pel.class_kod, lo, hi]
  );
  const hariDirekod = hariRes.rows[0].hari;

  // Hari pelajar tidak hadir (padanan nama, tidak case-sensitive) + sebab
  const thRes = await pool.query(
    `SELECT to_char(r.tarikh,'DD-MM-YYYY') AS tarikh, to_char(r.tarikh,'YYYY-MM-DD') AS tarikh_iso,
            MIN(a.sebab) AS sebab
     FROM attendance_records r
     JOIN attendance_absentees a ON a.record_id = r.id
     WHERE r.class_kod=$1 AND r.tarikh BETWEEN $2::date AND $3::date
       AND UPPER(TRIM(a.nama_pelajar)) = UPPER(TRIM($4))
     GROUP BY r.tarikh
     ORDER BY r.tarikh DESC`,
    args
  );

  // Hari pelajar jadi wakil sekolah
  const wkRes = await pool.query(
    `SELECT to_char(r.tarikh,'DD-MM-YYYY') AS tarikh, to_char(r.tarikh,'YYYY-MM-DD') AS tarikh_iso
     FROM attendance_records r
     JOIN attendance_representatives w ON w.record_id = r.id
     WHERE r.class_kod=$1 AND r.tarikh BETWEEN $2::date AND $3::date
       AND UPPER(TRIM(w.nama_pelajar)) = UPPER(TRIM($4))
     GROUP BY r.tarikh
     ORDER BY r.tarikh DESC`,
    args
  );

  const tidakHadir = thRes.rowCount;
  const wakil = wkRes.rowCount;
  const hadir = Math.max(hariDirekod - tidakHadir, 0); // wakil termasuk dalam hadir
  const peratus = hariDirekod > 0 ? Math.round((hadir / hariDirekod) * 10000) / 100 : null;

  return {
    ok: true,
    pelajar: { id: pel.id, nama: pel.nama, kelas: pel.class_kod, status: pel.status },
    julat: { mode: b.mode, label: b.label },
    hari_direkod: hariDirekod,
    hadir,
    tidak_hadir: tidakHadir,
    wakil,
    peratus,
    senarai_tidak_hadir: thRes.rows.map((x) => ({ tarikh: x.tarikh, tarikh_iso: x.tarikh_iso, sebab: x.sebab || null })),
    senarai_wakil: wkRes.rows.map((x) => ({ tarikh: x.tarikh, tarikh_iso: x.tarikh_iso })),
  };
}
