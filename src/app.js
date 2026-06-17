import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRouter } from './routes/health.js';
import { syncRouter } from './routes/sync.js';
import { auditRouter } from './routes/audit.js';
import { dashboardRouter } from './routes/dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buatApp() {
  const app = express();

  // Dashboard di-serve melalui HTTP di LAN (bukan HTTPS). Helmet secara lalai
  // menambah CSP 'upgrade-insecure-requests' yang memaksa browser menukar
  // /app.js, /style.css, dan panggilan fetch /api ke HTTPS — lalu gagal kerana
  // server hanya HTTP, menyebabkan UI tersangkut. Kekalkan CSP lain, buang UIR.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { upgradeInsecureRequests: null },
      },
    })
  );
  app.use(cors());
  app.use(express.json());
  app.use(morgan('tiny'));

  // API
  app.use('/api', healthRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/dashboard', dashboardRouter);

  // Frontend statik — Dashboard mobile-first (read-only)
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/dashboard', (req, res) => res.redirect('/'));

  // 404
  app.use((req, res) => res.status(404).json({ ralat: 'Tidak dijumpai' }));

  return app;
}
