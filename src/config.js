import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '3000', 10),
  timezone: process.env.TIMEZONE || 'Asia/Kuala_Lumpur',
  runMigrationsOnStart: (process.env.RUN_MIGRATIONS_ON_START || 'true') === 'true',
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
