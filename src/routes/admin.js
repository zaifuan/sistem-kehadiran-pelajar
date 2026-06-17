import { Router } from 'express';
import { todaySummary, missingClasses, records } from '../services/adminService.js';

export const adminRouter = Router();

// GET /api/admin/today-summary — kiraan ringkas dashboard "hari ini"
adminRouter.get('/today-summary', async (req, res) => {
  try {
    res.json(await todaySummary());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/admin/missing-classes — senarai kelas "Belum Isi" hari ini
adminRouter.get('/missing-classes', async (req, res) => {
  try {
    res.json(await missingClasses());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/admin/records?tarikh=YYYY-MM-DD&kelas=KOD — rekod lepas (baca sahaja)
adminRouter.get('/records', async (req, res) => {
  try {
    res.json(await records(req.query || {}));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
