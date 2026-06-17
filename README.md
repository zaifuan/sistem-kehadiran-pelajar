# Sistem Pantau Kehadiran Pelajar

Migrasi sistem kehadiran **SABK MAAHAD AL-KHAIR LIL BANAT** daripada Google Apps Script ke server sendiri (Docker, Node.js + Express + PostgreSQL).

> **Google Sheet kekal master database** pada fasa awal. Database PostgreSQL ini ialah **cache / lapisan kelajuan** sehingga write-back diaktifkan (Fasa 7).

---

## Status Fasa

| Fasa | Status | Keterangan |
|---|---|---|
| 0 | ✅ Siap | Audit sistem asal — lihat [`docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md`](docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md) |
| **1** | ✅ **Skeleton ini** | Repo + Docker + Express + PostgreSQL + skema + health check |
| **2** | ✅ **Siap** | Sync Google Sheet **read-only** ke DB (endpoint manual) |
| **3** | ✅ **Siap** | Modul **audit** validate import (endpoint, tanpa overwrite) |
| **4** | ✅ **Siap** | Dashboard UI read-only, mobile-first (vanilla) |
| **5** | ✅ **Siap** | Portal Guru Kelas — isi kehadiran harian (tulis ke DB, tanpa login) |
| 6 | ⬜ | Ketua admin — `SUPER_ADMIN` (SU HEM) |
| 7 | ⬜ | Write-back ke Google Sheet (sync dua hala) |
| 8 | ⬜ | Telegram (token **baru** dalam `.env`) |
| 9 | ⬜ | Deployment production di `srv-zai-93` |

---

## Keperluan

- Docker + Docker Compose (di server `srv-zai-93`)
- (Pembangunan tempatan tanpa Docker) Node.js ≥ 20 + PostgreSQL 16

---

## Cara Jalankan (Docker)

```bash
# 1. Salin & isi konfigurasi
cp .env.example .env
nano .env          # tetapkan DB_PASSWORD & JWT_SECRET yang kuat

# 2. Bina & jalankan
docker compose up -d --build

# 3. Semak server hidup
curl http://localhost:3000/api/health
```

Jangkaan respons:

```json
{ "status": "ok", "service": "sistem-pantau-kehadiran", "fasa": 1, "db": "up", "masa": "..." }
```

Hentikan / lihat log:

```bash
docker compose logs -f app
docker compose down            # hentikan (data DB kekal dalam volume)
docker compose down -v         # hentikan + PADAM data DB (volume)
```

Skema dijalankan automatik ketika app start (`RUN_MIGRATIONS_ON_START=true`). Untuk jalankan manual:

```bash
docker compose exec app npm run db:migrate
```

---

## Cara Jalankan (tempatan, tanpa Docker)

```bash
npm install
cp .env.example .env
# tetapkan DB_HOST=localhost dan butiran PostgreSQL tempatan
npm run db:migrate
npm start
```

---

## Fasa 2 — Sync Google Sheet (READ-ONLY)

Enjin sync menyalin data dari Google Sheet ke PostgreSQL (cache). **Tiada tulisan ke Sheet.** Scope OAuth = `spreadsheets.readonly`.

**Persediaan service account:**
1. Google Cloud → cipta service account, dayakan **Google Sheets API**, muat turun fail kunci JSON.
2. Letak fail sebagai `secrets/service-account.json` (sudah gitignored).
3. **Share kedua-dua Google Sheet** kepada email service account — **Viewer sahaja**.
4. Pastikan `.env` ada: `GOOGLE_APPLICATION_CREDENTIALS`, `SHEET_MASTER_PELAJAR_ID`, `SHEET_KEHADIRAN_ID`.

**Endpoint (tanpa auth — Fasa 2 sahaja):**

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/sync/google-sheets` | Cetus sync read-only; pulang ringkasan setiap langkah |
| GET | `/api/sync/status` | Ringkasan sync terakhir + 25 log terkini + kiraan baris |

**Pemetaan tab → jadual:**

| Sumber | Tab | Sasaran |
|---|---|---|
| Sheet #2 | `METADATA_KELAS` | `classes` |
| Sheet #2 | `SENARAI_PELAJAR` | `students` |
| Sheet #2 | `DATA_KEHADIRAN` | `attendance_records` (+ absentees + representatives) |
| Sheet #2 | `TETAPAN` | `settings` (PIN = rujukan legacy) |
| Sheet #2 | `PERATUS HARIANMINGGUAN`, `LAPORAN_BULANAN`, `LOG_AKTIVITI` | `sheet_raw` (mentah — struktur tak stabil) |
| Sheet #1 | direktori (SINGKATAN/GURU/PEMBANTU) | `classes.pembantu_kelas` (+ warning jika guru konflik, **tidak ditimpa**) |
| Sheet #1 | tab lain | `sheet_raw` |

Sifat penting: **idempotent** (kunci `tarikh`+`kelas` untuk kehadiran), nilai lama **disalin apa adanya** (tiada recalculate), tab hilang → **warning** dalam `sync_logs` (tidak crash), tarikh pelik → simpan raw + warning.



```
sistem-kehadiran/
├─ docker-compose.yml     # servis: app (Node) + db (PostgreSQL)
├─ Dockerfile             # imej aplikasi Node
├─ .env.example           # contoh konfigurasi (salin ke .env)
├─ package.json
├─ db/
│  └─ schema.sql          # skema PostgreSQL (idempotent)
├─ secrets/               # fail kunci service account (gitignored, Fasa 2)
├─ docs/
│  └─ FASA-0-AUDIT-...md  # dokumen audit Fasa 0
└─ src/
   ├─ index.js            # entry: migrasi + start server
   ├─ app.js              # Express app + middleware + routes
   ├─ config.js           # muat .env
   ├─ db/
   │  ├─ pool.js          # kolam sambungan + tunggu DB sedia
   │  └─ migrate.js       # jalankan schema.sql
   ├─ routes/
   │  └─ health.js        # GET /api/health
   ├─ services/           # (Fasa 2+: sync Sheet, dll.)
   └─ middleware/          # (Fasa 5+: auth, dll.)
```

---

## Fasa 3 — Audit & Validasi Import (READ-ONLY)

Audit data yang telah disync ke PostgreSQL. **Tiada data lama diubah** — hanya papar beza & isu.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/audit/import-summary` | Kiraan: kelas, pelajar, kehadiran, raw rows, status sync |
| GET | `/api/audit/attendance-compare` | Validasi formula (peratus = HADIR/JUMLAH×100; wakil dikira HADIR); papar rekod yang ada beza sahaja |
| GET | `/api/audit/warnings` | Konflik guru Sheet#1/#2, tarikh gagal normalize, kelas tiada metadata, pelajar duplicate, attendance duplicate (sumber) |

`attendance-compare` membanding *snapshot* Sheet (tersimpan) dengan kiraan semula server — **tanpa menulis**. `warnings` membaca semula `DATA_KEHADIRAN` (read-only) untuk kesan duplicate sumber; dilangkau dengan anggun jika Sheet tak dapat diakses. Tiada perubahan skema diperlukan untuk Fasa 3.

---

## Fasa 4 — Dashboard UI (read-only, mobile-first)

Frontend vanilla (HTML/CSS/JS) dalam `public/`, di-serve oleh Express. **Read-only** — hanya papar data yang sudah disync. Tiada React, tiada login, tiada PII pelajar (hanya agregat + nama guru).

Buka di pelayar: `http://<ip-server>:3010/`

| Method | Path | Fungsi |
|---|---|---|
| GET | `/` | Dashboard mobile (HTML) |
| GET | `/dashboard` | Redirect ke `/` |
| GET | `/api/dashboard/summary` | Jumlah pelajar/kelas/rekod, tarikh, peratus keseluruhan, status sync |
| GET | `/api/dashboard/classes` | Semua kelas + guru + pembantu + bil pelajar aktif |
| GET | `/api/dashboard/recent-attendance?limit=50` | Rekod kehadiran terkini (agregat) |

4 tab: **Utama** (statistik + peratus keseluruhan), **Kelas** (senarai), **Kehadiran** (rekod terkini), **Audit** (status dari endpoint Fasa 3). Peratus diwarna ikut ambang: ≥95% hijau, ≥85% amber, <85% merah.

---

## Fasa 5 — Portal Guru Kelas (isi kehadiran)

Portal untuk guru/pembantu isi kehadiran harian. **Tulis ke PostgreSQL sahaja** (tiada write-back ke Google Sheet). Tiada login (seperti sistem GAS). Aliran ikut GAS: **Pilih Kelas → Senarai Pelajar → Pilih Sebab/Wakil → Pengesahan → Simpan**.

Buka di pelayar: `http://<ip-server>:3010/guru`

| Method | Path | Fungsi |
|---|---|---|
| GET | `/guru` | Portal guru (HTML) |
| GET | `/api/guru/classes` | Senarai kelas + bil pelajar aktif |
| GET | `/api/guru/classes/:kod/pelajar` | Senarai pelajar aktif bagi kelas |
| POST | `/api/guru/kehadiran` | Simpan kehadiran (upsert tarikh+kelas) |

**Formula** (sama GAS): wakil sekolah **dikira hadir**; tidak hadir sebenar = bukan wakil; `hadir = jumlah − tidak_hadir`; `peratus = hadir/jumlah*100`. Rekod ditandai `sumber='server'`. Jika tarikh+kelas sudah wujud → **update**, bukan duplicate. Senarai tidak hadir disimpan dalam `attendance_absentees` (nama+sebab), wakil dalam `attendance_representatives` — serasi format Fasa 2. Sebab ketidakhadiran = 12 kategori sama seperti GAS. Tarikh = hari ini (zon Asia/Kuala_Lumpur, ditetapkan server).

---

## Keputusan Terkunci (Fasa 0)

- **K1** — Auth server username/password. Peranan: `ADMIN` = SU Kehadiran, `SUPER_ADMIN` = SU HEM. PIN lama = legacy sahaja.
- **K2** — Rekod lama **tidak** dikira semula; import nilai asal (snapshot). Recalculate **hanya** dalam modul audit (Fasa 3), tanpa overwrite.
- **K3** — Sheet #2 = master kehadiran/peratus; Sheet #1 = rujukan guru + pembantu kelas. Konflik → catat `sync_logs` (warning), **bukan** overwrite.
- **K4** — Telegram ditangguh ke Fasa 8; token lama dianggap terdedah dan **diganti**.

Butiran penuh: [`docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md`](docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md).

---

## Nota Keselamatan

- `.env` dan `secrets/` **tidak** di-commit (lihat `.gitignore`).
- Port PostgreSQL hanya terbuka pada `127.0.0.1` server (bukan internet).
- **JANGAN** guna token Telegram lama (terdedah dalam kod asal).
