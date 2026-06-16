import { config } from './config.js';
import { buatApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';

async function main() {
  if (config.runMigrationsOnStart) {
    await runMigrations();
  }

  const app = buatApp();
  // Bind ke 0.0.0.0 (semua antara muka) — WAJIB untuk Docker.
  // Tanpa host, Node boleh bind ke IPv6 '::' sahaja (lazim pada imej Alpine),
  // menyebabkan port-forward IPv4 Docker (0.0.0.0:3010->3000) "connection reset".
  const HOST = '0.0.0.0';
  const server = app.listen(config.port, HOST, () => {
    console.log(`[app] ✅ Server berjalan di ${HOST}:${config.port} (env: ${config.env})`);
    console.log(`[app] Health check (dalam container): http://localhost:${config.port}/api/health`);
  });

  // Penutupan kemas
  const shutdown = (signal) => {
    console.log(`\n[app] ${signal} diterima — menutup server...`);
    server.close(async () => {
      await pool.end();
      console.log('[app] Selesai. Selamat tinggal.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[app] Ralat permulaan:', err);
  process.exit(1);
});
