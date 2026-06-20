import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '3000', 10),
  timezone: process.env.TIMEZONE || 'Asia/Kuala_Lumpur',
  runMigrationsOnStart: (process.env.RUN_MIGRATIONS_ON_START || 'true') === 'true',
  runSeedOnStart: (process.env.RUN_SEED_ON_START || 'true') === 'true',
  // Sesi (Fasa 8) — disimpan dalam PostgreSQL (connect-pg-simple)
  session: {
    secret: process.env.SESSION_SECRET || 'GANTI_RAHSIA_SESI_DEV_SAHAJA',
    maxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || String(8 * 60 * 60 * 1000), 10), // 8 jam
  },
  // Kelayakan seed awal (Fasa 8). ON CONFLICT DO NOTHING — tidak set semula jika sudah wujud.
  seed: {
    superadmin: {
      username: process.env.SEED_SUPERADMIN_USERNAME || 'superadmin',
      password: process.env.SEED_SUPERADMIN_PASSWORD || '',
      nama: process.env.SEED_SUPERADMIN_NAMA || 'SU HEM',
    },
    admin: {
      username: process.env.SEED_ADMIN_USERNAME || 'admin',
      password: process.env.SEED_ADMIN_PASSWORD || '',
      nama: process.env.SEED_ADMIN_NAMA || 'SU Kehadiran',
    },
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'kehadiran',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kehadiran',
  },
  // Google Sheets (Fasa 2) — READ-ONLY
  google: {
    credentialsPath: path.resolve(
      process.cwd(),
      process.env.GOOGLE_APPLICATION_CREDENTIALS || 'secrets/service-account.json'
    ),
  },
  sheets: {
    masterPelajarId: process.env.SHEET_MASTER_PELAJAR_ID || '', // Sheet #1 (rujukan guru/pembantu)
    kehadiranId: process.env.SHEET_KEHADIRAN_ID || '', // Sheet #2 (master kehadiran/peratus)
  },
};

// ════════════════════════════════════════════════════════════
//  Semakan keselamatan produksi (fail-closed) — K-3
//  Dalam NODE_ENV=production, server MENOLAK untuk bermula jika
//  SESSION_SECRET / kata laluan seed masih kosong atau nilai lalai.
//  (Dalam pembangunan, nilai lalai dibenarkan untuk kemudahan.)
// ════════════════════════════════════════════════════════════
const SECRET_LALAI_DITOLAK = new Set([
  '', 'GANTI_RAHSIA_SESI_DI_SINI', 'GANTI_RAHSIA_SESI_DEV_SAHAJA',
]);
const KATA_LALUAN_LALAI_DITOLAK = new Set([
  '', 'ubah_saya_segera', 'GANTI_KATA_LALUAN_SUPERADMIN', 'GANTI_KATA_LALUAN_ADMIN',
]);

export function assertProductionSecrets() {
  if (config.env !== 'production') return; // hanya kuat kuasa dalam produksi
  const masalah = [];
  const sesi = (process.env.SESSION_SECRET || '').trim();
  if (SECRET_LALAI_DITOLAK.has(sesi)) {
    masalah.push('SESSION_SECRET belum ditetapkan / masih nilai lalai (jana: openssl rand -hex 32).');
  }
  if (config.runSeedOnStart) {
    const su = (process.env.SEED_SUPERADMIN_PASSWORD || '').trim();
    const ad = (process.env.SEED_ADMIN_PASSWORD || '').trim();
    if (KATA_LALUAN_LALAI_DITOLAK.has(su)) masalah.push('SEED_SUPERADMIN_PASSWORD belum ditetapkan / masih nilai lalai.');
    if (KATA_LALUAN_LALAI_DITOLAK.has(ad)) masalah.push('SEED_ADMIN_PASSWORD belum ditetapkan / masih nilai lalai.');
  }
  if (masalah.length) {
    const garis = '='.repeat(60);
    throw new Error(
      '\n' + garis + '\n' +
      'RALAT KESELAMATAN — server tidak dimulakan (fail-closed).\n\n' +
      'Sebab:\n  - ' + masalah.join('\n  - ') + '\n\n' +
      'Tindakan: tetapkan nilai kuat dalam .env, kemudian bina semula.\n' +
      'Jika akaun seed sudah dicipta sebelum ini, set RUN_SEED_ON_START=false\n' +
      'untuk melangkau semakan kata laluan seed.\n' +
      garis + '\n'
    );
  }
}
