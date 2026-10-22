// Paksa DNS resolve lewat IPv4 terlebih dahulu.
// Ini mencegah EAI_AGAIN yang terjadi saat Node.js (undici) mencoba resolve
// subdomain CDN dinamis Google (doc-XX-c4-sheets.googleusercontent.com) via IPv6.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { prisma } from "@/lib/prisma";
import { parseSpreadsheetUrl } from "@/lib/spreadsheet-parser";
import { calculateKpis, filterRows, normalizeRows } from "@/lib/data-helpers";
import type { AuthContext, ClientSpreadsheetData, ToolRequest, ToolResult } from "@/lib/chat/types";
import type { RawRow, CanonicalKey } from "@/types/data";

const MAX_ROWS = 200;

// ── In-memory cache untuk fallback server-side fetch ──────────────────────────
// Key: URL spreadsheet. TTL: 5 menit.
// Ini menghindari download ulang file XLSX setiap ada pesan chat masuk.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

type CacheEntry = {
  rows: RawRow[];
  columns: string[];
  fetchedAt: number; // timestamp ms
};

const spreadsheetCache = new Map<string, CacheEntry>();

async function fetchRowsCached(url: string): Promise<{ rows: RawRow[]; columns: string[] }> {
  const now = Date.now();
  const cached = spreadsheetCache.get(url);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { rows: cached.rows, columns: cached.columns };
  }

  // Cache miss atau expired — fetch ulang
  const { rows, columns } = await parseSpreadsheetUrl(url);
  spreadsheetCache.set(url, { rows, columns, fetchedAt: now });
  return { rows, columns };
}
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Get available filters (years, faculties, degrees) from user's data source.
 * Ini dipakai untuk "no_match" response.
 */
export async function getAvailableFilters(user: AuthContext): Promise<{
  years?: string[];
  faculties?: string[];
  degrees?: string[];
}> {
  const connections = await prisma.dataSourceConnection.findMany({
    where: { userEmail: user.email },
    orderBy: { createdAt: "asc" },
  });

  if (connections.length === 0) {
    return {};
  }

  const connection = connections[0];
  try {
    const { rows } = await parseSpreadsheetUrl(connection.url);
    const normalized = normalizeRows(rows);

    const years = Array.from(new Set(normalized.map((r) => r.year).filter(Boolean))) as string[];
    const faculties = Array.from(new Set(normalized.map((r) => r.faculty).filter(Boolean))) as string[];
    const degrees = Array.from(new Set(normalized.map((r) => r.degree).filter(Boolean))) as string[];

    return { years, faculties, degrees };
  } catch {
    return {};
  }
}

/**
 * Proses baris data (normalize, filter, aggregate) dan kembalikan ToolResult.
 * Dipakai bersama oleh path clientData dan path server-side fetch.
 */
function processRows(
  rows: RawRow[],
  source: { id: string; name: string },
  request: ToolRequest,
  availableFiltersFn: () => Promise<{ years?: string[]; faculties?: string[]; degrees?: string[] }>
): Promise<ToolResult> {
  const { indicator, year, faculty, degree, aggregation = "none", column } = request;
  const totalRows = rows.length;

  return (async () => {
    if (totalRows === 0) {
      const filters = await availableFiltersFn();
      return {
        status: "no_match" as const,
        message: "Sheet kosong atau tidak ada data yang dapat diproses.",
        availableFilters: filters,
      };
    }

    const normalized = normalizeRows(rows);

    const filters = {
      year: year || "",
      faculty: faculty || "",
      degree: degree || "",
      search: "",
    };

    const filteredRows = filterRows(normalized, filters);
    const matchedRows = filteredRows.length;

    if (matchedRows === 0) {
      const filtersAvail = await availableFiltersFn();
      return {
        status: "no_match" as const,
        message: `Tidak ada data yang cocok dengan filter: ${JSON.stringify(filters)}`,
        availableFilters: filtersAvail,
      };
    }

    // Aggregation
    let data: { rows: RawRow[] } | { value: number; column: string } = { rows: [] };
    let summary = calculateKpis(filteredRows);

    if (aggregation === "none") {
      const rowsToShow = filteredRows.slice(0, MAX_ROWS).map((r) => r.__raw as RawRow);
      data = { rows: rowsToShow };
      if (matchedRows > MAX_ROWS) {
        summary = { ...summary, totalStudyProgram: summary.totalStudyProgram };
      }
    } else {
      let aggValue = 0;

      if (aggregation === "count") {
        aggValue = matchedRows;
        data = { value: aggValue, column: "count" };
      } else if (aggregation === "sum") {
        if (!column) {
          return {
            status: "error" as const,
            message: "Aggregasi sum memerlukan parameter 'column'.",
          };
        }
        aggValue = filteredRows.reduce((acc, r) => {
          const raw = r.__raw as RawRow;
          const val = (column in raw ? raw[column as CanonicalKey] : 0) ?? 0;
          return acc + (typeof val === "number" ? val : 0);
        }, 0);
        data = { value: aggValue, column: column as string };
      } else if (aggregation === "avg") {
        if (column === "iku_percentage") {
          return {
            status: "error" as const,
            message: "Aggregasi avg tidak boleh untuk kolom iku_percentage. Gunakan sum atau none.",
          };
        }
        const nums: (number | string)[] = [];
        for (const r of filteredRows) {
          const raw = r.__raw as RawRow;
          const val = (column && column in raw) ? raw[column as CanonicalKey] : undefined;
          if (val !== undefined && val !== null) {
            if (typeof val === "number" || typeof val === "string") {
              nums.push(val);
            }
          }
        }
        const numeric = nums
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((v) => !isNaN(v));
        aggValue = numeric.length === 0
          ? 0
          : numeric.reduce((a, b) => a + b, 0) / numeric.length;
        data = { value: aggValue, column: column as string };
      }

      summary = calculateKpis(filteredRows);
    }

    const truncated = totalRows > MAX_ROWS && aggregation === "none";

    return {
      status: "ok" as const,
      source,
      indicator,
      filters: {
        year: filters.year || undefined,
        faculty: filters.faculty || undefined,
        degree: filters.degree || undefined,
      },
      aggregation,
      matchedRows,
      totalRows,
      truncated,
      summary: {
        totalStudyProgram: summary.totalStudyProgram,
        totalFaculty: summary.totalFaculty,
        totalLecturers: summary.totalLecturers,
        totalIkuQualified: summary.totalIkuQualified,
        avgIkuPercentage: summary.avgIkuPercentage,
        totalPartners: summary.totalPartners,
      },
      data,
    };
  })();
}

/**
 * Execute tool request berdasarkan indicator dan filter.
 *
 * Prioritas pengambilan data:
 * 1. `clientData` — data yang sudah di-parse di browser (tidak ada fetch ke Google Sheets).
 * 2. Fallback — server-side fetch via parseSpreadsheetUrl (menggunakan IPv4-first DNS).
 */
export async function executeTool(
  user: AuthContext,
  request: ToolRequest,
  clientData?: ClientSpreadsheetData
): Promise<ToolResult> {
  // ── PATH 1: Data dari client (browser sudah parse, tidak ada EAI_AGAIN) ──
  if (clientData && clientData.rows.length > 0) {
    const source = {
      id: clientData.sourceId ?? "client",
      name: clientData.sourceName ?? "Spreadsheet (dari browser)",
    };
    try {
      return await processRows(
        clientData.rows as RawRow[],
        source,
        request,
        () => Promise.resolve({})
      );
    } catch (error) {
      console.error("Error processing clientData:", error);
      return {
        status: "error",
        message: "Gagal memproses data spreadsheet dari browser.",
      };
    }
  }

  // ── PATH 2: Fallback — fetch server-side (IPv4-first DNS sudah aktif di atas) ──
  const { indicator } = request;

  const tabConnection = await prisma.dashboardTabConnection.findUnique({
    where: {
      userEmail_dashboardTab: {
        userEmail: user.email,
        dashboardTab: indicator,
      },
    },
  });

  const connections = await prisma.dataSourceConnection.findMany({
    where: { userEmail: user.email },
    orderBy: { createdAt: "asc" },
  });

  if (connections.length === 0) {
    return {
      status: "no_source",
      message: "User belum menghubungkan spreadsheet/data source apa pun.",
    };
  }

  const connection = tabConnection
    ? connections.find((c) => c.id === tabConnection.sourceId)
    : connections[0];

  if (!connection) {
    return {
      status: "no_source",
      message: "Tidak dapat menemukan data source yang terhubung.",
    };
  }

  try {
    const { rows } = await fetchRowsCached(connection.url);
    return await processRows(
      rows,
      { id: connection.id, name: connection.name },
      request,
      () => getAvailableFilters(user)
    );
  } catch (error) {
    console.error("Error parsing spreadsheet:", error);
    return {
      status: "error",
      message: "Gagal memproses spreadsheet. Pastikan URL valid dan sheet dapat diakses.",
    };
  }
}

