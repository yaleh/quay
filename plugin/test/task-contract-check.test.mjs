// @test-group engine
// task-contract-check.test.mjs — the consumer-side checker for the `## Contract` block + `## Dispatch
// review` section (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace). The dispatch gate's five
// verbal questions become a machine-readable Contract; this test pins the parser (shared with
// task-schema.ts), the A9/A10 syntax checks, the FIVE consumer judgments (AC↔measure ref, measure
// command+field, invoke verbatim evidence, defect→control, blank-value), the fence-aware section
// extraction, and the AC6 ratchet data-file invariant.
//
// AC1 six-key syntax (task-schema) · AC2 five consumer judgments read content · AC3 Dispatch review
// format + missing-section report · AC5 synthetic violation demo (AC-threshold-no-measure-ref,
// measure-no-command) · AC6 ratchet data file · AC8 @test-group engine.
//
// Run: scripts/test.sh plugin/test/task-contract-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  parseContract,
  checkContractSyntax,
  checkDispatchReview,
  extractSectionFenceAware,
} from "../scripts/task-schema.ts";

import {
  scanTaskText,
  hasThresholdMarker,
  findWorkspaceRoot,
  readRatchet,
  writeRatchet,
  DATA_FILE_REL,
} from "../scripts/task-contract-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "task-contract-check.ts");

const fm = (labels, extra = 'extra:\n  schema: "v1"') =>
  `---\nid: T\ntitle: t\nstatus: ${labels.status || "todo"}\nlabels:\n${(labels.list || []).map((l) => `  - ${l}`).join("\n")}\n${extra}\n---\n`;

function taskBody({ labels = [], status = "todo", contract, dispatchReview, ac, extraBody = "" }) {
  const parts = [];
  parts.push("## Proposal\n\nproposal body\n\n");
  if (contract !== undefined) parts.push(`## Contract\n\n${contract}\n\n`);
  if (ac !== undefined) parts.push(`## Acceptance Criteria\n\n${ac}\n\n`);
  if (dispatchReview !== undefined) parts.push(`## Dispatch review\n\n${dispatchReview}\n\n`);
  if (extraBody) parts.push(extraBody);
  return fm({ list: labels, status }, `extra:\n  schema: "v1"`) + parts.join("");
}

// ── parseContract ───────────────────────────────────────────────────────────────────────────────────

test("parseContract: fenced showcase format → structured entries", () => {
  const { present, entries } = parseContract(`## Contract

\`\`\`
measure   cpu_stall   = \`cat /proc/pressure/cpu\` 的 some avg10 字段      # comment
band      cpu_ok      = some avg10 < 40
invariant nproc 在判定前后一致
invoke    \`scripts/resource-gate.sh --for full-suite\`
control   人为压高 ⇒ gate 必须返回 WAIT
resume    n/a: gate 是无状态判定，无中途产物
\`\`\`
`);
  assert.equal(present, true);
  assert.equal(entries.length, 6);
  const [m, b, i, inv, c, r] = entries;
  assert.deepEqual({ key: m.key, name: m.name }, { key: "measure", name: "cpu_stall" });
  assert.match(m.value, /cat \/proc\/pressure\/cpu/);
  assert.match(m.value, /some avg10/);
  assert.equal(b.key, "band");
  assert.equal(b.name, "cpu_ok");
  assert.equal(i.key, "invariant");
  assert.equal(i.name, null); // invariant MAY be a bare statement
  assert.equal(inv.key, "invoke");
  assert.match(inv.value, /scripts\/resource-gate\.sh/);
  assert.equal(c.key, "control");
  assert.equal(r.key, "resume");
  assert.equal(r.na, true);
  assert.match(r.naReason, /无状态判定/);
});

test("parseContract: bare lines (no fence) and n/a with full-width colon", () => {
  const { entries } = parseContract(`## Contract

measure suite_wall = \`scripts/test.sh\` stdout 的 duration_ms 字段
invoke  \`scripts/test.sh --test-concurrency=4\`
resume  n/a：无中途产物
`);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, "suite_wall");
  assert.equal(entries[2].na, true);
  assert.match(entries[2].naReason, /无中途产物/);
});

test("parseContract: absent section → present:false; fenced example is NOT a real section", () => {
  assert.equal(parseContract("no contract here").present, false);
  // A fenced `## Contract` illustration inside ## Chosen mechanism must not be read as real.
  const body = `## Chosen mechanism\n\n\`\`\`\n## Contract\nmeasure x = \`cmd\` 的 y\n\`\`\`\n`;
  assert.equal(parseContract(body).present, false);
});

test("parseContract: unknown line and empty value are captured", () => {
  const { entries } = parseContract(`## Contract

bogus line here
measure x =
invoke  \`cmd\`
`);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].key, null);
  assert.equal(entries[1].key, "measure");
  assert.equal(entries[1].value, "");
});

test("R1: n/a with an EMPTY reason is a finding; n/a: <reason> is not", () => {
  // `resume n/a:` (colon, no reason) and bare `resume n/a` are indistinguishable from "never thought
  // about it" → contract-empty-value (REFUTE round-1 R1).
  const emptyColon = checkContractSyntax({ body: `## Contract\nresume n/a:\n` }).findings;
  assert.ok(emptyColon.some((f) => f.code === "contract-empty-value"), JSON.stringify(emptyColon));
  const bare = checkContractSyntax({ body: `## Contract\nresume n/a\n` }).findings;
  assert.ok(bare.some((f) => f.code === "contract-empty-value"), JSON.stringify(bare));
  const withReason = checkContractSyntax({ body: `## Contract\nresume n/a: 无中途产物\n` }).findings;
  assert.ok(!withReason.some((f) => f.code === "contract-empty-value"), JSON.stringify(withReason));
});

test("R2: a # inside a backtick command is NOT stripped as a comment", () => {
  const { entries } = parseContract(`## Contract
measure x = \`echo a # b\` 的 y 字段
`);
  assert.equal(entries.length, 1);
  assert.match(entries[0].value, /echo a # b/); // # b survives — it is part of the command
  assert.match(entries[0].value, /y 字段/);
});

// ── checkContractSyntax (A9) ────────────────────────────────────────────────────────────────────────

test("checkContractSyntax: absent section → info, no findings", () => {
  const r = checkContractSyntax({ body: "## Proposal\nx" });
  assert.equal(r.ok, true);
  assert.equal(r.code, "contract-absent-info");
  assert.deepEqual(r.findings, []);
});

test("checkContractSyntax: well-formed six keys → no findings", () => {
  const body = `## Contract
measure suite_wall = \`scripts/test.sh\` 的 duration_ms 字段
band    noise       = 20000..63000 ms
invariant selected_files = 2296
invoke  \`scripts/test.sh --test-concurrency=4\`
control 改回 8 ⇒ AC2 必须不成立
resume  n/a: 无
`;
  assert.deepEqual(checkContractSyntax({ body }).findings, []);
});

test("checkContractSyntax: blank value and measure-without-name are findings; n/a: reason is not", () => {
  const body = `## Contract
measure        = \`cmd\` 的 field
band   noise   =
resume n/a: 无
`;
  const codes = checkContractSyntax({ body }).findings.map((f) => f.code);
  assert.ok(codes.includes("contract-measure-no-name"), JSON.stringify(codes));
  assert.ok(codes.includes("contract-empty-value"), JSON.stringify(codes));
  // resume n/a: reason → no extra empty-value finding; exactly 2 findings total
  assert.equal(checkContractSyntax({ body }).findings.length, 2);
});

test("checkContractSyntax: invoke without backticks is a finding", () => {
  const body = `## Contract
invoke scripts/test.sh --test-concurrency=4
`;
  const codes = checkContractSyntax({ body }).findings.map((f) => f.code);
  assert.ok(codes.includes("contract-invoke-not-command"));
});

// ── checkDispatchReview (A10) ───────────────────────────────────────────────────────────────────────

test("checkDispatchReview: missing section → finding (report-only, ok:true)", () => {
  const r = checkDispatchReview({ body: "## Proposal\nx" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings.map((f) => f.code), ["dispatch-review-missing"]);
});

test("checkDispatchReview: well-formed section and reviewer:none → no findings", () => {
  const well = `## Dispatch review
reviewer: outer
at: 2026-08-02T22:06:00Z
changed: 要求 6 次 selected N files 一致
`;
  assert.deepEqual(checkDispatchReview({ body: well }).findings, []);
  const none = `## Dispatch review
reviewer: none
at: 2026-08-02T22:10:00Z
changed: 无
`;
  assert.deepEqual(checkDispatchReview({ body: none }).findings, []);
});

test("checkDispatchReview: malformed (missing reviewer/at/changed) → dispatch-review-malformed", () => {
  const body = `## Dispatch review
reviewer:
at: 2026-08-02T22:06:00Z
`;
  const codes = checkDispatchReview({ body }).findings.map((f) => f.code);
  assert.ok(codes.includes("dispatch-review-malformed"));
});

test("MINOR1: reviewer value and at: format are validated (outer|none|human|inner; ISO-like date)", () => {
  const badReviewer = checkDispatchReview({ body: `## Dispatch review
reviewer: me
at: 2026-08-02T22:06:00Z
changed: 无
` }).findings;
  assert.ok(badReviewer.some((f) => f.code === "dispatch-review-malformed" && /reviewer must be one of/.test(f.what)), JSON.stringify(badReviewer));
  const badAt = checkDispatchReview({ body: `## Dispatch review
reviewer: none
at: not-a-date
changed: 无
` }).findings;
  assert.ok(badAt.some((f) => f.code === "dispatch-review-malformed" && /ISO-like/.test(f.what)), JSON.stringify(badAt));
});

// ── extractSectionFenceAware ────────────────────────────────────────────────────────────────────────

test("extractSectionFenceAware: skips fenced headings, keeps fenced entries of a real section", () => {
  const body = `## Chosen mechanism

\`\`\`
## Contract
measure x = \`c\` 的 y
\`\`\`

## Contract

\`\`\`
measure real = \`c\` 的 y
\`\`\`

## Touches

- a
`;
  const sec = extractSectionFenceAware(body, "Contract");
  assert.ok(sec.includes("measure real"));
  assert.ok(!sec.includes("measure x"));
});

// ── scanTaskText: five consumer judgments (AC2) ────────────────────────────────────────────────────

test("AC5a: AC with threshold but no measure/band reference → ac-threshold-no-measure-ref", () => {
  const text = taskBody({
    status: "todo",
    contract: `measure suite_wall = \`scripts/test.sh\` 的 duration_ms 字段`,
    ac: `- [ ] AC1: 对照 20–63s 噪声带宽判定差异是否显著`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "ac-threshold-no-measure-ref"), JSON.stringify(violations));
});

test("AC5a-clean: AC threshold referencing a declared measure/band name → no finding", () => {
  const text = taskBody({
    status: "todo",
    contract: `measure suite_wall = \`scripts/test.sh\` 的 duration_ms 字段\nband noise = 20000..63000 ms`,
    ac: `- [ ] AC1: 对照 \`band noise\` 判定差异是否显著`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(!violations.some((v) => v.code === "ac-threshold-no-measure-ref"), JSON.stringify(violations));
});

test("AC5b: measure without command → measure-no-command", () => {
  const text = taskBody({
    status: "todo",
    contract: `measure suite_wall = duration_ms 字段`,
    ac: `- [ ] AC1: 记录墙钟`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "measure-no-command"), JSON.stringify(violations));
});

test("measure with command but no field → measure-no-field", () => {
  const text = taskBody({
    status: "todo",
    contract: `measure suite_wall = \`scripts/test.sh\``,
    ac: `- [ ] AC1: 记录墙钟`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "measure-no-field"), JSON.stringify(violations));
});

test("invoke not a backtick command → invoke-not-command", () => {
  const text = taskBody({
    status: "todo",
    contract: `invoke scripts/test.sh --test-concurrency=4`,
    ac: `- [ ] AC1: 跑`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "invoke-not-command"), JSON.stringify(violations));
});

test("done task: invoke command absent from evidence → invoke-evidence-missing", () => {
  const text = taskBody({
    status: "done",
    contract: `invoke \`scripts/test.sh --test-concurrency=4\``,
    ac: `- [x] AC1: 跑`,
    extraBody: `## Execution record\n\n跑了别的命令。\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
});

test("done task: invoke command present verbatim outside Contract → no finding", () => {
  const text = taskBody({
    status: "done",
    contract: `invoke \`scripts/test.sh --test-concurrency=4\``,
    ac: `- [x] AC1: 跑`,
    extraBody: `## Execution record\n\n命令：scripts/test.sh --test-concurrency=4\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(!violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
});

test("todo task: invoke evidence not required yet", () => {
  const text = taskBody({
    status: "todo",
    contract: `invoke \`scripts/test.sh --test-concurrency=4\``,
    ac: `- [ ] AC1: 跑`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(!violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
});

test("defect task without control → defect-no-control", () => {
  const text = taskBody({
    labels: ["gap", "defect"],
    status: "todo",
    contract: `measure m = \`cmd\` 的 f`,
    ac: `- [ ] AC1: 修`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "defect-no-control"), JSON.stringify(violations));
});

test("defect task with control (incl. n/a) → no defect-no-control finding", () => {
  const withControl = taskBody({
    labels: ["gap", "defect"],
    status: "todo",
    contract: `measure m = \`cmd\` 的 f\ncontrol 改脏 → 仍必须失败`,
    ac: `- [ ] AC1: 修`,
  });
  assert.ok(!scanTaskText(withControl, "tasks/x.md").violations.some((v) => v.code === "defect-no-control"));
  const withNa = taskBody({
    labels: ["gap", "defect"],
    status: "todo",
    contract: `measure m = \`cmd\` 的 f\ncontrol n/a: 无负面控制`,
    ac: `- [ ] AC1: 修`,
  });
  assert.ok(!scanTaskText(withNa, "tasks/x.md").violations.some((v) => v.code === "defect-no-control"));
});

test("dispatch-review-missing is a ratchet violation only when a Contract exists", () => {
  const noContract = taskBody({ status: "todo", ac: `- [ ] AC1: x` });
  assert.ok(!scanTaskText(noContract, "tasks/a.md").violations.some((v) => v.code === "dispatch-review-missing"));
  const withContract = taskBody({
    status: "todo",
    contract: `measure m = \`cmd\` 的 f`,
    ac: `- [ ] AC1: x`,
  });
  assert.ok(scanTaskText(withContract, "tasks/b.md").violations.some((v) => v.code === "dispatch-review-missing"));
});

// ── hasThresholdMarker ──────────────────────────────────────────────────────────────────────────────

test("hasThresholdMarker: noise/band keywords and number-with-unit", () => {
  assert.equal(hasThresholdMarker("对照 20–63s 噪声带宽判定"), true);
  assert.equal(hasThresholdMarker("band 对比"), true);
  assert.equal(hasThresholdMarker("至少跑 6 次"), false); // no unit → not a threshold marker
  assert.equal(hasThresholdMarker("需要 2048MB"), true);
  assert.equal(hasThresholdMarker(null), false);
});

// ── CLI + AC6 ratchet data file ─────────────────────────────────────────────────────────────────────

function makeGitRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cc-cli-${tag}-`));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "analysis"), { recursive: true });
  return dir;
}

const CLEAN_TASK = `---
id: t-clean
title: clean
status: todo
labels:
  - gap
extra:
  schema: v1
---

## Proposal

body body body body body

## Contract

\`\`\`
measure suite_wall = \`scripts/test.sh\` 的 duration_ms 字段
band    noise       = 20000..63000 ms
invoke  \`scripts/test.sh --test-concurrency=4\`
control 改回 8 ⇒ AC2 必须不成立
resume  n/a: 无中途产物
\`\`\`

## Acceptance Criteria

- [ ] AC1: 对照 \`band noise\` 判定差异

## Dispatch review

reviewer: none
at: 2026-08-03T00:00:00Z
changed: 无
`;

const VIOLATING_TASK = `---
id: t-bad
title: bad
status: todo
labels:
  - gap
  - defect
extra:
  schema: v1
---

## Proposal

body body body body body

## Contract

\`\`\`
measure = 20000..63000
invoke  scripts/test.sh
\`\`\`

## Acceptance Criteria

- [ ] AC1: 对照 20–63s 噪声带宽判定
`;

test("CLI: clean synthetic workspace → exit 0, no violations, --json shape", () => {
  const root = makeGitRoot("clean");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.violations.length, 0);
  assert.equal(report.ratchet.baselineCount, null);
});

test("CLI: violating workspace → exit 0 (report-not-block), violations listed", () => {
  const root = makeGitRoot("bad");
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // The synthetic fixture trips 7 distinct checks — AC5's "AC threshold without measure" and
  // "measure missing command" classes among them. The checker REPORTS them but does NOT block (exit 0).
  assert.match(r.stdout, /measure-no-command/);
  assert.match(r.stdout, /ac-threshold-no-measure-ref/);
  assert.match(r.stdout, /contract-measure-no-name/);
  assert.match(r.stdout, /invoke-not-command/);
  assert.match(r.stdout, /defect-no-control/);
});

test("MINOR2: subset scan (explicit file) skips the ratchet comparison and exits 0", () => {
  const root = makeGitRoot("subset");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  // Establish a baseline over the full store.
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // Subset scan of just t-clean: it must NOT report the t-bad baseline entries as "resolved" (they
  // are simply out of scope), and must exit 0.
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "tasks/t-clean.md"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /subset scan \(<task-file> args\) — ratchet comparison skipped/);
  assert.doesNotMatch(r.stdout, /resolved:/);
});

test("AC6 ratchet: --write-ratchet creates the baseline; a NEW violation then exits 1", () => {
  const root = makeGitRoot("ratchet");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const dataPath = path.join(root, DATA_FILE_REL);
  assert.ok(fs.existsSync(dataPath));
  assert.match(fs.readFileSync(dataPath, "utf8"), /# baseline-count: 0/);

  // Clean store stays clean → exit 0.
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);

  // Introduce a NEW violation → the list would grow → exit 1 (ratchet).
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /new since baseline: 7/);
});

test("AC6 ratchet shrink: fixing a listed violation exits 0 and reports resolved", () => {
  const root = makeGitRoot("shrink");
  // baseline with the violation listed
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, DATA_FILE_REL), "utf8"), /# baseline-count: 7/);

  // Fix the task (remove it from the store) → list shrinks → exit 0, resolved reported.
  fs.unlinkSync(path.join(root, "tasks", "t-bad.md"));
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /resolved: 7/);
});

test("writeRatchet refuses to grow past the ceiling or add new entries", () => {
  const root = makeGitRoot("norefuse");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  writeRatchet(root, []);
  const tooBig = writeRatchet(root, ["tasks/t-clean.md: measure-no-command"]);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /only get SHORTER/);
});

test("findWorkspaceRoot walks up to .git", () => {
  const root = makeGitRoot("rootwalk");
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(findWorkspaceRoot(sub), root);
});

// ── Real-store smoke (opt-in; runs the AC6 full-store scan) ────────────────────────────────────────
const REAL_STORE_ENABLED = process.env.QUAY_TEST_REAL_STORE === "1";
test("AC6 real-store: backfilled case tasks + this task are violation-free", { skip: !REAL_STORE_ENABLED }, () => {
  const root = REPO_ROOT;
  // The four AC4 backfilled cases + this task itself are clean (AC6). The showcase
  // gap-no-resource-awareness-heavy-ops-run-blind.md is DELIBERATELY NOT here — it is the one real
  // dispatch-review-missing baseline entry (a Contract but no Dispatch review yet, status:todo).
  const files = [
    "tasks/gap-suite-concurrency-4-vs-8-measurement.md",
    "tasks/gap-sync-vendor-drift-mislabelled-as-task-schema.md",
    "tasks/gap-no-explicit-blocked-signal-from-inner-layer.md",
    "tasks/gap-dispatch-gate-has-no-checklist-and-no-trace.md",
  ];
  // NOTE: runCli process-exits (it IS the CLI), so the real-store assertions scan directly.
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    const { violations } = scanTaskText(text, f);
    assert.deepEqual(violations, [], `expected ${f} to have zero violations, got: ${JSON.stringify(violations)}`);
  }
});
