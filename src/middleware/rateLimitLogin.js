// ════════════════════════════════════════════════════════════
//  Rate-limit khusus endpoint LOGIN admin (T-4)
//  • In-process (peta IP → tetingkap). Tanpa dependency baru.
//  • Anti brute-force password: had bilangan percubaan per-IP
//    dalam tetingkap masa gelung.
//  • Dipasang HANYA pada POST /api/auth/login (lihat routes/auth.js).
//    Portal Guru (/api/guru/*) TIDAK disentuh.
//
//  Reka bentuk:
//    - Key = IP pelanggan (req.ip; betul kerana app.set('trust proxy', 1)).
//    - Setiap percubaan (BERJAYA mahupun GAGAL) menambah kaunter.
//    - Reset kaunter selepas `windowMs` rehat (tiada percubaan baru).
//    - Melebihi `max` → 429 Too Many Requests + header Retry-After.
//    - mesej generik — tidak bocorkan sama ada akaun wujud.
//
//  Trade-off diterima: state hilang bila proses restart (boleh diterima
//  untuk throttle brute-force password; argon2id melambatkan setiap cubaan).
//  Untuk beban berbilang proses/instance, ganti dengan Redis-backed store.
// ════════════════════════════════════════════════════════════

// Tetingkap & had. Boleh ditindih via env (jualan: 10 percubaan / 10 minit).
const WINDOW_MS = parseInt(process.env.LOGIN_RATE_WINDOW_MS || String(10 * 60 * 1000), 10);
const MAX = parseInt(process.env.LOGIN_RATE_MAX || '10', 10);

// Peta IP → { count, firstHitMs }
const hits = new Map();

// Sahkan tetapan (elak NaN/kosong; fallback ke lalai selamat).
const windowMs = Number.isFinite(WINDOW_MS) && WINDOW_MS > 0 ? WINDOW_MS : 10 * 60 * 1000;
const max = Number.isFinite(MAX) && MAX > 0 ? MAX : 10;

// Bersihkan entri basi secara berkala (elak Map membesar tanpa had).
const SWEEP_MS = 5 * 60 * 1000;
let sweepStarted = false;
function startSweeper() {
  if (sweepStarted) return;
  sweepStarted = true;
  const iv = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (now - rec.firstHitMs > windowMs) hits.delete(ip);
    }
  }, SWEEP_MS);
  if (iv && typeof iv.unref === 'function') iv.unref();   // tidak menahan proses keluar
}

/**
 * Middleware rate-limit untuk POST /api/auth/login.
 * Pulangkan 429 jika IP melebihi had dalam tetingkap.
 */
export function rateLimitLogin(req, res, next) {
  startSweeper();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = hits.get(ip);

  // Tetingkap telah tamat → reset.
  if (rec && (now - rec.firstHitMs) > windowMs) {
    rec = undefined;
    hits.delete(ip);
  }

  if (!rec) {
    rec = { count: 0, firstHitMs: now };
    hits.set(ip, rec);
  }
  rec.count += 1;

  // Melebihi had → tolak. Retry-After = baki masa tetingkap (saat).
  if (rec.count > max) {
    const retryAfterSec = Math.ceil((rec.firstHitMs + windowMs - now) / 1000);
    // Penyerang tidak boleh memanjangkan tetingkap dengan terus-menyerang;
    // firstHitMs TIDAK dikemas kini di sini.
    return res
      .status(429)
      .set('Retry-After', String(Math.max(retryAfterSec, 1)))
      .json({ ok: false, ralat: 'Terlalu banyak percubaan log masuk. Cuba lagi nanti.' });
  }

  // Luluskan ke handler; rekodkan respons supaya hit tetap dikira walaupun
  // ada pemberhentian awal lain (cth validation) — brute-force tetap dihadkan.
  return next();
}

// ── Eksport sumber ujian (TIDAK dipakai runtime; hanya memudahkan unit test) ──
export const _internals = { hits, windowMs, max, reset: () => hits.clear() };
