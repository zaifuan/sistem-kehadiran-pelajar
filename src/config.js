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
  // Rujukan sahaja pada Fasa 1; digunakan Fasa 2+
  sheets: {
    peratusId: process.env.SHEET_PERATUS_ID || '',
    senaraiId: process.env.SHEET_SENARAI_ID || '',
    serviceAccountKey:
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './secrets/service-account.json',
  },
};
