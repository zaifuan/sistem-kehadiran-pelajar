import { config, assertProductionSecrets } from './config.js';
import { buatApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { pool } from './db/pool.js';
import { startTelegramScheduler } from './services/telegramScheduler.js';

async function main() {
  // K-3: fail-closed jika SESSION_SECRET / kata laluan seed lemah dalam produksi.
  assertProductionSecrets();

  if (config.runMigrationsOnStart) {
    await runMigrations();
  }
  if (config.runSeedOnStart) {
    await runSeed();
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

  // T-2: mulakan penjadual automasi Telegram selepas server mendengar.
  //   • Idempoten (guard `started`) — selamat walaupun dipanggil berulang.
  //   • Tidak crash jika kredential Telegram tiada: tick() pulang senyap bila
  //     token/chat kosong; tidak menghantar apa-apa semasa startup.
  //   • Boleh dimatikan sepenuhnya via env TELEGRAM_SCHEDULER=off.
  startTelegramScheduler();

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
