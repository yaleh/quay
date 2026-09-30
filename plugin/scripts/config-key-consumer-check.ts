#!/usr/bin/env node
// config-key-consumer-check.ts — mechanical enumeration of delivered config-key consumers
// (tasks/gap-config-key-consumer-check-mechanical-enumeration, GOAL-015 退出条件③ / AC-235).
//
// THE CLASS-LEVEL DISCIPLINE: every config key quay-init writes into a downstream project's
// `.quay/config.yml` `loop:` section must have a CODE CONSUMER — a key delivered with no reader is
// a dead key ("交付了却没人读", GOAL-015 缺口 B). The audited instance: quay-init wrote a branch-model
// merge key (`…: integration`) that the whole repo never read (downstream fan-in recorded
// `mergeTarget: None` and merged develop); the control `fork_baseline` has a real consumer
// (`fork-baseline.ts`). The difference between the two is exactly what this judgment separates
// mechanically.
//
// WRITER FACE (mechanically derived, never hand-listed): the keys quay-init writes are EXTRACTED
// from `plugin/scripts/quay-init.sh` — both the fresh-install heredoc (`loop:` block, two-space
// `  key:` lines) AND the config-preserving-upgrade python writer (`loop["key"] = …`). Adding a key
// to quay-init is picked up automatically; a hand-maintained key list would drift the exact way
// this task exists to stop.
//
// CONSUMER FACE (mechanically grepped): the goal's own evidence scope — top-level `.ts` files in
// `plugin/scripts/` + `packages/quay/src/`, excluding test files (`*.test.*`) and this checker
// itself. A key "has a consumer" iff ≥1 consumer file references it (the SAME literal-grep standard
// AC-235 states: `grep -rn '<key>' plugin/scripts/*.ts packages/quay/src/*.ts`).
//
// THREE-STATE OUTPUT (GOAL-015 风险 3 — 枚举可区分三态, ⛔ 豁免不是无理由 allowlist):
//   has-consumer           ≥1 consumer file references the key.
//   no-consumer-to-wire    zero references and no documented reason ⇒ RED (the defect class).
//   documented-with-reason zero references but an exemption WITH a reason text (reviewable).
// An exemption entry with a blank reason is a checker config error (exit 2, fail-closed) — the
// "documented" in documented-with-reason must be real text, never an empty string.
//
// MODES:
//   default — enumerate, print a per-key breakdown, PASS/FAIL verdict line. Exit 0 iff
//             no_consumer_to_wire == 0.
//   --json  — machine-readable report (the ## Contract / AC measure surface).
//
// Exit codes: 0 = PASS (every delivered key has a consumer or a documented reason);
//             1 = FAIL (≥1 key with no consumer and no reason);
//             2 = usage/env error (writer face unreadable, blank exemption reason, bad --root).

import fs from "node:fs";
import path from "node:path";
import { emitVerdict, helpExit, isDirectEntry, readFileSafe } from "./gate-script-base.ts";

// ── faces ───────────────────────────────────────────────────────────────────────────────────────────

/** The writer face: quay-init.sh writes delivery config keys into downstream `.quay/config.yml`. */
export const WRITER_REL = "plugin/scripts/quay-init.sh";

/** The SECOND writer face (gap-serve-binding-defaults-three-copies-to-one-definition-point P3.3):
 *  the `serve:` section is written by `packages/quay/src/init.ts` — both the fresh-install template
 *  and the comment-preserving reconcile (`quay init --reconcile`) — NOT by quay-init.sh, whose
 *  `ensure_loop_config` delegates the loop section to `ensureLoopConfig` in that same TS module
 *  (quay-init.sh:420: "one implementation, no second copy"). Reading only the shell face would leave
 *  the serve keys un-enumerated — a delivered key this checker simply could not see, which is the
 *  exact invisibility the check exists to remove. */
export const INIT_REL = "packages/quay/src/init.ts";

/** The table whose `Object.entries` IS the emitted `serve:` block (`generateConfigContent`) and the
 *  filled set (`reconcileConfigContent`) — so its keys ARE the delivered keys. */
export const SERVE_TABLE_MARKER = "export const SERVE_VERSION_DEFAULTS";

/** The consumer face: the goal's own evidence scope (top-level .ts, non-test). */
export const CONSUMER_DIRS: readonly string[] = ["plugin/scripts", "packages/quay/src"];

/** This checker's own basename — excluded from the consumer face (it must not read as a consumer of
 *  the keys it enumerates, and AC-235's own `grep` scope would otherwise count a self-mention). */
export const SELF_BASENAME = "config-key-consumer-check.ts";

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export type KeyState = "has-consumer" | "no-consumer-to-wire" | "documented-with-reason";

export interface KeyEntry {
  key: string;
  state: KeyState;
  /** Number of consumer files that reference the key. */
  consumers: number;
  /** Present only for `documented-with-reason` — the reviewable reason text. */
  reason?: string;
}

/** A documented-with-reason exemption. `reason` is MANDATORY and non-blank (fail-closed at audit). */
export interface Exemption {
  key: string;
  reason: string;
}

export interface AuditReport {
  mode: "config-key-consumer-audit";
  writer: string;
  consumerDirs: readonly string[];
  keys_total: number;
  no_consumer_to_wire: number;
  states: Record<KeyState, number>;
  entries: KeyEntry[];
}

// ── the exemption registry (documented-with-reason; 豁免必须带理由文本, ⛔ 不是无理由 allowlist) ──

export const EXEMPTIONS: Exemption[] = [
  // No delivered config key currently needs an exemption. When one does (a key kept for a documented
  // reason, e.g. "written for human-readable config, consumed by downstream tooling outside this
  // repo"), add it HERE with a non-blank `reason` — never drop it into a bare allowlist.
];

// ── writer-face extraction (mechanical, from quay-init.sh) ──────────────────────────────────────────

/** Extract the delivery config keys quay-init writes, from BOTH writer forms:
 *  (a) the fresh-install heredoc — a `loop:` line at column 0 followed by `  <key>:` lines;
 *  (b) the config-preserving-upgrade python writer — `loop["<key>"] = …` assignments.
 *
 *  An INDENTED YAML comment inside the block (`  # …`, e.g. the `loop.test_command` contract note
 *  written next to `test_command`) is SKIPPED, not a terminator — a comment is not a key and does not
 *  end the mapping. Treating it as a terminator silently truncated the key set: a key written after
 *  such a note was never enumerated, hence never consumer-checked, and `--capture` baked the
 *  truncated set into the committed baseline — so the missing key could never show up as a shrink
 *  either (fail-silent in both directions). The block still ends at a blank line, EOF, or a
 *  non-two-space line; a COLUMN-0 comment keeps terminating it, because skipping those would let the
 *  scan run on into the next top-level block and enumerate that block's indented keys as loop keys. */
export function extractWriterKeys(src: string): string[] {
  const keys = new Set<string>();
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^loop:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[ \t]+#/.test(lines[j])) continue; // an indented comment is not a key, does not end the block
        const m = /^  ([a-z_][a-z0-9_]*):/.exec(lines[j]);
        if (!m) break; // blank line / EOF / a non-two-space key terminates the loop: block
        keys.add(m[1]);
      }
    }
  }
  for (const line of lines) {
    const m = /loop\["([a-z_][a-z0-9_]*)"\]\s*=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

/** Extract the `serve:` config keys from the TS writer face (init.ts): the keys of the
 *  `SERVE_VERSION_DEFAULTS` table, which is what the fresh-install template emits and what the
 *  reconcile fills. A missing marker yields [] — the caller treats an absent second face as "no
 *  serve keys delivered", never as a crash (the shell face is still the hard requirement). */
export function extractServeVersionKeys(initSrc: string): string[] {
  const at = initSrc.indexOf(SERVE_TABLE_MARKER);
  if (at === -1) return [];
  const open = initSrc.indexOf("{", at);
  if (open === -1) return [];
  // Balanced-brace scan so a nested value (a list, a nested map) cannot end the table early.
  let depth = 0;
  let end = open;
  for (; end < initSrc.length; end++) {
    if (initSrc[end] === "{") depth += 1;
    else if (initSrc[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const keys = new Set<string>();
  for (const line of initSrc.slice(open + 1, end).split("\n")) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s*:/.exec(line);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

/** Collect the consumer face: top-level `.ts` files in CONSUMER_DIRS, excluding `*.test.*` and this
 *  checker. Returns a map of repo-relative path → file content. */
export function listConsumerFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of CONSUMER_DIRS) {
    const abs = path.join(root, dir);
    let names: string[];
    try {
      names = fs.readdirSync(abs);
    } catch {
      continue; // a missing consumer dir contributes no files (never a hard error — the writer face is)
    }
    for (const name of names) {
      if (!name.endsWith(".ts")) continue;
      if (/\.test\./.test(name)) continue;
      if (name === SELF_BASENAME) continue;
      const p = path.join(abs, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      files.set(path.join(dir, name), readFileSafe(p));
    }
  }
  return files;
}

// ── three-state classification ──────────────────────────────────────────────────────────────────────

/** Classify ONE key against the consumer face + the exemption registry (three states). */
export function classifyKey(
  key: string,
  consumerFiles: Map<string, string>,
  exemptions: readonly Exemption[],
): KeyEntry {
  let consumers = 0;
  for (const content of consumerFiles.values()) {
    if (content.includes(key)) consumers += 1;
  }
  if (consumers > 0) {
    return { key, state: "has-consumer", consumers };
  }
  const exemption = exemptions.find((e) => e.key === key);
  if (exemption) {
    return { key, state: "documented-with-reason", consumers: 0, reason: exemption.reason };
  }
  return { key, state: "no-consumer-to-wire", consumers: 0 };
}

/** Full enumeration: extract the writer face, grep the consumer face, classify every key. */
export function audit(root: string): AuditReport {
  const writerSrc = readFileSafe(path.join(root, WRITER_REL));
  const initSrc = readFileSafe(path.join(root, INIT_REL));
  // Section-qualified for the serve keys (`serve.host`) so the consumer-face grep means "this key of
  // this section", not the bare word `host` that appears in every file. The loop keys keep their
  // historical bare form (changing them would silently rewrite what this checker has always meant).
  const keys = [
    ...extractWriterKeys(writerSrc),
    ...extractServeVersionKeys(initSrc).map((k) => `serve.${k}`),
  ].sort();
  const consumerFiles = listConsumerFiles(root);
  const entries = keys.map((k) => classifyKey(k, consumerFiles, EXEMPTIONS));
  const states: Record<KeyState, number> = {
    "has-consumer": 0,
    "no-consumer-to-wire": 0,
    "documented-with-reason": 0,
  };
  for (const e of entries) states[e.state] += 1;
  return {
    mode: "config-key-consumer-audit",
    writer: `${WRITER_REL} + ${INIT_REL} (serve: section)`,
    consumerDirs: CONSUMER_DIRS,
    keys_total: entries.length,
    no_consumer_to_wire: states["no-consumer-to-wire"],
    states,
    entries,
  };
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────────

function reportText(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(
    `config-key-consumer-check — ${report.keys_total} delivered config key(s) (writer: ${report.writer})`,
  );
  for (const e of report.entries) {
    const mark =
      e.state === "has-consumer"
        ? "ok            "
        : e.state === "no-consumer-to-wire"
          ? "NO-CONSUMER   "
          : "DOCUMENTED    ";
    const reason = e.reason ? `  reason: ${e.reason}` : "";
    lines.push(`  [${mark}] ${e.key}  (consumer files: ${e.consumers})${reason}`);
  }
  return lines.join("\n");
}

const usage =
  "usage: node config-key-consumer-check.ts [--root <dir>] [--json]\n" +
  "  default: enumerate delivered config keys and their consumer state (exit 0 iff no-consumer-to-wire == 0)\n" +
  "  --json:  machine-readable report\n" +
  "  Exit: 0 = PASS; 1 = FAIL (a key with no consumer and no reason); 2 = usage/env error";

/** Validate the exemption registry: a documented-with-reason entry needs a non-blank reason. */
export function validateExemptions(exemptions: readonly Exemption[]): string | null {
  for (const e of exemptions) {
    if (!e.reason || !e.reason.trim()) {
      return `exemption for key "${e.key}" has a blank reason (documented-with-reason requires a reason text — 豁免要带理由可复核, ⛔ 不是无理由 allowlist)`;
    }
  }
  return null;
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  if (!fs.existsSync(root)) {
    console.error(`ERROR: audit root not found: ${root}`);
    return 2;
  }
  const writerPath = path.join(root, WRITER_REL);
  if (!fs.existsSync(writerPath)) {
    console.error(
      `ERROR: writer face not found: ${WRITER_REL} (cannot enumerate delivered config keys)`,
    );
    return 2;
  }
  const reasonError = validateExemptions(EXEMPTIONS);
  if (reasonError !== null) {
    console.error(`ERROR: ${reasonError}`);
    return 2;
  }

  const report = audit(root);
  const pass = report.no_consumer_to_wire === 0;
  if (!asJson) {
    console.log(reportText(report));
  }
  return emitVerdict(
    {
      status: pass ? "pass" : "fail",
      message: pass
        ? `config-key-consumer-check: ${report.keys_total} delivered config key(s), ${report.no_consumer_to_wire} with no consumer`
        : `config-key-consumer-check: ${report.no_consumer_to_wire} delivered config key(s) have no consumer (wire or delete, or document a reason)`,
      detail: report,
    },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "config-key-consumer-check")) {
  process.exit(main(process.argv));
}
