// ════════════════════════════════════════════════════════════
//  Route Super Admin (Fasa 9) — /api/superadmin/*
//  Dilindungi requireAuth + requireRole('SUPER_ADMIN') di app.js.
//  ADMIN → 403, tanpa login → 401 (ditangani middleware di app.js).
// ════════════════════════════════════════════════════════════
import { Router } from 'express';
import {
  listUsers, updateUser,
  listHolidays, createHoliday, updateHoliday, deleteHoliday,
  resetAttendanceClass, resetAttendanceDay,
  systemSummary, listActiveClassKod,
} from '../services/superadminService.js';

export const superadminRouter = Router();

function actorId(req) {
  const u = req.session && req.session.user;
  return u ? u.id : null;
}

// ── 1) Pengurusan Akaun ──
superadminRouter.get('/users', async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// PATCH /api/superadmin/users/:id  { username?, nama?, kata_laluan?, aktif? }
superadminRouter.patch('/users/:id', async (req, res) => {
  try {
    res.json(await updateUser(req.params.id, req.body || {}, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// ── 2) Tetapan Cuti ──
superadminRouter.get('/holidays', async (req, res) => {
  try {
    const onlyActive = req.query.aktif === 'true' || req.query.aktif === '1';
    res.json(await listHolidays(onlyActive));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/superadmin/holidays  { tarikh_mula, tarikh_tamat, nama_cuti, catatan?, aktif? }
superadminRouter.post('/holidays', async (req, res) => {
  try {
    res.status(201).json(await createHoliday(req.body || {}, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// PATCH /api/superadmin/holidays/:id  { tarikh_mula?, tarikh_tamat?, nama_cuti?, catatan?, aktif? }
superadminRouter.patch('/holidays/:id', async (req, res) => {
  try {
    res.json(await updateHoliday(req.params.id, req.body || {}, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// DELETE /api/superadmin/holidays/:id
superadminRouter.delete('/holidays/:id', async (req, res) => {
  try {
    res.json(await deleteHoliday(req.params.id, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// ── 3) Reset Kehadiran ──
// DELETE /api/superadmin/attendance?tarikh=YYYY-MM-DD&kelas=1K
superadminRouter.delete('/attendance', async (req, res) => {
  try {
    const q = req.query || {};
    res.json(await resetAttendanceClass(q.tarikh, q.kelas, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// DELETE /api/superadmin/attendance-day?tarikh=YYYY-MM-DD  body { sahan:'SAHKAN' } atau query &sahan=SAHKAN
superadminRouter.delete('/attendance-day', async (req, res) => {
  try {
    const q = req.query || {};
    const sahan = s(q.sahan) || s(req.body && req.body.sahan) || s(q.sahkan) || s(req.body && req.body.sahkan);
    res.json(await resetAttendanceDay(q.tarikh, sahan, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// ── 4) Maklumat Sistem ──
superadminRouter.get('/summary', async (req, res) => {
  try {
    res.json(await systemSummary());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// Senarai kelas aktif untuk dropdown reset.
superadminRouter.get('/classes', async (req, res) => {
  try {
    res.json(await listActiveClassKod());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

function s(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}
