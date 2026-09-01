#!/usr/bin/env node
// runner-grouping.ts — the --group / __GROUP__ grouping mechanism, NOW a real TypeScript module
// (gap-suite-classification-lpt-scheduler-ts-ization).
//
// This file USED to be bash-under-a-.ts-name: scripts/test.sh `source`d it (bash does not care about
// the extension) to get the classification/selection functions that decide WHICH test files run for a
// given --group. The ts-ization task moved those functions OUT of bash and INTO real TypeScript, so:
//   - scripts/test.sh no longer `source`s this file — it calls the CLI (below) as a thin forwarder, and
//     the pure functions are IMPORTED by suite-scheduler.ts (which now does classification → LPT →
//     scheduling internally, off a RAW file list).
//   - the `.ts` name is no longer a "make the HUB glob match a real file" trick — it is a real module.
//
// WHY A HUB FILE: these functions decide WHICH tests run, so this file is harness-critical — a change
// still forces the full suite (suite-bucket-hub-list.ts HUB_FILES glob `plugin/scripts/runner-grouping*`
// matches it).
//
// CLASSIFICATION SEMANTICS ARE BYTE-IDENTICAL to the OLD grep|awk (and to
// plugin/scripts/runner-grouping-metadata.mjs, which is the one-pass realpath-dedup + @test-group reader
// test.sh still uses for the metadata modes — that helper's groupOf is THIS module's groupOf):
//   - groupOf(content) — the first `@test-group` + inline whitespace + a lowercase word; awk's 2nd field.
//     A MISSING declaration defaults to engine (AC7). An UNRECOGNIZED name is FAIL-CLOSED (exit 3) in
//     classifyFile — never silently degraded to engine (the r10 dropped-group regression must stay hard).
//   - A file that is BINARY (a NUL byte in its first 32 KiB) is classified engine, never its
//     (unreachable) declaration — the byte-identical mirror of GNU grep's binary detection
//     (observation.test.mjs is the one real case: 8 NUL bytes inside a `@test-group product` file).
//
// TWO layers:
//   1. PURE functions (groupOf / classifyFile / effectiveGroups / inGroup / isDefaultSet / selectFiles /
//      listGroups) — imported by suite-scheduler.ts and unit-tested.
//   2. The CLI — test.sh's thin-forward surface for the metadata modes (--list-groups / --list-files)
//      and the retired legacy fallback's bucket split. It consumes the `path<TAB>group` metadata that
//      build_deduped_files produces (via runner-grouping-metadata.mjs), so it never re-reads a file —
//      classification stays a single in-process pass.

import fs from "node:fs";
import { isDirectEntry } from "./gate-script-base.ts";

/** A test file's declared group (the four recognized groups; product+engine collapse to "main" in the
 *  scheduler's three-bucket view, serial/lowconc map 1:1). */
export type DeclaredGroup = "product" | "engine" | "serial" | "lowconc";
export const RECOGNIZED_GROUPS: readonly DeclaredGroup[] = ["product", "engine", "serial", "lowconc"];
const RECOGNIZED = new Set<string>(RECOGNIZED_GROUPS);

export function isRecognizedGroup(g: string): g is DeclaredGroup {
  return RECOGNIZED.has(g);
}

/** groupOf(content) — mirror of the OLD grep|awk and of runner-grouping-metadata.mjs groupOf:
 *     grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" | awk '{print $2}'
 *  The first `@test-group` + inline whitespace + a lowercase word; awk's 2nd whitespace field is the
 *  group name. POSIX [[:space:]] within a grep line == [ \t\v\f\r]. An absent declaration → "engine"
 *  (AC7); an UNRECOGNIZED name is returned as-is so the caller can FAIL-CLOSED (never silently degrade). */
export function groupOf(content: string): string {
  const m = content.match(/@test-group[ \t\v\f\r]+[a-z]+/);
  if (!m) return "engine";
  const g = m[0].split(/[ \t]+/)[1];
  return g ?? "engine";
}

function failClosed(file: string, g: string): never {
  const msg =
    `scripts/test.sh: FAIL-CLOSED: '${file}' declares unknown @test-group '${g}' — a group was dropped or mis-typed (recognized: product|engine|serial|lowconc); refusing to silently degrade it to engine`;
  process.stderr.write(msg + "\n");
  process.exit(3);
}

/** classifyFile(file) — read a file, binary-detect (NUL in first 32KiB → engine, byte-identical to GNU
 *  grep), then groupOf; an UNKNOWN name FAIL-CLOSES (exit 3). This is the per-file classification
 *  suite-scheduler.ts runs over its RAW file list (the scheduler is the new canonical classifier). */
export function classifyFile(file: string): DeclaredGroup {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch {
    buf = Buffer.alloc(0); // unreadable → undeclared (grep 2>/dev/null → empty → engine)
  }
  if (buf.subarray(0, 32768).includes(0)) return "engine";
  const g = groupOf(buf.toString("utf8"));
  if (!isRecognizedGroup(g)) failClosed(file, g);
  return g;
}

/** effectiveGroups() — the default run's group set (AC4): the product+engine body. `serial`/`lowconc`
 *  are their own phases, never the default body. */
export function effectiveGroups(): string {
  return "product,engine";
}

/** inGroup(group, csv) — true iff group ∈ the comma-separated list. */
export function inGroup(group: string, csv: string): boolean {
  return `,${csv},`.includes(`,${group},`);
}

/** isDefaultSet(csv) — true iff csv is exactly the default set {product,engine} (AC6). */
export function isDefaultSet(csv: string): boolean {
  return csv === "product,engine";
}

/** A `[path, group]` entry — the shape of build_deduped_files' metadata (runner-grouping-metadata.mjs
 *  outputs `realpath<TAB>group` per deduped file). */
export type GroupEntry = [string, string];

/** selectFiles(entries, csv) — the files whose group ∈ csv, in input order (AC4/AC6). */
export function selectFiles(entries: GroupEntry[], csv: string): string[] {
  const out: string[] = [];
  for (const [file, g] of entries) if (inGroup(g, csv)) out.push(file);
  return out;
}

/** listGroups(entries) — per-group counts over the deduped glob (AC10). */
export function listGroups(entries: GroupEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of RECOGNIZED_GROUPS) counts.set(g, 0);
  for (const [, g] of entries) counts.set(g, (counts.get(g) ?? 0) + 1);
  return counts;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** Parse `path<TAB>group` lines (the runner-grouping-metadata.mjs output). */
function parseEntries(raw: string): GroupEntry[] {
  const entries: GroupEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("\t");
    if (idx <= 0) continue;
    const file = line.slice(0, idx);
    const g = line.slice(idx + 1);
    if (!file || !g) continue;
    entries.push([file, g]);
  }
  return entries;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stderr.write(
      "runner-grouping.ts — the --group classification/selection mechanism (TS, gap-suite-classification-lpt-scheduler-ts-ization)\n" +
        "usage:\n" +
        "  <path\\tgroup lines on stdin> | node runner-grouping.ts --list-groups\n" +
        "  <path\\tgroup lines on stdin> | node runner-grouping.ts --select <group[,group...]>\n" +
        "  <raw paths on stdin>         | node runner-grouping.ts --classify\n" +
        "  node runner-grouping.ts --effective-groups\n",
    );
    return 0;
  }
  if (args[0] === "--effective-groups") {
    process.stdout.write(effectiveGroups() + "\n");
    return 0;
  }
  const raw = await readStdin();
  if (args[0] === "--list-groups") {
    const entries = parseEntries(raw);
    const counts = listGroups(entries);
    let total = 0;
    for (const g of RECOGNIZED_GROUPS) {
      const n = counts.get(g) ?? 0;
      total += n;
      process.stdout.write(`${g}:    ${n}\n`);
    }
    process.stdout.write(`total:      ${total} (deduped by realpath)\n`);
    return 0;
  }
  if (args[0] === "--select" && args.length >= 2) {
    const csv = args[1];
    const entries = parseEntries(raw);
    for (const file of selectFiles(entries, csv)) process.stdout.write(file + "\n");
    return 0;
  }
  if (args[0] === "--classify") {
    // RAW paths in, `path<TAB>group` out — the retired legacy bucket split's classification source
    // (fail-closed on an unknown group, same as the old group_of).
    const paths = raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const p of paths) process.stdout.write(`${p}\t${classifyFile(p)}\n`);
    return 0;
  }
  process.stderr.write("runner-grouping.ts: unknown/missing subcommand (see --help)\n");
  return 2;
}

if (isDirectEntry(import.meta, undefined, "runner-grouping")) {
  main(process.argv).then((code) => process.exit(code));
}
