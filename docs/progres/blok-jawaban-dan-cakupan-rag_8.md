# Blok Jawaban RAG & Cakupan per Halaman di Layanan RAG — Perubahan #8

**Tanggal:** 28 Oktober 2026
**Peran:** FE (poin 4) + AI Engineer (poin 5)
**Dasar:** review integrasi chat (timeout 30 detik, blok jawaban tidak tampil, cakupan belum ditegakkan). Poin 1–3 (timeout 85 detik, `504`, `def answer`) sudah dikerjakan BE di PR #3 dan `iku-rag-chatbot@cbaa79d`.

## 1. Analisis

| Kebutuhan | Kondisi sebelum | Sumber aturan |
|---|---|---|
| Blok jawaban tampil (formula, catatan, hasil kalkulator) | RAG mengirim `{ type, lines }`, FE mengharapkan `AnswerBlock`; `toChatAnswer` tidak memetakan `blocks`, jadi tidak ada blok yang dirender | `src/types/chat.ts`, `docs/api-requests/asisten-iku-chat.md` A2 |
| RAG-01 `scope` divalidasi | `scope` diterima tapi diabaikan | PRD Asisten IKU, "Aturan cakupan per halaman" |
| RAG-02 retrieval difilter cakupan | retrieval selalu ke seluruh dokumen | PRD Asisten IKU, RAG-02 |
| RAG-03 pertanyaan di luar cakupan → `outOfScope` tanpa jawaban substantif | `outOfScope` selalu `null`; di halaman IKU 009, soal AEE tetap dijawab | PRD Asisten IKU, RAG-03 |

**Best practice yang dipakai**

- **Validasi di batas jaringan.** Respons server diperlakukan sebagai `unknown` dan divalidasi per blok dengan type guard. `zod` tidak dipakai karena menambah paket butuh persetujuan tim. Blok rusak atau tidak dikenal dibuang, sehingga UI tidak crash dan komponen tidak berubah.
- **Adapter toleran dua bentuk.** Kontrak FE diterima apa adanya, bentuk RAG saat ini dipetakan. RAG bisa beralih ke bentuk `AnswerBlock` kapan saja tanpa perubahan FE.
- **Cakupan berlapis** (PRD, "Guardrail"):
  1. Gerbang aturan deterministik sebelum LLM: hemat kuota Groq dan tidak bisa ditembus prompt injection.
  2. Filter retrieval berdasarkan metadata `iku_id`.
  3. Instruksi cakupan eksplisit di system prompt.
- **Logika murni yang bisa diuji tanpa GPU/LLM** (`cakupan.py`, `chat-blocks.ts`), dengan skenario dari PRD dan demo mock FE.
- **Kompatibel mundur.** Tanpa `scope`, RAG berperilaku seperti sebelumnya, sehingga CLI dan evaluasi 44 soal tetap sebanding.

## 2. Implementasi

### FE — `dikti-indicator`

| File | Status | Isi |
|---|---|---|
| `src/lib/chat-blocks.ts` | baru | `toAnswerBlocks(unknown)`: validasi & pemetaan blok |
| `src/lib/chat-client.ts` | diubah | `toChatAnswer` meneruskan `blocks: toAnswerBlocks(data.blocks)`; status `504` dari BE (PR #3) ditampilkan sebagai "terlalu lama merespons" |
| `docs/api-requests/asisten-iku-chat.md` | diubah | penanganan `blocks`, status B3/B6/A2, butir A9 |

Pemetaan bentuk RAG:

| RAG (`extract_blocks`) | UI |
|---|---|
| `formula.lines[]` | kartu Formula |
| `note.lines[]` | satu catatan per baris |
| `metric.lines[]`, mis. `"Capaian Agregat Kampus (2025): 86.36%"` | tabel **Rincian / Hasil**. Kartu capaian butuh `value` & `target` berangka, yang tidak tersedia di bentuk teks |
| `text`, `note.text`, `metric{label,value,target}`, `table`, `list` | diteruskan apa adanya (setelah divalidasi) |

### AI Engineer — `iku-rag-chatbot` (branch `feat/cakupan-halaman`, sudah di-merge ke `main` di `b2bfd61`)

| File | Status | Isi |
|---|---|---|
| `src/generation/cakupan.py` | baru | `baca_cakupan`, `periksa_cakupan`, `pesan_di_luar_cakupan`, `chunk_boleh`, `instruksi_cakupan` |
| `src/api/app.py` | diubah | `scope` tidak dikenal → `400`; gerbang `outOfScope` sebelum deteksi intent & LLM; cakupan diteruskan ke `ask` / `ask_with_spreadsheet` |
| `src/retrieval/retriever.py` | diubah | `search(question, boleh=None, iku_cakupan=None)`: kandidat ×4 saat difilter, peringkat dense terfilter `iku_id`, pasca-filter sebelum top-k |
| `src/generation/answer.py` | diubah | `_cari()` dan `_system_prompt()` memakai cakupan di kedua jalur jawaban |
| `tests/test_cakupan.py` | baru | 42 unit test |
| `docs/02-desain/integrasi_backend.md`, `CHANGELOG.md` | diubah | status cakupan, sumber `outOfScope`, keputusan sementara |

Aturan gerbang (`periksa_cakupan`):

| Halaman | Pertanyaan | `suggestedTab` |
|---|---|---|
| IKU 00x | menyebut IKU lain yang punya halaman | IKU tersebut |
| IKU 00x | menyebut IKU tanpa halaman (4, 6, 8, 10–12, LLDIKTI) | Overview |
| IKU 00x | membandingkan IKU halaman ini dengan IKU lain | Overview |
| IKU 00x | konsep umum (IKU wajib/pilihan/partisipatif, semua/daftar/lintas IKU) | Overview |
| IKU 00x | topik khas IKU lain tanpa kode (AEE, tracer study, MBKM, kerja sama/start-up, SDGs, pendapatan/UKT), kecuali topik IKU halaman ini juga muncul | IKU tersebut |
| Overview | rincian **satu** IKU yang punya halaman (kode atau topik) | IKU tersebut |
| Overview | konsep umum, perbandingan beberapa IKU, IKU tanpa halaman | – (dijawab) |

Daftar topik sengaja konservatif. Kata yang dipakai beberapa IKU (mis. "industri", juga dipakai magang IKU 3, dan "lulusan" polos, dekat dengan AEE IKU 1) tidak dipakai agar tidak salah tolak.

Filter retrieval (`chunk_boleh`): halaman IKU hanya memakai chunk `iku_id` IKU itu (termasuk sub-indikator), sedangkan Overview memakai chunk umum dan IKU tanpa halaman dasbor.

Env baru: tidak ada.

## 3. Validasi

| Cek | Hasil |
|---|---|
| `pytest tests/test_cakupan.py` | 42 lulus |
| `pytest` seluruh repo RAG | 264 lulus; `tests/test_intent_baseline.py` dan `src/retrieval/test_retrieval.py` dikecualikan karena butuh `openai`/`chromadb` (sudah gagal di `main` sebelum perubahan) |
| `python -m compileall src tests` (cek CI) | OK |
| Skrip fixture `toAnswerBlocks` (Node 24) | OK: bentuk RAG nyata, bentuk FE, input rusak/tidak dikenal |
| `npx tsc --noEmit` | OK |
| ESLint `chat-blocks.ts`, `chat-client.ts` | 0 masalah; seluruh proyek tetap 67, sama dengan sebelum perubahan |
| `npm run build` (Turbopack) | OK |
| End-to-end dengan model + Groq | **belum diuji**: butuh venv RAG, vector DB, dan API key di laptop pengembang |

**Skenario uji manual** (dashboard + `uvicorn src.api.app:app`):

1. Overview: "Pendapatan apa saja yang tidak dihitung di IKU 9?" → info "Di luar cakupan" + tombol **Tanyakan di IKU 009** → jawaban muncul di thread IKU 009.
2. IKU 009: "Hitung capaian AEE PT kami" → diarahkan ke IKU 001, tanpa log panggilan LLM di terminal FastAPI.
3. IKU 001: "Bagaimana rumus IKU 1?" → jawaban + kartu Formula; sitasi hanya chunk IKU 1.
4. IKU 005: "Apa beda IKU wajib dan IKU pilihan?" → diarahkan ke Overview.
5. Pertanyaan data (mis. "Berapa capaian IKU 1 tahun 2025?" di IKU 001) → hasil kalkulator tampil sebagai tabel Rincian/Hasil.

## 4. Lanjutan

- **AI:** fallback semantik (deteksi langkah 3 PRD: skor dalam cakupan rendah, skor tanpa filter tinggi di IKU lain), `metric` berangka (`value`, `target`), `citations` dari metadata chunk (`section`, `snippet`; saat ini `ikuCode` berisi `"IKU 3, Formula"` hasil regex), evaluasi per cakupan (7 halaman) bersama QA.
- **BE:** di cakupan IKU, `indicator` = `scope.ikuCode` (B3, pertahanan berlapis).
- **PO:** keputusan chunk IKU tanpa halaman dasbor (`integrasi_backend.md` bagian 3 no. 4); sementara diterapkan opsi (b) Overview.
- **Tim RAG:** branch `feat/cakupan-halaman` dibuat dari `origin/feat/fastapi`, yang README-nya lebih lama dari `main`. Saat merge ke `main`, pertahankan README versi `main`.
