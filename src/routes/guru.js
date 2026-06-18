import { Router } from 'express';
import { getClasses, getClassesStatus, getPelajar, simpanKehadiran } from '../services/guruService.js';

export const guruRouter = Router();

// GET /api/guru/classes — senarai kelas untuk grid (ditapis ikut guru)
guruRouter.get('/classes', async (req, res) => {
  try {
    res.json(await getClasses(req.session && req.session.user));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/guru/classes-status — senarai kelas + bil pelajar + status isi hari ini (Fasa 8.2)
guruRouter.get('/classes-status', async (req, res) => {
  try {
    res.json(await getClassesStatus());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/guru/classes/:kod/pelajar — senarai pelajar aktif bagi kelas
guruRouter.get('/classes/:kod/pelajar', async (req, res) => {
  try {
    res.json(await getPelajar(req.params.kod));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/guru/kehadiran — simpan kehadiran ke PostgreSQL (upsert tarikh+kelas)
guruRouter.post('/kehadiran', async (req, res) => {
  try {
    res.json(await simpanKehadiran(req.body || {}));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
