// ════════════════════════════════════════════════════════════
//  telegramScheduler.js (Fasa 11B) — penjadual automasi dalam proses.
//  • Tiada cron OS. setInterval 60s, unref() supaya tidak menahan proses.
//  • Baca tetapan dari DB setiap tick. Dedup via telegram_job_logs (job_key).
//  • Peringatan pagi & susulan: SKIP Sabtu/Ahad & SKIP cuti aktif (julat holidays).
//  • Snapshot mingguan & bulanan: TIDAK disekat weekend/cuti.
//  • Tidak menghantar apa-apa jika token/chat_id kosong.
// ════════════════════════════════════════════════════════════
import {
  getRawSettings, nowKL, isHolidayToday, jobDone, runScheduledJob,
  buildMorning, buildFollowup, buildFollowupDone, buildWeekly, buildMonthly,
  weeklyData, monthlyData,
} from './telegramService.js';
import { missingClasses } from './adminService.js';

let started = false;
let running = false;

function toMin(hhmm) { const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '')); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; }
function reached(now, target) { const a = toMin(now), b = toMin(target); return a != null && b != null && a >= b; }
function within(now, start, end) { const a = toMin(now), x = toMin(start), y = toMin(end); return a != null && x != null && y != null && a >= x && a <= y; }
function slotIndex(now, start, interval) {
  const a = toMin(now), x = toMin(start); const iv = Number(interval) || 30;
  if (a == null || x == null) return 0;
  return Math.floor((a - x) / iv);
}

export async function tick(injectedNow) {
  if (running) return; running = true;
  try {
    const st = await getRawSettings();
    const token = (st.bot_token && String(st.bot_token).trim()) || String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chat = (st.chat_id && String(st.chat_id).trim()) || String(process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!token || !chat) return;                       // tiada kredential → senyap

    const now = injectedNow || nowKL();
    const weekend = now.dow === 6 || now.dow === 7;     // 6=Sabtu, 7=Ahad
    let holiday = null;                                 // dinilai malas (lazy)
    const disekat = async () => {                       // untuk pagi & susulan sahaja
      if (weekend) return true;
      if (holiday === null) holiday = await isHolidayToday(now.iso);
      return holiday;
    };

    // ── Peringatan pagi ── (skip weekend & cuti; tiada hantar/log jika disekat)
    if (st.morning_enabled && reached(now.hhmm, st.morning_time) && !(await disekat())) {
      await runScheduledJob('peringatan_pagi', `morning:${now.iso}`, now.iso, async () => buildMorning(now.display));
    }

    // ── Peringatan kelas belum isi ── (skip weekend & cuti)
    if (st.followup_enabled && within(now.hhmm, st.followup_start_time, st.followup_end_time) && !(await disekat())) {
      if (!(await jobDone(`followup-done:${now.iso}`))) {           // jika belum hantar "selesai" hari ini
        const belum = (await missingClasses()).kelas || [];
        if (!belum.length) {
          await runScheduledJob('susulan', `followup-done:${now.iso}`, now.iso, async () => buildFollowupDone(now.display));
        } else {
          const slot = slotIndex(now.hhmm, st.followup_start_time, st.followup_interval_minutes);
          await runScheduledJob('susulan', `followup:${now.iso}:${slot}`, now.iso, async () => buildFollowup(now.hhmm, belum));
        }
      }
    }

    // ── Snapshot mingguan ── (TIDAK disekat weekend/cuti)
    if (st.weekly_enabled && now.dow === Number(st.weekly_day) && reached(now.hhmm, st.weekly_time)) {
      await runScheduledJob('mingguan', `weekly:${now.iso}`, now.iso, async () => buildWeekly(await weeklyData()));
    }

    // ── Snapshot bulanan ── (TIDAK disekat weekend/cuti)
    if (st.monthly_enabled) {
      const targetDay = st.monthly_day_mode === 'last' ? now.lastDay : Math.min(Number(st.monthly_day), now.lastDay);
      if (now.dayOfMonth === targetDay && reached(now.hhmm, st.monthly_time)) {
        await runScheduledJob('bulanan', `monthly:${now.ym}`, now.iso, async () => buildMonthly(await monthlyData()));
      }
    }
  } catch (_) {
    // jangan jatuhkan penjadual; ralat individu dilog dalam runScheduledJob
  } finally {
    running = false;
  }
}

export function startTelegramScheduler() {
  if (started) return;                                  // sudah dimulakan — idempoten
  if (process.env.TELEGRAM_SCHEDULER === 'off') {
    console.log('[telegram] Penjadual automasi DIMATIKAN (TELEGRAM_SCHEDULER=off).');
    return;                                             // dimatikan eksplisit via env
  }
  started = true;
  const iv = setInterval(() => { tick().catch(() => {}); }, 60 * 1000);
  if (iv && typeof iv.unref === 'function') iv.unref();
  const t0 = setTimeout(() => { tick().catch(() => {}); }, 8000);
  if (t0 && typeof t0.unref === 'function') t0.unref();
  console.log('[telegram] ✅ Penjadual automasi (Fasa 11B) dimulakan — semakan setiap 60s.');
}

export function schedulerStarted() { return started; }
