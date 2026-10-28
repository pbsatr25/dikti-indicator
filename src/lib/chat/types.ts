// Shared types untuk fitur chat.
// File ini dipakai bersama oleh route.ts, chat-service-rag.ts,
// rag-client.ts, auth-context.ts, dan spreadsheet-tool.ts.

export type AuthContext = {
  email: string;
};

/**
 * Data spreadsheet yang sudah di-parse di sisi client (browser).
 * Dikirim bersamaan dengan chat request agar server tidak perlu
 * fetch ulang ke Google Sheets (menghindari EAI_AGAIN di Node.js).
 *
 * Field ini opsional — jika tidak dikirim, server akan fallback ke
 * fetch server-side (dengan dns.setDefaultResultOrder('ipv4first')).
 */
export type ClientSpreadsheetData = {
  rows: Record<string, unknown>[];
  columns: string[];
  /** Nama/ID sumber data, untuk logging & ToolResult.source */
  sourceName?: string;
  sourceId?: string;
};

export type AuthResult =
  | { status: "ok"; user: AuthContext }
  | { status: "unauthenticated" }
  | { status: "inactive" };

export type QwenMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ===== Tool Request & Result Types =====

// Valid indicators berdasarkan dashboard-config.ts
export type IndicatorCode = "IKU 001" | "IKU 002" | "IKU 003" | "IKU 005" | "IKU 007" | "IKU 009";

// Valid aggregation methods
export type AggregationMethod = "none" | "sum" | "count" | "avg";

// Map indicator ke canonical keys (kolom valid per indicator)
export const indicatorValidColumns: Record<IndicatorCode, string[]> = {
  "IKU 001": ["total_lecturers", "year", "faculty", "study_program", "degree"],
  "IKU 002": ["year", "faculty", "study_program", "degree"],
  "IKU 003": ["iku_017", "iku_018", "coaching_achievement", "iku_total", "iku_percentage", "year", "faculty", "study_program", "degree"],
  "IKU 005": ["total_lecturers", "iku_017", "iku_018", "coaching_achievement", "iku_total", "iku_percentage", "year", "faculty", "study_program", "degree"],
  "IKU 007": ["total_lecturers", "iku_017", "iku_018", "coaching_achievement", "iku_total", "iku_percentage", "year", "faculty", "study_program", "degree"],
  "IKU 009": ["total_lecturers", "iku_017", "iku_018", "coaching_achievement", "iku_total", "iku_percentage", "year", "faculty", "study_program", "degree"],
};

// ToolRequest dari LLM untuk fetch data
export type ToolRequest =
  | {
      action: "fetch_data";
      indicator: IndicatorCode;
      year?: string | null;
      faculty?: string | null;
      degree?: string | null;
      aggregation?: AggregationMethod;
      column?: string | null;
    };

// ToolResult dari eksekusi data layer
export type ToolResult =
  | {
      status: "ok";
      source: { id: string; name: string };
      indicator: IndicatorCode;
      filters: { year?: string; faculty?: string; degree?: string };
      aggregation?: AggregationMethod;
      matchedRows: number;
      totalRows: number;
      truncated: boolean;
      summary?: {
        totalStudyProgram: number;
        totalFaculty: number;
        totalLecturers: number;
        totalIkuQualified: number;
        avgIkuPercentage: number;
        totalPartners: number;
      };
      data?: {
        rows: Record<string, unknown>[];
      } | {
        value: number;
        column: string;
      };
    }
  | {
      status: "no_source";
      message: string;
    }
  | {
      status: "no_match";
      message: string;
      availableFilters: {
        years?: string[];
        faculties?: string[];
        degrees?: string[];
      };
    }
  | {
      status: "error";
      message: string;
    };

// Parsed response dari LLM
export type ParsedQwenResponse =
  | { type: "answer"; content: string }
  | { type: "tool_request"; request: ToolRequest };

// ===== ChatAnswer type (dari RAG service) =====
export type ChatAnswer = {
  answer: string;
  citations: Array<{
    id: string;
    documentTitle: string;
    documentVersion?: string;
    section?: string;
    page?: number;
    ikuCode?: string;
    snippet?: string;
  }>;
  /**
   * Blok tambahan dari RAG (rumus, catatan, metrik) untuk ditampilkan
   * secara terstruktur di FE. Dikirim oleh FastAPI, diteruskan ke client.
   */
  blocks?: Array<{ type: "formula" | "note" | "metric"; lines?: string[] }>;
  grounded: boolean;
  outOfScope: { suggestedTab?: string } | null;
  action: { type: string; payload?: unknown } | null;
};

// Error types untuk LLM client
export class LlmTimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM request timed out");
    this.name = "LlmTimeoutError";
  }
}

export class LlmUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM service unavailable");
    this.name = "LlmUnavailableError";
  }
}

export class LlmBadResponseError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM returned invalid response");
    this.name = "LlmBadResponseError";
  }
}
