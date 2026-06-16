import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  let db = 'down';
  try {
    await pool.query('SELECT 1');
    db = 'up';
  } catch (_) {
    // db masih down — dilaporkan di bawah
  }
  res.json({
    status: 'ok',
    service: 'sistem-pantau-kehadiran',
    fasa: 1,
    db,
    masa: new Date().toISOString(),
  });
});
