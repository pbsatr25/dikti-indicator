# Permintaan API — Asisten IKU (Chatbot RAG)

**Untuk:** BE (Rakan) dan AI Ops (Irfan)
**Dari:** FE / AI Engineer
**Status (27 Okt 2026):** `POST /api/chat` **sudah ada** (PR #1, merge `db11e48`) dan FE sudah terhubung lewat adapter di `src/lib/chat-client.ts`. Masih tersisa `SCHEMA NOT FOUND` dan `AUTH NOT READY`, ditambah daftar revisi di bagian 0. Mock tetap default sampai env RAG tersedia (`NEXT_PUBLIC_CHAT_MOCK` ≠ `"false"`).

Kontrak tipe ada di `src/types/chat.ts`. Semua pemanggilan dari UI melewati `src/lib/chat-client.ts`, jadi setelah endpoint tersedia cukup set `NEXT_PUBLIC_CHAT_MOCK=false` tanpa mengubah komponen. Jika bentuk respons perlu diubah, ubah `src/types/chat.ts` terlebih dahulu.

> **Pembaruan (cakupan per halaman):** stakeholder menetapkan bahwa chatbot **hanya menjawab sesuai halaman dasbor yang dibuka**. Di halaman IKU 001, chatbot hanya menjawab seputar IKU 001, begitu pula untuk IKU lain. Halaman Overview hanya menjawab ringkasan lintas IKU dan konsep umum. Aturan ini **wajib ditegakkan di server** (lihat bagian "Aturan cakupan"). Pembatasan di UI/mock hanya simulasi.

Semua error dikembalikan sebagai `{ "error": "<pesan berbahasa Indonesia>" }` dengan status HTTP yang sesuai. Identitas user **wajib** diambil dari sesi server, bukan dari body atau query.

---

## 0. Kontrak aktual BE (PR #1) dan permintaan revisi

Bagian ini mencatat bentuk `POST /api/chat` yang **sudah berjalan** di `src/app/api/chat/route.ts` + `src/lib/chat/*`. FE menyesuaikan diri lewat adapter dan **tidak mengubah kode BE**. Bagian 1 di bawah tetap menjadi target kontrak akhir.

### 0.1 Yang dipakai FE sekarang

Request yang dikirim `chat-client.ts`:

```http
POST /api/chat
Content-Type: application/json
x-user-email: <email dari localStorage["iku-user-session"]>
```

```json
{
  "message": "pertanyaan (trim, ≤ 2000 karakter, dicek di klien)",
  "scope": { "kind": "iku", "ikuCode": "IKU 001" },
  "clientData": { "rows": [ … ], "columns": [ … ], "sourceName": "opsional" }
}
```

- `clientData` **hanya dikirim** jika cakupan = IKU, tab dasbor aktif = IKU tersebut, data selesai dimuat (`parseStatus: "success"`), dan jumlah baris 1–5.000. Di Overview atau di luar syarat itu, field ini tidak dikirim sehingga server mengambil data dari koneksi tab IKU yang sesuai. Alasannya: data aktif di Overview bisa milik IKU lain, dan memotong baris akan membuat angka KPI salah.
- Baris dikirim **tanpa filter dasbor** (tahun/fakultas dari pertanyaan yang menentukan filter di server).

Respons BE dinormalkan menjadi `ChatAnswer` di klien:

| Field BE | Penanganan FE |
|---|---|
| `answer` | wajib berupa string; jika tidak, ditampilkan error "Jawaban dari server tidak dapat dibaca" |
| `citations[]` | `documentVersion` kosong → `"-"`, `snippet` kosong → `""`, `id` duplikat dibuang |
| `grounded` | hanya `false` yang dianggap tanpa-konteks |
| `outOfScope: null` | menjadi `undefined` |
| `action: { type, payload }` | dipakai hanya jika ada `label` + `dashboardTab` (di `payload` atau di akar); selain itu dibuang |
| `conversationId`, `messageId` | **tidak dikirim BE** → dibuat di klien |
| `disclaimer` | **tidak dikirim BE** → ditambahkan kode FE (FR-14) |
| `blocks` | divalidasi per blok di `src/lib/chat-blocks.ts`. Bentuk kontrak FE diterima apa adanya; bentuk RAG `{ type, lines }` dipetakan: `formula.lines` → formula, `note.lines` → satu `note` per baris, `metric.lines` ("Label: nilai") → tabel Rincian/Hasil. Blok tidak dikenal dibuang |
| `confidence` | tidak dikirim BE → tidak ditampilkan |

Error: `401` → "Sesi tidak dikenali, masuk kembali"; `403`/`400` → pesan `error` dari server; `504` (timeout RAG 85 detik) → "terlalu lama merespons"; `5xx` lain atau body non-JSON → pesan umum. Timeout klien 90 detik; tombol Stop membatalkan fetch.

### 0.2 Permintaan revisi ke BE (Rakan) — belum diubah FE

| # | Prioritas | Temuan | Lokasi | Usulan |
|---|---|---|---|---|
| B1 | **Blokir build** | `toolResult.message` tidak ada di varian `status: "ok"` → `npm run build` gagal (`Failed to type check`) | `src/lib/chat/chat-service-rag.ts:85` | ganti dengan `"message" in toolResult ? toolResult.message : "OK"` |
| B2 | Tinggi (`AUTH NOT READY`) | identitas dari header `x-user-email` bisa dipalsukan siapa pun yang tahu email terdaftar | `src/lib/chat/auth-context.ts` | sesi server (cookie `httpOnly`); signature `getAuthenticatedUser` tetap |
| B3 | Tinggi (dimitigasi di RAG, lihat A9) | **cakupan per halaman dilanggar**: IKU yang disebut di pertanyaan diutamakan atas `scope` (di halaman IKU 001, "data IKU 9" mengambil data IKU 009) | `chat-service-rag.ts:52-64` | di cakupan IKU, `indicator` = `scope.ikuCode`; IKU lain di pertanyaan → `outOfScope: { suggestedTab }` |
| B4 | Tinggi | isi pertanyaan dan cuplikan data spreadsheet ditulis ke log (`[CHAT-DEBUG]`), melanggar aturan "jangan log isi mentah" | `chat-service-rag.ts:37,45,90-91` | log status/panjang/durasi saja, atau di balik flag debug |
| B5 | Sedang | fetch ke RAG tanpa timeout dan tidak diteruskan `request.signal`, sehingga Stop di FE tidak menghentikan proses server | `rag-client.ts:61,101` | `AbortSignal.timeout(...)` digabung dengan `request.signal` |
| B6 | ✅ selesai (`44c952e`) | `blocks` dari RAG dibuang | `rag-client.ts:77-83,117-123` | teruskan `blocks` (setelah bentuknya disamakan, lihat A2) |
| B7 | Sedang | respons tanpa `disclaimer`, `conversationId`, `messageId` | `route.ts` | tambahkan sesuai bagian 1 (FE sudah punya fallback) |
| B8 | Sedang | `clientData` tidak divalidasi (ukuran, tipe sel) dan tidak dibatasi panjang body | `route.ts:38-40` | batasi jumlah baris/ukuran body; tolak `413` |
| B9 | Rendah | pertanyaan > 2000 karakter dibalas `200` dengan teks, bukan `400` | `chat-service-rag.ts:27-35` | `400 { error }` (FE sudah memblokir di klien) |
| B10 | Rendah | jika panggilan RAG kedua gagal, jawaban berisi dump tabel mentah `a \| b \| c` | `chat-service-rag.ts:108-115` | jawaban singkat + `grounded: false`, atau ringkasan KPI saja |
| B11 | Rendah | `dns.setDefaultResultOrder("ipv4first")` mengubah perilaku DNS seluruh proses Node | `spreadsheet-tool.ts:4-5` | cukup di agent fetch khusus, atau atur di level runtime/Docker |
| B12 | Rendah | `getAvailableFilters` mengabaikan koneksi tab (selalu sumber pertama) dan tanpa cache | `spreadsheet-tool.ts:48-75` | pakai koneksi yang sama dengan `executeTool` + `fetchRowsCached` |
| B13 | Rendah | `docs/chatbot-architecture.md` usang (masih `qwen-client`, respons `{ answer }`) | docs | perbarui sesuai alur RAG saat ini |

### 0.3 Permintaan revisi ke AI Engineer (layanan RAG/FastAPI)

| # | Temuan | Usulan |
|---|---|---|
| A1 | Intent `fetch_data` hanya berupa `action.type`; parameter (IKU, tahun, fakultas, jenjang, agregasi) ditebak BE dengan regex, dan `aggregation` selalu `"none"`. Akibatnya hingga 100 baris dikirim ke LLM dan **LLM menghitung sendiri**, melanggar FR-08/FR-18 | kembalikan `action: { type: "fetch_data", payload: { year, faculty, degree, aggregation, column } }`; perhitungan tetap di `data-helpers.ts`, LLM hanya menjelaskan `summary` |
| A2 | Bentuk `blocks` RAG (`{ type, lines }`) berbeda dari FE (`note.text`, `metric.label/value/target/caption`) | **sementara dipetakan FE** (`chat-blocks.ts`, perubahan #8). Jangka panjang: kirim bentuk `AnswerBlock` langsung, terutama `metric` berangka (`value`, `target` dari `iku_targets`) agar kartu capaian tampil; adapter FE sudah menerima kedua bentuk |
| A3 | `citations` boleh tanpa `documentVersion`/`snippet` | selalu isi dari metadata chunk (FR-07, NFR Traceability) |
| A4 | `action` untuk navigasi belum berbentuk `{ label, dashboardTab }` | gunakan bentuk itu agar tombol "Buka IKU 00x" tampil |
| A5 | Tidak ada konteks percakapan (FR-09) | terima `history` (beberapa turn terakhir) + query rewriting; perlu kesepakatan kontrak dengan BE |
| A6 | Tidak ada `confidence` | kirim `"tinggi" \| "sedang" \| "rendah"` dari skor retrieval |
| A7 | Dua kali panggil LLM untuk pertanyaan data (intent → jawaban), latensi tinggi tanpa streaming | intent ringan (klasifikasi/aturan) di panggilan pertama; tahap 2: SSE (NFR token pertama ≤ 5 detik) |
| A8 | `spreadsheet_context` adalah data tak tepercaya | bungkus dengan delimiter dan tegaskan di system prompt agar tidak diikuti sebagai instruksi |
| A9 | ✅ dikerjakan di branch `feat/cakupan-halaman` repo RAG (perubahan #8): `scope` divalidasi (400), gerbang `outOfScope` sebelum intent/LLM, retrieval difilter `iku_id`, cakupan di system prompt. Pertanyaan yang menyebut IKU lain kini berhenti di gerbang sebelum `fetch_data`, sehingga B3 tidak lagi terpicu dari teks pertanyaan | BE tetap disarankan memakai `scope.ikuCode` sebagai `indicator` di cakupan IKU (pertahanan berlapis) |

## 1. `POST /api/chat` — ajukan pertanyaan (FR-04–FR-09, FR-14, FR-18)

Request:

```json
{
  "conversationId": "opsional; kosong berarti percakapan baru",
  "question": "Hitung capaian AEE PT kami…",
  "scope": { "id": "IKU 001", "kind": "iku", "ikuCode": "IKU 001" }
}
```

- `question`: wajib, setelah di-trim, maksimum 2.000 karakter (UI sudah membatasi).
- `scope`: wajib. Nilainya `{ "id": "overview", "kind": "overview" }` atau `{ "id": "IKU 00x", "kind": "iku", "ikuCode": "IKU 00x" }`. Validasi `ikuCode` terhadap daftar IKU yang dikenal (001, 002, 003, 005, 007, 009).
- `conversationId` harus milik `scope` yang sama. Tolak dengan `400` jika berbeda.

Response `200` (`ChatAnswer`):

```json
{
  "conversationId": "uuid",
  "messageId": "uuid",
  "answer": "Mengacu IKU 1 – Angka Efisiensi Edukasi (AEE), …",
  "blocks": [
    { "type": "metric", "label": "Capaian AEE PT", "value": 86.36, "target": 80, "caption": "Rata-rata dari 5 jenjang" },
    { "type": "formula", "lines": ["Capaian_i = AEE realisasi ÷ AEE ideal × 100%", "AEE PT    = Σ Capaian_i ÷ n"] },
    { "type": "table", "columns": [{ "key": "jenjang", "header": "Jenjang" }], "rows": [{ "jenjang": "D3" }] },
    { "type": "list", "variant": "excluded", "items": ["SPP/UKT/biaya kuliah mahasiswa"] },
    { "type": "note", "text": "Catatan: …" }
  ],
  "citations": [
    {
      "id": "chunk-id",
      "documentTitle": "Buku IKU Diktisaintek Berdampak",
      "documentVersion": "V1",
      "section": "IKU 1 · Formula",
      "page": 45,
      "ikuCode": "IKU 001",
      "snippet": "potongan teks sumber"
    }
  ],
  "grounded": true,
  "confidence": "tinggi",
  "action": { "label": "Buka IKU 001", "dashboardTab": "IKU 001" },
  "outOfScope": null,
  "disclaimer": "Dibuat AI dari Buku IKU V1 & data modul. Periksa sebelum pelaporan."
}
```

- `blocks` bersifat opsional. Blok ini dipakai untuk kartu capaian, formula, tabel, dan daftar seperti di desain Hifi. Semua isinya berupa teks atau angka, **tanpa HTML**.
- `grounded: false` berarti tidak ada konteks relevan (FR-06). UI akan menampilkan peringatan.
- `citations` dibentuk dari metadata chunk yang benar-benar dipakai (FR-07).
- `disclaimer` wajib selalu ada (FR-14).
- `outOfScope` diisi `{ "suggestedTab": "IKU 009" }` (atau `"Overview"`, atau tanpa `suggestedTab`) jika pertanyaan di luar cakupan. Dalam kondisi ini `answer` berisi penolakan singkat, `citations` kosong, dan LLM tidak perlu menyusun jawaban substantif. UI menampilkan tombol "Tanyakan di IKU 009" yang memindahkan pengguna dan mengirim ulang pertanyaan dengan `scope` halaman tersebut.

### Aturan cakupan (wajib di server)

1. **Retrieval difilter berdasarkan metadata chunk.**
   - Cakupan IKU: hanya chunk dengan `ikuCode` = cakupan, ditambah chunk umum yang ditandai relevan untuk semua IKU (mis. definisi istilah) bila tim AI menyetujuinya.
   - Cakupan Overview: chunk umum/kebijakan dan daftar IKU, **bukan** rincian formula per IKU.
2. **Data modul (FR-18) hanya untuk IKU dalam cakupan.** Overview boleh membaca ringkasan status dan target semua IKU.
3. **Deteksi di luar cakupan** dilakukan sebelum generasi: penyebutan IKU lain (mis. "IKU 9"), topik khas IKU lain, atau skor retrieval dalam cakupan di bawah threshold sementara skor di cakupan lain tinggi. Isi `outOfScope.suggestedTab` dengan IKU yang terdeteksi.
4. **System prompt menyebut cakupan secara eksplisit** dan melarang menjawab di luar cakupan, meskipun pengguna memintanya (mitigasi prompt injection).

**Streaming (NFR token pertama ≤ 5 detik), diusulkan sebagai tahap 2:** `text/event-stream` dengan event berikut:
- `status` → `{ "text": "Mencari di Buku IKU · Bab V, IKU 9…" }`
- `token` → `{ "text": "potongan" }`
- `done` → `ChatAnswer` lengkap
- `error` → `{ "error": "…" }`

UI sudah menyediakan callback `onStatus` dan `onToken`. Tombol **Hentikan** membatalkan request lewat `AbortSignal`, jadi server sebaiknya menghentikan pemanggilan LLM saat koneksi ditutup.

## 2–4. Riwayat percakapan — DIHAPUS

Fitur riwayat (daftar, buka, dan hapus percakapan) dihapus dari UI. Endpoint `GET/DELETE /api/chat/conversations` **tidak dibutuhkan**. Percakapan hanya berlaku selama sesi browser (per halaman) dan hilang saat halaman dimuat ulang. `conversationId` tetap dipakai untuk menjaga konteks multi-turn (FR-09) dalam satu sesi.

## 5. Umpan balik (feedback) — DIHAPUS

Tombol suka/tidak suka dan "buat ulang jawaban" dihapus dari UI. Endpoint `POST /api/chat/messages/:id/feedback` **tidak dibutuhkan**. Tombol "Coba lagi" pada jawaban yang gagal cukup memanggil ulang `POST /api/chat` dengan pertanyaan dan `scope` yang sama.

## 6. (Opsional) `GET /api/knowledge/documents?status=aktif` — versi dokumen aktif

Endpoint ini dipakai untuk tag "Buku IKU V1" pada bagian **Konteks jawaban**, yang saat ini masih statis.

---

## Kebutuhan skema (`SCHEMA NOT FOUND`, PRD §3.4)

- `ChatConversation`: id, userId, **scopeId** (`overview` / `IKU 00x`), createdAt (hanya untuk konteks multi-turn & audit; tidak ditampilkan sebagai riwayat)
- `DocumentChunk` wajib punya metadata **`ikuCode`** (nullable untuk konten umum) agar retrieval bisa difilter per cakupan
- `ChatMessage`: id, conversationId, role, text, blocks (Json), grounded, confidence, createdAt
- `MessageCitation`: messageId, chunkId, documentVersionId, urutan
- `AuditLog`: untuk pertanyaan yang diajukan (FR-17)

## Kebutuhan auth (`AUTH NOT READY`)

Saat ini sesi hanya tersimpan di `localStorage`. Semua endpoint di atas membutuhkan sesi yang diverifikasi server (cookie `httpOnly`) agar percakapan dan data dasbor milik pengguna tidak bisa dibaca atau dimanipulasi user lain.

## Kebutuhan env (AI Ops)

- `NEXT_PUBLIC_CHAT_MOCK`: `"false"` untuk memakai API asli. Default-nya mock.
- `RAG_SERVICE_URL`, `RAG_SERVICE_TOKEN` (server-only, dipakai `src/lib/chat/rag-client.ts`): **belum ada di `.env.local`**. Tanpa keduanya setiap chat berakhir `500`.
- Mode demo (`NEXT_PUBLIC_DEMO_MODE=true`) memakai `demo@dikti-indicator.local`. Jika email ini tidak ada di `app_users`, `/api/chat` membalas `401`. Perlu user demo di DB atau login dengan akun asli.
- Kredensial LLM/embedding hanya di server (tanpa prefix `NEXT_PUBLIC_`). Nama variabel mengikuti keputusan tim AI.
