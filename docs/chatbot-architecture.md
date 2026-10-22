# Dokumentasi Arsitektur Chatbot - Dikti Indicator

## 1. Ringkasan Eksekutif

Fitur chatbot adalah asisten berbasis AI yang membantu pengguna menjawab pertanyaan seputar data IKU (Indikator Kinerja Utama). Chatbot dapat mengeksekusi query ke spreadsheet yang terhubung oleh user untuk mendapatkan data yang dibutuhkan.

**Type:** Single-round tool call chatbot  
**Model:** Qwen (serving yet to be determined: Ollama / vLLM / custom)  
**Integration:** Next.js App Router + PostgreSQL + Google Sheets

---

## 2. Arsitektur Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Layer                              │
│  User Request (POST /api/chat) → { message: "..." }                 │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        API Route Layer                              │
│  src/app/api/chat/route.ts                                          │
│  - Authentication check (x-user-email header)                       │
│  - Validation (message required)                                    │
│  - Auth user lookup (Prisma → app_users)                            │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      Chat Service Layer                             │
│  src/lib/chat/chat-service.ts                                       │
│  - Build message stack (system + user)                              │
│  - Call Qwen model                                                  │
│  - Parse response (answer vs needsData)                             │
│  - (optional) Execute spreadsheet tool                              │
│  - (optional) Follow-up with tool result                            │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        Qwen Client Layer                            │
│  src/lib/chat/qwen-client.ts                                        │
│  - Interface: QwenClient.chat(messages)                             │
│  - Current: StubQwenClient (placeholder)                            │
│  - Future: HttpQwenClient (real HTTP client)                        │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      Spreadsheet Tool Layer                         │
│  src/lib/chat/spreadsheet-tool.ts                                   │
│  - Query user's data sources (Prisma → data_source_connections)     │
│  - Parse Google Sheet URL → xlsx export                             │
│  - Return max 200 rows of data                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         Database Layer                              │
│  PostgreSQL (Neon) + Prisma ORM                                     │
│  - app_users: Authentication & user status                          │
│  - data_source_connections: User's linked spreadsheets              │
└─────────────────────────────────────────────────────────────────────┘
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
  "message": "Pertanyaan user seputar data IKU"
}
```

**Response (Success 200):**
```json
{
  "answer": "Jawaban dari AI berdasarkan prompt & data (jika ada)"
}
```

**Error Responses:**
- `401 Unauthorized`: Header `x-user-email` tidak ada atau user tidak ditemukan
- `403 Forbidden`: User exists tapi `is_active = false`
- `400 Bad Request`: Body tidak ada `message` atau message kosong
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

**⚠️ NOTE (Current State):**
- Auth masih menggunakan **header-only approach** untuk development/testing
- Belum ada session management, JWT, atau cookie verification
- **DO NOT USE** untuk production sebelum implementasi auth yang proper

**TODO (Production):**
- Implementasi JWT verification atau session cookie
- Ganti auth mechanism tanpa mengubah signature `getAuthenticatedUser`

---

## 5. System Prompt Design

**Location:** `src/lib/chat/prompt.ts`

```typescript
export const SYSTEM_PROMPT = `Kamu adalah asisten yang menjawab pertanyaan seputar data IKU (Indikator Kinerja Utama).

Jika pertanyaan user MEMBUTUHKAN data dari spreadsheet untuk dijawab dengan akurat,
JANGAN menjawab langsung. Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{"needsData": true, "query": "<uraikan data apa yang dibutuhkan>"}

Jika pertanyaan TIDAK butuh data spreadsheet (sapaan, pertanyaan umum, dsb),
jawab langsung secara natural seperti biasa, tanpa format JSON.`;
```

**Design Decisions:**
- Bahasa Indonesia untuk instruksi (user targeting Indonesian audience)
- Strict JSON output untuk `needsData` case → mudah parsing
- Natural response untuk non-data questions → UX lebih natural
- Single responsibility: hanya fokus IKU data

---

## 6. Response Parsing Logic

**Location:** `src/lib/chat/chat-service.ts`

```typescript
type ParsedQwenResponse =
  | { type: "answer"; content: string }
  | { type: "needsData"; query: string };

function parseQwenResponse(rawText: string): ParsedQwenResponse {
  // STUB: Currently always returns { type: "answer", content: rawText }
  // TODO: Implement JSON detection when final format is confirmed
  return { type: "answer", content: rawText };
}
```

**Current Implementation (STUB):**
- Parsing belum diimplementasikan
- Semua response dianggap `answer` (tidak ada tool execution)
- Menunggu keputusan format JSON dari AI engineer

**Expected Implementation (Future):**
- Regex detection: `{.*"needsData":\s*true.*}`
- JSON.parse → extract `query`
- Fallback to `answer` jika tidak match format

---

## 7. Spreadsheet Tool Integration

**Location:** `src/lib/chat/spreadsheet-tool.ts`

### 7.1 Database Schema

**Table:** `data_source_connections`

| Column | Type | Description |
|--------|------|-------------|
| id | String (PK) | Unique identifier |
| userEmail | String (Indexed) | User email (foreign key logic) |
| type | String | Data source type (e.g., "google-sheet") |
| name | String | User-friendly name |
| url | String | Google Sheets URL |
| files | Json? | Optional file metadata |
| createdAt | DateTime | Timestamp |
| updatedAt | DateTime | Timestamp |

**Indexes:**
- `data_source_connections_user_email_idx` on `userEmail`

### 7.2 Function Signature

```typescript
export async function querySpreadsheet(
  user: AuthContext,  // { email: string }
  query: string       // Currently NOT used for filtering
): Promise<SpreadsheetToolResult>
```

### 7.3 Return Types

```typescript
type SpreadsheetToolResult =
  | {
      status: "ok";
      source: { id: string; name: string };
      columns: string[];
      rows: Record<string, unknown>[];
      truncated: boolean;
    }
  | { status: "no_source"; message: string }
  | { status: "error"; message: string };
```

### 7.4 Algorithm

```
1. Query database: find all data_source_connections WHERE userEmail = user.email
2. If empty → return { status: "no_source", message: "..." }
3. Take FIRST connection (MVP: no source selection logic yet)
4. Parse Google Sheets URL → extract sheetId + gid
5. Build export URL: https://docs.google.com/spreadsheets/d/{sheetId}/export?format=xlsx&gid={gid}
6. Fetch xlsx binary via HTTP
7. Parse xlsx → rows (JSON) + columns (array)
8. Truncate: if rows.length > 200, keep only first 200
9. Return { status: "ok", source, columns, rows, truncated }
10. Catch errors → return { status: "error", message: "..." }
```

### 7.5 Current Limitations

- **No filtering:** `query` parameter tidak dipakai (future-proofing)
- **Single source:** Ambil connection pertama, tidak ada logic pemilihan
- **Hard limit:** Max 200 rows (untuk menjaga context window)
- **No caching:** Fetch setiap kali dipanggil

---

## 8. Qwen Client Interface

**Location:** `src/lib/chat/qwen-client.ts`

### 8.1 Contract

```typescript
export interface QwenClient {
  chat(messages: QwenMessage[]): Promise<string>;
}

type QwenMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
```

### 8.2 Current Implementation (STUB)

```typescript
export class StubQwenClient implements QwenClient {
  async chat(_messages: QwenMessage[]): Promise<string> {
    return "Ini jawaban dummy dari StubQwenClient. Ganti dengan implementasi asli setelah server Qwen siap.";
  }
}

export const qwenClient: QwenClient = new StubQwenClient();
```

### 8.3 Expected Production Implementation

**Future HttpQwenClient** should implement:
- HTTP POST ke Qwen server (Ollama / vLLM / custom endpoint)
- Request body: `{ model: "...", messages: QwenMessage[] }`
- Parse JSON response → extract `choices[0].message.content`
- Error handling (timeout, server error, invalid JSON)
- Optional: temperature, max_tokens, etc.

---

## 9. End-to-End Flow Examples

### Case 1: Direct Question (No Data Required)

**User Request:**
```http
POST /api/chat
Headers: { "x-user-email": "user@example.com" }
Body: { "message": "Halo, apa itu IKU?" }
```

**Flow:**
1. Auth check → user exists & active
2. Build messages: `[{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Halo, apa itu IKU?" }]`
3. Call `qwenClient.chat(messages)` → returns "IKU adalah Indikator Kinerja Utama..."
4. Parse response → type = "answer"
5. Return `{ answer: "IKU adalah Indikator Kinerja Utama..." }`

### Case 2: Question Requiring Spreadsheet Data

**User Request:**
```http
POST /api/chat
Headers: { "x-user-email": "user@example.com" }
Body: { "message": "Berapa total dosen di IKU-017 tahun 2024?" }
```

**Flow (Expected - saat parsing sudah diimplementasi):**
1. Auth check → user exists & active
2. Build messages: `[{ role: "system", ... }, { role: "user", content: "..." }]`
3. Call `qwenClient.chat(messages)` → returns `{"needsData": true, "query": "data IKU-017 tahun 2024"}`
4. Parse response → type = "needsData"
5. Call `querySpreadsheet(user, query)` → returns spreadsheet data
6. Build follow-up prompt: `buildDataFollowupPrompt(JSON.stringify(toolResult))`
7. Build new messages: `[system, user, assistant(response), user(follow-up)]`
8. Call `qwenClient.chat(messages)` → returns natural language answer
9. Return `{ answer: "Total dosen IKU-017 tahun 2024 adalah 150 orang..." }`

---

## 10. Tech Stack Integration

| Component | Library/Tool | Purpose |
|-----------|--------------|---------|
| Framework | Next.js 16.2.6 | App Router, API Routes |
| Database | PostgreSQL (Neon) | Primary data store |
| ORM | Prisma 7.8.0 | Database queries |
| Auth | Custom (placeholder) | Header-based auth |
| AI Model | Qwen (TBD) | Chat completion |
| Spreadsheet | SheetJS (xlsx) | Excel parsing |
| HTTP | fetch (Node.js) | Google Sheets export API |
| Runtime | Node.js | Server-side execution |

---

## 11. Current Status & TODOs

### ✅ Completed
- [x] API route endpoint (`/api/chat`)
- [x] Auth context (`getAuthenticatedUser`)
- [x] Chat service flow (`handleChatMessage`)
- [x] Spreadsheet tool integration (`querySpreadsheet`)
- [x] Types & interfaces defined
- [x] Google Sheets URL parsing
- [x] xlsx export fetch & parsing
- [x] Max 200 rows truncation
- [x] Error handling & validation

### ⚠️ TODO (MVP)
- [ ] Implement JSON response parsing di `parseQwenResponse`
- [ ] Connect Qwen server (Ollama / vLLM / custom)
- [ ] Proper auth mechanism (JWT/session)
- [ ] Source selection logic (jika user punya >1 spreadsheet)
- [ ] Caching layer (optional)
- [ ] Filtering berdasarkan `query` parameter (optional)

### 🚫 Future Enhancements
- [ ] Multi-turn conversation support
- [ ] Streaming response
- [ ] Tool calling dengan multiple tools
- [ ] Retrieval/embedding untuk large spreadsheets
- [ ] Natural language to SQL (untuk structured queries)
- [ ] Chart generation dari spreadsheet data

---

## 12. Testing Guidelines

### Manual Testing
1. **Start dev server:** `npm run dev`
2. **Test direct question:**
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H "x-user-email: test@example.com" \
     -H "Content-Type: application/json" \
     -d '{"message": "Apa itu IKU?"}'
   ```
3. **Test missing auth:**
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "test"}'
   # Expected: 401 Unauthorized
   ```
4. **Test inactive user:**
   - Update `app_users SET is_active = false WHERE email = '...'`
   - Retry request
   - Expected: 403 Forbidden
5. **Test spreadsheet tool:**
   - Insert record ke `data_source_connections`
   - Request question yang butuh data
   - Check response berisi data spreadsheet

### Expected Test Scenarios
- [ ] Auth validation (empty header, invalid email, inactive user)
- [ ] Empty/missing message validation
- [ ] Direct answer (no spreadsheet needed)
- [ ] Spreadsheet data retrieval (mocked)
- [ ] Follow-up response dengan spreadsheet data
- [ ] Error handling (invalid sheet URL, network error, no sources)

---

## 13. Database Migration Notes

### Tables Required
- `app_users` (sudah ada, no changes needed)
- `data_source_connections` (sudah ada, no changes needed)

### No New Migrations Needed
Chatbot feature hanya menggunakan table yang sudah ada:
- `app_users` → authentication & user lookup
- `data_source_connections` → user's linked spreadsheets

---

## 14. Deployment Checklist

- [ ] Qwen server endpoint sudah running (Ollama / vLLM / custom)
- [ ] `qwen-client.ts` diupdate dengan implementasi HTTP asli
- [ ] Auth mechanism proper (JWT/session cookie)
- [ ] Database connections ready (Neon PostgreSQL)
- [ ] Google Sheets URL valid untuk test data
- [ ] CORS/origin validation (jika Qwen server remote)
- [ ] Rate limiting (jika diperlukan)
- [ ] Logging & monitoring (console.error sudah ada)
- [ ] Environment variables configured:
  - `QWEN_SERVER_URL` (atau sesuai implementation)
  - `DATABASE_URL`
  - `JWT_SECRET` (jika pakai JWT auth)

---

## 15. Troubleshooting

### Issue: Stub response selalu muncul
**Solution:** Ganti `qwenClient` di `qwen-client.ts` dengan `HttpQwenClient`

### Issue: 401 Unauthorized padahal user ada
**Solution:** 
- Check header `x-user-email` terkirim dengan benar
- Check email di database (case-sensitive? trailing whitespace?)
- Check `isActive = true`

### Issue: Spreadsheet tool returns no_source
**Solution:**
- Check `data_source_connections` ada record untuk `userEmail`
- Check URL format Google Sheets valid

### Issue: Network error saat fetch Google Sheets
**Solution:**
- Check internet connection
- Check spreadsheet share settings (public atau dengan link)
- Verify URL → export format (`/export?format=xlsx&gid=...`)

---

## 16. Contact & Maintenance

**Maintainer:** AI Engineer / Backend Developer  
**Last Updated:** October 2026  
**Project:** Dikti Indicator (Next.js 16 + PostgreSQL)  

---

*Doc generated based on actual codebase: `src/lib/chat/`*
