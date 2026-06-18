// ════════════════════════════════════════════════════════════
//  Seed Pengguna Awal (Fasa 8) — idempotent
//  Cipta superadmin (SUPER_ADMIN) + admin (ADMIN) jika belum wujud.
//  ON CONFLICT (username) DO NOTHING — TIDAK set semula kata laluan
//  pengguna sedia ada. Kelayakan diambil dari .env (lihat config.seed).
// ════════════════════════════════════════════════════════════
import { config } from '../config.js';
import { pool, waitForDb } from './pool.js';
import { hashKataLaluan } from '../services/authService.js';

async function roleId(kod) {
  const r = await pool.query('SELECT id FROM roles WHERE kod=$1', [kod]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function seedUser({ username, password, nama }, roleKod) {
  const rid = await roleId(roleKod);
  if (!rid) { console.warn(`[seed] ⚠️ Peranan ${roleKod} tiada — langkau ${username}.`); return; }

  const sedia = await pool.query('SELECT 1 FROM users WHERE username=$1', [username]);
  if (sedia.rowCount > 0) {
    console.log(`[seed] • ${username} (${roleKod}) sudah wujud — tidak diubah.`);
    return;
  }
  const hash = await hashKataLaluan(password);
  await pool.query(
    `INSERT INTO users (username, kata_laluan_hash, role_id, nama, aktif)
       VALUES ($1,$2,$3,$4,TRUE)
       ON CONFLICT (username) DO NOTHING`,
    [username, hash, rid, nama]
  );
  console.log(`[seed] ✅ ${username} (${roleKod}) dicipta.`);
  if (password === 'ubah_saya_segera') {
    console.warn(`[seed] ⚠️ ${username} guna kata laluan lalai — TUKAR SEGERA selepas log masuk pertama.`);
  }
}

export async function runSeed() {
  await waitForDb();
  console.log('[seed] Menyemai pengguna awal (idempotent)...');
  await seedUser(config.seed.superadmin, 'SUPER_ADMIN');
  await seedUser(config.seed.admin, 'ADMIN');
  console.log('[seed] ✅ Selesai.');
}

// Jika dijalankan terus: `node src/db/seed.js` atau `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] Ralat:', err);
      process.exit(1);
    });
}
