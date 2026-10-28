# Dokumentasi Arsitektur Chatbot - Dikti Indicator

## 1. Ringkasan Eksekutif

Fitur chatbot adalah asisten berbasis AI yang membantu pengguna menjawab pertanyaan seputar data IKU (Indikator Kinerja Utama). Chatbot menggunakan layanan RAG (Retrieval-Augmented Generation) eksternal (FastAPI) untuk deteksi intent dan generasi jawaban, serta data layer Next.js untuk mengambil dan memfilter data spreadsheet kampus.

**Type:** Single-round tool call chatbot (maks 1 ronde data, tanpa loop)  
**Model:** Dikonfigurasi via RAG FastAPI (env `LLM_*`, `CHAT_*`)  
**Integration:** Next.js App Router + PostgreSQL + Google Sheets + RAG FastAPI

---

## 2. Arsitektur Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Layer                              │
│  User Request (POST /api/chat)                                      │
│  { message, scope?, clientData? }                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        API Route Layer                              │
│  src/app/api/chat/route.ts                                          │
│  - Authentication check (x-user-email header)                       │
│  - Validation (message required, max 2000 karakter)                 │
│  - Auth user lookup (Prisma → app_users)                            │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      Chat Service Layer                             │
│  src/lib/chat/chat-service-rag.ts                                   │
│  - Call 1: RAG intent detection → action.type === "fetch_data"?     │
│  - (optional) Execute spreadsheet tool (data layer)                 │
│  - (optional) Call 2: RAG answer generation + spreadsheet_context   │
│  - Fallback ramah pengguna jika Call 2 gagal                        │
└─────────────────────────────────────────────────────────────────────┘
              ↓ (Call 1 & 2)                    ↓ (data layer)
┌──────────────────────────────┐   ┌────────────────────────────────┐
│       RAG Client Layer       │   │    Spreadsheet Tool Layer      │
│  src/lib/chat/rag-client.ts  │   │  src/lib/chat/spreadsheet-     │
│  - POST /v1/answer           │   │  tool.ts                       │
│  - AbortSignal.timeout(30s)  │   │  - clientData (browser-parsed) │
│  - Teruskan blocks ke FE     │   │  - Fallback: server-side fetch  │
└──────────────────────────────┘   │    (IPv4-first DNS)            │
              ↓                    │  - filterRows + calculateKpis  │
┌──────────────────────────────┐   └────────────────────────────────┘
│  RAG FastAPI Service         │                  ↓
│  (iku-rag-chatbot)           │   ┌────────────────────────────────┐
│  - Intent detection          │   │       Database Layer            │
│  - Retrieval (vector DB)     │   │  PostgreSQL + Prisma ORM       │
│  - LLM generation            │   │  - app_users                   │
│  - Respons: answer,          │   │  - data_source_connections     │
│    citations, blocks,        │   │  - dashboard_tab_connections   │
│    action, grounded          │   └────────────────────────────────┘
└──────────────────────────────┘
```

---

## 3. Endpoint Detail

### `POST /api/chat`

**Location:** `src/app/api/chat/route.ts`

**Headers:**
- `x-user-email` (REQUIRED): User email untuk authentication

**Request Body:**
```json
{
  "message": "Pertanyaan user seputar data IKU",
  "scope": { "kind": "iku", "ikuCode": "IKU 001" },
  "clientData": {
    "rows": [...],
    "columns": [...],
    "sourceName": "Spreadsheet IKU",
    "sourceId": "abc123"
  }
}
```

> [!NOTE]
> `scope` dan `clientData` bersifat opsional. `clientData` dikirim browser agar server tidak perlu fetch ulang ke Google Sheets (menghindari `EAI_AGAIN` di Node.js).

**Response (Success 200):**
```json
{
  "answer": "Jawaban dari AI berdasarkan data IKU",
  "citations": [
    {
      "id": "chunk-001",
      "documentTitle": "Panduan IKU 2024",
      "section": "Bab 3",
      "snippet": "..."
    }
  ],
  "blocks": [
    { "type": "formula", "lines": ["Capaian = (Realisasi / Target) × 100%"] }
  ],
  "grounded": true,
  "outOfScope": null,
  "action": null
}
```

> [!IMPORTANT]
> Kontrak `POST /api/chat` → `{ "answer": string }` tidak boleh diubah tanpa izin. Field tambahan (`citations`, `blocks`, dll.) bersifat opsional dan backward-compatible.

**Error Responses:**
- `401 Unauthorized`: Header `x-user-email` tidak ada atau user tidak ditemukan
- `403 Forbidden`: User exists tapi `is_active = false`
- `400 Bad Request`: Body tidak ada `message` atau message kosong
- `504 Gateway Timeout`: RAG service tidak merespons dalam 85 detik
- `500 Internal Server Error`: Exception saat processing

**Runtime Configuration:**
```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

---

## 4. Authentication Flow

**Location:** `src/lib/chat/auth-context.ts`

```typescript
export async function getAuthenticatedUser(request: Request): Promise<AuthResult>
```

**Steps:**
1. Extract `x-user-email` dari request header
2. Truncate & lowercase email
3. Query database: `prisma.appUser.findUnique({ where: { email } })`
4. Check `isActive` field
5. Return:
   - `{ status: "ok", user: { email } }` jika valid
   - `{ status: "unauthenticated" }` jika tidak ada user
   - `{ status: "inactive" }` jika user ada tapi `isActive = false`

> [!WARNING]
> Auth masih menggunakan **header-only approach** untuk development/testing. Belum ada session management, JWT, atau cookie verification. **DO NOT USE** untuk production sebelum implementasi auth yang proper.

---

## 5. Alur Chat Lengkap (2-Call RAG)

```
User kirim pesan
        │
        ▼
handleChatMessage()
        │
        ├─► RAG Call 1: POST /v1/answer { question, scope }
        │         │
        │         ▼
        │   ragResponse.action.type === "fetch_data"?
        │         │
        │   Tidak ─┤──► return ragResponse langsung (jawaban umum)
        │         │
        │    Ya   ▼
        │
        ├─► executeTool(user, spreadsheetRequest, clientData?)
        │         │
        │         ├── PATH 1: clientData ada → proses langsung (tanpa fetch)
        │         └── PATH 2: fallback → fetchRowsCached(connection.url)
        │                            → filterRows + calculateKpis
        │         │
        │         ▼
        │   toolResult.status === "ok"?
        │         │
        │   Tidak ─┤──► return pesan error (no_source / no_match / error)
        │         │
        │    Ya   ▼
        │
        ├─► formatToolResultForLLM(toolResult) → dataContext string
        │
        ├─► RAG Call 2: POST /v1/answer { question, spreadsheet_context, scope }
        │         │
        │         ├── Berhasil → return secondResponse (jawaban final + citations + blocks)
        │         │
        │         └── Gagal / timeout → return pesan fallback ramah pengguna
        │                               (BUKAN dump data mentah)
        ▼
    ChatAnswer { answer, citations, blocks, grounded, outOfScope, action }
```

---

## 6. RAG Client (`rag-client.ts`)

**Location:** `src/lib/chat/rag-client.ts`

### 6.1 Konfigurasi

| Env Variable | Deskripsi |
|---|---|
| `RAG_SERVICE_URL` | Base URL FastAPI RAG (wajib, via `getEnvOrThrow`) |
| `RAG_SERVICE_TOKEN` | Token internal untuk header `X-Internal-Token` (wajib) |

> [!CAUTION]
> Kedua env variable ini **wajib diisi** di `.env.local` sebelum RAG dapat berjalan. Jika kosong, `getRagClient()` akan melempar error saat request pertama.

### 6.2 Timeout

Setiap panggilan `fetch` ke RAG menggunakan `AbortSignal.timeout(30_000)` (30 detik). Jika RAG tidak merespons dalam 30 detik, fetch otomatis dibatalkan dan error dilempar ke caller.

### 6.3 Struktur Respons RAGResponse (internal)

```typescript
interface RAGResponse {
  answer: string;
  citations?: Array<{
    id: string;
    documentTitle: string;
    documentVersion?: string;
    section?: string;
    page?: number;
    ikuCode?: string;
    snippet?: string;
  }>;
  blocks?: Array<{ type: "formula" | "note" | "metric"; lines?: string[] }>;
  grounded?: boolean;
  outOfScope?: { suggestedTab?: string };
  action?: { type: string; payload?: unknown };
  debug?: { model?; chunkIds?; warnings?; llmCalls?; durationMs? };
}
```

### 6.4 ChatAnswer (publik — diteruskan ke FE)

```typescript
export type ChatAnswer = {
  answer: string;
  citations: Array<{ id; documentTitle; documentVersion?; section?; page?; ikuCode?; snippet? }>;
  blocks?: Array<{ type: "formula" | "note" | "metric"; lines?: string[] }>;
  grounded: boolean;
  outOfScope: { suggestedTab?: string } | null;
  action: { type: string; payload?: unknown } | null;
};
```

> [!NOTE]
> Field `blocks` bersifat opsional. Jika FastAPI mengirimkannya, FE dapat menampilkan rumus, catatan, atau metrik secara terstruktur.

---

## 7. Spreadsheet Tool Integration

**Location:** `src/lib/chat/spreadsheet-tool.ts`

### 7.1 Prioritas Pengambilan Data

1. **PATH 1 (Prioritas):** `clientData` dari browser — tidak ada network call ke Google Sheets
2. **PATH 2 (Fallback):** `fetchRowsCached(url)` — fetch server-side dengan IPv4-first DNS, cache 5 menit

### 7.2 Database Schema

**Tables dipakai:**

| Table | Kolom kunci | Deskripsi |
|-------|------------|-----------|
| `app_users` | `email`, `isActive` | Auth & status user |
| `data_source_connections` | `userEmail`, `url`, `name` | Spreadsheet terhubung |
| `dashboard_tab_connections` | `userEmail`, `dashboardTab`, `sourceId` | Mapping tab → source |

### 7.3 Algoritma `executeTool`

```
1. clientData ada & rows > 0?
   → processRows(clientData.rows, ...)
   → selesai

2. Query dashboard_tab_connections WHERE userEmail + dashboardTab = indicator
3. Query data_source_connections WHERE userEmail
4. Pilih connection (tab-specific atau pertama)
5. fetchRowsCached(connection.url) → parse XLSX → cache 5 menit
6. processRows(rows, ...) → normalizeRows → filterRows → calculateKpis → ToolResult
```

### 7.4 Logging

> [!IMPORTANT]
> Isi spreadsheet adalah **input tidak tepercaya**. Hanya metadata yang boleh di-log (status, jumlah baris, panjang karakter). Isi data mentah **TIDAK BOLEH** masuk ke console.

---

## 8. Aturan & Batasan (AGENTS.md)

| Aturan | Detail |
|--------|--------|
| Alur maks 1 ronde data | Call 1 → (opsional) data → Call 2. Tidak ada loop. |
| Kontrak API tidak berubah | `POST /api/chat` → `{ answer: string }` (field tambahan backward-compatible) |
| Angka dari data layer | `calculateKpis`, `filterRows`, `normalizeRows` — bukan dari LLM |
| Spreadsheet = tidak tepercaya | Jangan log isi mentah; hanya log metadata |
| URL Google Sheets | Hanya `https://docs.google.com/...` |
| Konfigurasi LLM via env | `LLM_*`, `CHAT_*`, `RAG_SERVICE_URL`, `RAG_SERVICE_TOKEN` |
| RAG = tanggung jawab AI engineer lain | Hanya antarmuka `knowledge.ts` yang boleh dibuat di sini |
| Jangan ubah auth/skema DB | Tanpa izin eksplisit |

---

## 9. End-to-End Flow Examples

### Case 1: Direct Question (No Data Required)

```http
POST /api/chat
Headers: { "x-user-email": "user@example.com" }
Body: { "message": "Halo, apa itu IKU?" }
```

**Flow:**
1. Auth check → user exists & active
2. Call 1 → RAG jawab langsung, `action = null`
3. Return `{ answer: "IKU adalah...", citations: [], grounded: true, outOfScope: null, action: null }`

### Case 2: Question Requiring Spreadsheet Data

```http
POST /api/chat
Headers: { "x-user-email": "user@example.com" }
Body: {
  "message": "Berapa total dosen IKU 001 tahun 2024?",
  "scope": { "ikuCode": "IKU 001" },
  "clientData": { "rows": [...], "columns": [...] }
}
```

**Flow:**
1. Auth check → ok
2. Call 1 → `action.type = "fetch_data"`
3. `executeTool` → PATH 1 (clientData) → filter tahun 2024 → `ToolResult { status: "ok", matchedRows: 45, ... }`
4. `formatToolResultForLLM` → `dataContext` (string ringkasan + tabel)
5. Call 2 → RAG + `spreadsheet_context` → jawaban natural + `blocks`
6. Return `{ answer: "Total dosen IKU 001 tahun 2024 adalah 150...", citations: [...], blocks: [...] }`

### Case 3: Call 2 Gagal (RAG Tidak Merespons)

**Flow setelah step 4 di atas:**
5. Call 2 → timeout / error
6. Return `{ answer: "Data berhasil ditemukan, namun layanan perangkum AI sedang tidak merespons. Silakan coba beberapa saat lagi.", grounded: false }`

---

## 10. Tech Stack Integration

| Component | Library/Tool | Purpose |
|-----------|--------------|---------|
| Framework | Next.js 16.2.6 | App Router, API Routes |
| Database | PostgreSQL (Neon) | Primary data store |
| ORM | Prisma 7.8.0 | Database queries |
| Auth | Custom (placeholder) | Header-based auth |
| RAG Service | FastAPI (iku-rag-chatbot) | Intent detection + LLM generation |
| Spreadsheet | SheetJS (xlsx) | Excel parsing |
| HTTP | fetch (Node.js) + AbortSignal.timeout | RAG & Google Sheets API |
| Runtime | Node.js | Server-side execution |

---

## 11. Current Status & TODOs

### ✅ Completed
- [x] API route endpoint (`/api/chat`)
- [x] Auth context (`getAuthenticatedUser`)
- [x] Chat service 2-call RAG flow (`handleChatMessage`)
- [x] RAG client dengan timeout 85s + 504 handler (`rag-client.ts`, `route.ts`)
- [x] Field `blocks` diteruskan dari RAG ke FE
- [x] Spreadsheet tool integration (`executeTool` — clientData priority)
- [x] Logging patuh AGENTS.md (tidak log data mentah)
- [x] Fallback Call 2 dengan pesan ramah pengguna
- [x] In-memory cache spreadsheet 5 menit
- [x] IPv4-first DNS untuk menghindari EAI_AGAIN

### ⚠️ TODO (Infrastruktur)
- [ ] Isi `RAG_SERVICE_URL` & `RAG_SERVICE_TOKEN` di `.env.local`
- [ ] Jalankan FastAPI `iku-rag-chatbot` service
- [ ] Proper auth mechanism (JWT/session)
- [ ] Tambah `AbortSignal` dari FE (Stop button) diteruskan ke RAG call

### 🚫 Future Enhancements
- [ ] Multi-turn conversation support
- [ ] Streaming response
- [ ] Source selection logic (user punya >1 spreadsheet)
- [ ] Caching layer (Redis / persistent)

---

## 12. Environment Variables Checklist

```env
# Wajib untuk RAG
RAG_SERVICE_URL=https://your-rag-service.example.com
RAG_SERVICE_TOKEN=your-internal-token

# Database
DATABASE_URL=postgresql://...

# LLM (dikonfigurasi di sisi RAG FastAPI, bukan Next.js)
# LLM_* dan CHAT_* ada di .env FastAPI
```

---

## 13. Troubleshooting

### Issue: `Environment variable RAG_SERVICE_URL is required`
**Solution:** Isi `RAG_SERVICE_URL` dan `RAG_SERVICE_TOKEN` di `.env.local`

### Issue: Jawaban "layanan perangkum AI sedang tidak merespons"
**Solution:** Pastikan FastAPI `iku-rag-chatbot` berjalan dan dapat diakses dari server Next.js

### Issue: Timeout setelah 30 detik
**Solution:** Periksa koneksi ke RAG service; pertimbangkan menaikkan `RAG_TIMEOUT_MS` di `rag-client.ts`

### Issue: `401 Unauthorized` padahal user ada
**Solution:**
- Check header `x-user-email` terkirim dengan benar
- Check email di database (case-sensitive? trailing whitespace?)
- Check `isActive = true`

### Issue: Spreadsheet tool returns `no_source`
**Solution:**
- Check `data_source_connections` ada record untuk `userEmail`
- Check URL format Google Sheets valid

### Issue: Network error saat fetch Google Sheets (server-side)
**Solution:**
- Kirim `clientData` dari browser agar server tidak perlu fetch (PATH 1)
- Atau pastikan DNS IPv4-first aktif (sudah di-set di `spreadsheet-tool.ts`)

---

## 14. Contact & Maintenance

**Maintainer:** AI Engineer / Backend Developer  
**Last Updated:** Oktober 2026  
**Project:** Dikti Indicator (Next.js 16 + PostgreSQL + RAG FastAPI)

---

*Doc diperbarui berdasarkan codebase aktual: `src/lib/chat/` — menggantikan referensi qwen-client yang sudah tidak relevan.*
