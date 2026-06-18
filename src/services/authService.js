// ════════════════════════════════════════════════════════════
//  Perkhidmatan Autentikasi (Fasa 8)
//  Kata laluan di-hash dengan argon2id. JANGAN simpan plaintext.
//  Bentuk sesi: req.session.user = { id, username, nama, role }
// ════════════════════════════════════════════════════════════
import argon2 from 'argon2';
import { pool } from '../db/pool.js';

const ARGON_OPTS = { type: argon2.argon2id };

// Hash kata laluan baharu (dipakai oleh seed & tukar kata laluan).
export async function hashKataLaluan(plain) {
  return argon2.hash(String(plain), ARGON_OPTS);
}

// Cari pengguna + peranan ikut username.
async function cariUser(username) {
  const r = await pool.query(
    `SELECT u.id, u.username, u.nama, u.kata_laluan_hash, u.aktif, r.kod AS role
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.username = $1`,
    [String(username || '').trim()]
  );
  return r.rows[0] || null;
}

// Sahkan kelayakan; pulang objek user ringkas (tanpa hash) jika sah.
// Lempar ralat (status 401) jika gagal — tidak bocorkan sebab tepat.
export async function sahkanLogin(username, kataLaluan) {
  const gagal = () => { const e = new Error('Nama pengguna atau kata laluan salah'); e.status = 401; throw e; };
  const u = await cariUser(username);
  if (!u || !u.aktif) gagal();

  let padan = false;
  try { padan = await argon2.verify(u.kata_laluan_hash, String(kataLaluan || '')); }
  catch (_) { padan = false; }            // hash rosak/format lain → anggap gagal
  if (!padan) gagal();

  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
  await pool.query(
    `INSERT INTO audit_logs (user_id, jenis, tindakan, butiran) VALUES ($1,'SYSTEM','LOGIN',$2)`,
    [u.id, `Log masuk: ${u.username}`]
  ).catch(() => { /* audit tidak kritikal */ });

  return { id: u.id, username: u.username, nama: u.nama, role: u.role };
}

// Tukar kata laluan sendiri — sahkan kata laluan lama dahulu.
export async function tukarKataLaluan(userId, lama, baru) {
  if (!baru || String(baru).length < 8) {
    const e = new Error('Kata laluan baharu mesti sekurang-kurangnya 8 aksara'); e.status = 400; throw e;
  }
  const r = await pool.query('SELECT kata_laluan_hash FROM users WHERE id=$1', [userId]);
  if (r.rowCount === 0) { const e = new Error('Pengguna tidak dijumpai'); e.status = 404; throw e; }

  let padan = false;
  try { padan = await argon2.verify(r.rows[0].kata_laluan_hash, String(lama || '')); }
  catch (_) { padan = false; }
  if (!padan) { const e = new Error('Kata laluan semasa salah'); e.status = 401; throw e; }

  const hash = await hashKataLaluan(baru);
  await pool.query('UPDATE users SET kata_laluan_hash=$1 WHERE id=$2', [hash, userId]);
  await pool.query(
    `INSERT INTO audit_logs (user_id, jenis, tindakan, butiran) VALUES ($1,'SYSTEM','TUKAR_KATA_LALUAN','Kata laluan ditukar')`,
    [userId]
  ).catch(() => {});
  return { ok: true, mesej: 'Kata laluan berjaya ditukar.' };
}

// Senarai pengguna (untuk panel admin) — tanpa hash.
export async function listUsers() {
  const r = await pool.query(
    `SELECT u.id, u.username, u.nama, u.aktif, r.kod AS role, u.last_login, u.dicipta_pada
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY r.kod, u.username`
  );
  return { ok: true, jumlah: r.rowCount, pengguna: r.rows };
}
