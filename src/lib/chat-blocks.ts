// Pemetaan `blocks` dari respons /api/chat ke AnswerBlock (src/types/chat.ts).
// Data dari jaringan diperlakukan sebagai `unknown`: setiap blok divalidasi, blok yang tidak
// dikenali dibuang, sehingga perubahan bentuk di RAG tidak membuat UI crash.
//
// Bentuk yang diterima:
// - kontrak FE apa adanya (text, note, metric, formula, table, list);
// - bentuk layanan RAG saat ini (iku-rag-chatbot/src/api/app.py, extract_blocks):
//   { type: "formula" | "note" | "metric", lines: string[] }.

import type { AnswerBlock } from "@/types/chat";

type TableBlock = Extract<AnswerBlock, { type: "table" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function stringLines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString).map((line) => line.trim()) : [];
}

/** "Capaian Agregat Kampus (2025): 86.36%" → { label: "Capaian Agregat Kampus (2025)", value: "86.36%" } */
function splitMetricLine(line: string): Record<string, string> {
  const separator = line.lastIndexOf(": ");
  if (separator <= 0) return { label: line, value: "" };
  return { label: line.slice(0, separator).trim(), value: line.slice(separator + 2).trim() };
}

/** Hasil kalkulator RAG berupa teks per baris; ditampilkan sebagai tabel ringkas. */
function metricLinesToTable(lines: string[]): TableBlock {
  return {
    type: "table",
    columns: [
      { key: "label", header: "Rincian" },
      { key: "value", header: "Hasil", align: "end", emphasis: true },
    ],
    rows: lines.map(splitMetricLine),
  };
}

function toTable(raw: Record<string, unknown>): TableBlock | undefined {
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return undefined;
  const columns = raw.columns.flatMap((column) => {
    if (!isRecord(column) || !nonEmptyString(column.key) || typeof column.header !== "string") return [];
    return [
      {
        key: column.key,
        header: column.header,
        align: column.align === "end" ? ("end" as const) : undefined,
        emphasis: column.emphasis === true || undefined,
      },
    ];
  });
  if (columns.length === 0) return undefined;
  const rows = raw.rows.filter(isRecord).map((row) =>
    Object.fromEntries(columns.map(({ key }) => [key, row[key] == null ? "" : String(row[key])]))
  );
  return rows.length > 0 ? { type: "table", columns, rows } : undefined;
}

function toBlocks(raw: unknown): AnswerBlock[] {
  if (!isRecord(raw)) return [];
  const lines = stringLines(raw.lines);

  switch (raw.type) {
    case "text":
      return nonEmptyString(raw.text) ? [{ type: "text", text: raw.text }] : [];
    case "note":
      if (nonEmptyString(raw.text)) return [{ type: "note", text: raw.text }];
      return lines.map((text) => ({ type: "note", text }));
    case "formula":
      return lines.length > 0 ? [{ type: "formula", lines }] : [];
    case "metric":
      if (nonEmptyString(raw.label) && isFiniteNumber(raw.value) && isFiniteNumber(raw.target)) {
        return [
          {
            type: "metric",
            label: raw.label,
            value: raw.value,
            target: raw.target,
            caption: typeof raw.caption === "string" ? raw.caption : "",
          },
        ];
      }
      return lines.length > 0 ? [metricLinesToTable(lines)] : [];
    case "table": {
      const table = toTable(raw);
      return table ? [table] : [];
    }
    case "list": {
      const items = stringLines(raw.items);
      if ((raw.variant !== "excluded" && raw.variant !== "included") || items.length === 0) return [];
      return [{ type: "list", variant: raw.variant, items }];
    }
    default:
      return [];
  }
}

/** Blok jawaban yang valid, atau undefined jika tidak ada yang bisa ditampilkan. */
export function toAnswerBlocks(value: unknown): AnswerBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.flatMap(toBlocks);
  return blocks.length > 0 ? blocks : undefined;
}
