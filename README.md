# Sistem Pantau Kehadiran Pelajar

Migrasi sistem kehadiran **SABK MAAHAD AL-KHAIR LIL BANAT** daripada Google Apps Script ke server sendiri (Docker, Node.js + Express + PostgreSQL).

> **Google Sheet kekal master database** pada fasa awal. Database PostgreSQL ini ialah **cache / lapisan kelajuan** sehingga write-back diaktifkan (Fasa 7).

---

## Status Fasa

| Fasa | Status | Keterangan |
|---|---|---|
| 0 | ✅ Siap | Audit sistem asal — lihat [`docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md`](docs/FASA-0-AUDIT-SISTEM-KEHADIRAN.md) |
| **1** | ✅ **Skeleton ini** | Repo + Docker + Express + PostgreSQL + skema + health check |
| 2 | ⬜ | Sync Google Sheet **read-only** ke DB |
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

## Struktur Repo

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
