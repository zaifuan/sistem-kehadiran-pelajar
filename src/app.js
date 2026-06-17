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
import { guruRouter } from './routes/guru.js';
import { adminRouter } from './routes/admin.js';
import { analyticsRouter } from './routes/analytics.js';

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
  app.use('/api/guru', guruRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/analytics', analyticsRouter);

  // Frontend statik — Dashboard (read-only) + Portal Guru (isi kehadiran)
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/dashboard', (req, res) => res.redirect('/'));
  app.get('/guru', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'guru.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.get('/analytics', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'analytics.html')));

  // 404
  app.use((req, res) => res.status(404).json({ ralat: 'Tidak dijumpai' }));

  return app;
}
