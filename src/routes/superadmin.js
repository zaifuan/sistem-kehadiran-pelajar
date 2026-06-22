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
  systemSummary, listActiveClassKod, runSheetSync,
  tgGetSettings, tgStatus, tgRecentLogs, tgSaveSettings, tgTest, tgSendDaily,
  tgSendWeekly, tgSendMonthly, tgSendFollowup,
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
    const sahan = s(q.sahan) || s(req.body && req.body.sahan) || s(q.sahkan) || s(req.body && req.body.sahkan);
    res.json(await resetAttendanceClass(q.tarikh, q.kelas, sahan, actorId(req)));
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

// ── 5) Google Sheet Sync (SUPER_ADMIN sahaja — Fasa 10) ──
// POST /api/superadmin/sync — cetus enjin sync sedia ada (dua Google Sheet).
// Hanya SUPER_ADMIN (dikuatkuasa requireRole di app.js; ADMIN → 403).
superadminRouter.post('/sync', async (req, res) => {
  try {
    res.json(await runSheetSync(actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

function s(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// ════════════════════════════════════════════════════════════
//  5) TELEGRAM ASAS (Fasa 11A) — semua warisi guard SUPER_ADMIN
//     daripada mount /api/superadmin di app.js.
// ════════════════════════════════════════════════════════════
superadminRouter.get('/telegram/settings', async (req, res) => {
  try {
    res.json(await tgGetSettings());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

superadminRouter.get('/telegram/status', async (req, res) => {
  try {
    res.json(await tgStatus());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// PATCH /api/superadmin/telegram/settings  { bot_token?, chat_id?, bot_token_clear? }
superadminRouter.patch('/telegram/settings', async (req, res) => {
  try {
    res.json(await tgSaveSettings(req.body || {}, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

superadminRouter.post('/telegram/test', async (req, res) => {
  try {
    res.json(await tgTest(actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/superadmin/telegram/daily?force=1  — hantar laporan harian manual
superadminRouter.post('/telegram/daily', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true' || (req.body && req.body.force === true);
    res.json(await tgSendDaily(force, actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

superadminRouter.get('/telegram/logs', async (req, res) => {
  try {
    res.json(await tgRecentLogs());
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/superadmin/telegram/weekly  — hantar snapshot mingguan sekarang (manual)
superadminRouter.post('/telegram/weekly', async (req, res) => {
  try {
    res.json(await tgSendWeekly(actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/superadmin/telegram/monthly  — hantar snapshot bulanan sekarang (manual)
superadminRouter.post('/telegram/monthly', async (req, res) => {
  try {
    res.json(await tgSendMonthly(actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// POST /api/superadmin/telegram/followup  — hantar "Peringatan Kelas Belum Isi" (manual)
//   Bukan ralat jika tiada kelas belum (balas dihantar:false + mesej info).
//   Tidak ganggu automasi scheduler / ledger dedup.
superadminRouter.post('/telegram/followup', async (req, res) => {
  try {
    res.json(await tgSendFollowup(actorId(req)));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
