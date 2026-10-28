import type { ChatAnswer } from "./types";

const getEnvOrUndefined = (name: string): string | undefined => {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value.trim();
  }
  return undefined;
};

const getEnvOrThrow = (name: string): string => {
  const value = getEnvOrUndefined(name);
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
};

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
  debug?: {
    model?: string;
    chunkIds?: string[];
    warnings?: string[];
    llmCalls?: number;
    durationMs?: number;
  };
}

/** Timeout default untuk setiap panggilan ke RAG FastAPI (ms). */
const RAG_TIMEOUT_MS = 85_000;

export class RagClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(options: {
    baseUrl: string;
    serviceToken: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.serviceToken = options.serviceToken;
  }

  async answer(question: string, scope?: { kind?: string; ikuCode?: string }): Promise<ChatAnswer> {
    const payload: { question: string; scope?: { kind?: string; ikuCode?: string } } = {
      question,
      scope: scope ? { kind: scope.kind, ikuCode: scope.ikuCode } : undefined,
    };

    const response = await fetch(`${this.baseUrl}/v1/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.serviceToken,
      },
      body: JSON.stringify(payload),
      // Batalkan fetch otomatis setelah RAG_TIMEOUT_MS (85 detik) agar server tidak menggantung
      signal: AbortSignal.timeout(RAG_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`RAG service error: HTTP ${response.status}${errorBody ? `: ${errorBody}` : ""}`);
    }

    const data: RAGResponse = await response.json();

    return {
      answer: data.answer,
      citations: data.citations || [],
      blocks: data.blocks,
      grounded: data.grounded ?? true,
      outOfScope: data.outOfScope || null,
      action: data.action || null,
    };
  }

  /**
   * Second call: kirim pertanyaan + data spreadsheet dari Next.js ke RAG.
   * FastAPI akan langsung proses dengan LLM (skip intent detection).
   */
  async answerWithSpreadsheet(
    question: string,
    spreadsheetContext: string,
    scope?: { kind?: string; ikuCode?: string }
  ): Promise<ChatAnswer> {
    const payload = {
      question,
      spreadsheet_context: spreadsheetContext,
      scope: scope ? { kind: scope.kind, ikuCode: scope.ikuCode } : undefined,
    };

    const response = await fetch(`${this.baseUrl}/v1/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.serviceToken,
      },
      body: JSON.stringify(payload),
      // Timeout yang sama (85 detik) untuk call kedua yang membawa spreadsheet_context
      signal: AbortSignal.timeout(RAG_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`RAG service (2nd call) error: HTTP ${response.status}${errorBody ? `: ${errorBody}` : ""}`);
    }

    const data: RAGResponse = await response.json();

    return {
      answer: data.answer,
      citations: data.citations || [],
      blocks: data.blocks,
      grounded: data.grounded ?? true,
      outOfScope: data.outOfScope || null,
      action: data.action || null,
    };
  }
}


// Singleton instance (lazy — hanya diinisialisasi saat pertama dipakai)
let ragClientInstance: RagClient | null = null;

export function getRagClient(): RagClient {
  if (!ragClientInstance) {
    ragClientInstance = new RagClient({
      baseUrl: getEnvOrThrow("RAG_SERVICE_URL"),
      serviceToken: getEnvOrThrow("RAG_SERVICE_TOKEN"),
    });
  }
  return ragClientInstance;
}
