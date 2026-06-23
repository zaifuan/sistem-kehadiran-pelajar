import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { listTabs, readTab } from './googleSheets.js';

// ════════════════════════════════════════════════════════════
//  Helper penghuraian
// ════════════════════════════════════════════════════════════
function s(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}
function toInt(v) {
  const n = parseInt(s(v).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}
function toPeratus(v) {
  const str = s(v).replace('%', '').replace(',', '.');
  const n = parseFloat(str);
  return Number.isNaN(n) ? null : n;
}
// Normalize tarikh -> 'YYYY-MM-DD' atau null. Buang masa jika ada (ambil token pertama).
function normTarikh(v) {
  const str = s(v).split(' ')[0];
  let m = str.match(/^(\d{2})-(\d{2})-(\d{4})$/); // DD-MM-YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/); // YYYY-MM-DD
  if (m) return str;
  return null;
}
// "NAMA(SEBAB) | NAMA(SEBAB)" -> [{nama, sebab}]
function parseSenaraiTH(v) {
  return s(v)
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(.*)\((.*)\)$/);
      return m ? { nama: m[1].trim(), sebab: m[2].trim() } : { nama: item, sebab: '' };
    });
}
// "NAMA | NAMA" -> [nama]
function parseSenaraiWakil(v) {
  return s(v).split('|').map((x) => x.trim()).filter(Boolean);
}
function headerIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    idx[s(h).toUpperCase()] = i;
  });
  return idx;
}
function deriveTingkatan(kod) {
  const k = s(kod).toUpperCase();
  if (k.startsWith('STAM')) return 'STAM';
  const m = k.match(/^(\d)/);
  return m ? 'T' + m[1] : null;
}

// ── Normalisasi kod kelas (Fasa 8.4.1) ──
// Sheet#1 (direktori) mengunci kelas pada lajur SINGKATAN. Bagi kelas STAM,
// singkatannya 'LULU'/'MARJAN' — berbeza daripada kod kanonik yang digunakan
// Sheet#2 (METADATA_KELAS/SENARAI_PELAJAR/DATA_KEHADIRAN) dan portal guru,
// iaitu 'STAMLULU'/'STAMMARJAN'. Tanpa pemetaan, sync mencipta baris kelas
// pendua (LULU/MARJAN, tingkatan NULL, tiada pelajar/kehadiran).
// Petakan alias di SETIAP titik masuk supaya HANYA satu kod kanonik wujud.
const ALIAS_KELAS = { LULU: 'STAMLULU', MARJAN: 'STAMMARJAN' };
function normKod(kod) {
  const raw = s(kod);
  const key = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(ALIAS_KELAS, key)) return ALIAS_KELAS[key];
  return raw; // kod lain tidak diubah
}

// ════════════════════════════════════════════════════════════
//  Helper DB
// ════════════════════════════════════════════════════════════
async function logSync(client, { arah = 'sheet->db', jenis, status, bil = null, mesej = '' }) {
  await client.query(
    `INSERT INTO sync_logs (arah, jenis, status, bil_rekod, mesej) VALUES ($1,$2,$3,$4,$5)`,
    [arah, jenis, status, bil, mesej]
  );
}

async function ensureClass(client, kodRaw) {
  const kod = normKod(kodRaw);
  if (!kod) return;
  await client.query(
    `INSERT INTO classes (kod, nama, tingkatan, status) VALUES ($1, $1, $2, 'aktif')
     ON CONFLICT (kod) DO NOTHING`,
    [kod, deriveTingkatan(kod)]
  );
}

async function upsertRawRow(client, sheetId, label, tabName, rowIndex, row) {
  await client.query(
    `INSERT INTO sheet_raw (sheet_id, sheet_label, tab_name, row_index, row_json)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (sheet_id, tab_name, row_index)
     DO UPDATE SET row_json = EXCLUDED.row_json, sheet_label = EXCLUDED.sheet_label, disync_pada = now()`,
    [sheetId, label, tabName, rowIndex, JSON.stringify(row || [])]
  );
}

async function upsertSheetRaw(client, sheetId, label, tabName, rows) {
  for (let i = 0; i < rows.length; i++) {
    await upsertRawRow(client, sheetId, label, tabName, i, rows[i]);
  }
  // Buang baris stale jika tab menjadi lebih pendek (kekal cermin idempotent)
  await client.query(
    `DELETE FROM sheet_raw WHERE sheet_id=$1 AND tab_name=$2 AND row_index >= $3`,
    [sheetId, tabName, rows.length]
  );
  return rows.length;
}

// ════════════════════════════════════════════════════════════
//  Import setiap tab
// ════════════════════════════════════════════════════════════

// Sheet #2: METADATA_KELAS -> classes
async function importMetadataKelas(client, rows) {
  if (!rows.length) return 0;
  const idx = headerIndex(rows[0]);
  const cKod = idx['KOD_KELAS'] ?? 0;
  const cNama = idx['NAMA_KELAS'] ?? 1;
  const cGuru = idx['GURU_KELAS'] ?? 2;
  const cStatus = idx['STATUS'] ?? 3;
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kod = normKod(s(r[cKod]));
    if (!kod) continue;
    await client.query(
      `INSERT INTO classes (kod, nama, guru_kelas, tingkatan, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (kod) DO UPDATE SET
         nama = EXCLUDED.nama, guru_kelas = EXCLUDED.guru_kelas,
         tingkatan = EXCLUDED.tingkatan, status = EXCLUDED.status`,
      [kod, s(r[cNama]) || kod, s(r[cGuru]) || null, deriveTingkatan(kod), s(r[cStatus]) || 'aktif']
    );
    n++;
  }
  return n;
}

// Sheet #1: direktori (guru + pembantu) + tab lain disimpan raw.
// K3: jangan overwrite guru secara senyap — catat warning jika konflik.
async function importSheet1(client, tabsPelajar) {
  if (!tabsPelajar || tabsPelajar.size === 0) return null;
  let processed = 0;
  for (const tab of tabsPelajar) {
    const rows = await readTab(config.sheets.masterPelajarId, tab);
    if (!rows.length) continue;
    const idx = headerIndex(rows[0]);
    const isDirektori = 'SINGKATAN' in idx || 'GURU KELAS' in idx || 'PEMBANTU GURU KELAS' in idx;

    if (isDirektori) {
      const cKod = idx['SINGKATAN'];
      const cNama = idx['NAMA KELAS'];
      const cGuru = idx['GURU KELAS'];
      const cPmb = idx['PEMBANTU GURU KELAS'];
      let dibaca = 0, dimasuk = 0, dikemas = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const kod = cKod != null ? normKod(s(r[cKod])) : '';
        if (!kod) continue;
        dibaca++;
        const namaKelas = cNama != null ? s(r[cNama]) : '';
        const guru = cGuru != null ? s(r[cGuru]) : '';
        const pembantu = cPmb != null ? s(r[cPmb]) : '';

        const ex = await client.query('SELECT guru_kelas FROM classes WHERE kod=$1', [kod]);
        if (ex.rowCount === 0) {
          await client.query(
            `INSERT INTO classes (kod, nama, guru_kelas, pembantu_kelas, tingkatan, status)
             VALUES ($1,$2,$3,$4,$5,'aktif')`,
            [kod, namaKelas || kod, guru || null, pembantu || null, deriveTingkatan(kod)]
          );
          dimasuk++;
        } else {
          // FIX SENARAI KELAS: Sheet#1 (tab SENARAI KELAS) ialah sumber kebenaran untuk
          // GURU KELAS & PEMBANTU GURU KELAS. Nilai BUKAN-kosong dari sheet MENIMPA DB
          // (tidak lagi skip kerana rekod wujud; tidak lagi kekalkan guru lama).
          // Sel KOSONG kekalkan nilai sedia ada supaya tiada padam tak sengaja.
          const lama = s(ex.rows[0].guru_kelas);
          await client.query(
            `UPDATE classes SET
               guru_kelas     = COALESCE(NULLIF($2,''), guru_kelas),
               pembantu_kelas = COALESCE(NULLIF($3,''), pembantu_kelas)
             WHERE kod=$1`,
            [kod, guru, pembantu]
          );
          dikemas++;
          if (guru && lama && lama.toUpperCase() !== guru.toUpperCase()) {
            await logSync(client, {
              jenis: 'SHEET1:GURU_DIKEMASKINI',
              status: 'berjaya',
              mesej: `Kelas ${kod}: guru '${lama}' -> '${guru}' (ikut SENARAI KELAS).`,
            });
          }
        }
        processed++;
      }
      // FIX: log ringkas SENARAI KELAS — dibaca / insert / update.
      console.log(`[SYNC] SENARAI KELAS (${tab}): ${dibaca} dibaca, ${dimasuk} insert, ${dikemas} update.`);
      await logSync(client, {
        jenis: 'SHEET1:SENARAI_KELAS',
        status: 'berjaya',
        bil: dibaca,
        mesej: `SENARAI KELAS (${tab}): ${dibaca} dibaca, ${dimasuk} insert, ${dikemas} update.`,
      });
    } else {
      // Tab lain (cth senarai pelajar Sheet#1) — simpan raw, jangan paksa map.
      processed += await upsertSheetRaw(client, config.sheets.masterPelajarId, 'SHEET1', tab, rows);
    }
  }
  return processed;
}

// Sheet #2: SENARAI_PELAJAR -> students
async function importSenaraiPelajar(client, rows) {
  if (!rows.length) return 0;
  const idx = headerIndex(rows[0]);
  const cKod = idx['KOD_KELAS'] ?? 0;
  const cNama = idx['NAMA_PELAJAR'] ?? 1;
  const cStatus = idx['STATUS'] ?? 2;
  const cTarikh = idx['TARIKH_DAFTAR'] ?? 3;
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kod = normKod(s(r[cKod]));
    const nama = s(r[cNama]);
    if (!kod || !nama) continue;
    await ensureClass(client, kod);
    await client.query(
      `INSERT INTO students (class_kod, nama, status, tarikh_daftar)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (class_kod, nama) DO UPDATE SET
         status = EXCLUDED.status, tarikh_daftar = EXCLUDED.tarikh_daftar`,
      [kod, nama, s(r[cStatus]) || 'aktif', normTarikh(r[cTarikh])]
    );
    n++;
  }
  return n;
}

// Sheet #2: DATA_KEHADIRAN -> attendance_records (+ absentees + representatives)
// K2: import nilai snapshot APA ADANYA — TIDAK dikira semula.
async function importDataKehadiran(client, rows) {
  if (!rows.length) return 0;
  const idx = headerIndex(rows[0]);
  const c = {
    tarikh: idx['TARIKH'] ?? 0,
    kelas: idx['KELAS'] ?? 1,
    guru: idx['GURU'] ?? 3,
    jumlah: idx['JUMLAH'] ?? 4,
    hadir: idx['HADIR'] ?? 5,
    th: idx['TIDAK_HADIR'] ?? 6,
    wakil: idx['WAKIL'] ?? 7,
    peratus: idx['PERATUS'] ?? 8,
    senaraiTH: idx['SENARAI_TH'] ?? 9,
    senaraiWakil: idx['SENARAI_WAKIL'] ?? 10,
    masa: idx['MASA'] ?? 11,
  };
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kelas = normKod(s(r[c.kelas]));
    const tarikhRaw = s(r[c.tarikh]);
    if (!kelas && !tarikhRaw) continue; // baris kosong
    const tarikh = normTarikh(tarikhRaw);

    if (!kelas || !tarikh) {
      // Tidak boleh dipetakan → simpan raw + warning (K: jangan crash, jangan hilang data)
      await upsertRawRow(client, config.sheets.kehadiranId, 'SHEET2', 'DATA_KEHADIRAN__UNPARSED', i, r);
      await logSync(client, {
        jenis: 'DATA_KEHADIRAN',
        status: 'warning',
        mesej: `Baris ${i + 1}: tarikh/kelas tak sah (tarikh='${tarikhRaw}', kelas='${kelas}') — disimpan raw, dilangkau.`,
      });
      continue;
    }

    await ensureClass(client, kelas);
    const rec = await client.query(
      `INSERT INTO attendance_records
         (tarikh, tarikh_raw, class_kod, jumlah, hadir, tidak_hadir, wakil, peratus, guru, masa_raw, sumber)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sheet')
       ON CONFLICT (tarikh, class_kod) DO UPDATE SET
         tarikh_raw = EXCLUDED.tarikh_raw, jumlah = EXCLUDED.jumlah, hadir = EXCLUDED.hadir,
         tidak_hadir = EXCLUDED.tidak_hadir, wakil = EXCLUDED.wakil, peratus = EXCLUDED.peratus,
         guru = EXCLUDED.guru, masa_raw = EXCLUDED.masa_raw, sumber = 'sheet'
       WHERE attendance_records.sumber IS DISTINCT FROM 'server'
       RETURNING id`,
      [
        tarikh, tarikhRaw, kelas,
        toInt(r[c.jumlah]), toInt(r[c.hadir]), toInt(r[c.th]), toInt(r[c.wakil]),
        toPeratus(r[c.peratus]), s(r[c.guru]) || null, s(r[c.masa]) || null,
      ]
    );
    // K-2: jika konflik dgn rekod bersumber 'server' (Portal Guru), UPDATE dilangkau oleh
    // WHERE di atas → tiada baris dipulangkan. JANGAN timpa; log warning & langkau baris.
    if (rec.rowCount === 0) {
      await logSync(client, {
        jenis: 'DATA_KEHADIRAN:KONFLIK_SUMBER',
        status: 'warning',
        mesej: `Kelas ${kelas} (${tarikh}): rekod sedia ada bersumber 'server' (Portal Guru) — TIDAK ditimpa oleh Sheet.`,
      });
      continue;
    }
    const recordId = rec.rows[0].id;

    // Ganti bersih anak rekod (idempotent)
    await client.query('DELETE FROM attendance_absentees WHERE record_id=$1', [recordId]);
    await client.query('DELETE FROM attendance_representatives WHERE record_id=$1', [recordId]);
    for (const a of parseSenaraiTH(r[c.senaraiTH])) {
      await client.query(
        'INSERT INTO attendance_absentees (record_id, nama_pelajar, sebab) VALUES ($1,$2,$3)',
        [recordId, a.nama, a.sebab || null]
      );
    }
    for (const w of parseSenaraiWakil(r[c.senaraiWakil])) {
      await client.query(
        'INSERT INTO attendance_representatives (record_id, nama_pelajar) VALUES ($1,$2)',
        [recordId, w]
      );
    }
    n++;
  }
  return n;
}

// Sheet #2: TETAPAN -> settings  (PIN lama = rujukan legacy sahaja, K1)
async function importTetapan(client, rows) {
  if (!rows.length) return 0;
  const idx = headerIndex(rows[0]);
  const cK = idx['KUNCI'] ?? 0;
  const cN = idx['NILAI'] ?? 1;
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kunci = s(r[cK]);
    if (!kunci) continue;
    await client.query(
      `INSERT INTO settings (kunci, nilai) VALUES ($1,$2)
       ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai`,
      [kunci, s(r[cN])]
    );
    n++;
  }
  return n;
}

// ════════════════════════════════════════════════════════════
//  Orkestra sync
// ════════════════════════════════════════════════════════════
async function stepWrap(ringkasan, client, nama, fn) {
  try {
    const bil = await fn();
    if (bil === null || bil === undefined) {
      ringkasan.langkah.push({ nama, status: 'dilangkau', bil: 0 });
      return;
    }
    await logSync(client, { jenis: nama, status: 'berjaya', bil, mesej: `${bil} baris disync` });
    ringkasan.langkah.push({ nama, status: 'berjaya', bil });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    await logSync(client, { jenis: nama, status: 'gagal', mesej: msg });
    ringkasan.langkah.push({ nama, status: 'gagal', bil: 0, mesej: msg });
    if (ringkasan.status === 'berjaya') ringkasan.status = 'sebahagian';
  }
}

export async function runSync() {
  const ringkasan = { mula: new Date().toISOString(), status: 'berjaya', langkah: [] };
  const client = await pool.connect();
  try {
    // Senarai tab kedua-dua sheet (jangan crash jika tab tiada).
    let tabsKehadiran = new Set();
    let tabsPelajar = new Set();
    try {
      tabsKehadiran = new Set(await listTabs(config.sheets.kehadiranId));
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      await logSync(client, { jenis: 'SHEET2:AKSES', status: 'gagal', mesej: `Gagal akses Sheet#2: ${msg}` });
      ringkasan.langkah.push({ nama: 'SHEET2:AKSES', status: 'gagal', bil: 0, mesej: msg });
      ringkasan.status = 'gagal';
    }
    try {
      tabsPelajar = new Set(await listTabs(config.sheets.masterPelajarId));
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      await logSync(client, { jenis: 'SHEET1:AKSES', status: 'warning', mesej: `Gagal akses Sheet#1: ${msg}` });
      ringkasan.langkah.push({ nama: 'SHEET1:AKSES', status: 'warning', bil: 0, mesej: msg });
    }

    const bacaSheet2 = async (tab) => {
      if (!tabsKehadiran.has(tab)) {
        await logSync(client, { jenis: tab, status: 'warning', mesej: `Tab '${tab}' tiada dalam Sheet#2 — dilangkau` });
        return null;
      }
      return await readTab(config.sheets.kehadiranId, tab);
    };

    // 1) METADATA_KELAS -> classes (perlu dahulu untuk FK)
    await stepWrap(ringkasan, client, 'METADATA_KELAS', async () => {
      const rows = await bacaSheet2('METADATA_KELAS');
      return rows ? importMetadataKelas(client, rows) : null;
    });

    // 2) Sheet #1 (guru + pembantu + raw)
    await stepWrap(ringkasan, client, 'SHEET1', async () => importSheet1(client, tabsPelajar));

    // 3) SENARAI_PELAJAR -> students
    await stepWrap(ringkasan, client, 'SENARAI_PELAJAR', async () => {
      const rows = await bacaSheet2('SENARAI_PELAJAR');
      return rows ? importSenaraiPelajar(client, rows) : null;
    });

    // 4) DATA_KEHADIRAN -> attendance_records (+ anak)
    await stepWrap(ringkasan, client, 'DATA_KEHADIRAN', async () => {
      const rows = await bacaSheet2('DATA_KEHADIRAN');
      return rows ? importDataKehadiran(client, rows) : null;
    });

    // 5-7) Tab tidak stabil -> raw
    for (const tab of ['PERATUS HARIANMINGGUAN', 'LAPORAN_BULANAN', 'LOG_AKTIVITI']) {
      await stepWrap(ringkasan, client, tab, async () => {
        const rows = await bacaSheet2(tab);
        return rows ? upsertSheetRaw(client, config.sheets.kehadiranId, 'SHEET2', tab, rows) : null;
      });
    }

    // 8) TETAPAN -> settings
    await stepWrap(ringkasan, client, 'TETAPAN', async () => {
      const rows = await bacaSheet2('TETAPAN');
      return rows ? importTetapan(client, rows) : null;
    });
  } finally {
    ringkasan.tamat = new Date().toISOString();
    try {
      await logSync(client, { jenis: 'RINGKASAN', status: ringkasan.status, mesej: JSON.stringify(ringkasan) });
    } catch (err) {
      // diabaikan
    }
    client.release();
  }
  return ringkasan;
}
