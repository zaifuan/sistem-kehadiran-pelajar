import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';

// ════════════════════════════════════════════════════════════
//  Klien Google Sheets — REST LANGSUNG (READ-ONLY)
//  Mem-bypass googleapis/google-auth-library/gaxios kerana ralat
//  ERR_STREAM_PREMATURE_CLOSE semasa gtoken fetch ke endpoint token.
//  Strategi: jana JWT service account secara manual (RS256) guna
//  node:crypto, tukar dengan access token via native fetch, dan
//  panggil Sheets REST API terus. Eksport listTabs()/readTab() kekal
//  supaya syncService.js / auditService.js tidak perlu diubah.
// ════════════════════════════════════════════════════════════

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
// Skop OAuth: read-only secara lalai. Skop tulis diminta HANYA bila write
// sebenar dibenarkan (WRITEBACK_ENABLED=true && WRITEBACK_DRY_RUN=false),
// supaya tingkah laku read-only sedia ada kekal IDENTIK.
const SCOPE_RO = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SCOPE_RW = 'https://www.googleapis.com/auth/spreadsheets';
function scopeSemasa() {
  return config.writeback && config.writeback.enabled && !config.writeback.dryRun
    ? SCOPE_RW
    : SCOPE_RO;
}

// ── Retry ringkas untuk ralat rangkaian sementara (token & Sheets API) ──
const RETRYABLE = new Set(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);
const RETRY_DELAYS = [500, 1000, 2000]; // ms — maksimum 3 cubaan semula

function isRetryable(err) {
  if (!err) return false;
  const codes = [err.code, err.errno, err.cause && err.cause.code, err.cause && err.cause.errno];
  if (codes.some((c) => c && RETRYABLE.has(String(c)))) return true;
  const msg = `${err.message || ''} ${(err.cause && err.cause.message) || ''}`;
  return /premature close|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jalankan fn(); jika gagal dengan ralat rangkaian sementara, cuba semula
// sehingga 3 kali dengan delay 500ms, 1000ms, 2000ms. Ralat lain dilempar terus.
async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < RETRY_DELAYS.length && isRetryable(err)) {
        await delay(RETRY_DELAYS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

// ── Kelayakan service account (dibaca sekali, dicache) ──
let _creds = null;

function loadCreds() {
  if (_creds) return _creds;
  const p = config.google.credentialsPath; // dari GOOGLE_APPLICATION_CREDENTIALS
  if (!fs.existsSync(p)) {
    throw new Error(
      `Fail service account tidak dijumpai: ${p}. ` +
        `Letak fail JSON sebagai secrets/service-account.json dan share kedua-dua sheet (Viewer) kepada emailnya.`
    );
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    throw new Error('Fail service account bukan JSON yang sah.');
  }
  if (!json.client_email || !json.private_key) {
    // JANGAN dedah private_key — hanya nyatakan medan yang hilang.
    throw new Error('Service account JSON tidak lengkap (perlu client_email & private_key).');
  }
  _creds = {
    client_email: json.client_email,
    private_key: json.private_key,
    token_uri: json.token_uri || TOKEN_URL,
  };
  return _creds;
}

// base64url tanpa padding
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Jana JWT service account (RS256) — ditandatangani guna private_key.
function buatJwt(creds, nowSec) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: creds.client_email,
    scope: scopeSemasa(),
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600, // token JWT sah 1 jam
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer
    .sign(creds.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${unsigned}.${sig}`;
}

// ── Access token (dicache sehingga hampir tamat tempoh) ──
let _token = null; // { access_token, exp (saat epoch) }

async function getAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  // Guna cache jika masih sah (buffer 60s sebelum tamat).
  if (_token && _token.exp - 60 > nowSec) return _token.access_token;

  const creds = loadCreds();
  const assertion = buatJwt(creds, nowSec);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();

  const data = await withRetry(async () => {
    const res = await fetch(creds.token_uri || TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text(); // baca penuh — boleh cetus "Premature close" → diretry
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = j.error_description || j.error || text;
      } catch (_) { /* biar mesej mentah */ }
      const e = new Error(`Token OAuth gagal (HTTP ${res.status}): ${msg}`);
      e.status = res.status;
      throw e;
    }
    return JSON.parse(text);
  });

  const expiresIn = Number(data.expires_in) || 3600;
  _token = { access_token: data.access_token, exp: nowSec + expiresIn };
  return _token.access_token;
}

// GET Sheets REST API dengan Bearer token + retry. Pulang JSON terhurai.
async function sheetsGet(url) {
  return withRetry(async () => {
    const token = await getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text(); // baca penuh — boleh cetus "Premature close" → diretry
    if (res.status === 401) _token = null; // token bermasalah → batalkan cache untuk panggilan seterusnya
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = (j.error && j.error.message) || text;
      } catch (_) { /* biar mesej mentah */ }
      const e = new Error(`Sheets API gagal (HTTP ${res.status}): ${msg}`);
      e.status = res.status;
      throw e;
    }
    return text ? JSON.parse(text) : {};
  });
}

// ════════════════════════════════════════════════════════════
//  Eksport awam (tandatangan kekal — syncService tidak perlu ubah)
// ════════════════════════════════════════════════════════════

// Senarai nama tab dalam sebuah spreadsheet.
// GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}
export async function listTabs(spreadsheetId) {
  if (!spreadsheetId) throw new Error('spreadsheetId kosong');
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}` +
    `?fields=${encodeURIComponent('sheets.properties.title')}`;
  const data = await sheetsGet(url);
  return (data.sheets || []).map((s) => s.properties.title);
}

// Baca semua nilai (FORMATTED) dalam satu tab → array baris (array sel).
// GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{tabName}
export async function readTab(spreadsheetId, tabName) {
  if (!spreadsheetId) throw new Error('spreadsheetId kosong');
  // Petik nama tab dengan tanda kutip tunggal supaya nama bermasa/aksara khas selamat.
  const range = encodeURIComponent(`'${tabName}'`);
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}` +
    `?valueRenderOption=FORMATTED_VALUE`;
  const data = await sheetsGet(url);
  return data.values || [];
}


// ════════════════════════════════════════════════════════════
//  WRITE-BACK (Fasa A) — infrastruktur SELAMAT
//  Dikawal config.writeback:
//    enabled=false               → dimatikan (tiada payload, tiada API)
//    enabled=true & dryRun=true  → bina payload + log, TIADA panggilan API
//    enabled=true & dryRun=false → tulisan REST sebenar (PUT/POST)
//  Fungsi read-only (listTabs/readTab/sheetsGet) di atas TIDAK diubah.
// ════════════════════════════════════════════════════════════

// POST/PUT Sheets REST API dengan Bearer token + retry. Pulang JSON terhurai.
async function sheetsWrite(method, url, body) {
  return withRetry(async () => {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 401) _token = null;
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = (j.error && j.error.message) || text;
      } catch (_) { /* biar mesej mentah */ }
      const e = new Error(`Sheets WRITE gagal (HTTP ${res.status}): ${msg}`);
      e.status = res.status;
      throw e;
    }
    return text ? JSON.parse(text) : {};
  });
}

// Log terperinci untuk mod DRY-RUN (tiada API dipanggil).
function logDryRun(op, spreadsheetId, range, payload) {
  const baris = [
    '[WRITEBACK-DRYRUN]',
    `Spreadsheet: ${spreadsheetId}`,
    `Range: ${range || '(tiada)'}`,
    `Operation: ${op}`,
    '',
    'Payload:',
    JSON.stringify(payload, null, 2),
    '',
    'Tiada API write dipanggil.',
  ];
  console.log(baris.join('\n'));
}

// Gerbang pusat: kuat kuasa enabled/dryRun untuk SEMUA helper tulis.
async function runWrite({ op, spreadsheetId, range, payload, call }) {
  if (!config.writeback || !config.writeback.enabled) {
    console.log(`[WRITEBACK] dimatikan (WRITEBACK_ENABLED=false) — ${op} dilangkau.`);
    return { ok: false, skipped: true, reason: 'WRITEBACK_DISABLED', op, spreadsheetId, range };
  }
  if (!spreadsheetId) {
    throw new Error('WRITEBACK: spreadsheetId kosong (set WRITEBACK_SPREADSHEET_ID atau SHEET_KEHADIRAN_ID).');
  }
  if (config.writeback.dryRun) {
    logDryRun(op, spreadsheetId, range, payload);
    return { ok: true, dryRun: true, op, spreadsheetId, range, payload };
  }
  const hasil = await call();
  console.log(`[WRITEBACK] ${op} BERJAYA — ${spreadsheetId}${range ? ' ' + range : ''}`);
  return { ok: true, dryRun: false, op, spreadsheetId, range, hasil };
}

// Selesaikan spreadsheetId: argumen → config.writeback.spreadsheetId.
function resolveSpreadsheetId(spreadsheetId) {
  return spreadsheetId || (config.writeback && config.writeback.spreadsheetId) || '';
}

// PUT values: kemas kini satu julat. values = array baris (array sel).
export async function updateRange(spreadsheetId, range, values, opts = {}) {
  const sid = resolveSpreadsheetId(spreadsheetId);
  const valueInputOption = opts.valueInputOption || 'USER_ENTERED';
  const payload = { range, majorDimension: 'ROWS', values };
  return runWrite({
    op: 'UPDATE', spreadsheetId: sid, range, payload,
    call: async () => {
      const url =
        `${SHEETS_BASE}/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}` +
        `?valueInputOption=${encodeURIComponent(valueInputOption)}`;
      return sheetsWrite('PUT', url, payload);
    },
  });
}

// POST values:append — tambah baris baharu di hujung julat.
export async function appendRows(spreadsheetId, range, values, opts = {}) {
  const sid = resolveSpreadsheetId(spreadsheetId);
  const valueInputOption = opts.valueInputOption || 'USER_ENTERED';
  const insertDataOption = opts.insertDataOption || 'INSERT_ROWS';
  const payload = { range, majorDimension: 'ROWS', values };
  return runWrite({
    op: 'APPEND', spreadsheetId: sid, range, payload,
    call: async () => {
      const url =
        `${SHEETS_BASE}/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}:append` +
        `?valueInputOption=${encodeURIComponent(valueInputOption)}` +
        `&insertDataOption=${encodeURIComponent(insertDataOption)}`;
      return sheetsWrite('POST', url, payload);
    },
  });
}

// POST :batchUpdate — permintaan berstruktur/format (sisip lajur, format sel, dll).
export async function batchUpdate(spreadsheetId, requests) {
  const sid = resolveSpreadsheetId(spreadsheetId);
  const payload = { requests: Array.isArray(requests) ? requests : [] };
  return runWrite({
    op: 'BATCH_UPDATE', spreadsheetId: sid, range: null, payload,
    call: async () => {
      const url = `${SHEETS_BASE}/${encodeURIComponent(sid)}:batchUpdate`;
      return sheetsWrite('POST', url, payload);
    },
  });
}
