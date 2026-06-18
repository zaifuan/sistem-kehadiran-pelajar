'use strict';

/* ============================================================
   Log masuk (Fasa 8). POST /api/auth/login → set sesi cookie.
   Selepas berjaya: redirect ke ?next= (jika selamat) atau
   halaman lalai mengikut peranan.
   ============================================================ */
const $ = (s) => document.querySelector(s);

function destinasi(role) {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  // Hanya benarkan path dalaman (elak open-redirect).
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  if (role === 'GURU') return '/guru';
  return '/admin'; // ADMIN / SUPER_ADMIN
}

// Papar amaran jika peranan tidak mencukupi untuk halaman yang diminta.
(function initRalat() {
  const params = new URLSearchParams(location.search);
  if (params.get('ralat') === 'akses_ditolak') {
    $('#ralat').textContent = 'Akses ditolak untuk halaman tersebut. Sila log masuk dengan akaun yang sesuai.';
  }
})();

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-login');
  const ralat = $('#ralat');
  ralat.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: $('#username').value.trim(),
        kata_laluan: $('#kata_laluan').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.ralat || ('HTTP ' + res.status));
    }
    location.href = destinasi(data.user && data.user.role);
  } catch (err) {
    ralat.textContent = err.message || 'Gagal log masuk.';
    btn.disabled = false;
    btn.textContent = 'Log Masuk';
  }
});
