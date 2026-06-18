// ════════════════════════════════════════════════════════════
//  Pemetaan Guru ↔ Kelas (Fasa 8)
//  teacher_class_assignments(user_id, class_kod) — UNIQUE(user_id, class_kod)
// ════════════════════════════════════════════════════════════
import { pool } from '../db/pool.js';

// Senarai KOD kelas yang ditugaskan kepada seorang guru.
export async function listKelasKodForUser(userId) {
  const r = await pool.query(
    'SELECT class_kod FROM teacher_class_assignments WHERE user_id=$1 ORDER BY class_kod',
    [userId]
  );
  return r.rows.map((x) => x.class_kod);
}

// Adakah kelas `kod` ditugaskan kepada guru `userId`?
export async function isKelasUntukGuru(userId, kod) {
  const r = await pool.query(
    'SELECT 1 FROM teacher_class_assignments WHERE user_id=$1 AND class_kod=$2 LIMIT 1',
    [userId, kod]
  );
  return r.rowCount > 0;
}

// Senarai penuh penugasan (untuk panel admin). Tapis ikut user_id jika diberi.
export async function listAssignments(userId) {
  const params = [];
  let where = '';
  if (userId) { params.push(userId); where = 'WHERE t.user_id=$1'; }
  const r = await pool.query(
    `SELECT t.id, t.user_id, u.username, u.nama, t.class_kod, c.nama AS nama_kelas, t.dicipta_pada
       FROM teacher_class_assignments t
       JOIN users u   ON u.id  = t.user_id
       LEFT JOIN classes c ON c.kod = t.class_kod
       ${where}
       ORDER BY u.username, t.class_kod`,
    params
  );
  return { ok: true, jumlah: r.rowCount, penugasan: r.rows };
}

// Tugaskan kelas kepada guru (idempotent).
export async function assignKelas(userId, classKod) {
  if (!userId || !classKod) { const e = new Error('user_id dan class_kod wajib'); e.status = 400; throw e; }
  const cek = await pool.query('SELECT 1 FROM classes WHERE kod=$1', [classKod]);
  if (cek.rowCount === 0) { const e = new Error(`Kelas '${classKod}' tidak wujud`); e.status = 404; throw e; }
  await pool.query(
    `INSERT INTO teacher_class_assignments (user_id, class_kod) VALUES ($1,$2)
       ON CONFLICT (user_id, class_kod) DO NOTHING`,
    [userId, classKod]
  );
  return { ok: true, mesej: `Kelas '${classKod}' ditugaskan kepada guru #${userId}.` };
}

// Buang penugasan kelas dari guru.
export async function unassignKelas(userId, classKod) {
  if (!userId || !classKod) { const e = new Error('user_id dan class_kod wajib'); e.status = 400; throw e; }
  const r = await pool.query(
    'DELETE FROM teacher_class_assignments WHERE user_id=$1 AND class_kod=$2',
    [userId, classKod]
  );
  return { ok: true, dibuang: r.rowCount, mesej: 'Penugasan dibuang.' };
}
