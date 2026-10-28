// Satu-satunya pintu akses API Asisten IKU dari sisi klien.
// Mode mock aktif selama NEXT_PUBLIC_CHAT_MOCK !== "false".

import { toAnswerBlocks } from "@/lib/chat-blocks";
import {
  CHAT_DISCLAIMER,
  MOCK_ERROR_KEYWORD,
  pickMockAnswer,
} from "@/lib/chat-mock";
import { useDashboardStore } from "@/store/dashboard-store";
import type { AnswerAction, ChatAnswer, ChatRequest, Citation } from "@/types/chat";
import type { RawRow } from "@/types/data";

const USE_MOCK = process.env.NEXT_PUBLIC_CHAT_MOCK !== "false";

const SESSION_KEY = "iku-user-session";
const MAX_QUESTION_LENGTH = 2000;
/** Server memanggil RAG hingga 2 kali (intent + jawaban dengan data), jadi batasnya longgar. */
const REQUEST_TIMEOUT_MS = 90_000;
/** Setelah jeda ini, teks progres berganti ke tahap penyusunan jawaban. */
const SLOW_STATUS_DELAY_MS = 6_000;
/** Di atas batas ini data tidak dikirim; server mengambil sendiri dari koneksi tab. */
const MAX_CLIENT_ROWS = 5_000;

export type SendOptions = {
  signal?: AbortSignal;
  /** Progres retrieval, mis. "Mencari di Buku IKU…". */
  onStatus?: (text: string) => void;
  /** Potongan teks jawaban (streaming). */
  onToken?: (chunk: string) => void;
};

export class ChatClientError extends Error {}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

async function sendQuestionMock(req: ChatRequest, { signal, onStatus, onToken }: SendOptions): Promise<ChatAnswer> {
  const mock = pickMockAnswer(req.question, req.scope);
  onStatus?.(mock.statusText);
  await wait(1200, signal);

  if (req.question.toLowerCase().includes(MOCK_ERROR_KEYWORD)) {
    throw new ChatClientError("Layanan Asisten IKU sedang tidak dapat dihubungi. Coba lagi beberapa saat.");
  }

  for (const word of mock.answer.split(/(\s+)/)) {
    await wait(25, signal);
    onToken?.(word);
  }

  return {
    conversationId: req.conversationId ?? `conv-${Date.now()}`,
    messageId: `msg-${Date.now()}`,
    answer: mock.answer,
    blocks: mock.blocks,
    citations: mock.citations,
    grounded: mock.grounded,
    confidence: mock.confidence,
    action: mock.action,
    outOfScope: mock.outOfScope,
    disclaimer: CHAT_DISCLAIMER,
  };
}

// ------------------------------------------------------------
// Kontrak BE saat ini (src/app/api/chat/route.ts). Bentuknya berbeda dari
// ChatRequest/ChatAnswer, jadi dipetakan di sini agar komponen tidak berubah.
// ------------------------------------------------------------

type ApiChatBody = {
  message: string;
  scope: { kind: "overview" | "iku"; ikuCode?: string };
  clientData?: { rows: RawRow[]; columns: string[]; sourceName?: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

/** Email dari sesi login lokal. Dipakai BE sebagai header `x-user-email` (AUTH NOT READY: belum sesi server). */
function readSessionEmail() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    return optionalString((JSON.parse(raw) as { email?: unknown }).email);
  } catch {
    return undefined;
  }
}

/**
 * Data spreadsheet yang sedang tampil di dasbor, agar angka jawaban sama dengan angka di layar.
 * Hanya untuk cakupan IKU dan hanya jika data sudah selesai dimuat. Di Overview data aktif
 * bisa milik IKU lain, jadi tidak dikirim dan server mengambil dari koneksi tab IKU yang sesuai.
 */
function readClientData(scope: ChatRequest["scope"]): ApiChatBody["clientData"] {
  if (scope.kind !== "iku") return undefined;
  const { rows, columns, parseStatus, activeDashboardTab, activeFileName } = useDashboardStore.getState();
  if (parseStatus !== "success" || activeDashboardTab !== scope.ikuCode) return undefined;
  if (rows.length === 0 || rows.length > MAX_CLIENT_ROWS) return undefined;
  return { rows, columns, sourceName: optionalString(activeFileName) };
}

function toCitation(value: unknown, index: number): Citation | undefined {
  if (!isRecord(value) || typeof value.documentTitle !== "string") return undefined;
  return {
    id: optionalString(value.id) ?? `citation-${index}`,
    documentTitle: value.documentTitle,
    documentVersion: optionalString(value.documentVersion) ?? "-",
    section: optionalString(value.section),
    page: typeof value.page === "number" ? value.page : undefined,
    ikuCode: optionalString(value.ikuCode),
    snippet: optionalString(value.snippet) ?? "",
  };
}

/** BE mengirim `{ type, payload }`; UI hanya bisa memakai aksi yang membawa label dan tab tujuan. */
function toAction(value: unknown): AnswerAction | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.payload) ? value.payload : value;
  const label = optionalString(source.label);
  const dashboardTab = optionalString(source.dashboardTab);
  return label && dashboardTab ? { label, dashboardTab } : undefined;
}

function toChatAnswer(data: unknown, req: ChatRequest): ChatAnswer {
  if (!isRecord(data) || typeof data.answer !== "string") {
    throw new ChatClientError("Jawaban dari server tidak dapat dibaca. Coba lagi beberapa saat.");
  }

  const citations = Array.isArray(data.citations)
    ? data.citations.map(toCitation).filter((c): c is Citation => Boolean(c))
    : [];
  const uniqueCitations = citations.filter((c, i) => citations.findIndex((other) => other.id === c.id) === i);

  return {
    conversationId: req.conversationId ?? createId("conv"),
    messageId: createId("msg"),
    answer: data.answer,
    blocks: toAnswerBlocks(data.blocks),
    citations: uniqueCitations,
    grounded: data.grounded !== false,
    action: toAction(data.action),
    outOfScope: isRecord(data.outOfScope)
      ? { suggestedTab: optionalString(data.outOfScope.suggestedTab) }
      : undefined,
    // FR-14: disclaimer ditambahkan kode, tidak bergantung pada server/LLM.
    disclaimer: CHAT_DISCLAIMER,
  };
}

async function readError(response: Response) {
  let serverMessage: string | undefined;
  try {
    serverMessage = optionalString(((await response.json()) as { error?: unknown }).error);
  } catch {
    // Body bukan JSON (mis. halaman error proxy).
  }

  if (response.status === 401) {
    return "Sesi Anda tidak dikenali server. Silakan keluar lalu masuk kembali.";
  }
  if (response.status === 504) {
    return "Asisten IKU terlalu lama merespons. Coba lagi atau sederhanakan pertanyaan.";
  }
  if (response.status >= 500) {
    return "Asisten IKU sedang tidak dapat memproses pertanyaan. Coba lagi beberapa saat.";
  }
  return serverMessage ?? "Gagal memproses pertanyaan.";
}

// DATA: POST /api/chat (JSON, belum streaming).
async function sendQuestionApi(req: ChatRequest, { signal, onStatus, onToken }: SendOptions): Promise<ChatAnswer> {
  const message = req.question.trim();
  if (!message) throw new ChatClientError("Pertanyaan tidak boleh kosong.");
  if (message.length > MAX_QUESTION_LENGTH) {
    throw new ChatClientError(`Pertanyaan terlalu panjang. Maksimal ${MAX_QUESTION_LENGTH} karakter.`);
  }

  const email = readSessionEmail();
  if (!email) throw new ChatClientError("Sesi login tidak ditemukan. Silakan masuk kembali.");

  const body: ApiChatBody = {
    message,
    scope: { kind: req.scope.kind, ikuCode: req.scope.ikuCode },
    clientData: readClientData(req.scope),
  };

  // Gabungkan tombol Stop (signal) dengan batas waktu agar permintaan tidak menggantung.
  const controller = new AbortController();
  let timedOut = false;
  const abortFromUser = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  signal?.addEventListener("abort", abortFromUser, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  onStatus?.("Mencari di Buku IKU…");
  const slowStatus = setTimeout(() => onStatus?.("Menyusun jawaban…"), SLOW_STATUS_DELAY_MS);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-email": email },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new ChatClientError(await readError(response));

    const answer = toChatAnswer(await response.json().catch(() => undefined), req);
    onToken?.(answer.answer);
    return answer;
  } catch (error) {
    if (timedOut) {
      throw new ChatClientError("Asisten IKU terlalu lama merespons. Coba lagi atau sederhanakan pertanyaan.");
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ChatClientError) throw error;
    throw new ChatClientError("Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.");
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowStatus);
    signal?.removeEventListener("abort", abortFromUser);
  }
}

export function sendQuestion(req: ChatRequest, options: SendOptions = {}) {
  return USE_MOCK ? sendQuestionMock(req, options) : sendQuestionApi(req, options);
}
