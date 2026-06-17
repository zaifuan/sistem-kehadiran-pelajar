import { Router } from 'express';
import { summary, classes, recentAttendance } from '../services/dashboardService.js';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', async (req, res) => {
  try {
    res.json(await summary());
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

dashboardRouter.get('/classes', async (req, res) => {
  try {
    res.json(await classes());
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

dashboardRouter.get('/recent-attendance', async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    res.json(await recentAttendance(limit));
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
