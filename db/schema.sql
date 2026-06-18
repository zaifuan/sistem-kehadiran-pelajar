-- ════════════════════════════════════════════════════════════
--  Sistem Pantau Kehadiran Pelajar — Skema PostgreSQL (Fasa 1)
--  Idempotent: selamat dijalankan berulang (CREATE ... IF NOT EXISTS).
--
--  PRINSIP (ikut keputusan terkunci Fasa 0):
--   K2: attendance_records.jumlah/hadir/peratus = SNAPSHOT nilai asal
--       dari Google Sheet. JANGAN kira semula untuk data lama.
--   K3: Konflik Sheet#1 vs Sheet#2 dicatat dalam sync_logs (warning),
--       bukan overwrite automatik.
--  Google Sheet kekal MASTER pada fasa awal; jadual ini = cache.
-- ════════════════════════════════════════════════════════════

-- ── Peranan & pengguna (K1: ganti PIN client-side dgn auth server) ──
CREATE TABLE IF NOT EXISTS roles (
  id    SERIAL PRIMARY KEY,
  kod   TEXT UNIQUE NOT NULL,          -- 'ADMIN', 'SUPER_ADMIN'
  nama  TEXT NOT NULL                  -- 'SU Kehadiran', 'SU HEM'
);

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  username         TEXT UNIQUE NOT NULL,
  kata_laluan_hash TEXT NOT NULL,       -- argon2/bcrypt — JANGAN simpan plaintext
  role_id          INTEGER REFERENCES roles(id),
  aktif            BOOLEAN DEFAULT TRUE,
  dicipta_pada     TIMESTAMPTZ DEFAULT now()
);

-- ── Kelas (cache dari METADATA_KELAS + medan pembantu dari Sheet#1) ──
CREATE TABLE IF NOT EXISTS classes (
  id             SERIAL PRIMARY KEY,
  kod            TEXT UNIQUE NOT NULL,   -- '1K','STAMLULU'
  nama           TEXT NOT NULL,          -- 'TINGKATAN 1 KHADIJAH'
  tingkatan      TEXT,                   -- 'T1'..'T5','STAM'
  guru_kelas     TEXT,
  pembantu_kelas TEXT,                   -- dari Sheet#1 (PEMBANTU GURU KELAS)
  status         TEXT DEFAULT 'aktif'    -- 'aktif'/'padam'
);

-- ── Pelajar (cache dari SENARAI_PELAJAR) ──
CREATE TABLE IF NOT EXISTS students (
  id            SERIAL PRIMARY KEY,
  class_kod     TEXT REFERENCES classes(kod),
  nama          TEXT NOT NULL,
  status        TEXT DEFAULT 'aktif',    -- aktif/keluar/pindah-keluar/tamat
  tarikh_daftar DATE,
  UNIQUE (class_kod, nama)
);

-- ── Sebab ketidakhadiran (dari KATEGORI_SEBAB) ──
CREATE TABLE IF NOT EXISTS absence_reasons (
  id           SERIAL PRIMARY KEY,
  kategori     TEXT NOT NULL,            -- 'PONTENG','MASALAH KESIHATAN'
  sebab        TEXT NOT NULL,            -- 'BANGUN LEWAT'
  dikira_hadir BOOLEAN DEFAULT FALSE,    -- = flag wakil:true ('WAKIL SEKOLAH')
  UNIQUE (kategori, sebab)
);

-- ── Rekod kehadiran (cache dari DATA_KEHADIRAN) — 1 baris / (tarikh,kelas) ──
CREATE TABLE IF NOT EXISTS attendance_records (
  id          SERIAL PRIMARY KEY,
  tarikh      DATE NOT NULL,
  class_kod   TEXT REFERENCES classes(kod),
  jumlah      INTEGER NOT NULL,          -- SNAPSHOT (K2) — jangan kira semula utk sejarah
  hadir       INTEGER NOT NULL,          -- SNAPSHOT
  tidak_hadir INTEGER NOT NULL,
  wakil       INTEGER NOT NULL,          -- direkod berasingan; TIDAK ditolak dari hadir
  peratus     NUMERIC(5,2),              -- SNAPSHOT (audit) = hadir/jumlah*100
  guru        TEXT,
  masa_isi    TIMESTAMPTZ,
  sumber      TEXT DEFAULT 'sheet',      -- 'sheet'/'server'
  UNIQUE (tarikh, class_kod)             -- kunci elak pendua
);
CREATE INDEX IF NOT EXISTS idx_attendance_tarikh ON attendance_records (tarikh);
CREATE INDEX IF NOT EXISTS idx_attendance_kelas  ON attendance_records (class_kod);

CREATE TABLE IF NOT EXISTS attendance_absentees (
  id           SERIAL PRIMARY KEY,
  record_id    INTEGER REFERENCES attendance_records(id) ON DELETE CASCADE,
  nama_pelajar TEXT NOT NULL,
  sebab        TEXT
);

CREATE TABLE IF NOT EXISTS attendance_representatives (
  id           SERIAL PRIMARY KEY,
  record_id    INTEGER REFERENCES attendance_records(id) ON DELETE CASCADE,
  nama_pelajar TEXT NOT NULL
);

-- ── Tetapan (cache dari tab TETAPAN + config lain) ──
CREATE TABLE IF NOT EXISTS settings (
  kunci TEXT PRIMARY KEY,
  nilai TEXT
);

-- ── Log sync (K3: catat warning konflik di sini, bukan overwrite) ──
CREATE TABLE IF NOT EXISTS sync_logs (
  id              SERIAL PRIMARY KEY,
  arah            TEXT,                  -- 'sheet->db' / 'db->sheet'
  jenis           TEXT,                  -- 'pelajar'/'kehadiran'/'metadata'
  status          TEXT,                  -- 'berjaya'/'gagal'/'warning'
  bil_rekod       INTEGER,
  mesej           TEXT,
  dijalankan_pada TIMESTAMPTZ DEFAULT now()
);

-- ── Log audit (cache/superset dari LOG_AKTIVITI) ──
CREATE TABLE IF NOT EXISTS audit_logs (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  jenis     TEXT,                        -- 'PELAJAR'/'KELAS'/'SYSTEM'
  tindakan  TEXT,                        -- 'TAMBAH'/'BUANG'/'EDIT'
  butiran   TEXT,
  masa      TIMESTAMPTZ DEFAULT now()
);

-- ── Log Telegram (Fasa 8) ──
CREATE TABLE IF NOT EXISTS telegram_logs (
  id             SERIAL PRIMARY KEY,
  jenis_mesej    TEXT,                   -- 'peringatan'/'ringkasan'/'mingguan'/'bulanan'
  tarikh_rujukan DATE,
  status         TEXT,                   -- 'dihantar'/'gagal'
  ringkasan      TEXT,
  dihantar_pada  TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════
--  FASA 2 — tambahan untuk Sync Engine read-only (additif)
-- ════════════════════════════════════════════════════════════

-- Simpanan RAW untuk tab yang struktur kolum tidak stabil
-- (PERATUS HARIANMINGGUAN, LAPORAN_BULANAN, LOG_AKTIVITI, dll.)
-- + fallback untuk baris yang gagal dipetakan.
CREATE TABLE IF NOT EXISTS sheet_raw (
  id          SERIAL PRIMARY KEY,
  sheet_id    TEXT NOT NULL,          -- ID spreadsheet
  sheet_label TEXT,                   -- 'SHEET1' / 'SHEET2'
  tab_name    TEXT NOT NULL,          -- cth 'PERATUS HARIANMINGGUAN'
  row_index   INTEGER NOT NULL,       -- indeks baris (0-based) dalam tab
  row_json    JSONB NOT NULL,         -- array nilai sel (mentah)
  disync_pada TIMESTAMPTZ DEFAULT now(),
  UNIQUE (sheet_id, tab_name, row_index)
);
CREATE INDEX IF NOT EXISTS idx_sheet_raw_tab ON sheet_raw (sheet_id, tab_name);

-- Simpan nilai tarikh & masa MENTAH dari Sheet (K2: import as-is)
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS tarikh_raw TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS masa_raw   TEXT;

-- ── Seed peranan tetap (K1) ──
INSERT INTO roles (kod, nama) VALUES
  ('ADMIN', 'SU Kehadiran'),
  ('SUPER_ADMIN', 'SU HEM')
ON CONFLICT (kod) DO NOTHING;

-- ════════════════════════════════════════════════════════════
--  FASA 8 — Autentikasi, Peranan & Pemetaan Guru-Kelas (additif)
--  Prinsip: 100% additif & idempotent. TIDAK mengubah jadual data
--  sedia ada (Fasa 1-7) selain menambah lajur baru pada `users`.
--  Sesi disimpan dalam jadual `session` (dicipta automatik oleh
--  connect-pg-simple — createTableIfMissing), tiada DDL di sini.
-- ════════════════════════════════════════════════════════════

-- Peranan tambahan untuk guru kelas (boleh isi kehadiran kelas ditugaskan)
INSERT INTO roles (kod, nama) VALUES
  ('GURU', 'Guru Kelas')
ON CONFLICT (kod) DO NOTHING;

-- Lajur tambahan pada users (nama paparan + jejak log masuk terakhir)
ALTER TABLE users ADD COLUMN IF NOT EXISTS nama        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login  TIMESTAMPTZ;

-- Pemetaan guru ↔ kelas (seorang guru boleh banyak kelas; sebaliknya juga)
CREATE TABLE IF NOT EXISTS teacher_class_assignments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  class_kod    TEXT    NOT NULL REFERENCES classes(kod) ON DELETE CASCADE,
  dicipta_pada TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, class_kod)
);
CREATE INDEX IF NOT EXISTS idx_tca_user  ON teacher_class_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_tca_kelas ON teacher_class_assignments (class_kod);
