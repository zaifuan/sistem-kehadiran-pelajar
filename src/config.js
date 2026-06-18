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
      password: process.env.SEED_SUPERADMIN_PASSWORD || 'ubah_saya_segera',
      nama: process.env.SEED_SUPERADMIN_NAMA || 'SU HEM',
    },
    admin: {
      username: process.env.SEED_ADMIN_USERNAME || 'admin',
      password: process.env.SEED_ADMIN_PASSWORD || 'ubah_saya_segera',
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
