import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { healthRouter } from './routes/health.js';
import { syncRouter } from './routes/sync.js';
import { auditRouter } from './routes/audit.js';
import { dashboardRouter } from './routes/dashboard.js';
import { guruRouter } from './routes/guru.js';
import { adminRouter } from './routes/admin.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { requireAuth, requireRole, requirePage } from './middleware/auth.js';

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

  // ── Sesi (Fasa 8) — store dalam PostgreSQL (tahan restart) ──
  // Dilayan di LAN melalui HTTP, jadi cookie `secure:false` (selaras nota CSP/UIR di atas).
  const PgStore = connectPgSimple(session);
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'kehadiran.sid',
      store: new PgStore({ pool, tableName: 'session', createTableIfMissing: true }),
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,            // LAN HTTP — JANGAN true (cookie akan digugurkan)
        maxAge: config.session.maxAgeMs,
      },
    })
  );

  // ── API terbuka (read-only) — Fasa 1-4 kekal tanpa auth ──
  app.use('/api', healthRouter);            // /api/health
  app.use('/api/sync', syncRouter);         // sync read-only (tidak disentuh)
  app.use('/api/dashboard', dashboardRouter); // dashboard read-only — KEKAL TERBUKA
  app.use('/api/auth', authRouter);         // log masuk / keluar / me

  // ── API dilindungi (Fasa 8) ──
  app.use('/api/guru', requireAuth, requireRole('GURU', 'ADMIN', 'SUPER_ADMIN'), guruRouter);
  app.use('/api/admin', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), adminRouter);
  app.use('/api/analytics', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), analyticsRouter);
  app.use('/api/audit', requireAuth, requireRole('SUPER_ADMIN'), auditRouter);

  // ── Frontend ──
  // Halaman login terbuka.
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
  app.get('/dashboard', (req, res) => res.redirect('/'));

  // Halaman terlindung — DIDAFTAR SEBELUM express.static supaya guard
  // mendahului penyajian fail statik (.html boleh diakses terus jika tidak).
  // Lindungi kedua-dua bentuk: /guru dan /guru.html, dsb.
  const sendPage = (file) => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file));
  app.get(['/guru', '/guru.html'], requirePage('GURU', 'ADMIN', 'SUPER_ADMIN'), sendPage('guru.html'));
  app.get(['/admin', '/admin.html'], requirePage('ADMIN', 'SUPER_ADMIN'), sendPage('admin.html'));
  app.get(['/analytics', '/analytics.html'], requirePage('ADMIN', 'SUPER_ADMIN'), sendPage('analytics.html'));

  // Aset awam (CSS/JS, index.html dashboard read-only). Halaman .html terlindung
  // di atas sudah ditangani sebelum sampai ke sini.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 404
  app.use((req, res) => res.status(404).json({ ralat: 'Tidak dijumpai' }));

  return app;
}
