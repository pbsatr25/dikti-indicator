"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dropdown,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Search,
  Tag,
  Tile,
  Loading,
  SkeletonPlaceholder,
  SkeletonText,
} from "@carbon/react";
import { Download, Filter } from "@carbon/icons-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RawRow } from "@/types/data";

type Props = {
  rows: RawRow[];
  parseStatus: "idle" | "loading" | "success" | "error";
  errorMessage: string | null;
};

type Iku002Row = {
  year: string;
  faculty: string;
  prodi: string;
  degree: string;
  totalGraduates: number;
  respondentTs: number;
  bekerja: number;
  lanjutStudi: number;
  wirausaha: number;
  belumBekerja: number;
  tidakTerlacak: number;
  totalSuccess: number;
  /** Jumlah lulusan berbobot (pembilang rumus IKU 2). */
  weightedScore: number;
  responseRate: number;
  ikuPercentage: number;
  __raw: RawRow;
};

type SortKey = "year" | "faculty" | "prodi" | "graduates" | "bekerja" | "lanjutStudi" | "wirausaha" | "iku";

type ScopeCardProps = {
  label: string;
  value: string;
  tone?: "brand" | "success" | "secondary";
};

const chartTooltipStyles = {
  backgroundColor: "#161616",
  border: "1px solid rgba(244, 244, 244, 0.32)",
  borderRadius: "4px",
  boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
  padding: "0.65rem 0.75rem",
};

const donutColors = ["#0f62fe", "#8a3ffc", "#198038", "#ee538b", "#6f6f6f"];

// Bobot IKU 2 (Buku IKU Diktisaintek Berdampak V1). Rumus: Σ(n × bobot) ÷ total responden × 100%.
// Spreadsheet tidak merinci jenis wirausaha (founder/freelancer, masa tunggu, UMP), sehingga
// dipakai 0,8 seperti kalkulator layanan RAG (spreadsheet_calc.py).
const BOBOT_IKU2 = {
  bekerja6BulanTinggi: 1,
  bekerja1TahunTinggi: 0.8,
  bekerja1TahunRendah: 0.6,
  lanjutStudi: 0.6,
  wirausaha: 0.8,
};

type Iku002Totals = { respondents: number; score: number };

function ikuFromTotals(totals: Iku002Totals) {
  return safePercent(totals.score, totals.respondents);
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(columns: string[], patterns: RegExp[], fallback = "") {
  for (const pattern of patterns) {
    const found = columns.find((column) => pattern.test(normalizeText(column)));
    if (found) return found;
  }
  return fallback;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
}

function safePercent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("id-ID");
}

function colorForPercent(value: number) {
  if (value >= 85) return { bg: "rgba(25, 128, 56, 0.22)", fg: "var(--cds-text-primary)" };
  if (value >= 70) return { bg: "rgba(15, 98, 254, 0.22)", fg: "var(--cds-text-primary)" };
  if (value >= 50) return { bg: "rgba(15, 98, 254, 0.12)", fg: "var(--cds-text-primary)" };
  if (value > 0) return { bg: "rgba(238, 83, 139, 0.16)", fg: "var(--cds-text-primary)" };
  return { bg: "rgba(111, 111, 111, 0.16)", fg: "var(--cds-text-primary)" };
}

function formatChartValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString("id-ID");
  if (typeof value === "string") return value;
  return "-";
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: unknown; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div style={chartTooltipStyles}>
      {label !== undefined && (
        <div style={{ color: "#fff", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.35rem" }}>
          {String(label)}
        </div>
      )}
      {payload.map((entry, index) => (
        <div
          key={`${entry.name ?? "value"}-${index}`}
          style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "#f4f4f4", fontSize: "0.75rem" }}
        >
          <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: entry.color || "#f4f4f4", flexShrink: 0 }} />
          <span>{entry.name || "Nilai"}:</span>
          <strong style={{ color: "#fff" }}>{formatChartValue(entry.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function ScopeCard({ label, value, tone = "secondary" }: ScopeCardProps) {
  const tagType = tone === "brand" ? "blue" : tone === "success" ? "green" : "cool-gray";
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", color: "var(--cds-text-secondary)", letterSpacing: "0.04em" }}>
        {label}
      </p>
      <Tag type={tagType} size="sm" style={{ margin: 0, maxWidth: "100%" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
      </Tag>
    </div>
  );
}

export function Iku002Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Tile style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.875rem" }}>
        <Loading withOverlay={false} small description="Memuat data IKU 002..." />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <strong style={{ fontSize: "0.875rem", color: "var(--cds-text-primary)" }}>Memuat dashboard IKU 002</strong>
          <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
            Menyiapkan agregasi alumni, tren universitas, dan analisis per fakultas.
          </span>
        </div>
      </Tile>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Tile key={index} style={{ padding: "1rem" }}>
            <SkeletonText heading width="60%" />
            <SkeletonText paragraph lineCount={2} width="90%" />
          </Tile>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "1rem" }}>
        <Tile style={{ minHeight: "320px" }}><SkeletonPlaceholder style={{ width: "100%", height: "280px" }} /></Tile>
        <Tile style={{ minHeight: "320px" }}><SkeletonPlaceholder style={{ width: "100%", height: "280px" }} /></Tile>
      </div>
    </div>
  );
}

export function Iku002Dashboard({ rows, parseStatus, errorMessage }: Props) {
  const parsedRows = useMemo<Iku002Row[]>(() => {
    if (!rows.length) return [];

    const columns = Object.keys(rows[0]);
    const yearCol = findColumn(columns, [/^tahun$/, /year/], "Tahun");
    const facultyCol = findColumn(columns, [/^fakultas$/, /faculty/], "Fakultas");
    const prodiCol = findColumn(columns, [/^prodi$/, /program.*studi/, /study.*program/], "Prodi");
    const degreeCol = findColumn(columns, [/^jenjang$/, /degree/], "Jenjang");
    const totalLulusanCol = findColumn(columns, [/total.*lulusan/, /jumlah.*lulusan/], "Total Lulusan");
    const respondentCol = findColumn(columns, [/responden.*ts/, /tracer.*study/, /^responden$/], "Responden TS");
    // Header spreadsheet bisa memakai singkatan ("<6 bln", "<1 thn") maupun kata lengkap.
    const bekerja6Col = findColumn(columns, [/bekerja.*<\s*6\s*(bln|bulan)/, /bekerja.*6\s*(bln|bulan)/], "Bekerja <6 bln >1.2 UMP");
    const bekerja1TinggiCol = findColumn(columns, [/bekerja.*<\s*1\s*(thn|tahun).*>\s*1[.,]2/], "Bekerja <1 thn >1.2 UMP");
    const bekerja1RendahCol = findColumn(columns, [/bekerja.*<\s*1\s*(thn|tahun).*<\s*1[.,]2/], "Bekerja <1 thn <1.2 UMP");
    const lanjutCol = findColumn(columns, [/lanjut.*studi/, /^studi$/], "Lanjut Studi");
    const wirausahaCol = findColumn(columns, [/wirausaha/, /entrepreneur/], "Wirausaha");
    const belumBekerjaCol = findColumn(columns, [/belum.*bekerja/, /unemployed/], "Belum Bekerja");
    const terlacakCol = findColumn(columns, [/tidak.*terlacak/, /untracked/], "Tidak Terlacak");

    return rows
      .map((row) => {
        const year = toStringValue(row[yearCol]);
        const faculty = toStringValue(row[facultyCol]);
        const prodi = toStringValue(row[prodiCol]);
        const degree = toStringValue(row[degreeCol]);
        const totalGraduates = Math.max(0, toNumber(row[totalLulusanCol]));
        const respondentTs = Math.max(0, toNumber(row[respondentCol]));
        const bekerja6Tinggi = Math.max(0, toNumber(row[bekerja6Col]));
        const bekerja1Tinggi = Math.max(0, toNumber(row[bekerja1TinggiCol]));
        const bekerja1Rendah = Math.max(0, toNumber(row[bekerja1RendahCol]));
        const bekerja = bekerja6Tinggi + bekerja1Tinggi + bekerja1Rendah;
        const lanjutStudi = Math.max(0, toNumber(row[lanjutCol]));
        const wirausaha = Math.max(0, toNumber(row[wirausahaCol]));
        const belumBekerja = Math.max(0, toNumber(row[belumBekerjaCol]));
        const tidakTerlacak = Math.max(0, toNumber(row[terlacakCol]));
        const totalSuccess = bekerja + lanjutStudi + wirausaha;
        const weightedScore =
          bekerja6Tinggi * BOBOT_IKU2.bekerja6BulanTinggi +
          bekerja1Tinggi * BOBOT_IKU2.bekerja1TahunTinggi +
          bekerja1Rendah * BOBOT_IKU2.bekerja1TahunRendah +
          lanjutStudi * BOBOT_IKU2.lanjutStudi +
          wirausaha * BOBOT_IKU2.wirausaha;
        const ikuPercentage = safePercent(weightedScore, respondentTs);
        const responseRate = safePercent(respondentTs, totalGraduates);

        return {
          year,
          faculty,
          prodi,
          degree,
          totalGraduates,
          respondentTs,
          bekerja,
          lanjutStudi,
          wirausaha,
          belumBekerja,
          tidakTerlacak,
          totalSuccess,
          weightedScore,
          responseRate,
          ikuPercentage,
          __raw: row,
        };
      })
      .filter((row) => row.year && row.faculty && row.prodi);
  }, [rows]);

  const [year, setYear] = useState("");
  const [faculty, setFaculty] = useState("");
  const [degree, setDegree] = useState("");
  const [prodi, setProdi] = useState("");
  const [search, setSearch] = useState("");
  const [tableSortKey, setTableSortKey] = useState<SortKey>("iku");
  const [tableSortDirection, setTableSortDirection] = useState<"asc" | "desc">("desc");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showInsightToast, setShowInsightToast] = useState(true);

  const filteredForCharts = useMemo(() => {
    return parsedRows.filter((row) => {
      if (year && row.year !== year) return false;
      if (faculty && row.faculty !== faculty) return false;
      if (degree && row.degree !== degree) return false;
      if (prodi && row.prodi !== prodi) return false;
      if (
        search &&
        ![
          row.year,
          row.faculty,
          row.prodi,
          row.degree,
          row.totalGraduates,
          row.respondentTs,
          row.bekerja,
          row.lanjutStudi,
          row.wirausaha,
          row.belumBekerja,
          row.tidakTerlacak,
          row.ikuPercentage,
        ].some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase()))
      ) {
        return false;
      }
      return true;
    });
  }, [parsedRows, year, faculty, degree, prodi, search]);

  const filteredForTable = useMemo(() => {
    return filteredForCharts;
  }, [filteredForCharts]);

  const sortedTableRows = useMemo(() => {
    const next = [...filteredForTable];
    next.sort((left, right) => {
      const compareString = (a: string, b: string) => a.localeCompare(b, "id", { numeric: true, sensitivity: "base" });
      const compareNumber = (a: number, b: number) => a - b;

      let diff = 0;
      switch (tableSortKey) {
        case "year":
          diff = compareString(left.year, right.year);
          break;
        case "faculty":
          diff = compareString(left.faculty, right.faculty);
          break;
        case "prodi":
          diff = compareString(left.prodi, right.prodi);
          break;
        case "graduates":
          diff = compareNumber(left.totalGraduates, right.totalGraduates);
          break;
        case "bekerja":
          diff = compareNumber(left.bekerja, right.bekerja);
          break;
        case "lanjutStudi":
          diff = compareNumber(left.lanjutStudi, right.lanjutStudi);
          break;
        case "wirausaha":
          diff = compareNumber(left.wirausaha, right.wirausaha);
          break;
        case "iku":
          diff = compareNumber(left.ikuPercentage, right.ikuPercentage);
          break;
      }

      return tableSortDirection === "asc" ? diff : -diff;
    });
    return next;
  }, [filteredForTable, tableSortDirection, tableSortKey]);

  const yearOptions = useMemo(() => uniqueSorted(parsedRows.map((row) => row.year)), [parsedRows]);
  const facultyOptions = useMemo(
    () => uniqueSorted(parsedRows.filter((row) => !year || row.year === year).map((row) => row.faculty)),
    [parsedRows, year]
  );
  const degreeOptions = useMemo(
    () =>
      uniqueSorted(
        parsedRows
          .filter((row) => (!year || row.year === year) && (!faculty || row.faculty === faculty))
          .map((row) => row.degree)
      ),
    [parsedRows, year, faculty]
  );
  const prodiOptions = useMemo(
    () =>
      uniqueSorted(
        parsedRows
          .filter((row) => (!year || row.year === year) && (!faculty || row.faculty === faculty) && (!degree || row.degree === degree))
          .map((row) => row.prodi)
      ),
    [parsedRows, year, faculty, degree]
  );

  const summary = useMemo(() => {
    const totalGraduates = filteredForCharts.reduce((acc, row) => acc + row.totalGraduates, 0);
    const totalRespondent = filteredForCharts.reduce((acc, row) => acc + row.respondentTs, 0);
    const totalSuccess = filteredForCharts.reduce((acc, row) => acc + row.totalSuccess, 0);
    const totalScore = filteredForCharts.reduce((acc, row) => acc + row.weightedScore, 0);
    const totalAlumniMemenuhi = totalSuccess;
    return {
      totalGraduates,
      totalRespondent,
      totalSuccess,
      totalAlumniMemenuhi,
      ikuPercentage: safePercent(totalScore, totalRespondent),
      responseRate: safePercent(totalRespondent, totalGraduates),
      facultyCount: new Set(filteredForCharts.map((row) => row.faculty)).size,
      prodiCount: new Set(filteredForCharts.map((row) => `${row.faculty}::${row.prodi}`)).size,
    };
  }, [filteredForCharts]);

  const trendData = useMemo(() => {
    const map = new Map<string, Iku002Totals & { graduates: number }>();
    filteredForCharts.forEach((row) => {
      const current = map.get(row.year) ?? { graduates: 0, respondents: 0, score: 0 };
      current.graduates += row.totalGraduates;
      current.respondents += row.respondentTs;
      current.score += row.weightedScore;
      map.set(row.year, current);
    });

    return [...map.entries()]
      .map(([yearLabel, value]) => ({
        year: yearLabel,
        iku: Number(ikuFromTotals(value).toFixed(2)),
        graduates: value.graduates,
      }))
      .sort((a, b) => a.year.localeCompare(b.year, "id", { numeric: true }));
  }, [filteredForCharts]);

  const facultyComparison = useMemo(() => {
    const map = new Map<string, Iku002Totals & { graduates: number }>();
    filteredForCharts.forEach((row) => {
      const current = map.get(row.faculty) ?? { graduates: 0, respondents: 0, score: 0 };
      current.graduates += row.totalGraduates;
      current.respondents += row.respondentTs;
      current.score += row.weightedScore;
      map.set(row.faculty, current);
    });

    return [...map.entries()]
      .map(([facultyLabel, value]) => ({
        faculty: facultyLabel,
        iku: Number(ikuFromTotals(value).toFixed(2)),
        graduates: value.graduates,
      }))
      .sort((a, b) => b.iku - a.iku);
  }, [filteredForCharts]);

  const prodiRanking = useMemo(() => {
    const map = new Map<string, Iku002Totals & { faculty: string; prodi: string; graduates: number }>();
    filteredForCharts.forEach((row) => {
      const key = `${row.faculty}::${row.prodi}`;
      const current = map.get(key) ?? { faculty: row.faculty, prodi: row.prodi, graduates: 0, respondents: 0, score: 0 };
      current.graduates += row.totalGraduates;
      current.respondents += row.respondentTs;
      current.score += row.weightedScore;
      map.set(key, current);
    });

    return [...map.values()]
      .map((item) => ({
        faculty: item.faculty,
        prodi: item.prodi,
        label: item.prodi,
        graduates: item.graduates,
        iku: Number(ikuFromTotals(item).toFixed(2)),
      }))
      .sort((a, b) => b.iku - a.iku)
      .slice(0, 10);
  }, [filteredForCharts]);

  const outcomeDistribution = useMemo(() => {
    const totals = {
      bekerja: filteredForCharts.reduce((acc, row) => acc + row.bekerja, 0),
      lanjutStudi: filteredForCharts.reduce((acc, row) => acc + row.lanjutStudi, 0),
      wirausaha: filteredForCharts.reduce((acc, row) => acc + row.wirausaha, 0),
      belumBekerja: filteredForCharts.reduce((acc, row) => acc + row.belumBekerja, 0),
      tidakTerlacak: filteredForCharts.reduce((acc, row) => acc + row.tidakTerlacak, 0),
    };

    return [
      { name: "Bekerja", value: totals.bekerja },
      { name: "Lanjut Studi", value: totals.lanjutStudi },
      { name: "Wirausaha", value: totals.wirausaha },
      { name: "Belum Bekerja", value: totals.belumBekerja },
      { name: "Tidak Terlacak", value: totals.tidakTerlacak },
    ].filter((item) => item.value > 0);
  }, [filteredForCharts]);

  const facultyComposition = useMemo(() => {
    const map = new Map<string, { faculty: string; bekerja: number; lanjutStudi: number; wirausaha: number }>();
    filteredForCharts.forEach((row) => {
      const current = map.get(row.faculty) ?? { faculty: row.faculty, bekerja: 0, lanjutStudi: 0, wirausaha: 0 };
      current.bekerja += row.bekerja;
      current.lanjutStudi += row.lanjutStudi;
      current.wirausaha += row.wirausaha;
      map.set(row.faculty, current);
    });
    return [...map.values()].sort((a, b) => a.faculty.localeCompare(b.faculty, "id"));
  }, [filteredForCharts]);

  const heatmap = useMemo(() => {
    const years = uniqueSorted(filteredForCharts.map((row) => row.year));
    const faculties = uniqueSorted(filteredForCharts.map((row) => row.faculty));

    const matrix = faculties.map((facultyLabel) => {
      const cells = years.map((yearLabel) => {
        const matching = filteredForCharts.filter((row) => row.faculty === facultyLabel && row.year === yearLabel);
        const graduates = matching.reduce((acc, row) => acc + row.totalGraduates, 0);
        const iku = ikuFromTotals({
          respondents: matching.reduce((acc, row) => acc + row.respondentTs, 0),
          score: matching.reduce((acc, row) => acc + row.weightedScore, 0),
        });
        return { year: yearLabel, iku, graduates };
      });

      return { faculty: facultyLabel, cells };
    });

    return { years, matrix };
  }, [filteredForCharts]);

  const insight = useMemo(() => {
    if (!filteredForCharts.length) {
      return "Belum ada data yang cocok dengan filter aktif.";
    }

    const facultyMap = new Map<string, Iku002Totals & { success: number }>();
    const prodiMap = new Map<string, { faculty: string; prodi: string; respondents: number; score: number; success: number }>();
    const yearMap = new Map<string, Iku002Totals & { success: number }>();

    filteredForCharts.forEach((row) => {
      const facultyCurrent = facultyMap.get(row.faculty) ?? { respondents: 0, score: 0, success: 0 };
      facultyCurrent.respondents += row.respondentTs;
      facultyCurrent.score += row.weightedScore;
      facultyCurrent.success += row.totalSuccess;
      facultyMap.set(row.faculty, facultyCurrent);

      const prodiKey = `${row.faculty}::${row.prodi}`;
      const prodiCurrent = prodiMap.get(prodiKey) ?? { faculty: row.faculty, prodi: row.prodi, respondents: 0, score: 0, success: 0 };
      prodiCurrent.respondents += row.respondentTs;
      prodiCurrent.score += row.weightedScore;
      prodiCurrent.success += row.totalSuccess;
      prodiMap.set(prodiKey, prodiCurrent);

      const yearCurrent = yearMap.get(row.year) ?? { respondents: 0, score: 0, success: 0 };
      yearCurrent.respondents += row.respondentTs;
      yearCurrent.score += row.weightedScore;
      yearCurrent.success += row.totalSuccess;
      yearMap.set(row.year, yearCurrent);
    });

    const bestFaculty = [...facultyMap.entries()]
      .map(([facultyLabel, value]) => ({
        faculty: facultyLabel,
        iku: ikuFromTotals(value),
        success: value.success,
      }))
      .sort((a, b) => b.iku - a.iku)[0];

    const bestProdi = [...prodiMap.values()]
      .map((value) => ({
        faculty: value.faculty,
        prodi: value.prodi,
        iku: ikuFromTotals(value),
        success: value.success,
      }))
      .sort((a, b) => b.iku - a.iku)[0];

    const years = [...yearMap.entries()]
      .map(([yearLabel, value]) => ({
        year: yearLabel,
        iku: ikuFromTotals(value),
      }))
      .sort((a, b) => a.year.localeCompare(b.year, "id", { numeric: true }));

    const firstYear = years[0];
    const lastYear = years[years.length - 1];
    const trendText =
      years.length > 1
        ? `tren IKU bergerak ${lastYear.iku >= firstYear.iku ? "naik" : "turun"} dari ${formatPercent(firstYear.iku)} ke ${formatPercent(lastYear.iku)}`
        : `capaian berada di ${formatPercent(summary.ikuPercentage)}`;

    const contributor = [...facultyMap.entries()]
      .map(([facultyLabel, value]) => ({ faculty: facultyLabel, success: value.success }))
      .sort((a, b) => b.success - a.success)[0];

    return `Capaian universitas pada filter aktif berada di ${formatPercent(summary.ikuPercentage)}. Fakultas terbaik adalah ${bestFaculty.faculty} (${formatPercent(bestFaculty.iku)}), prodi terbaik adalah ${bestProdi.prodi} di ${bestProdi.faculty} (${formatPercent(bestProdi.iku)}), dan ${trendText}. Kontributor terbesar terhadap alumni yang memenuhi IKU adalah ${contributor.faculty} dengan ${formatNumber(contributor.success)} alumni.`;
  }, [filteredForCharts, summary.ikuPercentage]);

  useEffect(() => {
    setShowInsightToast(true);
  }, [year, faculty, degree, prodi]);

  const resetAllFilters = () => {
    setYear("");
    setFaculty("");
    setDegree("");
    setProdi("");
    setSearch("");
    setTableSortKey("iku");
    setTableSortDirection("desc");
    setShowFilterDropdown(false);
  };

  const setSort = (key: SortKey) => {
    if (tableSortKey === key) {
      setTableSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setTableSortKey(key);
    setTableSortDirection(key === "iku" ? "desc" : "asc");
  };

  const downloadCsv = () => {
    if (!sortedTableRows.length) return;

    const columns = [
      "Tahun",
      "Fakultas",
      "Prodi",
      "Jenjang",
      "Total Lulusan",
      "Responden TS",
      "Bekerja",
      "Lanjut Studi",
      "Wirausaha",
      "Belum Bekerja",
      "Tidak Terlacak",
      "Persentase IKU",
      "Response Rate",
    ];

    const escapeCell = (value: unknown) => {
      const text = String(value ?? "");
      if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    };

    const rowsCsv = sortedTableRows.map((row) =>
      [
        row.year,
        row.faculty,
        row.prodi,
        row.degree,
        row.totalGraduates,
        row.respondentTs,
        row.bekerja,
        row.lanjutStudi,
        row.wirausaha,
        row.belumBekerja,
        row.tidakTerlacak,
        row.ikuPercentage.toFixed(2),
        row.responseRate.toFixed(2),
      ]
        .map(escapeCell)
        .join(",")
    );

    const blob = new Blob([[columns.join(","), ...rowsCsv].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `IKU002_Detail_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = async () => {
    if (!sortedTableRows.length) return;
    try {
      const XLSX = await import("xlsx");
      const exportRows = sortedTableRows.map((row) => ({
        Tahun: row.year,
        Fakultas: row.faculty,
        Prodi: row.prodi,
        Jenjang: row.degree,
        "Total Lulusan": row.totalGraduates,
        "Responden TS": row.respondentTs,
        Bekerja: row.bekerja,
        "Lanjut Studi": row.lanjutStudi,
        Wirausaha: row.wirausaha,
        "Belum Bekerja": row.belumBekerja,
        "Tidak Terlacak": row.tidakTerlacak,
        "Persentase IKU": Number(row.ikuPercentage.toFixed(2)),
        "Response Rate": Number(row.responseRate.toFixed(2)),
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "IKU 002 Detail");
      XLSX.writeFile(workbook, `IKU002_Detail_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      console.error("Gagal mengekspor Excel:", error);
    }
  };

  const buildTableRowKey = (row: Iku002Row, index: number) =>
    `${row.year}-${row.faculty}-${row.prodi}-${index}`;

  if (parseStatus === "loading") return <Iku002Skeleton />;

  if (parseStatus === "error") {
    return (
      <InlineNotification
        kind="error"
        title="Gagal Memuat Data"
        subtitle={errorMessage || "Sumber data tidak dapat diakses. Periksa koneksi Google Sheet yang aktif."}
        hideCloseButton
        lowContrast
      />
    );
  }

  if (!parsedRows.length) {
    return (
      <Tile style={{ padding: "1.25rem" }}>
        <InlineNotification
          kind="warning"
          title="Data IKU 002 Tidak Tersedia"
          subtitle="Dataset aktif belum memiliki kolom minimal: Tahun, Fakultas, Prodi, Jenjang, Total Lulusan, Responden TS, Bekerja, Lanjut Studi, Wirausaha, Belum Bekerja, Tidak Terlacak."
          hideCloseButton
          lowContrast
        />
      </Tile>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Tile style={{ padding: "1rem", position: "sticky", top: "0.5rem", zIndex: 20 }}>
        <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600, color: "var(--cds-text-secondary)" }}>
          Filter & Pencarian IKU 002
        </h4>
        <div className="dashboard-toolbars" style={{ position: "relative" }}>
          <Search
            id="iku002-search"
            size="sm"
            labelText="Search Prodi"
            placeholder="Search Prodi, Fakultas, atau Tahun"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <div className="iku001-filter-dropdown" style={{ position: "relative" }}>
            <Button
              size="sm"
              kind="tertiary"
              renderIcon={Filter}
              onClick={() => setShowFilterDropdown((prev) => !prev)}
            >
              Filter
            </Button>
          </div>
          {showFilterDropdown && (
            <div className="iku001-filter-panel iku001-filter-panel--overlay">
              <div className="iku001-filter-card">
                <Dropdown
                  id="iku002-year-filter"
                  size="sm"
                  titleText="Tahun"
                  label="Pilih tahun"
                  items={["Semua", ...yearOptions]}
                  selectedItem={year || "Semua"}
                  onChange={({ selectedItem }) => setYear(selectedItem === "Semua" ? "" : String(selectedItem || ""))}
                />
              </div>
              <div className="iku001-filter-card">
                <Dropdown
                  id="iku002-faculty-filter"
                  size="sm"
                  titleText="Fakultas"
                  label="Pilih fakultas"
                  items={["Semua", ...facultyOptions]}
                  selectedItem={faculty || "Semua"}
                  onChange={({ selectedItem }) => {
                    const nextFaculty = selectedItem === "Semua" ? "" : String(selectedItem || "");
                    setFaculty(nextFaculty);
                    setProdi("");
                  }}
                />
              </div>
              <div className="iku001-filter-card">
                <Dropdown
                  id="iku002-degree-filter"
                  size="sm"
                  titleText="Jenjang"
                  label="Pilih jenjang"
                  items={["Semua", ...degreeOptions]}
                  selectedItem={degree || "Semua"}
                  onChange={({ selectedItem }) => {
                    const nextDegree = selectedItem === "Semua" ? "" : String(selectedItem || "");
                    setDegree(nextDegree);
                    setProdi("");
                  }}
                />
              </div>
              <div className="iku001-filter-card">
                <Dropdown
                  id="iku002-prodi-filter"
                  size="sm"
                  titleText="Program Studi"
                  label="Pilih program studi"
                  items={["Semua", ...prodiOptions]}
                  selectedItem={prodi || "Semua"}
                  onChange={({ selectedItem }) => setProdi(selectedItem === "Semua" ? "" : String(selectedItem || ""))}
                />
              </div>
              <Button size="sm" kind="ghost" onClick={resetAllFilters}>
                Reset Filter
              </Button>
            </div>
          )}
        </div>
      </Tile>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        <Tile style={{ padding: "1rem" }}>
          <ScopeCard label="Capaian IKU 002" value={formatPercent(summary.ikuPercentage)} tone="brand" />
        </Tile>
        <Tile style={{ padding: "1rem" }}>
          <ScopeCard label="Total Lulusan" value={formatNumber(summary.totalGraduates)} />
        </Tile>
        <Tile style={{ padding: "1rem" }}>
          <ScopeCard label="Total Alumni Memenuhi IKU" value={formatNumber(summary.totalAlumniMemenuhi)} tone="success" />
        </Tile>
        <Tile style={{ padding: "1rem" }}>
          <ScopeCard label="Response Rate Tracer Study" value={formatPercent(summary.responseRate)} />
        </Tile>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "1rem" }}>
        <Tile style={{ minHeight: "340px", padding: "1rem" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Trend Multi-Tahun</h4>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="iku" stroke="#0f62fe" strokeWidth={2.5} name="Persentase IKU" />
            </LineChart>
          </ResponsiveContainer>
        </Tile>

        <Tile style={{ minHeight: "340px", padding: "1rem" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Perbandingan Fakultas</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={facultyComparison} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis dataKey="faculty" type="category" width={120} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="iku"
                fill="#8a3ffc"
                radius={[0, 4, 4, 0]}
                name="Persentase IKU"
                onClick={(payload: { payload?: { faculty?: string } }) => {
                  const clicked = payload?.payload?.faculty;
                  if (!clicked) return;
                  setFaculty(clicked);
                  setProdi("");
                }}
                style={{ cursor: "pointer" }}
              />
            </BarChart>
          </ResponsiveContainer>
        </Tile>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "1rem" }}>
        <Tile style={{ minHeight: "340px", padding: "1rem" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Ranking Program Studi Top 10</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={prodiRanking} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis dataKey="label" type="category" width={180} interval={0} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="iku"
                fill="#198038"
                radius={[0, 4, 4, 0]}
                name="Persentase IKU"
                onClick={(payload: { payload?: { faculty?: string; prodi?: string } }) => {
                  const clicked = payload?.payload;
                  if (!clicked?.faculty || !clicked?.prodi) return;
                  setFaculty(clicked.faculty);
                  setProdi(clicked.prodi);
                }}
                style={{ cursor: "pointer" }}
              />
            </BarChart>
          </ResponsiveContainer>
        </Tile>

        <Tile style={{ minHeight: "340px", padding: "1rem", display: "flex", flexDirection: "column" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Distribusi Outcome Alumni</h4>
          <div style={{ display: "flex", gap: "1rem", flex: 1, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 240, flex: "1 1 240px" }}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={outcomeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={65} outerRadius={95} paddingAngle={3}>
                    {outcomeDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={donutColors[index % donutColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", minWidth: 220, flex: "1 1 220px" }}>
              {outcomeDistribution.map((entry, index) => {
                const pct = safePercent(entry.value, summary.totalGraduates);
                return (
                  <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "999px", background: donutColors[index % donutColors.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                    <strong>{formatPercent(pct)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </Tile>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "1rem" }}>
        <Tile style={{ minHeight: "340px", padding: "1rem" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Komposisi Outcome per Fakultas</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={facultyComposition}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="faculty" />
              <YAxis />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar dataKey="bekerja" stackId="outcome" fill="#0f62fe" name="Bekerja" />
              <Bar dataKey="lanjutStudi" stackId="outcome" fill="#8a3ffc" name="Lanjut Studi" />
              <Bar dataKey="wirausaha" stackId="outcome" fill="#198038" name="Wirausaha" />
            </BarChart>
          </ResponsiveContainer>
        </Tile>

        <Tile style={{ minHeight: "340px", padding: "1rem", display: "flex", flexDirection: "column" }}>
          <h4 style={{ margin: "0 0 0.75rem 0" }}>Heatmap Fakultas vs Tahun</h4>
          <div style={{ flex: 1, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr style={{ background: "var(--cds-layer-02)", borderBottom: "1px solid var(--cds-border-subtle-01)" }}>
                  <th style={{ padding: "0.6rem", textAlign: "left", fontWeight: 600 }}>Fakultas</th>
                  {heatmap.years.map((yearLabel) => (
                    <th key={yearLabel} style={{ padding: "0.6rem", textAlign: "center", fontWeight: 600 }}>
                      {yearLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.matrix.map((row) => (
                  <tr key={row.faculty} style={{ borderBottom: "1px solid var(--cds-border-subtle-00)" }}>
                    <td style={{ padding: "0.6rem", fontWeight: 600 }}>{row.faculty}</td>
                    {row.cells.map((cell) => {
                      const tone = colorForPercent(cell.iku);
                      return (
                        <td key={`${row.faculty}-${cell.year}`} style={{ padding: "0.4rem" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setFaculty(row.faculty);
                              setYear(cell.year);
                              setProdi("");
                            }}
                            title={`${row.faculty} - ${cell.year} : ${formatPercent(cell.iku)}`}
                            style={{
                              width: "100%",
                              border: "none",
                              borderRadius: "4px",
                              padding: "0.55rem 0.4rem",
                              background: tone.bg,
                              color: tone.fg,
                              fontWeight: 600,
                              fontVariantNumeric: "tabular-nums",
                              cursor: "pointer",
                            }}
                          >
                            {cell.graduates > 0 ? formatPercent(cell.iku) : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tile>
      </section>

      <Tile style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <div>
            <h4 style={{ margin: "0 0 0.25rem 0" }}>Tabel Detail</h4>
            <p style={{ margin: 0, color: "var(--cds-text-secondary)", fontSize: "0.75rem" }}>
              Drill-down detail row-level mengikuti filter aktif. Klik header untuk sort.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Button size="sm" kind="tertiary" renderIcon={Download} onClick={downloadCsv}>
              Export CSV
            </Button>
            <Button size="sm" kind="primary" renderIcon={Download} onClick={downloadExcel}>
              Export Excel
            </Button>
          </div>
        </div>

        <TableContainer title="" description="">
          <TableToolbar>
            <TableToolbarContent>
            </TableToolbarContent>
          </TableToolbar>

          <Table>
            <TableHead>
              <TableRow>
                {[
                  { key: "year", header: "Tahun" },
                  { key: "faculty", header: "Fakultas" },
                  { key: "prodi", header: "Prodi" },
                  { key: "graduates", header: "Total Lulusan" },
                  { key: "bekerja", header: "Bekerja" },
                  { key: "lanjutStudi", header: "Lanjut Studi" },
                  { key: "wirausaha", header: "Wirausaha" },
                  { key: "iku", header: "Persentase IKU" },
                ].map((column) => {
                  const active = tableSortKey === (column.key as SortKey);
                  const direction = active ? tableSortDirection : "desc";
                  return (
                    <TableHeader
                      key={column.key}
                      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                      onClick={() => setSort(column.key as SortKey)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        {column.header}
                        {active && <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span>}
                      </span>
                    </TableHeader>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedTableRows.map((row, index) => (
                <TableRow key={buildTableRowKey(row, index)}>
                  <TableCell>{row.year}</TableCell>
                  <TableCell>{row.faculty}</TableCell>
                  <TableCell>{row.prodi}</TableCell>
                  <TableCell>{formatNumber(row.totalGraduates)}</TableCell>
                  <TableCell>{formatNumber(row.bekerja)}</TableCell>
                  <TableCell>{formatNumber(row.lanjutStudi)}</TableCell>
                  <TableCell>{formatNumber(row.wirausaha)}</TableCell>
                  <TableCell>{formatPercent(row.ikuPercentage)}</TableCell>
                </TableRow>
              ))}
              {sortedTableRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} style={{ textAlign: "center", color: "var(--cds-text-secondary)", padding: "2rem" }}>
                    Tidak ada data yang cocok dengan filter atau pencarian.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Tile>

      {showInsightToast && (
        <div
          style={{
            position: "fixed",
            right: "1rem",
            bottom: "1rem",
            zIndex: 1200,
            width: "min(440px, calc(100vw - 2rem))",
          }}
        >
          <InlineNotification
            kind="info"
            title="Analisis Insight Otomatis"
            subtitle={insight}
            lowContrast
            onCloseButtonClick={() => setShowInsightToast(false)}
          />
        </div>
      )}
    </div>
  );
}
