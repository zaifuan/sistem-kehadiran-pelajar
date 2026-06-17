import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';

let _sheets = null;

// Klien Google Sheets dengan skop READ-ONLY sahaja (tidak boleh tulis).
export async function getSheetsClient() {
  if (_sheets) return _sheets;
  if (!fs.existsSync(config.google.credentialsPath)) {
    throw new Error(
      `Fail service account tidak dijumpai: ${config.google.credentialsPath}. ` +
        `Letak fail JSON sebagai secrets/service-account.json dan share kedua-dua sheet (Viewer) kepada emailnya.`
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

// Senarai nama tab dalam sebuah spreadsheet.
export async function listTabs(spreadsheetId) {
  if (!spreadsheetId) throw new Error('spreadsheetId kosong');
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  return (res.data.sheets || []).map((s) => s.properties.title);
}

// Baca semua nilai (FORMATTED) dalam satu tab → array baris (array sel).
export async function readTab(spreadsheetId, tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}
