// ════════════════════════════════════════════════════════════
//  Perkhidmatan Super Admin (Fasa 9) — kawalan sistem.
//  Modul: Pengurusan Akaun · Tetapan Cuti · Reset Kehadiran ·
//         Maklumat Sistem.
//
//  Prinsip (selaras Fasa 1-8):
//   • 100% PostgreSQL. Tiada sentuh Google Sheet / sync engine.
//   • password_hash JANGAN dipulangkan dalam mana-mana respons.
//   • password di-hash dengan argon2id (guna semula authService).
//   • username mesti unik.
//   • Audit guna semula jadual audit_logs (jenis='SYSTEM').
//   • Reset kehadiran dlm transaksi; anak-rekod dihapus via CASCADE.
// ════════════════════════════════════════════════════════════
import { pool } from '../db/pool.js';
import { hashKataLaluan } from './authService.js';
import { runSync } from './syncService.js';
import * as TG from './telegramService.js';
import { schedulerStarted } from './telegramScheduler.js';

function s(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// Sahkan & normalkan tarikh 'YYYY-MM-DD'; tidak sah → null.
function normIsoDate(v) {
  const sv = s(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sv)) return null;
  const d = new Date(sv + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return iso === sv ? sv : null;
}

// Catat audit (tidak kritikal — kegagalan ditelan, jangan ganggu operasi).
async function audit(userId, tindakan, butiran, client) {
  const q = client || pool;
  await q
    .query(
      `INSERT INTO audit_logs (user_id, jenis, tindakan, butiran) VALUES ($1,'SYSTEM',$2,$3)`,
      [userId, tindakan, butiran]
    )
    .catch(() => {});
}

// ════════════════════════════════════════════════════════════
//  1) PENGURUSAN AKAUN
// ════════════════════════════════════════════════════════════

// Senarai semua akaun login (TANPA kata_laluan_hash).
export async function listUsers() {
  const r = await pool.query(
    `SELECT u.id, u.username, u.nama, u.aktif, r.kod AS role,
            u.last_login, u.dicipta_pada
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY r.kod, u.username`
  );
  return {
    ok: true,
    jumlah: r.rowCount,
    pengguna: r.rows.map((x) => ({
      id: x.id,
      username: x.username,
      nama: x.nama || '',
      role: x.role || null,
      aktif: !!x.aktif,
      last_login: x.last_login || null,
      dicipta_pada: x.dicipta_pada || null,
    })),
  };
}

// Kemaskini akaun: username, nama, kata_laluan, aktif (medan pilihan).
// id == null → 400. JANGAN pulangkan hash.
export async function updateUser(id, perubahan, actorId) {
  const uid = parseInt(id, 10);
  if (!Number.isFinite(uid)) { const e = new Error('ID pengguna tidak sah'); e.status = 400; throw e; }

  const username = s(perubahan.username);
  const nama = s(perubahan.nama);
  const kataLaluanBaru = s(perubahan.kata_laluan);
  const aktif = perubahan.aktif;
  const adaAktif = aktif === true || aktif === false;

  if (!username && !nama && !kataLaluanBaru && !adaAktif) {
    const e = new Error('Tiada medan untuk dikemaskini'); e.status = 400; throw e;
  }
  if (username && !/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    const e = new Error('Username tidak sah (3-40 aksara: huruf, nombor, . _ -)'); e.status = 400; throw e;
  }
  if (kataLaluanBaru && kataLaluanBaru.length < 8) {
    const e = new Error('Kata laluan baharu mesti sekurang-kurangnya 8 aksara'); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const semasa = await client.query(
      'SELECT u.username, u.role_id, r.kod FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1',
      [uid]
    );
    if (semasa.rowCount === 0) {
      const e = new Error('Pengguna tidak dijumpai'); e.status = 404; throw e;
    }

    // username unik (kecuali diri sendiri)
    if (username && username.toLowerCase() !== String(semasa.rows[0].username).toLowerCase()) {
      const c = await client.query(
        'SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) AND id<>$2', [username, uid]
      );
      if (c.rowCount > 0) {
        const e = new Error('Username sudah digunakan'); e.status = 409; throw e;
      }
    }

    const setParts = [];
    const params = [];
    if (username) { params.push(username); setParts.push(`username=$${params.length}`); }
    if (nama)     { params.push(nama);     setParts.push(`nama=$${params.length}`); }
    if (adaAktif) { params.push(aktif);    setParts.push(`aktif=$${params.length}`); }
    if (kataLaluanBaru) {
      const hash = await hashKataLaluan(kataLaluanBaru);
      params.push(hash);
      setParts.push(`kata_laluan_hash=$${params.length}`);
    }
    params.push(uid);
    await client.query(`UPDATE users SET ${setParts.join(', ')} WHERE id=$${params.length}`, params);

    const butiran = [
      username ? `username→'${username}'` : null,
      nama ? `nama→'${nama}'` : null,
      adaAktif ? `aktif→${aktif}` : null,
      kataLaluanBaru ? 'kata_laluan→[diganti]' : null,
    ].filter(Boolean).join(', ');
    await audit(actorId, 'UBAH_AKAUN', `Pengguna #${uid}: ${butiran}`, client);

    await client.query('COMMIT');
    return { ok: true, mesej: 'Akaun berjaya dikemaskini.' };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════
//  2) TETAPAN CUTI (jadual holidays — Fasa 9)
// ════════════════════════════════════════════════════════════

// Bilangan hari inklusif antara dua tarikh ISO 'YYYY-MM-DD'.
// Contoh: 2026-06-01 → 2026-06-03 = 3 hari; 2026-06-15 → 2026-06-15 = 1 hari.
function kiraBilanganHari(mulaIso, tamatIso) {
  const a = new Date(mulaIso + 'T00:00:00Z').getTime();
  const b = new Date(tamatIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000) + 1;
}

// Senarai cuti (terkini di atas). Boleh tapis aktif.
export async function listHolidays(onlyActive = false) {
  const params = [];
  let where = '';
  if (onlyActive) { where = 'WHERE aktif=TRUE'; }
  const r = await pool.query(
    `SELECT id,
            to_char(tarikh_mula,  'YYYY-MM-DD') AS tarikh_mula,
            to_char(tarikh_tamat, 'YYYY-MM-DD') AS tarikh_tamat,
            (tarikh_tamat - tarikh_mula + 1)     AS bilangan_hari,
            nama_cuti, catatan, aktif, dicipta_pada
       FROM holidays
       ${where}
       ORDER BY tarikh_mula DESC, id DESC`,
    params
  );
  return {
    ok: true,
    jumlah: r.rowCount,
    cuti: r.rows.map((x) => ({
      id: x.id,
      tarikh_mula: x.tarikh_mula,
      tarikh_tamat: x.tarikh_tamat,
      bilangan_hari: Number(x.bilangan_hari) || 1,
      nama_cuti: x.nama_cuti,
      catatan: x.catatan || '',
      aktif: !!x.aktif,
      dicipta_pada: x.dicipta_pada || null,
    })),
  };
}

// Tambah cuti. Medan wajib: tarikh_mula, tarikh_tamat, nama_cuti.
// catatan & aktif pilihan. tarikh_tamat tidak boleh lebih awal drp mula.
export async function createHoliday(input, actorId) {
  const mula = normIsoDate(input && input.tarikh_mula);
  const tamat = normIsoDate(input && input.tarikh_tamat);
  const nama = s(input && input.nama_cuti);
  if (!mula) { const e = new Error('Tarikh mula wajib (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (!tamat) { const e = new Error('Tarikh tamat wajib (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (!nama) { const e = new Error('Nama cuti wajib'); e.status = 400; throw e; }
  if (tamat < mula) {
    const e = new Error('Tarikh tamat tidak boleh lebih awal daripada tarikh mula'); e.status = 400; throw e;
  }
  const catatan = s(input && input.catatan) || null;
  const aktif = input && input.aktif === false ? false : true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let r;
    try {
      r = await client.query(
        `INSERT INTO holidays (tarikh_mula, tarikh_tamat, nama_cuti, catatan, aktif)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tarikh_mula, tarikh_tamat, nama_cuti)
           DO UPDATE SET aktif=TRUE, catatan=EXCLUDED.catatan
         RETURNING id`,
        [mula, tamat, nama, catatan, aktif]
      );
    } catch (err) {
      if (err && err.code === '23505') {
        const e = new Error('Cuti pada julat tarikh & nama ini sudah wujud'); e.status = 409; throw e;
      }
      throw err;
    }
    const id = r.rows[0].id;
    const hari = kiraBilanganHari(mula, tamat);
    await audit(actorId, 'TAMBAH_CUTI', `Cuti #${id}: ${nama} (${mula} → ${tamat}, ${hari} hari)`, client);
    await client.query('COMMIT');
    return { ok: true, id, bilangan_hari: hari, mesej: 'Cuti ditambah.' };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// Kemaskini cuti (separa). Julat akhir disahkan terhadap nilai sedia ada
// supaya tarikh_tamat tidak pernah lebih awal daripada tarikh_mula.
export async function updateHoliday(id, perubahan, actorId) {
  const hid = parseInt(id, 10);
  if (!Number.isFinite(hid)) { const e = new Error('ID cuti tidak sah'); e.status = 400; throw e; }
  const mula = normIsoDate(perubahan && perubahan.tarikh_mula);
  const tamat = normIsoDate(perubahan && perubahan.tarikh_tamat);
  const nama = s(perubahan && perubahan.nama_cuti);
  const catatan = perubahan && Object.prototype.hasOwnProperty.call(perubahan, 'catatan') ? s(perubahan.catatan) : undefined;
  const aktif = perubahan && (perubahan.aktif === true || perubahan.aktif === false) ? perubahan.aktif : undefined;

  if (!mula && !tamat && !nama && catatan === undefined && aktif === undefined) {
    const e = new Error('Tiada medan untuk dikemaskini'); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const semasa = await client.query(
      `SELECT to_char(tarikh_mula,'YYYY-MM-DD')  AS tarikh_mula,
              to_char(tarikh_tamat,'YYYY-MM-DD') AS tarikh_tamat
         FROM holidays WHERE id=$1`,
      [hid]
    );
    if (semasa.rowCount === 0) { const e = new Error('Cuti tidak dijumpai'); e.status = 404; throw e; }

    // Julat berkesan (gabung perubahan + nilai sedia ada) untuk validasi.
    const mulaAkhir = mula || semasa.rows[0].tarikh_mula;
    const tamatAkhir = tamat || semasa.rows[0].tarikh_tamat;
    if (tamatAkhir < mulaAkhir) {
      const e = new Error('Tarikh tamat tidak boleh lebih awal daripada tarikh mula'); e.status = 400; throw e;
    }

    const setParts = [];
    const params = [];
    if (mula)  { params.push(mula);  setParts.push(`tarikh_mula=$${params.length}`); }
    if (tamat) { params.push(tamat); setParts.push(`tarikh_tamat=$${params.length}`); }
    if (nama)  { params.push(nama);  setParts.push(`nama_cuti=$${params.length}`); }
    if (catatan !== undefined) { params.push(catatan || null); setParts.push(`catatan=$${params.length}`); }
    if (aktif !== undefined)   { params.push(aktif); setParts.push(`aktif=$${params.length}`); }

    try {
      params.push(hid);
      await client.query(`UPDATE holidays SET ${setParts.join(', ')} WHERE id=$${params.length}`, params);
    } catch (err) {
      if (err && err.code === '23505') {
        const e = new Error('Cuti pada julat tarikh & nama ini sudah wujud'); e.status = 409; throw e;
      }
      throw err;
    }

    await audit(actorId, 'UBAH_CUTI', `Cuti #${hid}: ${[mula, tamat, nama, catatan !== undefined ? 'catatan' : '', aktif !== undefined ? 'aktif' : ''].filter(Boolean).join(', ')}`, client);
    await client.query('COMMIT');
    return { ok: true, mesej: 'Cuti dikemaskini.' };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// Padam cuti (DELETE fizikal).
export async function deleteHoliday(id, actorId) {
  const hid = parseInt(id, 10);
  if (!Number.isFinite(hid)) { const e = new Error('ID cuti tidak sah'); e.status = 400; throw e; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `DELETE FROM holidays WHERE id=$1
        RETURNING to_char(tarikh_mula,'YYYY-MM-DD')  AS tarikh_mula,
                  to_char(tarikh_tamat,'YYYY-MM-DD') AS tarikh_tamat,
                  nama_cuti`,
      [hid]
    );
    if (r.rowCount === 0) { const e = new Error('Cuti tidak dijumpai'); e.status = 404; throw e; }
    const x = r.rows[0];
    await audit(actorId, 'PADAM_CUTI', `Cuti #${hid}: ${x.nama_cuti} (${x.tarikh_mula} → ${x.tarikh_tamat})`, client);
    await client.query('COMMIT');
    return { ok: true, dibuang: r.rowCount, mesej: 'Cuti dipadam.' };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════
//  3) RESET KEHADIRAN
//  attendance_absentees / attendance_representatives ada ON DELETE
//  CASCADE pada record_id → padam parent akan hapuskan anak-rekod.
//  Dijalankan dlm transaksi untuk atomicity.
// ════════════════════════════════════════════════════════════

// Reset kehadiran SATU kelas pada SATU tarikh.
// Wajib: tarikh & kelas. Pulang bil rekod dipadam.
export async function resetAttendanceClass(tarikhRaw, kelasRaw, actorId) {
  const tarikh = normIsoDate(tarikhRaw);
  const kelas = s(kelasRaw).toUpperCase();
  if (!tarikh) { const e = new Error('Tarikh wajib (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (!kelas) { const e = new Error('Kelas wajib'); e.status = 400; throw e; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `DELETE FROM attendance_records
        WHERE tarikh=$1::date AND class_kod=$2
        RETURNING id`,
      [tarikh, kelas]
    );
    const bilRekod = r.rowCount;
    const bilAnak = await Promise.all(
      r.rows.map((row) =>
        // CASCADE sepatutnya sudah hapuskan; ini ukur pengesahan sahaja.
        client.query(
          `SELECT
             (SELECT COUNT(*) FROM attendance_absentees WHERE record_id=$1)::int AS th,
             (SELECT COUNT(*) FROM attendance_representatives WHERE record_id=$1)::int AS wk`,
          [row.id]
        )
      )
    );
    const totalAnak = bilAnak.reduce((acc, q) => acc + (q.rows[0].th || 0) + (q.rows[0].wk || 0), 0);

    await audit(
      actorId,
      'RESET_KEHADIRAN_KELAS',
      `Tarikh ${tarikh}, kelas ${kelas}: ${bilRekod} rekod dipadam (${totalAnak} anak-rekod).`,
      client
    );
    await client.query('COMMIT');
    return {
      ok: true,
      tarikh,
      kelas,
      rekod_dipadam: bilRekod,
      anak_dipadam: totalAnak,
      mesej: bilRekod > 0 ? `Kehadiran ${kelas} (${tarikh}) direset.` : `Tiada rekod ${kelas} pada ${tarikh}.`,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// Reset SEMUA kelas pada SATU tarikh.
// Wajib: tarikh + sahkan === 'SAHKAN' (defense-in-depth, bukan hanya UI).
export async function resetAttendanceDay(tarikhRaw, sahkan, actorId) {
  const tarikh = normIsoDate(tarikhRaw);
  if (!tarikh) { const e = new Error('Tarikh wajib (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (s(sahkan) !== 'SAHKAN') {
    const e = new Error('Pengesahan gagal — taip SAHKAN'); e.status = 400; throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `DELETE FROM attendance_records WHERE tarikh=$1::date RETURNING id, class_kod`,
      [tarikh]
    );
    const bilRekod = r.rowCount;
    const bilAnak = await Promise.all(
      r.rows.map((row) =>
        client.query(
          `SELECT
             (SELECT COUNT(*) FROM attendance_absentees WHERE record_id=$1)::int AS th,
             (SELECT COUNT(*) FROM attendance_representatives WHERE record_id=$1)::int AS wk`,
          [row.id]
        )
      )
    );
    const totalAnak = bilAnak.reduce((acc, q) => acc + (q.rows[0].th || 0) + (q.rows[0].wk || 0), 0);

    await audit(
      actorId,
      'RESET_KEHADIRAN_HARI',
      `Tarikh ${tarikh}: ${bilRekod} rekod dipadam (${totalAnak} anak-rekod). SEMUA kelas.`,
      client
    );
    await client.query('COMMIT');
    return {
      ok: true,
      tarikh,
      rekod_dipadam: bilRekod,
      anak_dipadam: totalAnak,
      mesej: bilRekod > 0 ? `Semua kehadiran (${tarikh}) direset.` : `Tiada rekod pada ${tarikh}.`,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════
//  4) MAKLUMAT SISTEM
//  Kad ringkas. Status Telegram/SheetSync = placeholder Fasa akan datang.
// ════════════════════════════════════════════════════════════
export async function systemSummary() {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM classes WHERE status='aktif')::int                AS kelas_aktif,
       (SELECT COUNT(*) FROM students WHERE status='aktif')::int               AS pelajar_aktif,
       (SELECT COUNT(*) FROM users WHERE aktif=TRUE)::int                      AS akaun_aktif,
       (SELECT COUNT(*) FROM holidays WHERE aktif=TRUE)::int                   AS cuti_aktif`
  );
  const a = r.rows[0] || {};
  return {
    ok: true,
    jumlah_kelas_aktif: a.kelas_aktif || 0,
    jumlah_pelajar_aktif: a.pelajar_aktif || 0,
    jumlah_akaun_aktif: a.akaun_aktif || 0,
    jumlah_cuti_aktif: a.cuti_aktif || 0,
    status_telegram: 'Akan datang Fasa 10',
    status_google_sheet_sync: 'Akan datang Fasa 11',
  };
}

// ════════════════════════════════════════════════════════════
//  5) GOOGLE SHEET SYNC (Fasa 10)
//  Wrapper SUPER_ADMIN untuk enjin sync sedia ada (runSync).
//  TIDAK mengubah enjin — hanya cetus, audit & pulangkan ringkasan.
//  runSync() menyegerak kedua-dua Google Sheet:
//    • master pelajar/guru kelas/pembantu  • data kehadiran lama GAS
//  Pulangan: { ok, status, mula, tamat, langkah[] }. `status` =
//  'berjaya' | 'sebahagian' | 'gagal' supaya UI boleh papar keputusan
//  walaupun sync separa/gagal (ok kekal true selagi cetusan berjaya).
// ════════════════════════════════════════════════════════════
export async function runSheetSync(actorId) {
  const hasil = await runSync();
  const bilLangkah = Array.isArray(hasil.langkah) ? hasil.langkah.length : 0;
  await audit(actorId, 'SYNC_SHEET', `Sync Google Sheet: ${hasil.status} (${bilLangkah} langkah)`);
  return { ok: true, ...hasil };
}

// Senarai kod kelas aktif untuk dropdown reset (selaras /api/admin/classes).
export async function listActiveClassKod() {
  const r = await pool.query(
    `SELECT kod, nama, tingkatan FROM classes WHERE status='aktif' ORDER BY kod`
  );
  return {
    ok: true,
    jumlah: r.rowCount,
    kelas: r.rows.map((x) => ({ kod: x.kod, nama: x.nama, tingkatan: x.tingkatan || null })),
  };
}

// ════════════════════════════════════════════════════════════
//  5) TELEGRAM ASAS (Fasa 11A) — delegasi ke telegramService.
//  Token tidak pernah dipulangkan penuh. Audit jenis 'SYSTEM'.
// ════════════════════════════════════════════════════════════
export async function tgGetSettings() { return TG.getSettingsForUI(); }
export async function tgStatus() {
  const st = await TG.status();
  return { ...st, scheduler_aktif: schedulerStarted() };
}
export async function tgRecentLogs() { return TG.recentLogs(); }

export async function tgSaveSettings(body, actorId) {
  const r = await TG.saveSettings(body || {});
  await audit(actorId, 'TELEGRAM_TETAPAN', 'Tetapan Telegram dikemaskini');
  return r;
}
export async function tgTest(actorId) {
  const r = await TG.testTelegram();
  await audit(actorId, 'TELEGRAM_UJI', 'Uji sambungan Telegram');
  return r;
}
export async function tgSendDaily(force, actorId) {
  const r = await TG.sendDailyManual(!!force);
  if (r.dihantar) await audit(actorId, 'TELEGRAM_HARIAN', 'Laporan harian dihantar (manual)');
  return r;
}

// Fasa 11B — hantar snapshot manual
export async function tgSendWeekly(actorId) {
  const r = await TG.sendWeeklyManual();
  await audit(actorId, 'TELEGRAM_MINGGUAN', 'Snapshot mingguan dihantar (manual)');
  return r;
}
export async function tgSendMonthly(actorId) {
  const r = await TG.sendMonthlyManual();
  await audit(actorId, 'TELEGRAM_BULANAN', 'Snapshot bulanan dihantar (manual)');
  return r;
}
