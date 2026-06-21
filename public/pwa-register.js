/* Pendaftaran Service Worker PWA.
   Fail LUARAN (bukan inline) supaya patuh CSP `script-src 'self'`.
   SW memerlukan konteks selamat: HTTPS atau localhost (bukan LAN HTTP biasa). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(function (err) {
        console.warn('[PWA] Pendaftaran service worker gagal:', err);
      });
  });
}
