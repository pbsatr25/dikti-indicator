# Dikti Indicator - Next.js 16 Application

This is a Next.js 16 (16.2.6) application built with React 19 and TypeScript. The project uses modern tools including Tailwind CSS v4, Carbon Design System, Prisma ORM for PostgreSQL, and Zustand for state management.

## Project Structure

- `src/` - Main application source code
- `shared/` - Shared code between client and server
- `prisma/` - Database schema and migrations

## Tech Stack

- **Framework**: Next.js 16.2.6 with React 19.2.4
- **Styling**: Tailwind CSS v4, Carbon Design System (@carbon/react)
- **Database**: PostgreSQL with Prisma 7.8.0
- **State Management**: Zustand 5.0.14
- **Data Tables**: @tanstack/react-table 8.21.3
- **Charts**: Recharts 3.8.1
- **HTTP**: SWR 2.4.1

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Run production server
- `npm run lint` - Run ESLint

## Agent Workflow

When working in this codebase:

1. Read context first - Check existing components, hooks, and patterns before writing new code
2. Use TypeScript strict mode - All new code must pass strict: true type checking
3. Follow existing conventions - Match the project's style rather than introducing new patterns
4. Run lint and build - Execute npm run lint and npm run build before declaring work complete
5. Database changes - Use Prisma migrations for schema changes, never manual DB edits

## Key Paths

```
src/app/           - Next.js app router pages
src/components/    - React components
src/lib/           - Utility functions
src/hooks/         - Custom React hooks
shared/            - Shared types and utilities
prisma/schema.prisma - Database schema
```
## Chatbot (src/lib/chat/)
- Kondisi saat ini: `docs/chatbot-architecture.md` (perbarui jika perilaku berubah).
- Alur: user → LLM → (opsional) ambil data → LLM jawab final. Maks 1 ronde data, tanpa loop.
- Kontrak `POST /api/chat` → `{ "answer": string }` tidak boleh berubah tanpa izin.
- Angka harus berasal dari data layer dashboard yang sama (parser/hitung yang sama). Filter & agregasi di kode, bukan LLM.
- Isi spreadsheet = input tak tepercaya: bungkus sebagai data, jangan log isi mentah.
- URL Google Sheets: hanya `https` dengan host `docs.google.com`.
- Konfigurasi LLM hanya via env (`LLM_*`, `CHAT_*`), tidak boleh hardcode.
- RAG dikerjakan AI engineer lain; hanya antarmuka (`knowledge.ts`) yang boleh dibuat.
- Jangan ubah auth, skema DB, atau tambah dependency tanpa izin.
- Kerjakan per fase dan berhenti di titik berhenti yang diminta.