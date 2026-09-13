#!/usr/bin/env node
// state-worded-clause-check.ts — result-state-clause checker
// (tasks/gap-ac41-actionize-state-worded-clauses, AC4 — the mechanical realization of the
// ## Contract `measure`/`band`).
//
// WHAT IT DETECTS: the three execution cores (manager / orchestrator / fast-mode tick-core) must
// phrase every executable clause as an ACTION + a mechanically verifiable product — "run THIS
// command, wait for THAT reading" — not as a RESULT STATE ("确保 / 保证 / 自测绿 / 直到…绿").
// The defect class is the 2026-08-10 incident: orchestrator A15 ④'s 「自测绿」 is a result state
// ("green"), not an action; an executor holding 「自测绿」 + a file reference reasonably read it as
// "observe the suite until it turns green" (scope=main failure) while the executor holding the
// actionized form ("run scripts/test.sh in the worktree until verification-round.jsonl carries a
// scope=worktree + state=green record") did the right thing (scope=worktree success).
//
// SCAN SURFACE (a ## Contract invariant — the doc set must stay byte-identical across runs):
//     orchestration/manager-tick-core.md
//     orchestration/orchestrator-tick-core.md
//     orchestration/fast-mode-tick-core.md
//   The `## Contract` measure is the literal count of the regex below over this exact set. A
//   missing scan doc is an ERROR (exit 1) so a rename/delete of a scan target fails loudly instead
//   of silently shrinking the surface. The broader enumeration surface (plugin/skills/, the
//   source loop-tick.md reason docs) is NOT scanned here — the measure's band is tick-core-only.
//
// JUDGMENT: by the literal state-word pattern (the measure IS the contract), but every hit is
// REPORTED with file:line:snippet so a future hit is debuggable — a bare `grep -c` would hide
// which clause regressed. `直到.*绿` is line-scoped so a "until … green" in one clause cannot be
// matched by an unrelated 「绿」 later in the same table cell (the 2026-08-10 orchestrator:35 shape).
//
// MODES:
//   default        — scan the three tick-cores under --root; exit 0 iff the total hit count == 0
//                    (the Contract `band 0`).
//   --judge <path> — judge ONE arbitrary file (absolute or --root-relative); exit 1 iff it carries
//                    any state-word hit (the AC4 controls + mutation case + tests).
//   --json         — machine-readable output; the ## Contract measure reads the `count` / `hits`.
//
// Exit codes: 0 = PASS (band 0); 1 = FAIL (a state-word hit, or a scan target missing);
//             2 = usage/env error.
//
// Run:
//   node --experimental-strip-types plugin/scripts/state-worded-clause-check.ts [--root <dir>]
//       [--judge <path>] [--json]
//   scripts/test.sh plugin/test/state-worded-clause-check.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/**
 * The ## Contract measure regex — result-state words an executable clause must NOT use.
 * `直到.*绿` is intended to catch "until green" phrasings; it is applied PER-LINE (not across the
 * whole file) so an unrelated 「未绿」 in a later sentence of the same table cell cannot be dragged
 * into a hit by a leading 「直到」 (see the DEFAULT_LINE_RE note below).
 *
 * ACTIONIZED EXEMPTION (manager 2026-08-10 ruling, the A15 ④ shape): a clause that gives BOTH a
 * runnable command (`scripts/test.sh`) AND a readable artifact (`verification-round.jsonl`) is the
 * ACTIONIZED form AC41 判据① demands — "run THIS command until THAT artifact reads state=green" —
 * and passes REGARDLESS of whether its wording contains 直到/出现. `state=green` is latin (no Chinese
 * 绿), so a Chinese `绿` on the same line can only come from a LATER unrelated clause (绿退/未绿) in the
 * same table cell; the raw `直到.*绿` sweep then false-positives the actionized line. The fix keeps
 * the hard result-state words (自测绿/确保/保证) unconditional but exempts `直到.*绿` when the line
 * also carries a command + an artifact.
 */
export const STATE_WORD_RE = /自测绿|确保|保证|直到.*绿/;

/** A runnable command on the line (backtick-quoted executable, or `bash/node/scripts/…`). */
const COMMAND_RE = /`[^`]*\.(?:sh|ts|mjs|js)`|(?:\bbash\s+|\bnode\s+)(?:\S+\s+)*(?:\S+\.(?:sh|ts|mjs|js)|\S+)/;

/** A readable artifact on the line (backtick-quoted .jsonl/.json/.log/.md path, or state file). */
const ARTIFACT_RE = /`[^`]*\.(?:jsonl|json|log|md)`|verification-round\.jsonl|full-suite-state\.json/;

/**
 * True when the line carries BOTH a runnable command AND a readable artifact — the actionized form
 * (AC41 判据①: 动作 + 可核产物). Such a line's `直到…绿` is the command's termination condition, not
 * a bare result-state clause, so it is exempt from the `直到.*绿` alternative.
 */
export function isActionized(line: string): boolean {
  return COMMAND_RE.test(line) && ARTIFACT_RE.test(line);
}

/** One reported hit. */
export interface StateWordHit {
  file: string;
  line: number;
  hit: string;
  snippet: string;
}

/** Result of scanning one file. */
export interface FileResult {
  file: string;
  hits: StateWordHit[];
}

/** The fixed scan surface (a ## Contract invariant — the doc set must stay byte-identical). */
export const SCAN_DOCS = [
  "orchestration/manager-tick-core.md",
  "orchestration/orchestrator-tick-core.md",
  "orchestration/fast-mode-tick-core.md",
] as const;

/** Scan one file's text; returns every line carrying a state-word hit with a trimmed snippet. */
export function scanText(fileRel: string, text: string): StateWordHit[] {
  const hits: StateWordHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Per-LINE match: `直到.*绿` must resolve within the same line so an unrelated later 「绿」
    // (e.g. "未绿退出" in a different sentence of the same table cell) cannot be swept into a hit.
    // Split the sweep: HARD result-state words (自测绿/确保/保证) are unconditional — an actionized
    // clause never contains them (the actionized form REPLACES 自测绿 with "跑 <cmd> 直到 <产物> 绿").
    // The `直到.*绿` alternative gets the ACTIONIZED EXEMPTION (manager 2026-08-10): a line carrying
    // BOTH a runnable command AND a readable artifact is the actionized form AC41 判据① demands — its
    // `直到…绿` is the command's termination condition, not a bare result state. (The A15 ④ shape:
    // "跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green`" —
    // `state=green` is latin, so a Chinese 绿 on that line can only come from a LATER unrelated clause
    // in the same table cell.) The negative control (原文「自测绿」, no command/artifact) is untouched.
    const hard = line.match(/自测绿|确保|保证/);
    const until = line.match(/直到.*绿/);
    if (!hard && !until) continue;
    const hit = hard ? hard[0] : until![0];
    if (until && isActionized(line) && !hard) continue;
    hits.push({
      file: fileRel,
      line: i + 1,
      hit,
      snippet: line.trim().slice(0, 120),
    });
  }
  return hits;
}

/**
 * Scan the tick-core files under `root`. A missing scan target is an ERROR (the ## Contract
 * invariant: the doc set must stay byte-identical — a renamed/deleted scan doc must fail loudly).
 */
export function scanTicks(root: string): FileResult[] {
  return SCAN_DOCS.map((rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `state-worded-clause-check: scan target missing — ${rel} (the ## Contract invariant scan set must stay byte-identical; a renamed/deleted tick-core is a silent-surface-shrink, not a green pass)`,
      );
    }
    const text = fs.readFileSync(abs, "utf8");
    return { file: rel, hits: scanText(rel, text) };
  });
}

/** Judge ONE arbitrary file (absolute or root-relative) — the AC4 / --judge control surface. */
export function judgeFile(root: string, target: string): FileResult {
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  if (!fs.existsSync(abs)) {
    throw new Error(`state-worded-clause-check: --judge target missing — ${target}`);
  }
  const rel = path.isAbsolute(target)
    ? path.relative(root, abs)
    : target.replace(/\\/g, "/");
  const text = fs.readFileSync(abs, "utf8");
  return { file: rel, hits: scanText(rel, text) };
}

interface CliResult {
  code: number;
  json: unknown;
}

function usage(): CliResult {
  process.stderr.write(
    "usage: state-worded-clause-check.ts [--root <dir>] [--judge <path>] [--json]\n",
  );
  return { code: 2, json: { error: "usage" } };
}

export function main(argv: string[]): CliResult {
  let root = process.cwd();
  let judge: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i];
      if (root === undefined) return usage();
    } else if (a === "--judge") {
      judge = argv[++i];
      if (judge === undefined) return usage();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "state-worded-clause-check.ts — is every executable clause in the three tick-cores an ACTION + mechanically verifiable product, not a result state (自测绿/确保/保证/直到…绿)?\n",
      );
      return { code: 0, json: { help: true } };
    } else {
      return usage();
    }
  }

  let results: FileResult[];
  try {
    results = judge ? [judgeFile(root, judge)] : scanTicks(root);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return { code: 1, json: { error: (err as Error).message } };
  }

  const total = results.reduce((n, r) => n + r.hits.length, 0);
  const out = {
    count: total,
    band: 0,
    hits: results.flatMap((r) => r.hits),
  };
  if (json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else if (total > 0) {
    for (const h of out.hits) {
      process.stdout.write(
        `state-worded-clause-check: ${h.file}:${h.line} — ${h.hit}\n  ${h.snippet}\n`,
      );
    }
    process.stdout.write(
      `state-worded-clause-check: ${total} state-worded clause(s) — the ## Contract band is 0; actionize each as "run THIS command, wait for THAT readable product".\n`,
    );
  } else {
    process.stdout.write(
      "state-worded-clause-check: 0 state-worded clauses across the three tick-cores (band 0).\n",
    );
  }
  return { code: total === 0 ? 0 : 1, json: out };
}

if (isDirectEntry(import.meta, undefined, "state-worded-clause-check")) {
  const res = main(process.argv.slice(2));
  process.exitCode = res.code;
}
