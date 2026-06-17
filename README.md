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
| 3 | ⬜ | Import data lama + modul **audit** (validate kiraan, tanpa overwrite) |
| 4 | ⬜ | Page guru (mobile) |
| 5 | ⬜ | Admin biasa — `ADMIN` (SU Kehadiran), login username/password |
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
