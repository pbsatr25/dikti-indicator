# Integrasi API Chat (BE PR #1) — Perubahan #7

**Tanggal:** 27 Oktober 2026
**Peran:** FE (tanpa mengubah kode BE)

## Ringkasan

Backend chat dari PR #1 (`db11e48`: `src/app/api/chat/route.ts` + `src/lib/chat/*`) sudah masuk. Kontraknya berbeda dari `src/types/chat.ts`, jadi `src/lib/chat-client.ts` kini berisi **adapter**: request FE dipetakan ke bentuk BE, respons BE dinormalkan menjadi `ChatAnswer`. Komponen, `chat-store`, dan tipe kontrak **tidak berubah**. Mode mock tetap default sampai env RAG tersedia.

## Perubahan

| File | Perubahan |
|---|---|
| `src/lib/chat-client.ts` | adapter request/response, header `x-user-email`, `clientData`, timeout, pesan error per status, validasi respons |
| `docs/api-requests/asisten-iku-chat.md` | bagian 0: kontrak aktual BE, revisi untuk BE (B1–B13) dan AI Engineer (A1–A8), env yang belum ada |

## Praktik fetching yang diterapkan

1. **Satu pintu akses.** Semua `fetch` ke `/api/chat` hanya di `chat-client.ts`; flag `NEXT_PUBLIC_CHAT_MOCK` memilih mock/API tanpa komponen tahu.
2. **Validasi sebelum kirim.** Pertanyaan kosong atau > 2.000 karakter ditolak di klien. Sesi tanpa email tidak mengirim request.
3. **Data yang sama dengan layar (FR-18).** `clientData` diambil dari `dashboard-store`, hanya bila:
   - cakupan = IKU dan tab dasbor aktif = IKU itu,
   - `parseStatus === "success"` (tidak mengirim data lama saat tab sedang berganti),
   - jumlah baris 1–5.000 (tidak dipotong, karena potongan membuat KPI salah).
   Di luar syarat itu field tidak dikirim dan server mengambil dari koneksi tab yang benar.
4. **Batas waktu + Stop.** `AbortController` internal menggabungkan sinyal Stop pengguna dan timeout 90 detik (server memanggil RAG hingga 2 kali). Timeout dibedakan dari Stop agar pesannya tepat.
5. **Tanpa retry otomatis.** POST ke LLM mahal dan tidak idempoten; pengguna memakai tombol "Coba lagi" yang sudah ada.
6. **Pesan error yang bisa ditindaklanjuti.** 401 → masuk kembali; 400/403 → pesan server; 5xx, body non-JSON → pesan umum; gagal jaringan → periksa koneksi. Detail teknis tidak ditampilkan.
7. **Respons tidak dipercaya mentah.** Bentuk dicek tanpa dependency baru: `answer` wajib string, sitasi tak lengkap diberi default, `id` duplikat dibuang, `action` yang tidak bisa dipakai UI dibuang, `null` → `undefined`.
8. **Disclaimer dari kode (FR-14)**, bukan dari server/LLM.
9. **Progres yang jujur.** Status "Mencari di Buku IKU…" lalu "Menyusun jawaban…" setelah 6 detik; tidak mengklaim tahap yang tidak diketahui klien.

## Belum dikerjakan (menunggu pihak lain)

- `NEXT_PUBLIC_CHAT_MOCK` **belum** diubah ke `false`: `RAG_SERVICE_URL` dan `RAG_SERVICE_TOKEN` belum ada di `.env.local`, sehingga API asli pasti `500`.
- Streaming SSE: BE masih JSON. Adapter sudah memanggil `onToken` sekali dengan jawaban penuh.
- `blocks`/`confidence`: tidak dikirim BE (lihat B6, A2, A6).

## Verifikasi

- `npx eslint src/lib/chat-client.ts src/lib/chat src/app/api/chat`: 0 masalah.
- `npx tsc --noEmit`: 1 error, **di kode BE** `src/lib/chat/chat-service-rag.ts:85` (B1). Tidak ada error dari file FE.
- `npm run build`: **gagal di tahap type check karena B1** (sudah ada sejak merge PR #1, bukan dari perubahan ini). Kompilasi Turbopack sendiri sukses.

### Skenario uji manual (setelah B1 diperbaiki dan env RAG terisi, `NEXT_PUBLIC_CHAT_MOCK=false`)

| Skenario | Harapan |
|---|---|
| Tanya definisi di halaman IKU 001 | jawaban + sitasi + disclaimer; request tanpa/dengan `clientData` sesuai syarat |
| Tanya data di IKU 001 setelah data tampil | request berisi `clientData` (cek Network) |
| Tanya data di Overview | request tanpa `clientData` |
| Mode demo dengan email demo yang tidak ada di DB | pesan "Sesi Anda tidak dikenali server…" |
| Matikan layanan RAG | pesan umum 5xx + tombol "Coba lagi" |
| Klik Stop saat menunggu | "Permintaan dihentikan." |
| Layanan RAG menggantung > 90 detik | "Asisten IKU terlalu lama merespons…" |
