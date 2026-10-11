#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dark-axis-record-check.ts
import fs from "node:fs";
import path2 from "node:path";

// packages/quay/src/gate/dark-axis-record.ts
var LINE_PREFIX = "^(?:\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s*)?|\\d+\\.\\s+(?:\\[[ xX]\\]\\s*)?|>\\s*))?(?:\\*\\*)?\\s*";
var AXIS_AT_LINE_START_RE = new RegExp(`${LINE_PREFIX}(L_[DGS])(?![A-Za-z0-9_])`);
var KEY = "[^\\s=\uFF1A]{0,39}[A-Za-z\\u4e00-\\u9fff][^\\s=\uFF1A]{0,39}";
var VALUE = "-?\\d+(?:\\.\\d+)?(?:\\s*[:\uFF1A/]\\s*\\d+(?:\\.\\d+)?)?";
var NUMERIC_MEASUREMENT_RE = new RegExp(`(?:^|[\\s(\uFF08[\uFF0C,;\uFF1B])(${KEY})\\s*[=:\uFF1A]\\s*(${VALUE})`);
var DISCLAIM_ZH_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[\uFF1A:=]?\\s*)?\u8BE5\u8F74\u4ECD\u6697`);
var DISCLAIM_EN_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[\uFF1A:=]?\\s*)?axis\\s+still\\s+dark\\b`, "i");
var REASON_ZH_RE = /理由\s*[：:]\s*(\S.*)$/;
var REASON_EN_RE = /\breason\s*[：:]\s*(\S.*)$/i;
function isBlockContinuation(line) {
  return /^\s+\S/.test(line);
}
function numbersIn(text) {
  const out = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(Number(m[0]));
  return out;
}
function measurementNumbers(blockLines) {
  const out = [];
  for (const line of blockLines) {
    const probe = new RegExp(NUMERIC_MEASUREMENT_RE.source, "g");
    let m;
    while ((m = probe.exec(line)) !== null) {
      for (const n of numbersIn(m[2])) out.push(n);
      if (m[0].length === 0) probe.lastIndex++;
    }
  }
  return out;
}
function findDisclaimer(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DISCLAIM_ZH_RE.test(line) && !DISCLAIM_EN_RE.test(line)) continue;
    const candidates = [line];
    for (let j = i + 1; j < lines.length && j <= i + 1; j++) {
      if (lines[j].trim() !== "") candidates.push(lines[j]);
    }
    for (const c of candidates) {
      const zh = c.match(REASON_ZH_RE);
      const en = c.match(REASON_EN_RE);
      const reason = zh ? zh[1] : en ? en[1] : null;
      if (reason && reason.trim() !== "") {
        return { line: i + 1, text: line.trim(), reason: reason.trim() };
      }
    }
  }
  return null;
}
function classifyDarkAxisRecord(body) {
  if (typeof body !== "string") {
    return {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason: "NOT-EVALUATED \u2014 the task carries no readable body (typeof body !== string). An unreadable input is neither evidence of a record nor evidence of its absence (\u786C\u89C4\u5219 3b)."
    };
  }
  const lines = body.split("\n");
  const readings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = AXIS_AT_LINE_START_RE.exec(lines[i]);
    if (!m) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && isBlockContinuation(lines[j]); j++) block.push(lines[j]);
    const numbers = measurementNumbers(block);
    if (numbers.length === 0) continue;
    readings.push({ axis: m[1], line: i + 1, numbers, text: lines[i].trim() });
  }
  const disclaimer = findDisclaimer(lines);
  const substantive = readings.filter((r) => r.axis === "L_D" || r.axis === "L_G");
  if (substantive.length > 0) {
    const shown = substantive.map((r) => `${r.axis}(line ${r.line})=[${r.numbers.join(", ")}]`).join(" ");
    return {
      state: "RECORDED",
      readings,
      disclaimer,
      reason: `RECORDED \u2014 ${substantive.length} L_D/L_G reading(s) with concrete quantities: ${shown}`
    };
  }
  if (disclaimer) {
    return {
      state: "DISCLAIMED",
      readings,
      disclaimer,
      reason: `DISCLAIMED \u2014 explicit declaration at line ${disclaimer.line}: "${disclaimer.text}" (\u7406\u7531: ${disclaimer.reason})`
    };
  }
  const otherAxes = readings.length > 0 ? ` (found only non-L_D/L_G reading(s): ${readings.map((r) => r.axis).join(", ")})` : "";
  return {
    state: "MISSING",
    readings,
    disclaimer: null,
    reason: `MISSING \u2014 the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "\u8BE5\u8F74\u4ECD\u6697,\u7406\u7531:<...>" declaration${otherAxes}. ADR-007 requires one or the other before the task may be called done.`
  };
}
function darkAxisGateCheck(task) {
  const verdict = classifyDarkAxisRecord(task?.body);
  return {
    ok: verdict.state === "RECORDED" || verdict.state === "DISCLAIMED",
    reason: `dark-axis (ADR-007 per-milestone predicate): ${verdict.reason}`
  };
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dark-axis-record-check.ts
function taskBodyOf(fileText) {
  const lines = fileText.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") return fileText;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(i + 1).join("\n");
  }
  return fileText;
}
var USAGE = `dark-axis-record-check.ts \u2014 ADR-007 per-milestone dark-axis record check

Usage:
  node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id> [--root <dir>] [--json] [--help]

  <task-id>     task whose body to classify (REQUIRED; reads <root>/tasks/<task-id>.md)
  --root <dir>  workspace root (default: cwd)
  --json        machine-readable output
  --help        this help

States:
  RECORDED      body carries a parseable L_D/L_G reading (its concrete numbers are printed)
  DISCLAIMED    body carries the explicit declaration \u8BE5\u8F74\u4ECD\u6697,\u7406\u7531:<...>
  MISSING       neither present
  NOT-EVALUATED body unreadable (own value, never folded into MISSING/RECORDED)

Exit codes:
  0  RECORDED | DISCLAIMED
  1  MISSING          (fail-closed \u2014 the state the ready->done dark-axis gate refuses)
  2  NOT-EVALUATED / usage error / task file not found`;
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}
`);
    return 0;
  }
  const VALUE_FLAGS = /* @__PURE__ */ new Set(["--root"]);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i++;
      continue;
    }
    if (args[i].startsWith("-")) continue;
    positional.push(args[i]);
  }
  const taskId = positional[0];
  if (!taskId) {
    process.stderr.write(`dark-axis-record-check: <task-id> is required
${USAGE}
`);
    return 2;
  }
  const root = path2.resolve(flagValue(args, "--root") ?? process.cwd());
  const asJson = args.includes("--json");
  const taskPath = path2.join(root, "tasks", `${taskId}.md`);
  let verdict;
  if (!fs.existsSync(taskPath)) {
    verdict = {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason: `NOT-EVALUATED \u2014 no task file at ${taskPath}; the body could not be read, so no statement about its contents is available.`
    };
  } else {
    verdict = classifyDarkAxisRecord(taskBodyOf(fs.readFileSync(taskPath, "utf8")));
  }
  const numbers = verdict.readings.flatMap((r) => r.numbers);
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        { task: taskId, state: verdict.state, readings: verdict.readings, disclaimer: verdict.disclaimer, numbers, reason: verdict.reason },
        null,
        2
      )}
`
    );
  } else {
    process.stdout.write(`dark-axis-record-check: ${taskId}
`);
    process.stdout.write(`  state:    ${verdict.state}
`);
    for (const r of verdict.readings) {
      process.stdout.write(`  reading:  ${r.axis} (line ${r.line}) = [${r.numbers.join(", ")}]  ${r.text}
`);
    }
    if (verdict.disclaimer) {
      process.stdout.write(`  declared: line ${verdict.disclaimer.line}: ${verdict.disclaimer.text} (\u7406\u7531: ${verdict.disclaimer.reason})
`);
    }
    process.stdout.write(`  numbers:  ${numbers.length > 0 ? numbers.join(", ") : "(none)"}
`);
    process.stdout.write(`  reason:   ${verdict.reason}
`);
  }
  if (verdict.state === "RECORDED" || verdict.state === "DISCLAIMED") return 0;
  return verdict.state === "MISSING" ? 1 : 2;
}
if (isDirectEntry(import.meta, void 0, "dark-axis-record-check")) {
  process.exit(main(process.argv));
}
export {
  USAGE,
  classifyDarkAxisRecord,
  darkAxisGateCheck,
  main,
  taskBodyOf
};
