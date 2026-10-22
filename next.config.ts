import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>;
type TurbopackRule = Extract<TurbopackRules[string], { as?: string }>;

const sassOptions = {
  silenceDeprecations: ["legacy-js-api"],
};

/**
 * Loader Sass untuk Turbopack.
 *
 * Loader bawaan (experimental.turbopackUseBuiltinSass) me-resolve @use relatif di dalam paket
 * lewat resolver Turbopack yang mengabaikan `preferRelative`, sehingga impor relatif Carbon
 * (mis. `@use './config'` di @carbon/styles) gagal. Dengan `webpackImporter: false`, Sass
 * memuat paket langsung dari `loadPaths` (filesystem), dan impor relatif di dalamnya berjalan normal.
 */
function sassRule(as: "*.css" | "*.module.css"): TurbopackRule {
  return {
    loaders: [
      {
        loader: "next/dist/build/webpack/loaders/resolve-url-loader/index",
        options: { sourceMap: true },
      },
      {
        loader: "next/dist/compiled/sass-loader",
        options: {
          sourceMap: true,
          webpackImporter: false,
          sassOptions: { ...sassOptions, loadPaths: [join(projectRoot, "node_modules")] },
        },
      },
    ],
    as,
  };
}

const turbopackRules: TurbopackRules = {
  "*.module.scss": sassRule("*.module.css"),
  "*.scss": sassRule("*.css"),
};

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  experimental: {
    // Diganti oleh turbopack.rules di atas (lihat komentar sassRule).
    turbopackUseBuiltinSass: false,
  },
  turbopack: {
    root: projectRoot,
    rules: turbopackRules,
  },
  // Dipakai saat build dengan webpack (`next build --webpack`).
  sassOptions: {
    ...sassOptions,
    includePaths: ["./node_modules"],
  },
};

export default nextConfig;