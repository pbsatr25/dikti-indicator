"use client";

// Render teks jawaban LLM (Markdown + tabel GFM) dengan komponen Carbon.
// HTML mentah di dalam teks tidak dirender (bawaan react-markdown), dan gambar dibuang,
// sehingga jawaban LLM tidak bisa menyisipkan elemen berbahaya.

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@carbon/react";
import styles from "./chat.module.scss";

// Judul dari LLM ditampilkan sebagai paragraf tebal agar tidak bersaing dengan judul panel.
const Heading: Components["h1"] = ({ children }) => (
  <p>
    <strong>{children}</strong>
  </p>
);

const components: Components = {
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className={styles.tableWrap}>
      <Table size="sm" useZebraStyles={false}>
        {children}
      </Table>
    </div>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  // Perataan kolom dari sintaks GFM (|---:|) datang sebagai style text-align.
  th: ({ children, style }) => (
    <TableHeader className={style?.textAlign === "right" ? styles.cellEnd : undefined}>{children}</TableHeader>
  ),
  td: ({ children, style }) => (
    <TableCell className={style?.textAlign === "right" ? styles.cellEnd : undefined}>{children}</TableCell>
  ),
};

export function MarkdownAnswer({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={["img"]} unwrapDisallowed>
        {text}
      </Markdown>
    </div>
  );
}
