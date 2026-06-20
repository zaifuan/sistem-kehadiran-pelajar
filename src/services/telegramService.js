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
import { todaySummary, missingClasses, classesWithCounts } from './adminService.js';
import * as A from './analyticsService.js';

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
      // Fasa 11B — automasi
      morning_enabled: st.morning_enabled, morning_time: st.morning_time,
      followup_enabled: st.followup_enabled, followup_start_time: st.followup_start_time,
      followup_end_time: st.followup_end_time, followup_interval_minutes: st.followup_interval_minutes,
      weekly_enabled: st.weekly_enabled, weekly_day: st.weekly_day, weekly_time: st.weekly_time,
      monthly_enabled: st.monthly_enabled, monthly_day_mode: st.monthly_day_mode,
      monthly_day: st.monthly_day, monthly_time: st.monthly_time,
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

  // ── Fasa 11B: medan automasi ──
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const setTime = (k, label) => {
    if (body[k] === undefined) return;
    if (!HHMM.test(s(body[k]))) { const e = new Error(`${label}: format masa mesti HH:MM`); e.status = 400; throw e; }
    sets.push(`${k}=$${i++}`); vals.push(s(body[k]));
  };
  const setBool = (k) => { if (body[k] !== undefined) { sets.push(`${k}=$${i++}`); vals.push(!!body[k]); } };
  setBool('morning_enabled'); setTime('morning_time', 'Masa peringatan pagi');
  setBool('followup_enabled'); setTime('followup_start_time', 'Masa mula susulan'); setTime('followup_end_time', 'Masa tamat susulan');
  if (body.followup_interval_minutes !== undefined) {
    const n = parseInt(s(body.followup_interval_minutes), 10);
    if (![30, 60, 120].includes(n)) { const e = new Error('Kekerapan susulan mesti 30, 60 atau 120 minit'); e.status = 400; throw e; }
    sets.push(`followup_interval_minutes=$${i++}`); vals.push(n);
  }
  setBool('weekly_enabled');
  if (body.weekly_day !== undefined) {
    const n = parseInt(s(body.weekly_day), 10);
    if (!(n >= 1 && n <= 7)) { const e = new Error('Hari mingguan: 1 (Isnin) – 7 (Ahad)'); e.status = 400; throw e; }
    sets.push(`weekly_day=$${i++}`); vals.push(n);
  }
  setTime('weekly_time', 'Masa mingguan');
  setBool('monthly_enabled');
  if (body.monthly_day_mode !== undefined) {
    const m = s(body.monthly_day_mode);
    if (m !== 'last' && m !== 'fixed') { const e = new Error("Mod hari bulanan: 'last' atau 'fixed'"); e.status = 400; throw e; }
    sets.push(`monthly_day_mode=$${i++}`); vals.push(m);
  }
  if (body.monthly_day !== undefined) {
    const n = parseInt(s(body.monthly_day), 10);
    if (!(n >= 1 && n <= 31)) { const e = new Error('Hari bulanan: 1–31'); e.status = 400; throw e; }
    sets.push(`monthly_day=$${i++}`); vals.push(n);
  }
  setTime('monthly_time', 'Masa bulanan');

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

// ════════════════════════════════════════════════════════════
//  FASA 11B — Automasi (masa KL, semakan cuti julat, dedup, pembina
//  mesej, snapshot mingguan/bulanan). Guna analyticsService sedia ada.
// ════════════════════════════════════════════════════════════

// Masa waktu Malaysia (Asia/Kuala_Lumpur).
export function nowKL(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  const y = g('year'), mo = g('month'), da = g('day');
  let hh = g('hour'); if (hh === '24') hh = '00';
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const lastDay = new Date(Date.UTC(parseInt(y, 10), parseInt(mo, 10), 0)).getUTCDate();
  return { iso: `${y}-${mo}-${da}`, display: `${da}/${mo}/${y}`, hhmm: `${hh}:${g('minute')}`,
           dow: map[g('weekday')] || 0, dayOfMonth: parseInt(da, 10), lastDay, ym: `${y}-${mo}` };
}

// Semakan cuti JULAT pada jadual holidays (BUKAN 'cuti', BUKAN lajur tarikh tunggal).
export async function isHolidayToday(iso) {
  const r = await pool.query(
    'SELECT 1 FROM holidays WHERE aktif = TRUE AND $1::date BETWEEN tarikh_mula AND tarikh_tamat LIMIT 1',
    [iso]
  );
  return r.rowCount > 0;
}

// Dedup ledger (telegram_job_logs.job_key UNIK).
export async function claimJob(jobKey, jobType) {
  const r = await pool.query(
    `INSERT INTO telegram_job_logs (job_key, job_type, status) VALUES ($1,$2,'proses')
     ON CONFLICT (job_key) DO NOTHING RETURNING id`,
    [jobKey, jobType]
  );
  return r.rowCount > 0;
}
export async function jobDone(jobKey) {
  const r = await pool.query('SELECT 1 FROM telegram_job_logs WHERE job_key = $1', [jobKey]);
  return r.rowCount > 0;
}
async function markJob(jobKey, statusVal) {
  await pool.query('UPDATE telegram_job_logs SET status=$2 WHERE job_key=$1', [jobKey, statusVal]).catch(() => {});
}
// Log penghantaran untuk PAPARAN (telegram_logs) — dieksport untuk scheduler.
export async function logSend(jenis, tarikhRujukan, statusVal, ringkasan) {
  await pool.query(
    `INSERT INTO telegram_logs (jenis_mesej, tarikh_rujukan, status, ringkasan) VALUES ($1,$2,$3,$4)`,
    [jenis, tarikhRujukan || null, statusVal, (ringkasan || '').slice(0, 500)]
  ).catch(() => {});
}

// Jalankan job berjadual: claim (dedup) → hantar → log paparan + tanda status.
export async function runScheduledJob(jobType, jobKey, refDate, builder) {
  if (!(await claimJob(jobKey, jobType))) return { skipped: true };   // sudah dijalankan
  try {
    const text = await builder();
    const r = await sendTelegram(text);
    await markJob(jobKey, 'dihantar');
    await logSend(jobType, refDate, 'dihantar', `auto ${jobKey}${r && r.message_id ? ' (#' + r.message_id + ')' : ''}`);
    return { ok: true, message_id: r && r.message_id };
  } catch (err) {
    await markJob(jobKey, 'gagal');
    await logSend(jobType, refDate, 'gagal', `auto ${jobKey} — ${err && err.message ? err.message : err}`);
    return { ok: false, ralat: String(err && err.message ? err.message : err) };
  }
}

// ── Pembina mesej (teks biasa; tiada parse_mode → tiada escape diperlukan) ──
function slash(d) { return s(d).replace(/-/g, '/'); }
export function buildMorning(displayDate) {
  return ['🔔 PERINGATAN KEHADIRAN', '',
    'Mohon Guru Kelas dan Pembantu Guru Kelas mengisi kehadiran pelajar hari ini.', '',
    `Tarikh: ${displayDate}`, '', 'Terima kasih.'].join('\n');
}
export function buildFollowup(jam, belum) {
  const blok = belum.map((k) => `• ${k.nama || k.kod}\n  Guru: ${k.guru_kelas || '-'}\n  Pembantu: ${k.pembantu_kelas || '-'}`).join('\n\n');
  return ['⚠️ KEHADIRAN BELUM DIHANTAR', '', `Jam: ${jam}`, '', 'Kelas belum mengisi:', '', blok, '', `Jumlah: ${belum.length} kelas`].join('\n');
}
export function buildFollowupDone(displayDate) {
  return ['✅ Semua kelas telah mengisi kehadiran hari ini.', '', `Tarikh: ${displayDate}`].join('\n');
}
export function buildWeekly(d) {
  const top = d.top.length ? d.top.map((c, i) => `${i + 1}. ${c.nama} (${fmtPct(c.peratus)}%)`).join('\n') : '- Tiada data';
  const low = d.low.length ? d.low.map((c, i) => `${i + 1}. ${c.nama} (${fmtPct(c.peratus)}%)`).join('\n') : '- Tiada data';
  const julat = d.week ? `${slash(d.week.isnin)} - ${slash(d.week.jumaat)}` : '-';
  return ['📈 LAPORAN KEHADIRAN MINGGUAN', '', `Minggu: ${julat}`, '',
    `Purata Kehadiran: ${fmtPct(d.purata)}%`, '', 'Top 5 Kelas:', top, '', 'Kelas Terendah:', low].join('\n');
}
export function buildMonthly(d) {
  return ['📊 LAPORAN KEHADIRAN BULANAN', '', `Bulan: ${d.month ? d.month.label : '-'}`, '',
    `Purata Kehadiran: ${fmtPct(d.purata)}%`, '', `Jumlah Hari Persekolahan: ${d.hari || 0}`, `Jumlah Pelajar: ${d.pelajar || 0}`, '',
    'Kelas Terbaik:', d.terbaik ? `${d.terbaik.nama} (${fmtPct(d.terbaik.peratus)}%)` : '- Tiada data', '',
    'Kelas Terendah:', d.terendah ? `${d.terendah.nama} (${fmtPct(d.terendah.peratus)}%)` : '- Tiada data'].join('\n');
}

// ── Pengumpul data snapshot (guna analyticsService — tidak ubah formula) ──
export async function weeklyData() {
  const sch = await A.weekly({});
  const wk = sch.minggu && sch.minggu.length ? sch.minggu[sch.minggu.length - 1] : null;
  const cls = (await classesWithCounts()).kelas || [];
  const rows = [];
  for (const c of cls) {
    const w = await A.weekly({ kelas: c.kod });
    const last = w.minggu && w.minggu.length ? w.minggu[w.minggu.length - 1] : null;
    if (last && last.peratus != null) rows.push({ nama: c.nama || c.kod, peratus: Number(last.peratus) });
  }
  return { week: wk, purata: wk ? wk.peratus : null,
           top: [...rows].sort((a, b) => b.peratus - a.peratus).slice(0, 5),
           low: [...rows].sort((a, b) => a.peratus - b.peratus).slice(0, 5) };
}
export async function monthlyData() {
  const sch = await A.monthly({});
  const mo = sch.bulan && sch.bulan.length ? sch.bulan[sch.bulan.length - 1] : null;
  const cls = (await classesWithCounts()).kelas || [];
  const rows = [];
  for (const c of cls) {
    const m = await A.monthly({ kelas: c.kod });
    const last = m.bulan && m.bulan.length ? m.bulan[m.bulan.length - 1] : null;
    if (last && last.peratus != null) rows.push({ nama: c.nama || c.kod, peratus: Number(last.peratus) });
  }
  rows.sort((a, b) => b.peratus - a.peratus);
  const sum = await todaySummary();
  return { month: mo, purata: mo ? mo.peratus : null, hari: mo ? mo.hari : 0, pelajar: sum.jumlah_pelajar,
           terbaik: rows[0] || null, terendah: rows.length ? rows[rows.length - 1] : null };
}

// ── Penghantaran manual mingguan/bulanan (butang; sentiasa hantar, tiada dedup) ──
export async function sendWeeklyManual() {
  const d = await weeklyData();
  const text = buildWeekly(d);
  let res;
  try { res = await sendTelegram(text); }
  catch (err) { await logSend('mingguan', null, 'gagal', String(err && err.message ? err.message : err)); throw err; }
  await logSend('mingguan', null, 'dihantar', `Snapshot mingguan (manual) — purata ${fmtPct(d.purata)}%`);
  return { ok: true, dihantar: true, message_id: res.message_id, mesej: 'Snapshot mingguan dihantar ke Telegram.' };
}
export async function sendMonthlyManual() {
  const d = await monthlyData();
  const text = buildMonthly(d);
  let res;
  try { res = await sendTelegram(text); }
  catch (err) { await logSend('bulanan', null, 'gagal', String(err && err.message ? err.message : err)); throw err; }
  await logSend('bulanan', null, 'dihantar', `Snapshot bulanan (manual) — ${d.month ? d.month.label : ''} ${fmtPct(d.purata)}%`);
  return { ok: true, dihantar: true, message_id: res.message_id, mesej: 'Snapshot bulanan dihantar ke Telegram.' };
}
