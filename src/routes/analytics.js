import { Router } from 'express';
import {
  daily, weekly, monthly, classAnalytics, studentAnalytics,
} from '../services/analyticsService.js';

export const analyticsRouter = Router();

function fail(res, err) {
  res.status(err.status || 500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
}

// GET /api/analytics/daily?tarikh=&kelas=&bulan=&dari=&hingga= — Analisis Harian
analyticsRouter.get('/daily', async (req, res) => {
  try { res.json(await daily(req.query || {})); } catch (err) { fail(res, err); }
});

// GET /api/analytics/weekly?kelas=&bulan=&dari=&hingga= — Analisis Mingguan (Σh/Σj)
analyticsRouter.get('/weekly', async (req, res) => {
  try { res.json(await weekly(req.query || {})); } catch (err) { fail(res, err); }
});

// GET /api/analytics/monthly?kelas=&tahun=&dari=&hingga= — Analisis Bulanan (Σh/Σj)
analyticsRouter.get('/monthly', async (req, res) => {
  try { res.json(await monthly(req.query || {})); } catch (err) { fail(res, err); }
});

// GET /api/analytics/class/:kelas — Paparan Kelas (harian/mingguan/bulanan/trend)
analyticsRouter.get('/class/:kelas', async (req, res) => {
  try { res.json(await classAnalytics(req.params.kelas)); } catch (err) { fail(res, err); }
});

// GET /api/analytics/student/:id?bulan=&dari=&hingga= — Paparan Pelajar
analyticsRouter.get('/student/:id', async (req, res) => {
  try { res.json(await studentAnalytics(req.params.id, req.query || {})); } catch (err) { fail(res, err); }
});
