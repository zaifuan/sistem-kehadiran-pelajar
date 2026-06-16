# FASA 0 — AUDIT SISTEM PANTAU KEHADIRAN PELAJAR

**Sekolah:** SABK MAAHAD AL-KHAIR LIL BANAT
**Sumber:** Google Apps Script (GAS) Web App + 2 Google Sheet
**Skop audit:** Fahami sistem asal sahaja. **Tiada kod migration ditulis. Tiada Google Sheet diubah.**
**Tarikh audit:** Fasa 0

> Nota: Audit ini dibuat dengan membaca **semua 11 fail kod** dalam zip dan **mengesahkan struktur kedua-dua Google Sheet secara langsung** (read-only). Tiada apa-apa dipadam, ditulis, atau diubah.

---

## 1. RINGKASAN SISTEM ASAL

Sistem ini ialah **aplikasi web Google Apps Script** untuk merekod kehadiran harian pelajar bagi 17 kelas (6 peringkat). Guru/pembantu kelas membuka satu pautan web, pilih kelas, tanda pelajar yang tidak hadir beserta sebab, dan hantar. Sistem mengira peratus kehadiran harian/mingguan/bulanan dan menulis terus ke Google Sheet. Notifikasi dihantar ke Telegram.

**Senibina sebenar:**

```
   [Telefon Guru / Pembantu]                [Telefon / PC Admin]
            │                                        │
            ▼                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │   GOOGLE APPS SCRIPT WEB APP  (Index.html — 1 fail SPA)   │
   │   • Tab Isi Kehadiran (tiada login)                       │
   │   • Tab Rekod Lepas    (tiada login)                      │
   │   • Tab Dashboard      (PIN 6003 — semak di browser)      │
   │   • Tab Pengurusan     (PIN 0000 — semak di browser)      │
   └──────────────────────────────────────────────────────────┘
            │  google.script.run (RPC, bukan HTTP biasa)
            ▼
   ┌──────────────────────────────────────────────────────────┐
   │   11 fail .gs (logik server)                              │
   └──────────────────────────────────────────────────────────┘
            │  SpreadsheetApp.openById(SPREADSHEET_ID)
            ▼
   ┌──────────────────────────────────────────────────────────┐
   │   GOOGLE SHEET #2 "PERATUS KEHADIRAN" (16_MSY...)         │
   │   = pangkalan data operasi SEBENAR (semua tab di sini)    │
   └──────────────────────────────────────────────────────────┘

   GOOGLE SHEET #1 "SENARAI NAMA PELAJAR" (1kZJRFxl...)
   = dokumen rujukan HR. TIDAK dirujuk langsung oleh kod.
            │
            ▼
   [Telegram Group/Channel: -1003712920577]  ← notifikasi
```

**Fakta senibina yang paling penting (perlu difahami sebelum migrasi):**

1. **Hanya Google Sheet #2 (`16_MSY...`) yang digunakan oleh kod.** Semua `openById` menggunakan `CONFIG.SPREADSHEET_ID` = sheet #2. Google Sheet #1 (`1kZJRFxl...`) **langsung tidak dirujuk** dalam mana-mana fail. Sheet #1 ialah senarai rujukan guru/pembantu/pelajar yang diselenggara secara manual.
2. **Master pelajar sebenar = tab `SENARAI_PELAJAR` di dalam Sheet #2.** Senarai nama pelajar asal di-*hardcode* dalam `Index.html` (objek `DATA_PELAJAR`, "DATA SEBENAR DARI EXCEL"), kemudian disemai ke tab `SENARAI_PELAJAR` melalui fungsi `syncPelajarDariHTML`. Selepas itu, app override data hardcoded dengan data dari Sheet semasa runtime.
3. **PIN admin disemak di sebelah browser (client-side), bukan server.** `const PIN_ADMIN = "6003"` ada terus dalam HTML, dan fungsi `dapatPinAdmin()` menghantar PIN sebenar ke browser. Sesiapa yang buka "View Source" boleh nampak PIN. **Ini bermakna tiada keselamatan sebenar.**
4. **Bilangan pelajar di-hardcode** (`JUMLAH_PELAJAR`, jumlah 376 murid) dan inilah asas kiraan peratus, bukan kiraan baris sebenar (kecuali jika `SENARAI_PELAJAR` ada data aktif).
5. **Tiada `doPost`.** Komunikasi frontend↔backend guna `google.script.run` (RPC khas GAS). Migrasi ke server sendiri bermakna semua panggilan ini perlu ditulis semula sebagai HTTP `fetch()`.

**Skala sistem:**

| Perkara | Nilai |
|---|---|
| Peringkat | 6 (T1, T2, T3, T4, T5, STAM/Pra-U) |
| Kelas | 17 |
| Jumlah pelajar | 376 (dari `JUMLAH_PELAJAR`) |
| Zon waktu | Asia/Kuala_Lumpur |
| Format tarikh | `DD-MM-YYYY` (teks) |
| Minggu persekolahan | Isnin–Jumaat |

---

## 2. SENARAI FAIL DAN FUNGSI (Audit A)

### 2.1 Struktur fail

| Fail | Baris | Fungsi utama |
|---|---|---|
| `code.gs` | 23 | Entry point `doGet()` + nota dokumentasi |
| `config.gs` | 87 | Semua konstant: `CONFIG`, nama tab, senarai kelas, guru, jumlah pelajar, mapping naik kelas |
| `helpers.gs` | 143 | Fungsi tarikh (normalize, cari Jumaat, set minggu), cache jumlah pelajar |
| `setup.gs` | 180 | Setup awal semua tab Sheet + triggers (jalankan sekali). **Ada `doGet()` kedua (pendua)** |
| `kehadiran.gs` | 325 | **Teras**: simpan & muat kehadiran, reset, cari/buat kolum tarikh |
| `peratus.gs` | 423 | Kira & jana peratus harian + mingguan (paling kompleks) |
| `pengurusan.gs` | 420 | Urus pelajar/guru/kelas, PIN, naik kelas, arkib |
| `laporan.gs` | 152 | Laporan bulanan dalam Sheet |
| `telegram.gs` | 371 | Semua notifikasi & laporan Telegram |
| `utiliti.gs` | 416 | Pembaikan & pembersihan data (jalankan manual) |
| `Index.html` | 3,623 | Seluruh frontend (SPA): HTML + CSS + JS dalam satu fail |

### 2.2 Entry point Web App

* **`doGet()`** (dalam `code.gs` DAN `setup.gs` — **pendua**): pulangkan `Index.html` sebagai HtmlOutput. Tiada parameter routing. Aplikasi satu halaman (SPA).
* **`doPost()`: TIADA.** Sistem tidak guna HTTP POST. Frontend panggil backend melalui `google.script.run.withSuccessHandler(...).namaFungsi(args)`.

### 2.3 Fungsi utama guru submit kehadiran

* Frontend: `sahkanHantar()` → `simpanKelasDenganRetry(dataKelas, 3)` → panggil backend `simpanDataKelas(dataJson)`.
* Backend: **`simpanDataKelas(dataJson)`** dalam `kehadiran.gs` — fungsi tulang belakang. Ia:
  1. Ambil `LockService` (lock 30 saat) untuk elak perlanggaran serentak.
  2. Kira hadir/peratus.
  3. Tulis ke tab tingkatan (`_simpanKeTabTingkatan`).
  4. Kemaskini tab `PERATUS HARIANMINGGUAN` (`kemaskiniPeratusTab`).
  5. Tulis baris transaksi ke `DATA_KEHADIRAN` (`simpanTabData`).
  6. Semak & simpan laporan bulanan jika hari terakhir bulan (`semakDanSimpanBulanan`).
* Untuk hantar semua kelas sekaligus dari Dashboard: `simpanDataKeSheets(dataJson)`.

### 2.4 Fungsi utama dashboard/admin

* Muat data harian: `muatDataHarian(tarikh)` / `muatRekodTarikh(tarikh)` / `muatSemuaRekodDariSheets()`.
* Pengurusan pelajar: `muatDataPengurusan`, `tambahPelajar`, `buangPelajar`, `editNamaPelajar`, `pindahKelasPelajar`.
* Pengurusan kelas/guru: `editGuruKelas`, `tambahKelas`, `editNamaKelas`, `padamKelas`.
* PIN: `dapatPinAdmin`, `simpanPinAdmin`, `dapatPinUrus`, `simpanPinUrus`.
* Naik kelas: `previewNaikKelas`, `prosesNaikKelas`, `undoNaikKelas`, `senaraiBackupNaikKelas`.
* Laporan: `simpanLaporanBulananSheets`, `janaPeratusMingguanUntuk`.
* Reset/padam: `resetKelasSheets`, `resetSemuaSheets`, `padamDataTarikh`.

### 2.5 Fungsi Telegram

`hantarMesejTelegram`, `hantarRingkasanTelegram`, `hantarPeringatanPagi`, `hantarPeringatanManual`, `hantarPeringatanBelumIsiGs`, `hantarLaporanMingguan`, `hantarLaporanBulanan`, `kelasBelumsIsi`, `kesanPelajarKerapTidakHadir`, `triggerSemakPelajarKerap`. (Butiran penuh di Bahagian F.)

### 2.6 Code smell / isu kod (perlu diberi perhatian semasa migrasi)

* **`doGet()` pendua** (code.gs + setup.gs) — dalam GAS ini boleh jadi konflik / ambiguous.
* **`dapatJumlahPelajarBerCache()` pendua** (helpers.gs + kehadiran.gs) — definisi sama, dua tempat.
* Beberapa fungsi membanding tarikh dengan `.toString()` terus (bukan `normTarikh()`) → lihat Risiko #2.

---

## 3. SENARAI SHEET/TAB DAN FUNGSI (Audit B)

### 3.1 Google Sheet #1 — `1kZJRFxl...` "SENARAI NAMA PELAJAR SABK MAAHAD AL-KHAIR LIL BANAT"

* **Status: rujukan manual sahaja. TIDAK digunakan oleh kod.** (Boleh diakses awam "anyone with link".)
* Tab pertama (yang disahkan): direktori kelas dengan kolum:

  | A | B | C | D | E |
  |---|---|---|---|---|
  | BIL | NAMA KELAS | SINGKATAN | GURU KELAS | **PEMBANTU GURU KELAS** |

* 17 kelas tersenarai. **Penemuan penting:** sheet ini ada kolum **PEMBANTU GURU KELAS** yang TIADA dalam kod. Ini relevan untuk keperluan baru (#5: "guru kelas / pembantu isi kehadiran").
* **Percanggahan data:** beberapa "GURU KELAS" di Sheet #1 berbeza dengan `GURU_KELAS` dalam kod. Contoh: kelas **1M** — Sheet #1 catat guru = *NUR ADILAH BINTI MAT SAUD* (dan *HANIZAN BINTI MD NAYAN* sebagai pembantu), tetapi kod catat guru = *HANIZAN BINTI MD. NAYAN*. (Lihat Soalan #4.)

### 3.2 Google Sheet #2 — `16_MSY...` "PERATUS KEHADIRAN PELAJAR" (pangkalan data operasi)

Semua tab di bawah dicipta/diurus oleh kod. Disahkan struktur sepadan dengan `setup.gs`.

#### Tab peringkat: `T1`, `T2`, `T3`, `T4`, `T5`, `STAM` — **laporan/peratus visual harian + mingguan**

Setiap tab berstruktur blok (kolum B ke kanan = tarikh):

| Baris | Kandungan |
|---|---|
| 1 | Nama sekolah |
| 3 | Label tingkatan (cth "TINGKATAN 1") |
| 4 | Tajuk "JUMLAH KEHADIRAN SEBENAR" |
| 5 | Baris header tarikh |
| 6–8 (T1–T5) / 6–7 (STAM) | Bilangan **hadir** per kelas |
| 10 | Tajuk "JUMLAH PELAJAR SEBENAR HARIAN" |
| 11 | Baris header tarikh |
| 12–14 / 12–13 | **Jumlah pelajar** per kelas |
| 16 | Tajuk "PERATUS KEHADIRAN HARIAN" |
| 17 | Baris header tarikh |
| 18–20 / 18–19 | **Peratus** per kelas |
| baris bawah blok peratus | Peratus harian + mingguan **sekolah** |

> **Beza penting:** T1–T5 guna `rowHadir:5, rowJumlah:11, rowPeratus:17`. **STAM berbeza** (`rowHadir:5, rowJumlah:9, rowPeratus:13`) sebab hanya 2 kelas. Mana-mana parser mesti ikut offset per-tingkatan.
> Kolum `PERATUS MINGGUAN` disisip secara dinamik selepas Jumaat setiap minggu.

#### Tab `PERATUS HARIANMINGGUAN` — **ringkasan peratus semua kelas**

* Baris 1 = header tarikh (+ kolum "PERATUS MINGGUAN").
* Setiap kelas = satu baris tetap (`ROW_PERATUS_TAB`): 1K=2, 1A=3, … STAMMARJAN=18, dan baris 20 = "PERATUS HARIAN / MINGGUAN SEKOLAH".

#### Tab `DATA_KEHADIRAN` — **REKOD TRANSAKSI (sumber kebenaran utama untuk kiraan)**

Header (12 kolum):

| TARIKH | KELAS | NAMA_KELAS | GURU | JUMLAH | HADIR | TIDAK_HADIR | WAKIL | PERATUS | SENARAI_TH | SENARAI_WAKIL | MASA |
|---|---|---|---|---|---|---|---|---|---|---|---|

* TARIKH & PERATUS diformat sebagai **teks** (`@`).
* `SENARAI_TH` = senarai tidak hadir, format `NAMA(SEBAB) | NAMA(SEBAB) | ...`.
* `SENARAI_WAKIL` = senarai wakil sekolah, dipisah ` | `.
* **Ini tab yang semua laporan & peratus mingguan/bulanan kira semula daripadanya.**

#### Tab `SENARAI_PELAJAR` — **MASTER PELAJAR**

| KOD_KELAS | NAMA_PELAJAR | STATUS | TARIKH_DAFTAR |
|---|---|---|---|

* STATUS: `aktif`, `keluar`, `pindah-keluar`, `tamat`. Hanya `aktif` dikira dalam jumlah pelajar.

#### Tab `METADATA_KELAS` — **TETAPAN KELAS**

| KOD_KELAS | NAMA_KELAS | GURU_KELAS | STATUS |
|---|---|---|---|

* STATUS: `aktif` / `padam`.

#### Tab `LOG_AKTIVITI` — **log audit pengurusan**

| MASA | JENIS | TINDAKAN | BUTIRAN | ADMIN |
|---|---|---|---|---|

#### Tab `PELAJAR_TAMAT` — **arkib pelajar tamat (5K/5A/5M/STAM)**

| KELAS_ASAL | NAMA_PELAJAR | STATUS | TAHUN_TAMAT | TARIKH_ARKIB |
|---|---|---|---|---|

#### Tab `LAPORAN_BULANAN` — **laporan bulanan terkumpul**

| BULAN/TAHUN | BIL HARI | 1K…STAMMARJAN (17 kolum) | JUMLAH HADIR | JUMLAH PELAJAR | PERATUS SEKOLAH |
|---|---|---|---|---|---|

#### Tab `TETAPAN` — **konfigurasi PIN (KUNCI/NILAI)**

| KUNCI | NILAI |
|---|---|
| PIN_ADMIN | (cth 6003) |
| PIN_URUS | (cth 0000) |

#### Tab `BACKUP_PELAJAR_<timestamp>` — **backup auto sebelum naik kelas** (boleh banyak)

### 3.3 Pengelasan tab

| Peranan | Tab |
|---|---|
| **Master pelajar** | `SENARAI_PELAJAR` (di Sheet #2) |
| **Rekod transaksi** | `DATA_KEHADIRAN` |
| **Laporan / peratus** | `T1`–`T5`, `STAM`, `PERATUS HARIANMINGGUAN`, `LAPORAN_BULANAN` |
| **Tetapan / config** | `METADATA_KELAS`, `TETAPAN` |
| **Log / arkib** | `LOG_AKTIVITI`, `PELAJAR_TAMAT`, `BACKUP_PELAJAR_*` |

---

## 4. ALIRAN DATA LENGKAP

### 4.1 Aliran guru isi kehadiran (Audit D)

1. **Buka page:** Guru buka pautan web app. Tab default = **"📝 Isi Kehadiran"** (tiada login).
2. **Pilih kelas:** Grid 17 kelas dipaparkan (`renderGridKelas`). Semua guru nampak semua kelas — **tiada sekatan per-guru**. Klik kelas → Langkah 2.
3. **Senarai pelajar:** Datang dari `DATA_PELAJAR[kelas]` (hardcoded), tetapi di-override dengan data terkini dari tab `SENARAI_PELAJAR` apabila app muat (`muatSenaraiPelajarDariSheets`).
4. **Tanda tidak hadir:** Tap pelajar → modal kategori sebab (`KATEGORI_SEBAB`) → pilih kategori → pilih sebab spesifik. Fungsi `pilihSebab(sebab, isWakil)`:
   * Jika kategori berflag **`wakil:true`** (hanya "🏫 AKTIVITI LUAR SEKOLAH" → "WAKIL SEKOLAH") → masuk `S.wakilSekolah[kelas]` → **dikira HADIR**.
   * Jika `wakil:false` (semua sebab lain) → masuk `S.tidakHadir[kelas]` sebagai `{nama, sebab}` → **dikira TIDAK HADIR**.
5. **Wakil sekolah:** diisi melalui mekanisme #4 di atas (bukan medan berasingan). Senarai sebab `wakil:false` termasuk: ancaman keselamatan, bencana alam, digantung sekolah, masalah keluarga, masalah peribadi, PdPR, penggiliran peperiksaan, kebenaran pengetua, ponteng, masalah kesihatan, sekolah dalam hospital.
6. **Simpan:** `selesaiKelas()` papar pengesahan (Hadir = jumlah − tidak hadir; Tidak Hadir; Wakil) → `sahkanHantar()` → `simpanDataKelas` di backend. Disimpan ke **`DATA_KEHADIRAN` + tab tingkatan + `PERATUS HARIANMINGGUAN`**.
7. **Validasi:** minimal. Tiada validasi sekolah/guru. Ada **cache localStorage** (`kehadiran_cache`) + **logik retry 3×** dengan jitter (elak data hilang bila sistem sibuk/rangkaian gagal).
8. **Jika kelas sudah isi tarikh sama:** `simpanTabData` cari baris sedia ada (padanan `TARIKH`+`KELAS`). Jika jumpa → **OVERWRITE** baris itu. Jika tiada → **append** baris baru. Jadi: **kemaskini (overwrite), bukan tambah pendua** — *dengan syarat* padanan tarikh berjaya (lihat Risiko #2 & #3).
9. **Tarikh:** Guru sentiasa isi untuk **HARI INI sahaja** (`S.tarikh = tarikhHariIni()`). **Tiada date picker** untuk guru. (Edit tarikh lampau hanya melalui admin/utiliti.)

### 4.2 Aliran admin (Audit E)

1. **Login sekarang:** Tab "📊 Dashboard" minta **PIN** (`inputPin`). Disemak di browser: `if (input === PIN_ADMIN)`. Tab "⚙️ Pengurusan" minta **PIN kedua** (`PIN_URUS`).
2. **PIN sekarang:** `PIN_ADMIN` default **6003**; `PIN_URUS` default **0000**. Boleh ditukar & disimpan dalam tab `TETAPAN`. **Tiada username/password, tiada akaun bernama, tiada peranan sebenar — hanya 2 PIN kongsi yang menjaga 2 kawasan.**
3. **Fungsi dashboard:** Paparan harian/mingguan/bulanan (carta + statistik), peratus per kelas, senarai tidak hadir, pie chart.
4. **Semak kelas belum isi:** `kelasBelumsIsi()` — bandingkan `SENARAI_GURU` dengan kelas yang sudah ada rekod hari ini; pulangkan senarai guru yang belum isi.
5. **Fungsi laporan:** jana laporan bulanan ke Sheet, jana peratus mingguan, hantar ringkasan/laporan ke Telegram.
6. **Fungsi setting:** tukar PIN admin & PIN pengurusan.
7. **Tambah/buang pelajar:** ADA (`tambahPelajar`, `buangPelajar` [soft-delete `keluar`], `editNamaPelajar`, `pindahKelasPelajar`). Juga tambah/edit/padam kelas & edit guru.
8. **Repair/sync:** ADA banyak (di `utiliti.gs`): `betulkanRekodLepas`, `bersihkanSemuaMasalah`, `bersihkanKolumTarikhDuplikat`, `bersihkanKolumMingguanDuplikat`, `tetapkanFormatTarikhTab`, `padamDataTarikh`. Juga `syncPelajarDariHTML`, dan naik kelas (`prosesNaikKelas` + backup + undo).

---

## 5. FORMULA KIRAAN SEBENAR (Audit C)

> **INI BAHAGIAN PALING KRITIKAL UNTUK MIGRASI.** Sistem baru mesti tiru formula ini dengan TEPAT supaya nombor sejarah kekal sama.

### 5.1 Jumlah pelajar (`jumlah`)

Diambil oleh `dapatJumlahPelajarBerCache(ss, kelas)`:
* **Default** = `JUMLAH_PELAJAR[kelas]` (konstant hardcoded).
* **Jika** tab `SENARAI_PELAJAR` ada pelajar berstatus `aktif` untuk kelas itu (`count > 0`) → guna **kiraan baris aktif** itu.
* **Cache 600 saat (10 minit)** per kelas.

> Maksudnya ada **3 sumber "jumlah pelajar"** yang boleh berbeza: (a) konstant `JUMLAH_PELAJAR`, (b) hardcoded `DATA_PELAJAR.length` di HTML, (c) kiraan aktif `SENARAI_PELAJAR`. Lihat Risiko #1.

### 5.2 Hadir, Tidak Hadir, Wakil

```
th     = bilangan pelajar dalam senarai tidakHadir        (sebab wakil:false)
wk     = bilangan pelajar dalam senarai wakilSekolah      (sebab wakil:true)
hadir  = jumlah − th
```

> **KAEDAH PENTING:** `hadir = jumlah − th` sahaja. **Wakil sekolah TIDAK ditolak** — pelajar wakil sekolah **kekal dikira HADIR**. `wk` hanya direkod berasingan untuk laporan. Mekanismenya: flag `wakil:true` pada sebab "WAKIL SEKOLAH" menyebabkan pelajar masuk senarai wakil (bukan senarai tidak hadir).

### 5.3 Peratus harian (kelas)

```
peratusNum = hadir / jumlah                    (pecahan, cth 0.9667)
peratus    = (hadir / jumlah * 100).toFixed(2) + "%"   (teks, cth "96.67%")
```
* Dalam tab tingkatan: disimpan sebagai **pecahan** (format `0.00%`).
* Dalam `DATA_KEHADIRAN` & `PERATUS HARIANMINGGUAN`: disimpan sebagai **teks "xx.xx%"**.

### 5.4 Peratus harian (sekolah)

```
peratus_harian_sekolah = Σ(hadir semua kelas hari itu) / Σ(jumlah semua kelas hari itu)
```
Dikira semula daripada `DATA_KEHADIRAN` (bukan purata peratus kelas).

### 5.5 Peratus mingguan — **TERKUMPUL, bukan purata harian**

```
peratus_mingguan_kelas = Σ(hadir Isnin..Jumaat) / Σ(jumlah Isnin..Jumaat)

peratus_mingguan_sekolah = Σ(hadir semua kelas, semua hari minggu)
                           / Σ(jumlah semua kelas, semua hari minggu)
```
* **BUKAN** purata 5 peratus harian. Ia **jumlah hadir terkumpul ÷ jumlah pelajar terkumpul** sepanjang minggu.
* Hari yang **tiada data langsung dikecualikan secara automatik** (kerana tiada kolum/baris untuk hari itu, jadi tidak ditambah ke jumlah terkumpul).
* Minggu = Isnin–Jumaat (`tarikhMingguDari`). Hujung minggu diabaikan (`getDay()` 1–5 sahaja).

### 5.6 Peratus bulanan — **TERKUMPUL juga**

```
peratus_bulanan_kelas = Σ(hadir semua hari bulan) / Σ(jumlah semua hari bulan)
peratus_bulanan_sekolah = Σ(hadir semua kelas, semua hari bulan)
                         / Σ(jumlah semua kelas, semua hari bulan)
BIL HARI = bilangan tarikh unik yang ada rekod dalam bulan itu
```
* Sama kaedah dengan mingguan: terkumpul, bukan purata.
* Auto-simpan hanya apabila rekod dihantar pada **hari kalendar terakhir bulan** (`semakDanSimpanBulanan`). Boleh juga jana manual.

### 5.7 Cuti / hari tidak sekolah

* **Tiada konsep "hari cuti" eksplisit** dalam sistem. Tiada tab/flag cuti.
* Hari tanpa sekolah dikecualikan secara **tersirat**: tiada guru isi → tiada rekod → tiada kolum → tidak masuk kiraan terkumpul.

### 5.8 Format tarikh sebenar

* **`DD-MM-YYYY`** sebagai **teks** (cth `21-04-2026`) dalam `DATA_KEHADIRAN`.
* Dalam tab tingkatan & `PERATUS HARIANMINGGUAN`, header tarikh ditulis sebagai **objek Date** dengan format paparan `dd-mm-yyyy`.
* `normTarikh()` menyeragamkan kedua-dua (Date → teks `dd-MM-yyyy`; selainnya `.toString().trim()`).
* Warna ambang: **≥95% hijau, ≥85% kuning, <85% merah**. (Per kelas harian: 0 tidak hadir = hijau, >2 = merah, selainnya kuning.)

---

## 6. INTEGRASI TELEGRAM (Audit F) — *kenal pasti sahaja, JANGAN migrate dahulu*

| Perkara | Butiran |
|---|---|
| **Bot token dibaca dari** | `CONFIG.TELEGRAM_BOT_TOKEN` — **hardcoded** dalam `config.gs` (token bermula `8575996183:...` — **rahsia, perlu dirotasi & dipindah ke secret**) |
| **Chat ID dibaca dari** | `CONFIG.TELEGRAM_CHAT_ID` = `-1003712920577` (ID negatif = group/channel), hardcoded |
| **Cara hantar** | `UrlFetchApp.fetch` POST ke `api.telegram.org/bot<TOKEN>/sendMessage`, `parse_mode: Markdown`, pecah mesej jika >4000 aksara |

**Bila mesej dihantar:**

| Fungsi | Pencetus | Kandungan |
|---|---|---|
| `hantarPeringatanPagi` | Trigger harian **8:00 pagi** (hari bekerja) | Peringatan umum semua guru isi sebelum 9 pagi |
| `hantarRingkasanTelegram` | Butang manual (Dashboard) | 2 mesej: (1) ringkasan harian (hadir/tidak hadir/wakil/jumlah/peratus), (2) senarai ketidakhadiran per kelas + sebab |
| `hantarPeringatanManual` | Butang manual | Senarai guru yang **belum isi** hari ini |
| `hantarLaporanMingguan` | Trigger **Jumaat 3:00 petang** | Jumlah hadir/tidak hadir + peratus mingguan |
| `hantarLaporanBulanan` | Trigger **1 haribulan 7:00 pagi** | Laporan bulan lepas + peratus setiap kelas |
| `kesanPelajarKerapTidakHadir` | Manual (`triggerSemakPelajarKerap`) | Amaran pelajar tidak hadir **3 hari berturut** |

**Data dalam Telegram:** nama sekolah, tarikh (BM), jumlah hadir/tidak hadir/wakil/pelajar, peratus, senarai nama pelajar tidak hadir + sebab, senarai guru belum isi, senarai pelajar kerap tidak hadir.

> **Amaran keselamatan:** Token bot & senarai nama penuh pelajar dihantar ke Telegram dan token ada dalam kod sumber. Semasa migrasi, token **mesti** dipindah ke environment variable/secret dan dirotasi.

---

## 7. RISIKO MIGRASI (Audit G)

| # | Risiko | Penjelasan & kesan |
|---|---|---|
| 1 | **3 sumber "jumlah pelajar" berbeza** | `JUMLAH_PELAJAR` (376), `DATA_PELAJAR.length` (HTML), kiraan aktif `SENARAI_PELAJAR` — boleh tak sepadan. Cache 10 minit pula buat nilai jadi basi. Jika migrasi guna sumber berbeza dari yang asal, **peratus berubah**. |
| 2 | **Format tarikh bercampur (Date vs teks)** | `normTarikh` urus kebanyakan kes, TAPI beberapa fungsi banding dengan `.toString()` terus (cth `kiraPeratusMingguanPeratusTab`, `hantarLaporanMingguan`, `hantarLaporanBulanan`, `kesanPelajarKerapTidakHadir`). Rekod lama bertaip Date boleh **gagal dipadan** → peratus mingguan/bulanan tersilap kira. Import mesti normalize dulu. |
| 3 | **Kolum tarikh / MINGGUAN pendua** | Wujud **berulang** dalam sistem asal — buktinya ada banyak utiliti pembersihan (`bersihkanKolumTarikhDuplikat`, `bersihkanKolumMingguanDuplikat`, `bersihkanSemuaMasalah`). Migrasi mesti **deduplikat** ikut (tarikh+kelas) sebelum import. |
| 4 | **Formula peratus berbeza ikut permukaan** | Harian per-kelas = pecahan (tingkatan tab) vs teks "%" (DATA_KEHADIRAN). Mingguan/bulanan = **terkumpul** (Σhadir/Σjumlah), bukan purata. Jika sistem baru guna kaedah lain, **nombor sejarah tak sepadan**. |
| 5 | **`betulkanRekodLepas` paksa konstant** | Fungsi repair ini menulis semula `jumlah = JUMLAH_PELAJAR` (abaikan kiraan `SENARAI_PELAJAR`). Jika pernah dijalankan, sejarah ditulis semula guna konstant. Wujud **ketegangan** antara nilai hidup vs konstant. |
| 6 | **Peraturan wakil sekolah** | `hadir = jumlah − tidakHadir` (wakil **tidak** ditolak). Jika migrasi tersilap tolak wakil, **peratus jatuh**. Mesti kekalkan flag `wakil:true`. |
| 7 | **Pelajar masuk/keluar pertengahan tempoh** | `DATA_KEHADIRAN` simpan `JUMLAH` pada masa rekod dibuat. Jika sistem baru kira semula `jumlah` ikut roster **semasa**, peratus sejarah pecah. Mesti hormati `jumlah` yang tersimpan untuk rekod lama. |
| 8 | **Google Sheet sebagai master + sync 2 hala** | Risiko race condition. Asal guna `LockService` (30s). Bila ada server sendiri + admin masih boleh edit Sheet UI, perlu strategi konflik (mis. "Sheet menang" atau "server menang") yang jelas. |
| 9 | **Kuota Google API** | Sync penuh `DATA_KEHADIRAN` berulang boleh cecah had baca/tulis Sheets API. Perlu sync berperingkat (delta) + backoff. |
| 10 | **Kedua-dua Sheet boleh diakses awam** ("anyone with link") | Mengandungi 376 nama pelajar (PII). Perlu semak & ketatkan kebenaran semasa/selepas migrasi. |
| 11 | **PIN client-side (tiada keselamatan)** | PIN nampak dalam source; `dapatPinAdmin` hantar PIN ke browser. **Tidak boleh dibawa ke sistem baru.** Perlu auth server sebenar (sudah dirancang). |
| 12 | **Percanggahan guru kod vs Sheet #1** | Cth kelas 1M (guru vs pembantu bertukar). Perlu putuskan sumber kebenaran untuk nama guru/pembantu. |
| 13 | **STAM berbeza layout** | Offset baris (`rowJumlah:9, rowPeratus:13`) berbeza dari T1–T5. Parser import mesti per-tingkatan. |
| 14 | **Masa disimpan sebagai string locale** | `toLocaleTimeString('ms-MY')` — bukan ISO. Perlu parsing berhati-hati. |
| 15 | **Tiada `doPost` / guna `google.script.run`** | Kontrak frontend↔backend berubah sepenuhnya. Semua panggilan RPC perlu ditulis semula sebagai HTTP API. |
| 16 | **Auto-laporan bulanan bergantung hari terakhir** | `semakDanSimpanBulanan` cuma cetus jika rekod dihantar pada hari kalendar terakhir bulan. Jika hari itu cuti/hujung minggu, baris bulanan mungkin tertinggal. |

---

## 8. CADANGAN SCHEMA DATABASE SERVER (Audit H)

> **Ingat:** Pada fasa awal, **Google Sheet kekal master database**. Database server hanya **cache / lapisan kelajuan**. Schema ini direka supaya boleh tampung peranan penuh kemudian, tetapi mula sebagai cache read-mostly.

Cadangan **PostgreSQL** (boleh mula dengan SQLite untuk skeleton):

```sql
-- ROLES & USERS (untuk auth server baru — ganti PIN client-side)
CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  kod           TEXT UNIQUE NOT NULL,         -- 'ADMIN', 'SUPER_ADMIN'
  nama          TEXT NOT NULL                 -- 'SU Kehadiran', 'SU HEM'
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  kata_laluan_hash TEXT NOT NULL,             -- bcrypt/argon2 — JANGAN simpan plain
  role_id       INTEGER REFERENCES roles(id),
  aktif         BOOLEAN DEFAULT TRUE,
  dicipta_pada  TIMESTAMPTZ DEFAULT now()
);

-- KELAS (cache dari METADATA_KELAS)
CREATE TABLE classes (
  id            SERIAL PRIMARY KEY,
  kod           TEXT UNIQUE NOT NULL,         -- '1K','STAMLULU'
  nama          TEXT NOT NULL,                -- 'TINGKATAN 1 KHADIJAH'
  tingkatan     TEXT,                         -- 'T1'..'T5','STAM'
  guru_kelas    TEXT,
  pembantu_kelas TEXT,                        -- dari Sheet #1 (baru)
  status        TEXT DEFAULT 'aktif'          -- 'aktif'/'padam'
);

-- PELAJAR (cache dari SENARAI_PELAJAR)
CREATE TABLE students (
  id            SERIAL PRIMARY KEY,
  class_kod     TEXT REFERENCES classes(kod),
  nama          TEXT NOT NULL,
  status        TEXT DEFAULT 'aktif',         -- aktif/keluar/pindah-keluar/tamat
  tarikh_daftar DATE,
  UNIQUE (class_kod, nama)
);

-- SEBAB KETIDAKHADIRAN (dari KATEGORI_SEBAB)
CREATE TABLE absence_reasons (
  id            SERIAL PRIMARY KEY,
  kategori      TEXT NOT NULL,                -- 'PONTENG','MASALAH KESIHATAN'
  sebab         TEXT NOT NULL,                -- 'BANGUN LEWAT'
  dikira_hadir  BOOLEAN DEFAULT FALSE         -- = flag wakil:true
);

-- REKOD KEHADIRAN (cache dari DATA_KEHADIRAN) — 1 baris per (tarikh,kelas)
CREATE TABLE attendance_records (
  id            SERIAL PRIMARY KEY,
  tarikh        DATE NOT NULL,
  class_kod     TEXT REFERENCES classes(kod),
  jumlah        INTEGER NOT NULL,             -- SIMPAN nilai pada masa rekod (jangan kira semula utk sejarah)
  hadir         INTEGER NOT NULL,
  tidak_hadir   INTEGER NOT NULL,
  wakil         INTEGER NOT NULL,
  peratus       NUMERIC(5,2),                 -- simpan utk audit; = hadir/jumlah*100
  guru          TEXT,
  masa_isi      TIMESTAMPTZ,
  sumber        TEXT DEFAULT 'sheet',         -- 'sheet'/'server' (asal data)
  UNIQUE (tarikh, class_kod)                  -- kunci elak pendua
);

CREATE TABLE attendance_absentees (
  id            SERIAL PRIMARY KEY,
  record_id     INTEGER REFERENCES attendance_records(id) ON DELETE CASCADE,
  nama_pelajar  TEXT NOT NULL,
  sebab         TEXT
);

CREATE TABLE attendance_representatives (
  id            SERIAL PRIMARY KEY,
  record_id     INTEGER REFERENCES attendance_records(id) ON DELETE CASCADE,
  nama_pelajar  TEXT NOT NULL
);

-- TETAPAN (cache dari tab TETAPAN + config lain)
CREATE TABLE settings (
  kunci         TEXT PRIMARY KEY,
  nilai         TEXT
);

-- LOG SYNC (audit dua-hala dgn Google Sheet)
CREATE TABLE sync_logs (
  id            SERIAL PRIMARY KEY,
  arah          TEXT,                         -- 'sheet->db' / 'db->sheet'
  jenis         TEXT,                         -- 'pelajar'/'kehadiran'/'metadata'
  status        TEXT,                         -- 'berjaya'/'gagal'
  bil_rekod     INTEGER,
  mesej         TEXT,
  dijalankan_pada TIMESTAMPTZ DEFAULT now()
);

-- LOG AUDIT (cache/superset dari LOG_AKTIVITI)
CREATE TABLE audit_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  jenis         TEXT,                         -- 'PELAJAR'/'KELAS'/'SYSTEM'
  tindakan      TEXT,                         -- 'TAMBAH'/'BUANG'/'EDIT'
  butiran       TEXT,
  masa          TIMESTAMPTZ DEFAULT now()
);

-- LOG TELEGRAM (untuk Fasa 8)
CREATE TABLE telegram_logs (
  id            SERIAL PRIMARY KEY,
  jenis_mesej   TEXT,                         -- 'peringatan'/'ringkasan'/'mingguan'/'bulanan'
  tarikh_rujukan DATE,
  status        TEXT,                         -- 'dihantar'/'gagal'
  ringkasan     TEXT,
  dihantar_pada TIMESTAMPTZ DEFAULT now()
);
```

**Catatan reka bentuk:**
* `attendance_records.jumlah` **disimpan** (snapshot) — jangan kira semula daripada roster semasa, supaya peratus sejarah kekal (Risiko #7).
* Peratus mingguan/bulanan **jangan disimpan sebagai jadual berasingan dahulu** — kira *on-the-fly* dari `attendance_records` (Σhadir/Σjumlah) supaya padan kaedah asal. Boleh tambah jadual ringkasan kemudian untuk prestasi.
* `absence_reasons.dikira_hadir` = peraturan `wakil:true`.

---

## 9. PELAN FASA PEMBANGUNAN (Audit I)

Susunan dipersetujui (dengan penambahbaikan berdasarkan audit):

| Fasa | Matlamat | Output utama | Nota audit |
|---|---|---|---|
| **0** | Audit & faham (SIAP) | Dokumen ini | — |
| **1** | Repo + Docker skeleton | Struktur repo, `docker-compose`, README, .env.example | Token Telegram & SPREADSHEET_ID masuk `.env`, bukan kod |
| **2** | Sync Google Sheet **read-only** | Service account, baca `SENARAI_PELAJAR`, `METADATA_KELAS`, `DATA_KEHADIRAN` ke DB | Tangani format Date↔teks, dedup (tarikh+kelas), offset STAM |
| **3** | Import data lama + **validate kiraan** | Skrip import + ujian yang **bandingkan peratus DB vs Sheet sedia ada** | Tiru formula Bahagian 5 TEPAT; sahkan harian/mingguan/bulanan sepadan |
| **4** | Page guru (mobile) | UI isi kehadiran, pilih kelas, tanda sebab, retry/offline cache | Kekal peraturan wakil, "hari ini sahaja", localStorage |
| **5** | Admin biasa (SU Kehadiran) | Login server (username/pwd), dashboard, semak belum isi, laporan | Ganti PIN client-side dgn JWT/session |
| **6** | Ketua admin (SU HEM) | Peranan `SUPER_ADMIN`, urus pelajar/kelas/guru, naik kelas, undo | Tambah audit_logs penuh |
| **7** | Write-back Google Sheet | Tulis dari server → Sheet, strategi konflik, sync_logs | Putuskan "siapa menang"; backoff kuota |
| **8** | Telegram | Pindah semua notifikasi + scheduler (cron) | Token dari secret; replika 6 jenis mesej |
| **9** | Deployment production | Reverse proxy, HTTPS, backup, monitoring di `srv-zai-93` | Backup DB + eksport Sheet berkala |

---

## 10. SENARAI SOALAN / PERKARA TIDAK JELAS

1. **Sumber kebenaran "jumlah pelajar":** Untuk rekod **lama**, adakah kita kekalkan `JUMLAH` yang sudah tersimpan dalam `DATA_KEHADIRAN` (disyorkan), atau kira semula? Untuk rekod **baru**, guna kiraan `SENARAI_PELAJAR` aktif?
2. **Pemetaan 2 PIN → 2 akaun:** Adakah betul tafsiran ini: **PIN_ADMIN (6003)** → akaun **ADMIN / SU Kehadiran** (dashboard, laporan, peringatan); **PIN_URUS (0000)** → akaun **SUPER_ADMIN / SU HEM** (urus pelajar/kelas, naik kelas, tukar PIN)? Atau kedua-dua akaun patut boleh akses semua, cuma SU HEM ada kuasa tambahan (cth padam/naik kelas)?
3. **Pembantu kelas (dari Sheet #1):** Adakah sistem baru perlu **senarai pembantu** dan benarkan mereka isi kehadiran juga? Perlu nama mereka dimasukkan ke DB?
4. **Percanggahan guru (kod vs Sheet #1):** Untuk kelas seperti **1M** (guru/pembantu bertukar), mana satu betul — kod atau Sheet #1? Sheet mana jadi sumber rasmi nama guru/pembantu?
5. **Akses awam Google Sheet:** Kedua-dua sheet kini "anyone with link". Adakah ini disengajakan? Boleh kita ketatkan kepada service account + admin sahaja selepas migrasi?
6. **Sync dua hala (Fasa 7):** Selepas server jadi master kemudian, adakah admin masih perlu/dibenarkan edit Google Sheet secara manual? Ini menentukan strategi konflik.
7. **Hari cuti / cuti penggal:** Adakah anda mahu sistem baru ada **kalendar cuti eksplisit** (supaya boleh bezakan "tiada sekolah" vs "guru lupa isi"), atau kekal kaedah tersirat sedia ada?
8. **Telegram:** Token semasa terdedah dalam kod — boleh saya andaikan ia akan **dirotasi** (token baru) sebelum Fasa 8? Adakah masih guna group/channel `-1003712920577` yang sama?
9. **Tahun sesi & arkib:** Bila proses **naik kelas** dijalankan (akhir tahun)? Adakah `PELAJAR_TAMAT` dan `BACKUP_PELAJAR_*` perlu dibawa masuk ke DB sebagai sejarah?
10. **"Rekod Lepas" terbuka tanpa login:** Sekarang sesiapa boleh lihat rekod kehadiran lampau (termasuk nama). Adakah ini patut kekal terbuka, atau perlu di belakang login dalam sistem baru?

---

---

## 11. KEPUTUSAN TERKUNCI (dipersetujui selepas Fasa 0)

Diputuskan oleh pemilik sistem. Ini **mengatasi** tafsiran awal di Bahagian 10.

**K1 — Autentikasi & peranan.**
PIN lama **TIDAK dipetakan**. Sistem baru guna **login server username/password**.
Peranan: `ADMIN` = **SU Kehadiran**; `SUPER_ADMIN` = **SU HEM**.
`PIN_ADMIN` (6003) & `PIN_URUS` (0000) dianggap **rujukan legacy sahaja** — tidak diimport sebagai kelayakan.
→ Guna jadual `roles`/`users` (Bahagian 8), kata laluan di-**hash** (argon2/bcrypt). *(Jawab Soalan #2.)*

**K2 — Rekod lama JANGAN dikira semula (fasa awal).**
Import nilai asal **sebagaimana dalam Google Sheet** (`JUMLAH`, `HADIR`, `PERATUS` = snapshot).
Server hanya **validate & bandingkan** kiraan. **Recalculate hanya dalam modul audit — TIDAK overwrite data lama.**
→ `attendance_records.jumlah` kekal snapshot; modul audit berasingan untuk perbandingan & laporan ketakpadanan. *(Jawab Soalan #1.)*

**K3 — Sumber rasmi.**
- **Sheet #2** kekal **master utama** kehadiran/peratus.
- **Sheet #1** = rujukan **guru kelas + pembantu guru kelas**.
- Jika bercanggah → **JANGAN overwrite automatik**; catat sebagai **sync warning** dalam `sync_logs`. *(Jawab Soalan #3 & #4.)*

**K4 — Telegram ditangguh.**
Token lama dianggap **terdedah**. **JANGAN migrate Telegram dahulu.**
Dalam **Fasa 8**, token **diganti** & disimpan dalam **.env server** (bukan kod). *(Jawab Soalan #8.)*

> Soalan #5, #6, #7, #9, #10 di Bahagian 10 masih terbuka (boleh dijawab nanti pada fasa berkaitan).

---

*Tamat Fasa 0. Tiada kod migration ditulis, tiada Google Sheet diubah. Keputusan K1–K4 terkunci. Fasa 1 memerlukan pilihan stack teknikal sebelum bermula.*
