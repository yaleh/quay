// suite-fs-trace.ts — the dynamic-truth collector for
// gap-suite-bucket-dynamic-truth-drift-detector (phase A).
//
// THE DEFECT THIS CLOSES: `suite-bucket-attribution.ts`'s static attribution is a PROXY (a static
// reference closure over the test file's text), so a subject reached only through a VARIABLE path
// segment is invisible to it — `worktree-root-fs-check.test.mjs` does
// `const pluginDir = path.resolve(__dirname, "..")` then
// `spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh")])`, and the static closure sees
// only the `scripts/quay-init.sh` fragment (no `plugin/scripts` prefix) ⇒ the M signal is lost and the
// test is statically attributed S (from its `scripts/test.sh` mention). THIS module produces the
// DYNAMIC TRUTH: it runs a test file in a traced subprocess (`node --require suite-fs-trace-preload.cjs`)
// and records every repo file the test actually reads/writes, so the variable-constructed
// `plugin/scripts/quay-init.sh` is observed, not guessed.
//
// INCREMENTAL CACHE (AC2 ②-AC2): the ground-truth map is cached at `.quay/suite-fs-trace.jsonl`
// (gitignored, a runtime derived product — never committed), one JSON line per test file
// `{file, hash, reads, writes}` where `hash` is the test file's content sha256. `updateTraceCache`
// re-runs the trace ONLY for test files whose content hash changed since the cached entry (or that
// have no entry yet) — an unchanged test is skipped, never re-traced (the trace run is a separate
// subprocess execution of the test's own code, so "don't re-run" is a real cost saving, not a no-op).
//
// The collector is a STANDALONE mechanism (opt-in CLI), NOT wired into the live suite: instrumenting
// every full-suite test process with the tracer would couple the observation to the run and risk
// perturbing it. The drift CHECKER (suite-bucket-drift-check.ts) consumes the cache; until the cache
// is populated the checker reports NOT-EVALUATED (hard rule 3b — never conflated with green).
//
// Run:
//   node --experimental-strip-types suite-fs-trace.ts --collect <test-file>... [--root <dir>]
//   node --experimental-strip-types suite-fs-trace.ts --update [--root <dir>] [--force] [--json]
//   node --experimental-strip-types suite-fs-trace.ts --list [--root <dir>]
//
// Exit codes: 0 = ok; 1 = a traced subprocess failed (fail-closed on the COLLECT side — a trace we
// could not obtain must not look like "the test reads nothing"); 2 = usage/env error.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";
import { listSuiteFiles } from "./suite-bucket-select.ts";

const PRELOAD_REL = "plugin/scripts/suite-fs-trace-preload.cjs";
const CACHE_REL = ".quay/suite-fs-trace.jsonl";

export interface TraceResult {
  /** repo-relative paths the test read at runtime. */
  reads: string[];
  /** repo-relative paths the test wrote at runtime. */
  writes: string[];
  /** the traced subprocess exit status (0 = clean). */
  status: number;
  /** stderr tail on failure ("" on clean). */
  error: string;
}

export interface TraceCacheEntry {
  file: string;
  hash: string;
  reads: string[];
  writes: string[];
}

/** sha256 of a file's content (the incremental-cache key — an unchanged test keeps its cached trace). */
export function contentHash(fileAbs: string): string {
  return createHash("sha256").update(fs.readFileSync(fileAbs)).digest("hex");
}

/** The absolute path of the preload, resolved against THIS module's own directory (the preload ships
 *  beside the collector), NOT `root` — a fixture root (a mutation case's temp dir, a unit test's
 *  /tmp tree) has no copy of the preload, so resolving against `root` would "Cannot find module". */
export function preloadAbs(_root?: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "suite-fs-trace-preload.cjs");
}

/**
 * Run ONE test file in a traced subprocess and return its dynamic truth. The subprocess is
 * `node --require <preload.cjs> <test-file>` — running the test file directly lets node:test's
 * default runner execute its tests, and the `--require` preload (a CJS preload) patches
 * node:fs / node:child_process BEFORE the test's ESM named imports are instantiated, so a
 * `import { spawnSync } from "node:child_process"` is observed. A spawn timeout/error is a distinct
 * `status` (never conflated with a clean-but-empty trace — hard rule 3b).
 * @param {string} testFileRel — repo-relative test file (e.g. `plugin/test/foo.test.mjs`).
 * @param {string} [root]
 * @param {number} [timeoutMs] — per-test subprocess timeout (default 120_000).
 */
export function traceOne(testFileRel: string, root = repoRoot(), timeoutMs = 120_000): TraceResult {
  const abs = path.join(root, testFileRel);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suite-fs-trace-"));
  const out = path.join(tmp, "trace.json");
  try {
    const res = spawnSync(
      process.execPath,
      ["--require", preloadAbs(root), abs],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        env: {
          ...process.env,
          QUAY_FS_TRACE_FILE: out,
          QUAY_FS_TRACE_ROOT: root,
          // A traced test may itself spawn scripts/test.sh (the suite-runner test family). Mark the
          // traced subprocess nested so that nested run skips the single-flight lock / static checks /
          // rebuild (scripts/test.sh's QUAY_TEST_NESTED guards) — otherwise it would contend on the
          // full-suite lock the collector's caller may hold, or re-run whole-store checks re-entrantly.
          QUAY_TEST_NESTED: "1",
          QUAY_TEST_NESTED_ROOT: root,
        },
      },
    );
    if (res.error) {
      return { reads: [], writes: [], status: -1, error: `spawn failed: ${res.error.message}` };
    }
    const status = res.status ?? 0;
    if (status !== 0) {
      return { reads: [], writes: [], status, error: (res.stderr ?? "").split("\n").slice(-5).join("\n").trim() };
    }
    if (!fs.existsSync(out)) {
      return { reads: [], writes: [], status: -2, error: `trace file not written (preload did not arm? ${PRELOAD_REL})` };
    }
    const payload = JSON.parse(fs.readFileSync(out, "utf8"));
    return { reads: Array.isArray(payload.reads) ? payload.reads : [], writes: Array.isArray(payload.writes) ? payload.writes : [], status: 0, error: "" };
  } catch (e) {
    return { reads: [], writes: [], status: -3, error: `trace read/parse failed: ${String(e)}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** Load the trace cache (absent/unreadable ⇒ empty map — a missing cache is a NOT-EVALUATED input, not a crash). */
export function loadTraceCache(root = repoRoot()): Map<string, TraceCacheEntry> {
  const map = new Map<string, TraceCacheEntry>();
  const file = path.join(root, CACHE_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as Partial<TraceCacheEntry>;
      if (typeof d.file === "string" && typeof d.hash === "string" && Array.isArray(d.reads) && Array.isArray(d.writes)) {
        map.set(d.file, { file: d.file, hash: d.hash, reads: d.reads, writes: d.writes });
      }
    } catch {
      // one bad line must not kill the cache read
    }
  }
  return map;
}

/** Write the trace cache back (best-effort: a write failure must not fail the collect — it degrades to re-trace). */
export function writeTraceCache(root: string, map: Map<string, TraceCacheEntry>): void {
  const lines: string[] = [];
  for (const e of map.values()) lines.push(JSON.stringify(e));
  try {
    const file = path.join(root, CACHE_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  } catch {
    // best-effort cache — never throw
  }
}

export interface UpdateResult {
  traced: string[];
  skipped: string[];
  failed: string[];
  /** entries in the cache after the update. */
  count: number;
}

/**
 * Incrementally update the trace cache: re-trace ONLY test files whose content hash changed (or that
 * have no entry); unchanged files keep their cached trace (AC2 ②-AC2). `force` re-traces everything.
 * A failed trace is recorded in `failed` and the entry is left untouched (fail-closed: a test we
 * could not trace must not silently keep/claim a stale truth). `limit` bounds the expensive work
 * per call (a production trigger piggybacks a SMALL batch per suite run — the trace is a separate
 * subprocess execution of each test's own code, so "at most limit traces" is a real cost bound):
 * unchanged files are still cheaply skipped past the limit, but at most `limit` subprocess traces run.
 * @param {readonly string[]} testFiles — repo-relative test files (listSuiteFiles).
 */
export function updateTraceCache(root: string, testFiles: readonly string[], opts: { force?: boolean; limit?: number } = {}): UpdateResult {
  const cache = loadTraceCache(root);
  const traced: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const rel of testFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const hash = contentHash(abs);
    const existing = cache.get(rel);
    if (!opts.force && existing && existing.hash === hash) {
      skipped.push(rel);
      continue;
    }
    if (opts.limit !== undefined && traced.length >= opts.limit) break; // bounded batch — no more traces this call
    const r = traceOne(rel, root);
    if (r.status !== 0) {
      failed.push(`${rel} (status=${r.status}: ${r.error})`);
      continue;
    }
    cache.set(rel, { file: rel, hash, reads: r.reads, writes: r.writes });
    traced.push(rel);
  }
  writeTraceCache(root, cache);
  return { traced, skipped, failed, count: cache.size };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-fs-trace.ts — dynamic-truth file-access trace collector (gap-suite-bucket-dynamic-truth-drift-detector)

Usage:
  node --experimental-strip-types suite-fs-trace.ts --collect <test-file>... [--root <dir>] [--json]
      trace the given test files (write their truth into the cache).
  node --experimental-strip-types suite-fs-trace.ts --update [--root <dir>] [--force] [--limit N] [--json]
      incrementally re-trace changed/new suite test files (at most --limit traces per call).
  node --experimental-strip-types suite-fs-trace.ts --list [--root <dir>] [--json]
      print the cached test→{reads,writes} map.`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");

  if (args.includes("--collect")) {
    const files = args.filter((a) => !a.startsWith("--") && !["--collect", "--root", "--json"].includes(a) && a !== flagValue(args, "--root"));
    if (files.length === 0) {
      process.stderr.write(`${usage}\n`);
      return 2;
    }
    let failed = 0;
    const out: Array<{ file: string; reads: string[]; writes: string[] }> = [];
    const cache = loadTraceCache(root);
    for (const rel of files) {
      const r = traceOne(rel, root);
      if (r.status !== 0) {
        failed += 1;
        process.stderr.write(`suite-fs-trace: trace failed for ${rel}: ${r.error}\n`);
        continue;
      }
      cache.set(rel, { file: rel, hash: contentHash(path.join(root, rel)), reads: r.reads, writes: r.writes });
      out.push({ file: rel, reads: r.reads, writes: r.writes });
    }
    writeTraceCache(root, cache);
    if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else for (const o of out) process.stdout.write(`${o.file}\treads=[${o.reads.join(", ")}]\twrites=[${o.writes.join(", ")}]\n`);
    return failed > 0 ? 1 : 0;
  }

  if (args.includes("--update")) {
    const limitRaw = flagValue(args, "--limit");
    const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
    const res = updateTraceCache(root, listSuiteFiles(root), {
      force: args.includes("--force"),
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    });
    if (asJson) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    else {
      process.stdout.write(`traced=${res.traced.length} skipped=${res.skipped.length} failed=${res.failed.length} cache=${res.count}\n`);
      for (const f of res.failed) process.stderr.write(`suite-fs-trace: FAILED ${f}\n`);
    }
    return res.failed.length > 0 ? 1 : 0;
  }

  if (args.includes("--list")) {
    const cache = loadTraceCache(root);
    if (asJson) process.stdout.write(JSON.stringify([...cache.values()], null, 2) + "\n");
    else for (const e of cache.values()) process.stdout.write(`${e.file}\treads=[${e.reads.join(", ")}]\twrites=[${e.writes.join(", ")}]\n`);
    return 0;
  }

  process.stderr.write(`${usage}\n`);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "suite-fs-trace")) {
  process.exitCode = main(process.argv);
}
