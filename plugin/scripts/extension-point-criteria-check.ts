#!/usr/bin/env node
// extension-point-criteria-check.ts — the mechanical judge for DIR-133 裁定 2's "extension-point
// criteria four-piece set" (正臂 / 负臂 / 注入泄漏 / 红线基线).
// (tasks/gap-extension-point-refactor-criteria-scaffold; method corpus
//  docs/references/ownership-first-refactoring-methodology.md §13)
//
// THE DEFECT THIS EXISTS FOR (ADR-004: a rule that only lives as prose gets paraphrased away):
// DIR-133 裁定 2 says every design-investigation/refactor-slice AC must carry an extension-point
// criterion. Until now that was prose with ZERO checker — every slice re-derived the same four
// assertions by hand (claudecodeui 2026-10-22: five refactors, five hand-written criterion sets).
// The failure it guards has already happened in 3 code bases (quay worker 2440b52d0 → 82% of later
// growth back into the centre; plantuml-js elk 570→150→278 lines; claudecodeui ws-proxy 65→66).
//
// THE FOUR ARMS (and why the negative arm ALONE is a vacuous green — DIR-133 裁定 2 + task Plan 3):
//   positive        — a handler registered OUTSIDE the centre is TRIGGERED. The assertion must be a
//                     COUNT (`triggered=1`), never "the handler exists". This arm IS the liveness
//                     check; there is no separate one.
//   negative        — when NOT registered it does NOT trigger (`triggered=0`). On its own this is
//                     green for the wrong reason when the wiring is broken (`triggered=0` at both
//                     ends too), so it is only accepted TOGETHER with a counted positive arm.
//                     ⇒ "only a negative arm" is `missing-arms`, never "one arm present".
//   injectionLeak   — replace the dispatcher with a LEAKING implementation and the SAME assertions
//                     must go red. Its job is to prove the NEGATIVE arm is not vacuous (not to
//                     backstop the positive one).
//   redLineBaseline — `wc -l <centre>` must be RED before the change (single-shot acceptance
//                     criterion; explicitly NOT a standing ratchet — see the template in §13).
//
// POSITION, NOT KEYWORD (硬规则 2): only GFM checklist items (`- [ ]` / `- [x]`) inside the task's
// `## Acceptance Criteria` section are read. Prose in `## Proposal` / `## Plan`, fenced code blocks,
// and comment-like mentions never count. The section extraction is fence-aware (a `## Acceptance
// Criteria` inside a code fence is not the section).
//
// FOUR-STATE OUTPUT (硬规则 3b — "could not evaluate" must never share the shape of "evaluated and
// satisfied"):
//   satisfied       — all four arms present.
//   missing-arms    — at least one arm absent; `missing` / `missingLabels` name EVERY absent arm.
//                     An arm that is NAMED but written in the wrong form (e.g. positive written as
//                     "handler 存在" with no `triggered=1`) is also missing, with `weak[]` recording
//                     the wrong form.
//   not-applicable  — the task is not a design slice (no `refactor-slice` label, and neither title
//                     nor labels carry slice semantics: 拆分 / 切片 / 重构 / refactor / slice).
//   NOT-EVALUATED   — the input or the `## Acceptance Criteria` section cannot be read. Every
//                     discriminating field differs from `satisfied` (evaluated:false, applicable:null,
//                     satisfied:false, every arm null) — pinned by the test.
//
// Exit codes: 0 = satisfied OR not-applicable (scan: an aggregate reading was produced);
//             1 = missing-arms (single task);
//             2 = usage / environment error;
//             3 = NOT-EVALUATED (unreadable task file / absent AC section / unreadable scan dir).
//
// Run:
//   node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --task-id <id> [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --task <path> [--json]
//   node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --scan [--tasks-dir <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --help

import fs from "node:fs";
import path from "node:path";
import { helpExit, emitPass, emitFail, emitNotEvaluated, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { parseFrontmatterCompletely, frontmatterLabels, extractSectionFenceAware } from "./task-schema.ts";

// ── The arm vocabulary (ONE definition — the template, the test and the human output share it) ────

export const ARMS = ["positive", "negative", "injectionLeak", "redLineBaseline"] as const;
export type ArmId = (typeof ARMS)[number];

/** Human labels used in every output (the same words the methodology template uses). */
export const ARM_LABELS: Record<ArmId, string> = {
  positive: "正臂",
  negative: "负臂",
  injectionLeak: "注入泄漏",
  redLineBaseline: "红线基线",
};

/** What each arm answers — carried into `missingArms[].question` so a missing arm is actionable. */
export const ARM_QUESTIONS: Record<ArmId, string> = {
  positive: "从中心文件之外注册的 handler 被触发了吗（计数断言 triggered=1，不是「handler 存在」）？",
  negative: "未注册时确实不触发吗（且与一条 counted 正臂成对，否则是真空绿）？",
  injectionLeak: "把分派器换成泄漏实现后，同一断言会打红吗（证明负臂不真空）？",
  redLineBaseline: "改动前 `wc -l <中心文件>` 的基线断言为红吗（单次验收，非常设棘轮）？",
};

/** The four identifier forms. Position is enforced by the caller (AC checklist items only). */
export const ARM_MARKERS: Record<ArmId, RegExp> = {
  positive: /正臂|positive\s*arm/i,
  negative: /负臂|negative\s*arm/i,
  injectionLeak: /注入泄漏|injection\s*leak/i,
  redLineBaseline: /红线基线|red[-\s]?line\s*baseline/i,
};

/**
 * The COUNTED positive assertion. `triggered=1`, `triggered == 1`, `triggered: 1` all read; a bare
 * "handler 存在" does NOT (that is the exact vacuous form AC8 pins). `\b` after 1 keeps `triggered=10`
 * from matching.
 */
export const TRIGGERED_ONE_RE = /triggered\s*(?:={1,3}|:)\s*1\b/i;

/** The red-line baseline's own carrier spelling (`wc -l <file>`) — accepted without the 红线基线 label. */
export const WC_LINE_RE = /\bwc\s+-l\b/i;

/** Slice semantics for the applicability judgment (title + labels; never the body). */
export const SLICE_SEMANTICS_RE = /refactor|slice|拆分|切片|重构|提取/i;
export const REFACTOR_SLICE_LABEL = "refactor-slice";

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────

export interface AcItem {
  /** The list item's text with its indented continuation lines joined (fenced blocks excluded). */
  text: string;
  /** GFM checkbox state. NOT a filter: a checked AC still carries the criterion (see `--help`). */
  checked: boolean;
  /** 0-based line index inside the AC section (for diagnostics only). */
  line: number;
}

export type Verdict = "satisfied" | "missing-arms" | "not-applicable" | "NOT-EVALUATED";

export interface WeakArm {
  arm: ArmId;
  label: string;
  reason: "named-but-no-count-assertion";
  item: string;
}

export interface Reading {
  evaluated: boolean;
  taskId: string | null;
  taskFile: string | null;
  verdict: Verdict;
  /** true / false when a judgment was made; null when nothing could be evaluated (NOT-EVALUATED). */
  applicable: boolean | null;
  satisfied: boolean;
  /** Arm state: true present, false absent, null NOT-EVALUATED (never conflated with absent). */
  arms: Record<ArmId, boolean | null>;
  missing: ArmId[];
  missingLabels: string[];
  missingArms: Array<{ arm: ArmId; label: string; question: string }>;
  weak: WeakArm[];
  /** Number of GFM checklist items read from the AC section. */
  acItems: number;
  reason?: string;
}

// ── Positional parsing: AC checklist items only (硬规则 2) ─────────────────────────────────────────

const CHECKLIST_RE = /^\s*[-*]\s+\[([ xX~])\]\s+(.*)$/;

/**
 * Parse the GFM checklist items of a task body's `## Acceptance Criteria` section.
 * Returns null when the section is absent (⇒ NOT-EVALUATED), [] when present but with no items.
 * Fenced blocks are skipped; a non-indented, non-item line ends the current item's continuation.
 */
export function parseAcItems(body: string): AcItem[] | null {
  const section = extractSectionFenceAware(body, "Acceptance Criteria");
  if (section === null) return null;
  const lines = section.split(/\r?\n/);
  const items: AcItem[] = [];
  let inFence = false;
  let cur: AcItem | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      cur = null;
      continue;
    }
    if (inFence) continue;
    const m = raw.match(CHECKLIST_RE);
    if (m) {
      cur = { text: String(m[2] ?? "").trim(), checked: String(m[1] ?? "").trim().toLowerCase() === "x", line: i };
      items.push(cur);
      continue;
    }
    if (cur && /^\s+\S/.test(raw)) {
      // An INDENTED continuation line belongs to the previous checklist item.
      cur.text = `${cur.text} ${raw.trim()}`;
      continue;
    }
    if (raw.trim() === "") continue;
    cur = null;
  }
  return items;
}

/** True iff the task (title + labels) is a design slice — the `not-applicable` gate. */
export function isDesignSlice(fm: Record<string, unknown>, title: string): boolean {
  const labels = frontmatterLabels(fm);
  if (labels.includes(REFACTOR_SLICE_LABEL)) return true;
  const hay = [title, ...labels].join(" ");
  return SLICE_SEMANTICS_RE.test(hay);
}

// ── The four-arm judgment ─────────────────────────────────────────────────────────────────────────

/**
 * Judge one task body. `taskId` / `taskFile` are echoed into the reading for diagnostics.
 * Pure: no I/O — the CLI reads the file and calls this.
 */
export function judgeTaskBody(body: string, opts: { taskId?: string | null; taskFile?: string | null; title?: string | null } = {}): Reading {
  const taskId = opts.taskId ?? null;
  const taskFile = opts.taskFile ?? null;
  const base: Reading = {
    evaluated: true,
    taskId,
    taskFile,
    verdict: "NOT-EVALUATED",
    applicable: null,
    satisfied: false,
    arms: { positive: null, negative: null, injectionLeak: null, redLineBaseline: null },
    missing: [],
    missingLabels: [],
    missingArms: [],
    weak: [],
    acItems: 0,
  };

  // Frontmatter: a body without a closed frontmatter block cannot be judged (position, not guess).
  const fmMatch = String(body).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    return { ...base, evaluated: false, verdict: "NOT-EVALUATED", reason: "frontmatter-missing" };
  }
  let fm: Record<string, unknown>;
  try {
    fm = parseFrontmatterCompletely(fmMatch[1]) as Record<string, unknown>;
  } catch {
    return { ...base, evaluated: false, verdict: "NOT-EVALUATED", reason: "frontmatter-unparsable" };
  }
  const declaredTitle = typeof fm.title === "string" ? fm.title : "";
  const title = opts.title ?? declaredTitle;

  const bodyOnly = String(body).slice(fmMatch[0].length);
  const items = parseAcItems(bodyOnly);
  if (items === null) {
    return { ...base, evaluated: false, verdict: "NOT-EVALUATED", reason: "ac-section-missing" };
  }

  if (!isDesignSlice(fm, title)) {
    return {
      ...base,
      verdict: "not-applicable",
      applicable: false,
      acItems: items.length,
      reason: "not-a-design-slice (no refactor-slice label; title/labels carry no slice semantics)",
    };
  }

  // ── Arm presence, positionally over the checklist items ──
  const present: Record<ArmId, boolean> = {
    positive: false,
    negative: false,
    injectionLeak: false,
    redLineBaseline: false,
  };
  const weak: WeakArm[] = [];
  let positiveNamedWithoutCount = false;

  for (const item of items) {
    const text = item.text;
    if (ARM_MARKERS.positive.test(text)) {
      if (TRIGGERED_ONE_RE.test(text)) present.positive = true;
      else positiveNamedWithoutCount = true;
    }
    if (ARM_MARKERS.negative.test(text)) present.negative = true;
    if (ARM_MARKERS.injectionLeak.test(text)) present.injectionLeak = true;
    if (ARM_MARKERS.redLineBaseline.test(text) || WC_LINE_RE.test(text)) present.redLineBaseline = true;
  }

  if (positiveNamedWithoutCount && !present.positive) {
    const culprit = items.find((it) => ARM_MARKERS.positive.test(it.text) && !TRIGGERED_ONE_RE.test(it.text));
    weak.push({
      arm: "positive",
      label: ARM_LABELS.positive,
      reason: "named-but-no-count-assertion",
      item: culprit ? culprit.text : "",
    });
  }

  // "Only a negative arm is not a criterion" — the missing set names the positive arm even when the
  // negative arm exists (AC8). The generic per-arm loop below already does this; kept explicit here
  // so the rule and its test cannot drift apart.
  const missing = ARMS.filter((a) => !present[a]);
  const satisfied = missing.length === 0;

  return {
    ...base,
    verdict: satisfied ? "satisfied" : "missing-arms",
    applicable: true,
    satisfied,
    arms: { ...present },
    missing,
    missingLabels: missing.map((a) => ARM_LABELS[a]),
    missingArms: missing.map((a) => ({ arm: a, label: ARM_LABELS[a], question: ARM_QUESTIONS[a] })),
    weak,
    acItems: items.length,
  };
}

/** Read one task file and judge it. A missing/unreadable file is NOT-EVALUATED (never absent arms). */
export function judgeTaskFile(taskFile: string, taskId?: string | null): Reading {
  let text: string;
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch {
    return {
      evaluated: false,
      taskId: taskId ?? null,
      taskFile,
      verdict: "NOT-EVALUATED",
      applicable: null,
      satisfied: false,
      arms: { positive: null, negative: null, injectionLeak: null, redLineBaseline: null },
      missing: [],
      missingLabels: [],
      missingArms: [],
      weak: [],
      acItems: 0,
      reason: "task-file-unreadable",
    };
  }
  return judgeTaskBody(text, { taskId: taskId ?? path.basename(taskFile).replace(/\.md$/, ""), taskFile });
}

export interface ScanResult {
  evaluated: boolean;
  satisfied: number;
  missing: number;
  notApplicable: number;
  notEvaluated: number;
  missingIds: string[];
  readings: Reading[];
}

/** Judge every `tasks/*.md` in a directory. Unreadable directory ⇒ evaluated:false (NOT-EVALUATED). */
export function scanTasksDir(tasksDir: string): ScanResult {
  let entries: string[];
  try {
    entries = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return { evaluated: false, satisfied: 0, missing: 0, notApplicable: 0, notEvaluated: 0, missingIds: [], readings: [] };
  }
  const readings = entries.map((f) => judgeTaskFile(path.join(tasksDir, f)));
  const satisfied = readings.filter((r) => r.verdict === "satisfied").length;
  const missingReadings = readings.filter((r) => r.verdict === "missing-arms");
  return {
    evaluated: true,
    satisfied,
    missing: missingReadings.length,
    notApplicable: readings.filter((r) => r.verdict === "not-applicable").length,
    notEvaluated: readings.filter((r) => r.verdict === "NOT-EVALUATED").length,
    missingIds: missingReadings.map((r) => String(r.taskId)).slice(0, 5),
    readings,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `extension-point-criteria-check.ts — judge DIR-133 裁定 2's extension-point four-arm criteria on a task's AC checklist
usage: extension-point-criteria-check.ts (--task-id <id> | --task <file> | --scan) [--root <dir>] [--tasks-dir <dir>] [--json]
  exit 0 = satisfied / not-applicable (scan: reading produced)
  exit 1 = missing-arms (the missing arms are named)
  exit 2 = usage / environment error
  exit 3 = NOT-EVALUATED (task file, frontmatter, or '## Acceptance Criteria' section unreadable)`;

function resolveTasksDir(root: string): string {
  // .quay/config.yml can point the native tasks_dir elsewhere; read it when present, else <root>/tasks.
  try {
    const cfg = fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8");
    const m = cfg.match(/^\s*tasks_dir:\s*["']?([^"'\n#]+)["']?/m);
    if (m) {
      const p = String(m[1]).trim();
      return path.isAbsolute(p) ? p : path.resolve(root, p);
    }
  } catch {
    /* absent config ⇒ the conventional default below */
  }
  return path.join(root, "tasks");
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);

  const json = argv.includes("--json");
  const root = path.resolve(flagValue(argv, "--root") ?? process.cwd());
  const taskId = flagValue(argv, "--task-id");
  const taskFileArg = flagValue(argv, "--task");
  const scan = argv.includes("--scan");

  const modes = [taskId !== undefined, taskFileArg !== undefined, scan].filter(Boolean).length;
  if (modes !== 1) {
    return emitFail(`exactly ONE of --task-id, --task, --scan is required (got ${modes})`, { usage: USAGE }, { json, stream: "stderr" });
  }

  if (scan) {
    const tasksDir = path.resolve(flagValue(argv, "--tasks-dir") ?? resolveTasksDir(root));
    const result = scanTasksDir(tasksDir);
    if (!result.evaluated) {
      return emitNotEvaluated(`NOT-EVALUATED — cannot read the tasks directory ${tasksDir}; no reading was produced`, {
        evaluated: false, tasksDir,
      }, { json });
    }
    const msg =
      `extension-point criteria over ${tasksDir}: satisfied=${result.satisfied} missing=${result.missing} ` +
      `notApplicable=${result.notApplicable} notEvaluated=${result.notEvaluated}` +
      (result.missingIds.length > 0 ? ` | first missing: ${result.missingIds.join(", ")}` : "");
    return emitPass(msg, {
      evaluated: true,
      tasksDir,
      satisfied: result.satisfied,
      missing: result.missing,
      notApplicable: result.notApplicable,
      notEvaluated: result.notEvaluated,
      missingIds: result.missingIds,
    }, { json });
  }

  let reading: Reading;
  if (taskId !== undefined) {
    const tasksDir = resolveTasksDir(root);
    reading = judgeTaskFile(path.join(tasksDir, `${taskId}.md`), taskId);
  } else {
    reading = judgeTaskFile(path.resolve(taskFileArg as string));
  }

  const detail = {
    evaluated: reading.evaluated,
    verdict: reading.verdict,
    applicable: reading.applicable,
    satisfied: reading.satisfied,
    arms: reading.arms,
    missing: reading.missing,
    missingLabels: reading.missingLabels,
    missingArms: reading.missingArms,
    weak: reading.weak,
    acItems: reading.acItems,
    taskId: reading.taskId,
    taskFile: reading.taskFile,
    ...(reading.reason ? { reason: reading.reason } : {}),
  };

  if (reading.verdict === "NOT-EVALUATED") {
    return emitNotEvaluated(
      `NOT-EVALUATED — ${reading.taskId ?? reading.taskFile}: ${reading.reason ?? "unreadable"} (this is NOT 'missing arms')`,
      detail,
      { json },
    );
  }
  if (reading.verdict === "not-applicable") {
    return emitPass(
      `not-applicable — ${reading.taskId}: not a design slice (no '${REFACTOR_SLICE_LABEL}' label; title/labels carry no slice semantics)`,
      detail,
      { json },
    );
  }
  if (reading.verdict === "satisfied") {
    return emitPass(
      `satisfied — ${reading.taskId}: 四臂齐备 (${ARMS.map((a) => ARM_LABELS[a]).join(" / ")})`,
      detail,
      { json },
    );
  }
  return emitFail(
    `missing-arms — ${reading.taskId}: missing ${reading.missingLabels.join(" / ")}` +
      (reading.weak.length > 0 ? ` (weak: ${reading.weak.map((w) => `${w.label}=${w.reason}`).join(", ")})` : ""),
    detail,
    { json },
  );
}

if (isDirectEntry(import.meta, process.argv[1], "extension-point-criteria-check")) {
  process.exit(main());
}
