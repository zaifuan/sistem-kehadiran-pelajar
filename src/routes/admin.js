import { Router } from 'express';
import { todaySummary, missingClasses, records } from '../services/adminService.js';
import { listUsers } from '../services/authService.js';
import { listAssignments, assignKelas, unassignKelas } from '../services/assignmentService.js';

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

// ── Pengurusan pengguna & penugasan guru-kelas (Fasa 8) ──

// GET /api/admin/users — senarai pengguna (untuk panel penugasan)
adminRouter.get('/users', async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/admin/assignments?user_id= — senarai penugasan guru-kelas
adminRouter.get('/assignments', async (req, res) => {
  try {
    const uid = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    res.json(await listAssignments(uid));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/admin/assignments { user_id, class_kod } — tugaskan kelas
adminRouter.post('/assignments', async (req, res) => {
  try {
    const { user_id, class_kod } = req.body || {};
    res.json(await assignKelas(parseInt(user_id, 10), class_kod));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// DELETE /api/admin/assignments { user_id, class_kod } — buang penugasan
adminRouter.delete('/assignments', async (req, res) => {
  try {
    const { user_id, class_kod } = req.body || {};
    res.json(await unassignKelas(parseInt(user_id, 10), class_kod));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
