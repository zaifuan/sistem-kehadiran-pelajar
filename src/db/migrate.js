import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, waitForDb } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');

export async function runMigrations() {
  await waitForDb();
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('[migrate] Menjalankan db/schema.sql (idempotent)...');
  await pool.query(sql);
  console.log('[migrate] ✅ Schema siap.');
}

// Jika fail ini dijalankan terus: `node src/db/migrate.js` atau `npm run db:migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] Ralat:', err);
      process.exit(1);
    });
}
