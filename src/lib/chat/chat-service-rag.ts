import { executeTool } from "@/lib/chat/spreadsheet-tool";
import type {
  AuthContext,
  ClientSpreadsheetData,
  ToolResult,
  ChatAnswer,
} from "@/lib/chat/types";
import { getRagClient } from "@/lib/chat/rag-client";



/**
 * Handle chat menggunakan RAG service (IKU Chatbot).
 *
 * @param clientData - Data spreadsheet yang sudah di-parse di browser (opsional).
 *   Jika dikirim, server tidak perlu fetch ke Google Sheets (menghindari EAI_AGAIN).
 *   Jika tidak dikirim, server fallback ke fetch server-side.
 */
export async function handleChatMessage(
  user: AuthContext,
  message: string,
  scope?: { kind?: string; ikuCode?: string },
  clientData?: ClientSpreadsheetData
): Promise<ChatAnswer> {
  const MAX_MESSAGE_LENGTH = 2000;
  const trimmedMessage = message.trim();
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return {
      answer: "Pertanyaan terlalu panjang. Mohon singkatkan (max 2000 karakter).",
      citations: [],
      grounded: true,
      outOfScope: null,
      action: null,
    };
  }

  // 1. RAG retrieval (selalu dilakukan untuk get intent + chunks)
  const ragClient = getRagClient();
  const ragResponse = await ragClient.answer(trimmedMessage, scope);

  // 2. Check RAG response: butuh data spreadsheet?
  const needsData = ragResponse.action?.type === "fetch_data";
  console.log("[CHAT] Call 1 selesai. action.type:", ragResponse.action?.type ?? "none", "| citations:", ragResponse.citations.length);

  if (needsData) {
    // 3. Butuh data spreadsheet
    const VALID_INDICATOR_CODES = ["IKU 001", "IKU 002", "IKU 003", "IKU 005", "IKU 007", "IKU 009"] as const;
    type IndicatorCode = typeof VALID_INDICATOR_CODES[number];

    // Ekstrak nomor IKU dari pertanyaan user jika ada (misal "IKU 2" -> "IKU 002")
    const ikuMatch = trimmedMessage.match(/iku[\s-]*0*(\d+)/i);
    const extractedIku = ikuMatch ? `IKU ${ikuMatch[1].padStart(3, "0")}` : null;

    // Normalisasi scope.ikuCode juga jika dikirim dalam format "IKU 2" -> "IKU 002"
    const scopeIkuMatch = scope?.ikuCode?.match(/iku[\s-]*0*(\d+)/i);
    const normalizedScopeIku = scopeIkuMatch ? `IKU ${scopeIkuMatch[1].padStart(3, "0")}` : scope?.ikuCode;

    // Prioritaskan IKU yang disebut eksplisit di pertanyaan, lalu dari scope, terakhir default IKU 001
    const candidateIndicator = extractedIku || normalizedScopeIku || "IKU 001";
    const indicator: IndicatorCode = (VALID_INDICATOR_CODES as readonly string[]).includes(candidateIndicator)
      ? (candidateIndicator as IndicatorCode)
      : "IKU 001";

    // Deteksi tahun dari pertanyaan user (misal 2024, 2025, 2026).
    const yearMatch = trimmedMessage.match(/\b(202\d)\b/);
    const requestedYear = yearMatch ? yearMatch[1] : null;

    const spreadsheetRequest = {
      action: "fetch_data" as const,
      indicator,
      year: requestedYear,
      faculty: null,
      degree: null,
      aggregation: "none" as const,
      column: null,
    };

    console.log("[CHAT] Menjalankan tool spreadsheet. indicator:", spreadsheetRequest.indicator, "| year:", spreadsheetRequest.year ?? "semua");

    try {
      const toolResult = await executeTool(user, spreadsheetRequest, clientData);
      // Type narrowing sebelum akses .message agar patuh pada TypeScript strict mode
      console.log("[CHAT] Tool Result status:", toolResult.status, "| message:", toolResult.status === "ok" ? "OK" : toolResult.message);

      if (toolResult.status === "ok") {
        // Format data untuk LLM-friendly
        const dataContext = formatToolResultForLLM(toolResult);
        // Log hanya metadata (panjang & jumlah baris), bukan isi data mentah
        console.log("[CHAT] dataContext siap. panjang:", dataContext.length, "karakter | matchedRows:", toolResult.matchedRows);

        // Kirim ulang ke RAG dengan question + spreadsheet_context
        try {
          // Pastikan scope juga membawa indicator yang benar ke Call 2
          const updatedScope = { ...scope, ikuCode: indicator };
          console.log("[CHAT] Memanggil Call 2 (answerWithSpreadsheet). ikuCode:", updatedScope.ikuCode);

          const secondResponse = await ragClient.answerWithSpreadsheet(
            trimmedMessage,
            dataContext,
            updatedScope
          );
          console.log("[CHAT] Call 2 berhasil.");
          return secondResponse;
        } catch (secondCallError) {
          // Log hanya jenis error, bukan stack trace atau data
          const errMsg = secondCallError instanceof Error ? secondCallError.message : String(secondCallError);
          console.error("[CHAT] Call 2 gagal. error:", errMsg);
          // Jangan kembalikan dataContext mentah — tampilkan pesan ramah pengguna
          return {
            answer:
              "Data berhasil ditemukan, namun layanan perangkum AI sedang tidak merespons. " +
              "Silakan coba beberapa saat lagi.",
            citations: ragResponse.citations,
            grounded: false,
            outOfScope: null,
            action: null,
          };
        }
      } else {
        console.warn("[CHAT] Tool status non-ok:", toolResult.status);
        return {
          answer: `Gagal mengambil data: ${toolResult.message || "Tidak ada data tersedia"}`,
          citations: [],
          grounded: false,
          outOfScope: null,
          action: null,
        };
      }
    } catch (error) {
      const toolErrMsg = error instanceof Error ? error.message : String(error);
      console.error("[CHAT] Error saat eksekusi tool spreadsheet:", toolErrMsg);
      return {
        answer: "Maaf, terjadi kesalahan saat mengambil data kampus.",
        citations: [],
        grounded: false,
        outOfScope: null,
        action: null,
      };
    }
  } else {
    // 4. Tidak butuh data spreadsheet -> return langsung dari RAG
    console.log("[CHAT] Intent bukan fetch_data, return jawaban langsung dari RAG.");
    return ragResponse;
  }
}


/**
 * Format ToolResult menjadi text yang LLM-friendly.
 */
function formatToolResultForLLM(result: ToolResult): string {
  if (result.status !== "ok") {
    return `Error: ${result.message || "Data tidak tersedia"}`;
  }

  const lines: string[] = [];
  
  // Summary
  if (result.summary) {
    lines.push("Ringkasan Data:");
    if (result.summary.totalStudyProgram !== undefined) {
      lines.push(`- Total Program Studi: ${result.summary.totalStudyProgram}`);
    }
    if (result.summary.totalFaculty !== undefined) {
      lines.push(`- Total Fakultas: ${result.summary.totalFaculty}`);
    }
    if (result.summary.totalLecturers !== undefined) {
      lines.push(`- Total Dosen: ${result.summary.totalLecturers}`);
    }
    if (result.summary.totalIkuQualified !== undefined) {
      lines.push(`- Total Memenuhi IKU: ${result.summary.totalIkuQualified}`);
    }
    if (result.summary.avgIkuPercentage !== undefined) {
      lines.push(`- Rata-rata Capaian IKU: ${result.summary.avgIkuPercentage.toFixed(2)}%`);
    }
    if (result.summary.totalPartners !== undefined) {
      lines.push(`- Total Mitra: ${result.summary.totalPartners}`);
    }
    lines.push("");
  }

  // Data
  if (result.data && "rows" in result.data && result.data.rows.length > 0) {
    const MAX_LLM_ROWS = 100;
    const rows = result.data.rows.slice(0, MAX_LLM_ROWS);
    const headers = Object.keys(rows[0]);
    
    lines.push(`Data Detail (${rows.length} dari ${result.matchedRows} baris):`);
    lines.push(headers.join(" | "));
    
    rows.forEach((row) => {
      const vals = headers.map((h) => String(row[h as keyof typeof row] ?? ""));
      lines.push(vals.join(" | "));
    });
  } else if (result.data && "value" in result.data) {
    lines.push(`Hasil Agregasi (${result.data.column}): ${result.data.value}`);
  }

  return lines.join("\n");
}
