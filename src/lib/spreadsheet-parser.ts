import type { RawRow } from "@/types/data";

type ParsedSpreadsheet = {
  rows: RawRow[];
  columns: string[];
};

async function loadXlsx() {
  return import("xlsx");
}

function toGoogleSheetExportUrl(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return url;
  const sheetId = match[1];
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx&gid=${gid}`;
}

function getSheetNameFromUrl(url: string): string | null {
  const match = url.match(/[#?&]sheet=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function parseSpreadsheetBuffer(buffer: ArrayBuffer, url?: string): Promise<ParsedSpreadsheet> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: "array" });
  
  let targetSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (url) {
    const sheetName = getSheetNameFromUrl(url);
    if (sheetName && workbook.Sheets[sheetName]) {
      targetSheet = workbook.Sheets[sheetName];
    }
  }
  
  const rows = XLSX.utils.sheet_to_json<RawRow>(targetSheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { rows, columns };
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const buffer = await file.arrayBuffer();
  return parseSpreadsheetBuffer(buffer);
}

/**
 * Fetch dengan retry untuk menangani DNS failure intermittent (EAI_AGAIN)
 * yang terjadi saat Google Sheets redirect ke subdomain dinamis
 * (doc-XX-c4-sheets.googleusercontent.com).
 */
async function fetchWithRetry(
  url: string,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      return response;
    } catch (err) {
      lastError = err;
      // Hanya retry untuk error jaringan/DNS, bukan error lain
      const isNetworkError =
        err instanceof Error &&
        err.cause instanceof Error &&
        ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(
          (err.cause as NodeJS.ErrnoException).code ?? ""
        );
      if (!isNetworkError || attempt === maxAttempts) break;
      // Exponential backoff: 500ms, 1000ms
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export async function parseSpreadsheetUrl(url: string): Promise<ParsedSpreadsheet> {
  const trimmed = url.trim();

  const finalUrl = toGoogleSheetExportUrl(trimmed);
  let response: Response;
  try {
    response = await fetchWithRetry(finalUrl);
  } catch (err) {
    const cause = err instanceof Error ? (err.cause as NodeJS.ErrnoException | undefined) : undefined;
    const code = cause?.code;
    if (code === "EAI_AGAIN" || code === "ENOTFOUND") {
      throw new Error(
        "Tidak dapat menjangkau Google Sheets. Periksa koneksi internet server."
      );
    }
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Akses ditolak. Pastikan spreadsheet dibagikan sebagai 'Anyone with the link can view'."
    );
  }
  if (!response.ok) {
    throw new Error(
      `Gagal mengambil data dari URL spreadsheet (HTTP ${response.status}).`
    );
  }

  const buffer = await response.arrayBuffer();
  return parseSpreadsheetBuffer(buffer, trimmed);
}

export async function fetchSpreadsheetSheets(url: string): Promise<string[]> {
  const trimmed = url.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error("URL Spreadsheet tidak valid");
  const sheetId = match[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

  const response = await fetchWithRetry(exportUrl);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Akses ditolak. Pastikan spreadsheet dibagikan sebagai 'Anyone with the link can view'."
    );
  }
  if (!response.ok) {
    throw new Error(`Gagal mengambil data dari URL spreadsheet (HTTP ${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: "array" });
  return workbook.SheetNames;
}
