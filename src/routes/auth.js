// ════════════════════════════════════════════════════════════
//  Route Autentikasi (Fasa 8) — /api/auth/*
// ════════════════════════════════════════════════════════════
import { Router } from 'express';
import { sahkanLogin, tukarKataLaluan } from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// POST /api/auth/login { username, kata_laluan }
authRouter.post('/login', async (req, res) => {
  try {
    const { username, kata_laluan } = req.body || {};
    const user = await sahkanLogin(username, kata_laluan);
    // Regenerate sesi untuk elak session fixation.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ ok: false, ralat: 'Gagal mula sesi' });
      req.session.user = user;
      res.json({ ok: true, user });
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('kehadiran.sid');
    res.json({ ok: true, mesej: 'Log keluar berjaya.' });
  });
});

// GET /api/auth/me — siapa yang log masuk
authRouter.get('/me', (req, res) => {
  const u = req.session && req.session.user;
  if (!u) return res.status(401).json({ ok: false, auth: false });
  res.json({ ok: true, auth: true, user: u });
});

// POST /api/auth/tukar-kata-laluan { lama, baru }
authRouter.post('/tukar-kata-laluan', requireAuth, async (req, res) => {
  try {
    const { lama, baru } = req.body || {};
    res.json(await tukarKataLaluan(req.session.user.id, lama, baru));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
