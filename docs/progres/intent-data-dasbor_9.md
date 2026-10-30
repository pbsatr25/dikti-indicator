# Deteksi Intent Data Dasbor di Layanan RAG — Perubahan #9

**Tanggal:** 28 Oktober 2026
**Peran:** AI Engineer (repo `iku-rag-chatbot`, tanpa perubahan FE/BE)

## 1. Analisis

**Gejala.** Di halaman IKU 001, pertanyaan "rangkumkan analisis fakultas IKU001 saya" dijawab "tidak ditemukan dalam dokumen IKU", disertai peringatan "Konteks tidak ditemukan". Data dasbor sebenarnya tersedia dan FE sudah mengirim `clientData`.

**Penyebab.** Data spreadsheet hanya dipakai jika `detect_intent()` (`src/api/app.py`) mengembalikan `"data"`. Fungsi itu hanya mencocokkan pola teks dan tidak melihat halaman yang dibuka:

- `iku\s+\d+` mewajibkan spasi, sehingga "IKU001" tidak dikenali;
- kata khas dasbor (fakultas, prodi, analisis, rangkum, terendah, ranking, "kami") tidak ada di daftar pola.

Akibatnya pertanyaan masuk jalur dokumen, sementara Buku IKU tidak memuat data kampus.

## 2. Implementasi

| File | Status | Isi |
|---|---|---|
| `src/generation/intent.py` | baru | `deteksi_intent(pertanyaan, cakupan)` + `normalisasi()`; modul murni |
| `src/api/app.py` | diubah | `detect_intent(q, cakupan)` jadi pembungkus `deteksi_intent` (nama tetap, agar `test_intent_baseline.py` jalan) |
| `src/generation/cakupan.py` | diperbaiki | `KODE_IKU_RE`: "IKU 9 dihitung" tidak lagi terbaca sub-indikator "9d" |
| `tests/intent_cases.json` | diubah | +11 kasus `PAGE-*` dengan field opsional `scope` |
| `tests/test_intent.py` | baru | pytest seluruh dataset + kasus konteks halaman + normalisasi |
| `CHANGELOG.md` | diubah | catatan perubahan |

Aturan berurutan (yang pertama cocok menang):

1. **Sinyal data kuat → `data`:** kepemilikan ("IKU 1 saya", "PT kami", "capaian kita"; bukan "saya ingin tahu rumus …"), peringkat (tertinggi/terendah/paling …/ranking), "data" + IKU/tahun, atau tahun + IKU/capaian.
2. Rumus/cara hitung/bobot → `formula`.
3. Definisi/kriteria/ketentuan → `definisi`.
4. **Halaman IKU:** capaian/realisasi, fakultas/prodi, atau analisis/rangkuman → `data`. "Berapa" dan "mahasiswa" sengaja tidak dipakai, karena "Berapa SKS minimal agar diakui?" adalah pertanyaan dokumen.
5. Tanpa halaman IKU: fakultas/prodi + kata tanya angka/analisis → `data`; "berapa capaian IKU N" tanpa data pengguna → `formula`.
6. Selain itu → `definisi`.

Overview sengaja tidak memakai aturan 4: data Overview bersifat lintas IKU, sedangkan `fetch_data` di BE saat ini mengambil satu IKU (default IKU 001).

## 3. Validasi

| Cek | Lama | Baru |
|---|---|---|
| Dataset tim (48 kasus) | 39/48 | **48/48** |
| Kasus halaman baru (11 kasus) | 6/11 | **11/11** |
| `pytest` seluruh repo RAG (tanpa 2 file yang butuh `openai`/`chromadb`) | 264 | **331 lulus** |
| `python -m compileall src tests` | – | OK |

End-to-end dengan model + Groq belum diuji. Skenario manual di halaman IKU 001:
- "rangkumkan analisis fakultas IKU001 saya" → log FastAPI menunjukkan `fetch_data`, lalu panggilan kedua membawa `spreadsheet_context`;
- "Bagaimana rumus IKU 1?" → tetap jawaban dokumen + kartu Formula.

## 4. Temuan & lanjutan

- **Bug yang sama di retriever (belum diubah).** `IKU_IN_QUESTION_RE` di `src/retrieval/retriever.py` membaca "IKU 1 **a**pa itu?" sebagai IKU "1a" dan "IKU 3 **b**agaimana" sebagai "3b", sehingga boost IKU di retrieval tidak mengenai chunk yang benar. Perbaikannya sama (`[a-d](?![a-z])`), tetapi dapat menggeser angka Hit@k, jadi perlu `eval_retrieval.py` + `run_answer_tests.py` ulang dengan model.
- **Angka jawaban vs layar (poin 3, perlu kesepakatan FE/BE).** Jalur data mengirim baris mentah (maks. 100) dan RAG menghitung ulang di Python; hasilnya belum tentu sama dengan "Analisis Fakultas" di dasbor (`data-helpers.ts`). Usulan PRD: FE mengirim ringkasan hasil hitungan dasbor.
- **BE:** di Overview, `indicator` jatuh ke default IKU 001 bila pertanyaan tidak menyebut IKU.
