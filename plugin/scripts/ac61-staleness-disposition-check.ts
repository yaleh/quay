// ac61-staleness-disposition-check.ts — AC61 清单逐条处置检查器
// (tasks/gap-ac61-staleness-list-item-disposition, AC1/AC2/AC3 + DoD 负控制).
//
// AC61 判据1 (phase-goal verbatim): manager 2026-08-14 交出的清单 A-1…A-7 / B-1…B-4 逐条处置：
//   要么已按 AC58 迁出（带落点映射），要么明写「经核实仍有效」并给出核实读数。
// AC61 判据2: inner loop / outer loop 文档的 `integration` 命中逐条打印并分类
//   （活指令 / 退役注记 / 历史记述），不得只给计数。
// AC61 判据3: inner 核 :65 C7（integration-branch-model.ts --overlaps-unverified 活指令→退役模块）修。
// DoD 负控制: 一条「某条无处置记录」的样本 ⇒ 检查必须红。
//
// Mechanism:
//   CHECK-A (判据1 + 负控制): the task file carries a `## AC61 处置记录` section with one
//     `### <id>` subsection per list item (A-1..A-7, B-1..B-4). Each subsection MUST carry a
//     `- 处置：` line. If the disposition is 迁出/改指 (migrated/re-pointed) the subsection MUST
//     also carry a landing-point (`落点`/`→`); if it is 经核实仍有效/已逐条分类 (verified/classified)
//     it MUST also carry a reading (`读数`). Any item missing a record, or a record missing its
//     required companion field, ⇒ RED (exit 1). This is the 负控制 surface the mutation case pins.
//   CHECK-B (判据2): for each enforced loop doc (the two plugin/loop templates the criterion's
//     39/12 counts name), the `## integration 命中逐条分类` section must carry a per-file table
//     whose anchor (backtick-quoted, = the normalized hit line's leading 70 chars) covers EVERY
//     current `integration`-containing line in that doc, and whose row count equals the actual
//     hit count. A doc whose hits are not all classified, or whose table is stale ⇒ RED.
//   CHECK-C (判据3): neither core copy (orchestration/ + plugin/loop/ fast-mode-tick-core.md) may
//     still contain the live instruction `integration-branch-model.ts --overlaps-unverified` /
//     `空串使该判定恒假、机制半死` (the C7 body that AC61 moved to archive R25). Present ⇒ RED.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/ac61-staleness-disposition-check.ts --root <repo>
//   scripts/test.sh --for-task gap-ac61-staleness-list-item-disposition  (via run_static_checks)
//   node ... ac61-staleness-disposition-check.ts --task-file <fixture> --core-file <fixture> --json
//     (overrides for the negative-control fixtures)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_FILE_REL = "tasks/gap-ac61-staleness-list-item-disposition.md";
export const LIST_ITEMS = ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7", "B-1", "B-2", "B-3", "B-4"];

// The two loop docs the criterion's 39/12 counts name (the shipped plugin/loop templates).
export const ENFORCED_LOOP_DOCS = [
  "plugin/loop/fast-mode-loop-tick.md",
  "plugin/loop/orchestrator-loop-tick.md",
];

// The inner fast-mode core in BOTH copies (instance + shipped template).
export const INNER_CORE_COPIES = [
  "orchestration/fast-mode-tick-core.md",
  "plugin/loop/fast-mode-tick-core.md",
];

// The exact live-instruction body AC61 判据3 requires to be GONE from the cores (R25 body).
export const C7_LIVE_MARKERS = [
  "integration-branch-model.ts --overlaps-unverified",
  "空串使该判定恒假、机制半死",
];

export const DISPOSITION_HEADING = "AC61 处置记录";
export const CLASSIFICATION_HEADING = "integration 命中逐条分类";

/** Normalize: strip backticks, collapse whitespace, trim (mirrors retired-clause-check.norm). */
export function norm(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/** Extract the content of a `## <key>` section (through the next `## ` heading or EOF). */
export function extractH2(text: string, key: string): string | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `## ${key}` || lines[i].trim().startsWith(`## ${key}（`) || lines[i].trim().startsWith(`## ${key} `)) { start = i; break; }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Extract a `### <id> …` subsection of a `## <key>` section (through the next `### ` or `## `). */
export function extractH3(section: string, id: string): string | null {
  const lines = section.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(`### ${id}`)) { start = i; break; }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###\s+/.test(lines[i]) || /^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

export interface DispositionVerdict {
  id: string;
  ok: boolean;
  why: string;
}

/**
 * CHECK-A — every list item has a well-formed disposition record.
 * 迁出/改指 ⇒ needs 落点; 经核实仍有效/已逐条分类 ⇒ needs 读数.
 */
export function checkDispositions(taskText: string): { ok: boolean; verdicts: DispositionVerdict[] } {
  const section = extractH2(taskText, DISPOSITION_HEADING);
  const verdicts: DispositionVerdict[] = [];
  if (!section) {
    for (const id of LIST_ITEMS) verdicts.push({ id, ok: false, why: "disposition section missing" });
    return { ok: false, verdicts };
  }
  for (const id of LIST_ITEMS) {
    const sub = extractH3(section, id);
    if (!sub) {
      verdicts.push({ id, ok: false, why: `no "### ${id}" disposition record` });
      continue;
    }
    const dispLine = sub.split(/\r?\n/).find((l) => /^\s*-\s*处置：/.test(l.trim()));
    if (!dispLine) {
      verdicts.push({ id, ok: false, why: `"### ${id}" has no "- 处置：" line` });
      continue;
    }
    const disp = dispLine.trim();
    // Primary disposition keyword FIRST: 经核实仍有效/已逐条分类 ⇒ verify (needs 读数), even if the
    // parenthetical note mentions 迁出 as future context. Only a non-verify disposition is migrate.
    const isVerify = /经核实仍有效|已逐条分类|已核实/.test(disp);
    const isMigrate = !isVerify && /迁出|改指|已迁出/.test(disp);
    if (!isMigrate && !isVerify) {
      verdicts.push({ id, ok: false, why: `"### ${id}" disposition "${disp}" is neither 迁出/改指 nor 经核实仍有效` });
      continue;
    }
    if (isMigrate && !/落点|→|archive#/.test(sub)) {
      verdicts.push({ id, ok: false, why: `"### ${id}" disposition is 迁出/改指 but the record carries no landing-point (落点/→/archive#)` });
      continue;
    }
    if (isVerify && !/读数/.test(sub)) {
      verdicts.push({ id, ok: false, why: `"### ${id}" disposition is 经核实仍有效/已逐条分类 but the record carries no 读数` });
      continue;
    }
    verdicts.push({ id, ok: true, why: "ok" });
  }
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

/** The actual `integration`-containing normalized lines of a doc. */
export function integrationHits(root: string, rel: string): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readFileSync(abs, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("integration"))
    .map(norm);
}

/**
 * Parse the per-file classification rows from the `## integration 命中逐条分类` section.
 * Each file subsection is `### <tag>：`<rel>`（<N> 处…）` and its table rows are
 * `| 分类 | `anchor` | 说明 |` — the anchor is the backtick-quoted cell (normalized line prefix).
 * Returns a map rel → anchors[].
 */
export function parseClassificationRows(taskText: string): Map<string, string[]> {
  const section = extractH2(taskText, CLASSIFICATION_HEADING);
  const result = new Map<string, string[]>();
  if (!section) return result;
  const lines = section.split(/\r?\n/);
  let currentRel: string | null = null;
  for (const line of lines) {
    const header = line.trim().match(/^###\s+.*?`([^`]+\.md)`\s*（/);
    if (header) {
      currentRel = header[1];
      if (!result.has(currentRel)) result.set(currentRel, []);
      continue;
    }
    if (!currentRel) continue;
    if (/^\|/.test(line.trim()) && !/^\|\s*---/.test(line.trim())) {
      const anchor = line.match(/`([^`]+)`/);
      if (anchor) result.get(currentRel)!.push(anchor[1]);
    }
  }
  return result;
}

export interface ClassificationVerdict {
  rel: string;
  ok: boolean;
  hits: number;
  rows: number;
  uncovered: string[];
  issues: string[];
}

/** CHECK-B — every enforced loop doc's integration hits are all classified (not just counted). */
export function checkIntegrationClassification(
  taskText: string,
  root: string,
): { ok: boolean; verdicts: ClassificationVerdict[] } {
  const rowsByFile = parseClassificationRows(taskText);
  const verdicts: ClassificationVerdict[] = [];
  for (const rel of ENFORCED_LOOP_DOCS) {
    const hits = integrationHits(root, rel);
    const rows = rowsByFile.get(rel) ?? [];
    const issues: string[] = [];
    if (hits.length === 0 && rows.length === 0) {
      verdicts.push({ rel, ok: true, hits: 0, rows: 0, uncovered: [], issues: [] });
      continue;
    }
    if (rows.length !== hits.length) {
      issues.push(`row count ${rows.length} != actual integration hit count ${hits.length} (${rel})`);
    }
    const covered = new Set<number>();
    for (const anchor of rows) {
      const a = norm(anchor);
      let matchedAny = false;
      hits.forEach((h, i) => {
        if (a && h.includes(a)) { covered.add(i); matchedAny = true; }
      });
      if (!matchedAny) issues.push(`classification anchor resolves to NO current integration hit: "${a.slice(0, 50)}…"`);
    }
    const uncovered: string[] = [];
    hits.forEach((h, i) => {
      if (!covered.has(i)) uncovered.push(h.slice(0, 70));
    });
    if (uncovered.length > 0) {
      issues.push(`${uncovered.length} integration hit(s) in ${rel} have NO classification row (not 逐条):`);
      for (const u of uncovered) issues.push(`  - ${u}…`);
    }
    verdicts.push({ rel, ok: issues.length === 0, hits: hits.length, rows: rows.length, uncovered, issues });
  }
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

export interface CoreC7Verdict {
  rel: string;
  ok: boolean;
  hits: string[];
}

/** CHECK-C — neither inner core copy still carries the C7 live instruction. */
export function checkC7Gone(root: string): { ok: boolean; verdicts: CoreC7Verdict[] } {
  const verdicts: CoreC7Verdict[] = [];
  for (const rel of INNER_CORE_COPIES) {
    const abs = path.join(root, rel);
    const text = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const hits = C7_LIVE_MARKERS.filter((m) => text.includes(m));
    verdicts.push({ rel, ok: hits.length === 0, hits });
  }
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

export interface Ac61Result {
  ok: boolean;
  dispositions: DispositionVerdict[];
  classifications: ClassificationVerdict[];
  cores: CoreC7Verdict[];
}

export function runCheck(root: string, taskFileOverride?: string): Ac61Result {
  const taskFile = taskFileOverride ? path.resolve(root, taskFileOverride) : path.join(root, TASK_FILE_REL);
  const taskText = fs.readFileSync(taskFile, "utf8");
  const dispositions = checkDispositions(taskText);
  const classifications = checkIntegrationClassification(taskText, root);
  const cores = checkC7Gone(root);
  return { ok: dispositions.ok && classifications.ok && cores.ok, dispositions: dispositions.verdicts, classifications: classifications.verdicts, cores: cores.verdicts };
}

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let taskFileOverride: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? ".");
    else if (a === "--task-file") taskFileOverride = argv[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "ac61-staleness-disposition-check — AC61 清单逐条处置检查器\n" +
          "  --root <dir>       repo root (default: script dir ../..)\n" +
          "  --task-file <path> explicit task-file path (negative-control fixtures; overrides root)\n" +
          "  --json             machine-readable output\n" +
          "exit 0 = all A-1..A-7/B-1..B-4 dispositioned + integration hits classified + C7 gone; exit 1 = RED",
      );
      return 0;
    } else {
      console.error(`ac61-staleness-disposition-check: unknown argument: ${a}`);
      return 2;
    }
  }

  const res = runCheck(root, taskFileOverride);
  if (json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (res.ok) {
    console.log(
      `PASS: AC61 — ${LIST_ITEMS.length} list items dispositioned; ` +
        `${res.classifications.filter((c) => c.ok).reduce((n, c) => n + c.hits, 0)} enforced-loop integration hits classified; C7 gone from ${res.cores.length} core copies`,
    );
  } else {
    console.error("RED: AC61 staleness-disposition check failed");
    for (const v of res.dispositions) if (!v.ok) console.error(`  - DISPOSITION ${v.id}: ${v.why}`);
    for (const c of res.classifications) if (!c.ok) {
      console.error(`  - CLASSIFICATION ${c.rel}: ${c.issues.join("; ")}`);
    }
    for (const c of res.cores) if (!c.ok) console.error(`  - C7-STILL-LIVE ${c.rel}: ${c.hits.join(", ")}`);
  }
  return res.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
