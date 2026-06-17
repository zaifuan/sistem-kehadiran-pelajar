import { Router } from 'express';
import { pool } from '../db/pool.js';
import { runSync } from '../services/syncService.js';

export const syncRouter = Router();

// POST /api/sync/google-sheets — cetus sync read-only (TANPA auth — Fasa 2 sahaja)
syncRouter.post('/google-sheets', async (req, res) => {
  try {
    const hasil = await runSync();
    const kod = hasil.status === 'gagal' ? 500 : 200;
    res.status(kod).json({ ok: hasil.status !== 'gagal', ...hasil });
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});

// GET /api/sync/status — ringkasan sync terakhir + log terkini + kiraan baris
syncRouter.get('/status', async (req, res) => {
  try {
    const ringkasan = await pool.query(
      `SELECT dijalankan_pada, status, mesej FROM sync_logs
       WHERE jenis = 'RINGKASAN' ORDER BY id DESC LIMIT 1`
    );
    const terkini = await pool.query(
      `SELECT dijalankan_pada, arah, jenis, status, bil_rekod, mesej FROM sync_logs
       ORDER BY id DESC LIMIT 25`
    );
    const kira = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM classes)            AS classes,
        (SELECT COUNT(*) FROM students)           AS students,
        (SELECT COUNT(*) FROM attendance_records) AS attendance_records,
        (SELECT COUNT(*) FROM sheet_raw)          AS sheet_raw
    `);

    let ringkasanTerakhir = null;
    if (ringkasan.rowCount > 0) {
      let butiran = null;
      try {
        butiran = JSON.parse(ringkasan.rows[0].mesej);
      } catch (_) {
        butiran = null;
      }
      ringkasanTerakhir = {
        dijalankan_pada: ringkasan.rows[0].dijalankan_pada,
        status: ringkasan.rows[0].status,
        butiran,
      };
    }

    res.json({
      ok: true,
      ringkasan_terakhir: ringkasanTerakhir,
      kiraan: kira.rows[0],
      log_terkini: terkini.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
});
