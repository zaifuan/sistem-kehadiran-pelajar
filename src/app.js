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
import { superadminRouter } from './routes/superadmin.js';
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
  // T-3: cookie.secure kini production-aware ('auto'). express-session
  // menetapkan bendera `Secure` berdasarkan protokol request semasa
  // (req.protocol, yang betul kerana trust proxy=1 di bawah):
  //   • Local/dev HTTP        → Secure TIDAK ditetapkan → cookie dihantar, login OK.
  //   • Production + HTTPS/proxy → Secure ditetapkan → cookie HANYA melalui HTTPS.
  // httpOnly & sameSite kekal selamat (lihat bawah).
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
        httpOnly: true,            // kekal: JS tak boleh baca cookie (anti XSS theft)
        sameSite: 'lax',           // kekal: halang CSRF rentas tapak asas
        secure: 'auto',            // T-3: HTTPS-aware (auto ikut req.protocol)
        maxAge: config.session.maxAgeMs,
      },
    })
  );

  // ── API terbuka (read-only) — Fasa 1-4 kekal tanpa auth ──
  app.use('/api', healthRouter);            // /api/health
  // K-1: enjin sync boleh menulis/menimpa data — dikunci kepada SUPER_ADMIN.
  // (UI awam ambil status sync dari /api/dashboard/summary, bukan /api/sync.)
  app.use('/api/sync', requireAuth, requireRole('SUPER_ADMIN'), syncRouter);
  app.use('/api/dashboard', dashboardRouter); // dashboard read-only — KEKAL TERBUKA
  app.use('/api/auth', authRouter);         // log masuk / keluar / me
  app.use('/api/guru', guruRouter);         // Portal Guru — TERBUKA (Fasa 8.1: tanpa login)

  // ── API dilindungi (Fasa 8) — admin/superadmin sahaja ──
  app.use('/api/admin', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), adminRouter);
  app.use('/api/analytics', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), analyticsRouter);
  app.use('/api/audit', requireAuth, requireRole('SUPER_ADMIN'), auditRouter);

  // ── API Super Admin (Fasa 9) — SUPER_ADMIN sahaja ──
  //   requireRole memulangkan 403 untuk ADMIN, 401 untuk tanpa login.
  app.use('/api/superadmin', requireAuth, requireRole('SUPER_ADMIN'), superadminRouter);

  // ── Frontend ──
  // Halaman login terbuka.
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
  app.get('/dashboard', (req, res) => res.redirect('/'));

  // ── Routing ikut domain (Fasa 8.1) ──
  // Portal guru & portal admin dihos pada domain berasingan. Hanya path '/'
  // dialih; host lain (cth IP server) jatuh ke dashboard statik seperti biasa.
  const HOST_GURU = 'kehadiranpelajar.byzaifuan.com';
  const HOST_ADMIN = 'adminkehadiranpelajar.byzaifuan.com';
  app.get('/', (req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    if (host === HOST_GURU) return res.redirect('/guru');
    if (host === HOST_ADMIN) return res.redirect('/login');
    return next(); // host lain → dashboard read-only (index.html) via express.static
  });

  const sendPage = (file) => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file));

  // Portal guru — TERBUKA tanpa login (Fasa 8.1), seperti sebelum Fasa 8.
  app.get(['/guru', '/guru.html'], sendPage('guru.html'));

  // Halaman admin terlindung — DIDAFTAR SEBELUM express.static supaya guard
  // mendahului penyajian fail statik (.html boleh diakses terus jika tidak).
  app.get(['/admin', '/admin.html'], requirePage('ADMIN', 'SUPER_ADMIN'), sendPage('admin.html'));
  app.get(['/analytics', '/analytics.html'], requirePage('ADMIN', 'SUPER_ADMIN'), sendPage('analytics.html'));

  // ── Halaman Super Admin (Fasa 9) — SUPER_ADMIN sahaja ──
  //   Tanpa login → /login. ADMIN → /admin (bukan halaman akses ditolak
  //   generik, agar pengguna dibawa ke dashboard mereka sendiri).
  //   Gunakan handler khusus (selaras corak requirePage di middleware/auth.js).
  app.get(['/superadmin', '/superadmin.html'], (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) {
      const next_ = encodeURIComponent(req.originalUrl || '/superadmin');
      return res.redirect(`/login?next=${next_}`);
    }
    if (u.role !== 'SUPER_ADMIN') return res.redirect('/admin');
    return next();
  }, sendPage('superadmin.html'));

  // Aset awam (CSS/JS, index.html dashboard read-only). Halaman .html terlindung
  // di atas sudah ditangani sebelum sampai ke sini.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 404
  app.use((req, res) => res.status(404).json({ ralat: 'Tidak dijumpai' }));

  return app;
}
