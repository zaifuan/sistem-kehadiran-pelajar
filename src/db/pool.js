import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

// Postgres mungkin belum sedia ketika app start (dalam Docker).
// Cuba sambung berulang sebelum menyerah.
export async function waitForDb(maxRetries = 15, delayMs = 2000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] ✅ Sambungan PostgreSQL berjaya.');
      return;
    } catch (err) {
      console.log(
        `[db] Menunggu PostgreSQL... cubaan ${i}/${maxRetries} (${err.code || err.message})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[db] Gagal sambung ke PostgreSQL selepas beberapa cubaan.');
}
