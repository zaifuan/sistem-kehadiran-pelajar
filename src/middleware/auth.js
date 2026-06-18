// ════════════════════════════════════════════════════════════
//  Middleware Autentikasi & Kebenaran (Fasa 8)
//  Sesi cookie (express-session) — req.session.user diisi semasa login.
//  Bentuk user: { id, username, nama, role }  (role = kod: GURU/ADMIN/SUPER_ADMIN)
// ════════════════════════════════════════════════════════════
import { isKelasUntukGuru } from '../services/assignmentService.js';

// ── API: mesti log masuk (balas 401 JSON jika tidak) ──
export function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ ok: false, auth: false, ralat: 'Perlu log masuk' });
}

// ── API: mesti salah satu peranan yang disenaraikan ──
export function requireRole(...kodList) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false, auth: false, ralat: 'Perlu log masuk' });
    if (!kodList.includes(u.role)) {
      return res.status(403).json({ ok: false, ralat: 'Akses ditolak — peranan tidak mencukupi' });
    }
    return next();
  };
}

// ── API guru: hadkan akses kepada kelas yang ditugaskan ──
//   ADMIN / SUPER_ADMIN melepasi semakan (akses semua kelas).
//   Parameter kelas diambil dari req.params.kod, atau req.body.kelas.
export async function requireClassAccess(req, res, next) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false, auth: false, ralat: 'Perlu log masuk' });
    if (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') return next();

    const kod = req.params.kod || (req.body && req.body.kelas);
    if (!kod) return res.status(400).json({ ok: false, ralat: 'Kelas tidak dinyatakan' });

    const benar = await isKelasUntukGuru(u.id, kod);
    if (!benar) {
      return res.status(403).json({ ok: false, ralat: `Anda tidak ditugaskan ke kelas '${kod}'` });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ ok: false, ralat: String(err && err.message ? err.message : err) });
  }
}

// ── Halaman HTML: redirect ke /login jika belum log masuk ──
//   roles kosong = mana-mana pengguna yang sudah log masuk.
//   Jika log masuk tetapi peranan salah → redirect ke / dengan amaran.
export function requirePage(...roles) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) {
      const next_ = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/login?next=${next_}`);
    }
    if (roles.length && !roles.includes(u.role)) {
      return res.redirect('/login?ralat=akses_ditolak');
    }
    return next();
  };
}
