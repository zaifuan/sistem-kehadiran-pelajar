// ════════════════════════════════════════════════════════════
//  telegramService.js (Fasa 11A) — Telegram ASAS sahaja.
//  • Simpan Bot Token + Chat ID (telegram_settings, env fallback).
//  • Token TIDAK PERNAH dipulangkan penuh ke frontend / di-log ke console.
//  • Uji sambungan + Hantar Laporan Harian (manual).
//  • Log penghantaran guna jadual telegram_logs (Fasa 8) sedia ada.
//  • TIADA scheduler, TIADA automasi mingguan/bulanan.
//  • Laporan harian guna semula adminService (todaySummary/missingClasses)
//    — tidak mengubah modul Admin/Analytics.
// ════════════════════════════════════════════════════════════
import { pool } from '../db/pool.js';
import { todaySummary, missingClasses } from './adminService.js';

const TG_API = 'https://api.telegram.org';

function s(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function fmtPct(p) { return p == null ? '0.00' : (Math.round(Number(p) * 100) / 100).toFixed(2); }
function isoToSlash(iso) { const m = s(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s(iso); }

// ── Tetapan ──
export async function getRawSettings() {
  await pool.query('INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  const r = await pool.query('SELECT * FROM telegram_settings WHERE id = 1');
  return r.rows[0];
}
function effToken(st) { return (st && s(st.bot_token)) || s(process.env.TELEGRAM_BOT_TOKEN); }
function effChat(st) { return (st && s(st.chat_id)) || s(process.env.TELEGRAM_CHAT_ID); }
function maskToken(t) { const v = s(t); if (!v) return ''; return v.length <= 10 ? '••••••' : v.slice(0, 6) + '••••••' + v.slice(-4); }
function maskChat(t) { const v = s(t); if (!v) return ''; return v.length <= 4 ? v : '••••' + v.slice(-4); }

export async function getSettingsForUI() {
  const st = await getRawSettings();
  const token = effToken(st), chat = effChat(st);
  return {
    ok: true,
    tetapan: {
      token_set: !!token,
      token_mask: maskToken(token),                 // hanya bertopeng — tidak pernah penuh
      token_sumber: s(st.bot_token) ? 'db' : (s(process.env.TELEGRAM_BOT_TOKEN) ? 'env' : null),
      chat_id: chat || '',
      chat_mask: maskChat(chat),
      dikemaskini_pada: st.dikemaskini_pada,
    },
  };
}

export async function status() {
  const st = await getRawSettings();
  const token = effToken(st), chat = effChat(st);
  return { ok: true, dikonfigurasi: !!(token && chat), token_set: !!token, chat_set: !!chat, token_mask: maskToken(token), chat_mask: maskChat(chat) };
}

export async function saveSettings(body = {}) {
  const sets = []; const vals = []; let i = 1;
  // Token: tukar hanya jika nilai baharu BUKAN kosong & BUKAN topeng (elak terpadam bila UI hantar mask).
  if (body.bot_token !== undefined && s(body.bot_token) !== '' && !s(body.bot_token).includes('••')) {
    sets.push(`bot_token=$${i++}`); vals.push(s(body.bot_token));
  }
  if (body.bot_token_clear === true) { sets.push(`bot_token=$${i++}`); vals.push(null); }
  if (body.chat_id !== undefined && !s(body.chat_id).includes('••')) { sets.push(`chat_id=$${i++}`); vals.push(s(body.chat_id) || null); }
  if (!sets.length) { const e = new Error('Tiada perubahan tetapan'); e.status = 400; throw e; }
  sets.push('dikemaskini_pada=now()');
  await pool.query(`UPDATE telegram_settings SET ${sets.join(', ')} WHERE id = 1`, vals);
  return { ok: true, mesej: 'Tetapan Telegram disimpan.' };
}

// ── Telegram Bot API (token tidak di-log) ──
async function tgRequest(token, method, payload) {
  let res;
  try {
    res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
    });
  } catch (err) {
    const e = new Error('Gagal menghubungi Telegram (rangkaian)'); e.status = 502; throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!data || data.ok !== true) {
    const e = new Error('Telegram: ' + ((data && data.description) || ('HTTP ' + res.status))); e.status = 502; throw e;
  }
  return data.result;
}

// ── Log guna telegram_logs (Fasa 8): jenis_mesej, tarikh_rujukan, status, ringkasan ──
async function logTelegram(jenis, tarikhRujukan, statusVal, ringkasan) {
  await pool.query(
    `INSERT INTO telegram_logs (jenis_mesej, tarikh_rujukan, status, ringkasan) VALUES ($1,$2,$3,$4)`,
    [jenis, tarikhRujukan || null, statusVal, (ringkasan || '').slice(0, 500)]
  ).catch(() => { /* log tidak kritikal */ });
}

export async function sendTelegram(text) {
  const st = await getRawSettings();
  const token = effToken(st), chat = effChat(st);
  if (!token) { const e = new Error('Bot Token Telegram belum ditetapkan'); e.status = 400; throw e; }
  if (!chat) { const e = new Error('Chat ID Telegram belum ditetapkan'); e.status = 400; throw e; }
  return tgRequest(token, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
}

export async function testTelegram() {
  const st = await getRawSettings();
  const token = effToken(st), chat = effChat(st);
  if (!token) { const e = new Error('Bot Token belum ditetapkan'); e.status = 400; throw e; }
  let me, messageId = null;
  try {
    me = await tgRequest(token, 'getMe', {});
    if (chat) {
      const r = await tgRequest(token, 'sendMessage', { chat_id: chat, text: `✅ Ujian sambungan berjaya.\nBot: @${me.username}\n\nSistem Kehadiran Pelajar` });
      messageId = r.message_id;
    }
  } catch (err) {
    await logTelegram('ujian', null, 'gagal', String(err && err.message ? err.message : err));
    throw err;
  }
  await logTelegram('ujian', null, 'dihantar', `getMe @${me.username}${messageId ? ' + mesej ujian' : ' (tiada chat_id)'}`);
  return {
    ok: true, bot: { id: me.id, username: me.username, nama: me.first_name },
    mesej_dihantar: !!messageId, message_id: messageId,
    amaran: chat ? null : 'Chat ID belum ditetapkan — mesej ujian tidak dihantar.',
  };
}

// ── Laporan harian (format mengikut spesifikasi) ──
export function buildDaily(sum, belum) {
  const senarai = belum && belum.length ? belum.map((k) => `- ${k.nama || k.kod}`).join('\n') : 'Tiada';
  return [
    '📊 LAPORAN KEHADIRAN HARIAN', '',
    `Tarikh: ${sum.tarikh || isoToSlash(sum.tarikh_iso)}`, '',
    `Jumlah Kelas: ${sum.jumlah_kelas}`,
    `Sudah Hantar: ${sum.kelas_sudah_isi}`,
    `Belum Hantar: ${sum.kelas_belum_isi}`, '',
    `Jumlah Pelajar: ${sum.jumlah_pelajar}`,
    `Hadir: ${sum.jumlah_hadir}`,
    `Tidak Hadir: ${sum.jumlah_tidak_hadir}`,
    `Wakil: ${sum.jumlah_wakil}`, '',
    `Peratus Hadir: ${fmtPct(sum.peratus_kehadiran)}%`, '',
    'Kelas Belum Hantar:', senarai, '',
    'Dijana oleh Sistem Kehadiran Pelajar',
  ].join('\n');
}

// Hantar laporan harian manual. force=true abai amaran "belum isi".
export async function sendDailyManual(force) {
  const sum = await todaySummary();
  const miss = await missingClasses();
  const belum = miss.kelas || [];
  if (belum.length && !force) {
    return {
      ok: true, dihantar: false, amaran: true, belum_bil: belum.length,
      belum: belum.map((k) => k.nama || k.kod),
      mesej: `Masih ada ${belum.length} kelas belum mengisi kehadiran. Sahkan untuk tetap menghantar laporan.`,
    };
  }
  const text = buildDaily(sum, belum);
  let res;
  try {
    res = await sendTelegram(text);            // throw jika token/chat kosong / rangkaian
  } catch (err) {
    await logTelegram('harian', sum.tarikh_iso, 'gagal', String(err && err.message ? err.message : err));
    throw err;
  }
  await logTelegram('harian', sum.tarikh_iso, 'dihantar', `Laporan harian — ${sum.kelas_sudah_isi}/${sum.jumlah_kelas} kelas · ${fmtPct(sum.peratus_kehadiran)}%`);
  return { ok: true, dihantar: true, message_id: res.message_id, mesej: 'Laporan harian dihantar ke Telegram.' };
}

export async function recentLogs(limit = 15) {
  const r = await pool.query(
    `SELECT id, jenis_mesej, to_char(tarikh_rujukan,'YYYY-MM-DD') AS tarikh_rujukan, status, ringkasan,
            to_char(dihantar_pada,'YYYY-MM-DD HH24:MI') AS dihantar_pada
       FROM telegram_logs ORDER BY dihantar_pada DESC, id DESC LIMIT $1`,
    [Math.min(parseInt(limit, 10) || 15, 50)]
  );
  return { ok: true, jumlah: r.rowCount, log: r.rows };
}
