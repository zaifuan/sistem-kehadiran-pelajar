import { Router } from 'express';
import { importSummary, attendanceCompare, warnings } from '../services/auditService.js';

export const auditRouter = Router();

// GET /api/audit/import-summary — kiraan ringkas import
auditRouter.get('/import-summary', async (req, res) => {
  try {
    res.json(await importSummary());
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/audit/attendance-compare — validasi formula (snapshot Sheet vs kiraan server)
auditRouter.get('/attendance-compare', async (req, res) => {
  try {
    res.json(await attendanceCompare());
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/audit/warnings — isu kualiti data (konflik, tarikh, metadata, duplicate)
auditRouter.get('/warnings', async (req, res) => {
  try {
    res.json(await warnings());
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
