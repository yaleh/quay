// @test-group engine
// task-contract-check.test.mjs — the consumer-side checker for the `## Contract` block + `## Dispatch
// review` section (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace). The dispatch gate's five
// verbal questions become a machine-readable Contract; this test pins the parser (shared with
// task-schema.ts), the A9/A10 syntax checks, the FIVE consumer judgments (AC↔measure ref, measure
// command+field, invoke ENTRY-PATH evidence, defect→control, blank-value), the fence-aware section
// extraction, and the AC6 ratchet data-file invariant.
//
// gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed: the invoke-evidence criterion was
// changed from VERBATIM string to the command's EXECUTABLE ENTRY PATH (placeholders like <ISO> make
// verbatim matching impossible by construction; 6 of the 7 prior findings were false positives). The
// checker itself is now wired into scripts/test.sh's run_static_checks (AC4) so the ratchet CANNOT
// grow unnoticed. AC8: this file declares `// @test-group engine`.
//
// AC1 six-key syntax (task-schema) · AC2 five consumer judgments read content · AC3 Dispatch review
// format + missing-section report · AC5 synthetic violation demo (AC-threshold-no-measure-ref,
// measure-no-command) · AC6 ratchet data file · AC8 @test-group engine.
//
// Run: scripts/test.sh plugin/test/task-contract-check.test.mjs

import { test, after } from "node:test";
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
  readRatchet,
  writeRatchet,
  invokeEntryPath,
  checkDodSuiteLine,
  readDodSuiteLineBaseline,
  readBareDirTouchesBaseline,
  checkWiringClaimAcProbeGated,
  readWiringClaimAcProbeBaseline,
  DATA_FILE_REL,
  DOD_SUITE_LINE_BASELINE_REL,
  WIRING_CLAIM_AC_PROBE_BASELINE_REL,
} from "../scripts/task-contract-check.ts";
import { repoRoot } from "../scripts/repo-root.ts";
import { checkWiringClaimAcProbe } from "../scripts/wiring-coverage-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "task-contract-check.ts");

const fm = (labels, extra = 'extra:\n  schema: "v1"') =>
  `---\nid: T\ntitle: t\nstatus: ${labels.status || "todo"}\nlabels:\n${(labels.list || []).map((l) => `  - ${l}`).join("\n")}\n${extra}\n---\n`;

function taskBody({ labels = [], status = "todo", contract, dispatchReview, ac, dod, extraBody = "" }) {
  const parts = [];
  parts.push("## Proposal\n\nproposal body\n\n");
  if (contract !== undefined) parts.push(`## Contract\n\n${contract}\n\n`);
  if (ac !== undefined) parts.push(`## Acceptance Criteria\n\n${ac}\n\n`);
  if (dispatchReview !== undefined) parts.push(`## Dispatch review\n\n${dispatchReview}\n\n`);
  if (dod !== undefined) parts.push(`## Definition of Done\n\n${dod}\n\n`);
  if (extraBody) parts.push(extraBody);
  return fm({ list: labels, status }, `extra:\n  schema: "v1"`) + parts.join("");
}

// ── Governance self-skip (AC8 @test-group engine) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent) — the checker itself is enforced unconditionally via scripts/test.sh's

// ── parseContract ───────────────────────────────────────────────────────────────────────────────────

test("parseContract: fenced showcase format → structured entries", () => {
  const { present, entries } = parseContract(`## Contract

\`\`\`
measure   cpu_stall   = \`cat /proc/pressure/cpu\` 的 some avg10 字段      # comment
band      cpu_ok      = some avg10 < 40
invariant nproc 在判定前后一致
invoke    \`plugin/scripts/resource-gate.sh --for full-suite\`
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

// ── invokeEntryPath (gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed) ────────────────

test("invokeEntryPath: first slash-bearing token, skipping interpreter + flags", () => {
  assert.equal(invokeEntryPath("node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <ISO>"), "orchestration/watch/inner-forensics.mjs");
  assert.equal(invokeEntryPath("bash scripts/assert-clean-tree.sh /srv/target"), "scripts/assert-clean-tree.sh");
  assert.equal(invokeEntryPath("node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173"), "packages/quay/bin/quay.ts");
  assert.equal(invokeEntryPath("node --experimental-strip-types plugin/scripts/task-schema-check.ts <file>"), "plugin/scripts/task-schema-check.ts");
  assert.equal(invokeEntryPath("bash scripts/test.sh"), "scripts/test.sh");
  assert.equal(invokeEntryPath("node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json"), "plugin/scripts/runtime-usage-inventory.ts");
});

test("invokeEntryPath: no path token → fall back to the full command string", () => {
  assert.equal(invokeEntryPath("git status"), "git status");
  assert.equal(invokeEntryPath("quay gate --gate dod X-001"), "quay gate --gate dod X-001");
});

// Entry-path invoke evidence (AC1/AC3): the criterion is the EXECUTABLE ENTRY PATH outside the
// Contract block, not the verbatim string. The 6 previously-false findings had the path elsewhere.

test("done task: invoke entry path present outside Contract (different flags) → no finding", () => {
  // gap-web-cannot-show: invoke says `--port 4173`, evidence ran `--port 4174` on a scratch worktree.
  const text = taskBody({
    status: "done",
    contract: `invoke \`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173\``,
    ac: `- [x] AC1: 服务`,
    extraBody: `## Execution record\n\n服务：node packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4174（scratch worktree）\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(!violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
});

test("done task: invoke entry path present outside Contract (interpreter dropped) → no finding", () => {
  // gap-tests-never-clean: invoke says `bash scripts/test.sh`, evidence wrote `scripts/test.sh` 全绿.
  const text = taskBody({
    status: "done",
    contract: `invoke \`bash scripts/test.sh\` 前后各跑一次 \`ls -1 /tmp | wc -l\``,
    ac: `- [x] AC1: 跑`,
    extraBody: `## Acceptance Criteria\n\n- [x] \`scripts/test.sh\` 全绿：fan-in 套件 2054 tests / 2035 pass\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(!violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
});

test("AC1: invoke with placeholder (<ISO>/<file>) is judged by entry path, not the full string", () => {
  // Placeholder present + entry path present outside Contract → no finding.
  const present = taskBody({
    status: "done",
    contract: `invoke \`node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <ISO>\``,
    ac: `- [x] AC1: 跑`,
    extraBody: `## Execution record\n\n$ node orchestration/watch/inner-forensics.mjs verify 全量套件 --since 2026-08-03T01:59:40Z\n`,
  });
  assert.ok(!scanTaskText(present, "tasks/x.md").violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(scanTaskText(present, "tasks/x.md").violations));
  // Placeholder present + entry path absent outside Contract → still a finding.
  const absent = taskBody({
    status: "done",
    contract: `invoke \`node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <ISO>\``,
    ac: `- [x] AC1: 跑`,
    extraBody: `## Execution record\n\n跑了别的命令。\n`,
  });
  assert.ok(scanTaskText(absent, "tasks/x.md").violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(scanTaskText(absent, "tasks/x.md").violations));
});

test("AC2 negative control: entry path appears ONLY in the Contract → still reported", () => {
  // gap-serve-task-list-dies-on-one-malformed-task: the ONLY `packages/quay/bin/quay.ts` occurrence
  // is the invoke line inside ## Contract itself. A done task must show the path outside the block.
  const text = taskBody({
    status: "done",
    contract: `invoke \`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173\``,
    ac: `- [x] AC1: 服务`,
    extraBody: `## Execution record\n\n跑了别的命令。\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
  assert.match(violations.find((v) => v.code === "invoke-evidence-missing").what, /packages\/quay\/bin\/quay\.ts/);
});

test("AC2 negative control: entry path inside a Contract MEASURE line does NOT satisfy the evidence", () => {
  // The path appears in the `measure` line of the Contract, but the Contract block is excluded —
  // a measure mention is not "the command was run".
  const text = taskBody({
    status: "done",
    contract: `measure exit_code = \`node packages/quay/bin/quay.ts serve --port 4173\` 输出的 exit_code 字段\ninvoke \`node packages/quay/bin/quay.ts serve --port 4173\``,
    ac: `- [x] AC1: 服务`,
    extraBody: `## Execution record\n\n跑了别的命令。\n`,
  });
  const { violations } = scanTaskText(text, "tasks/x.md");
  assert.ok(violations.some((v) => v.code === "invoke-evidence-missing"), JSON.stringify(violations));
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

// ── Check 6: DoD full-suite-demand line (gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge, AC2) ──

const SUITE_DEMAND_DOD = "- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）";

test("AC2 negative control: a task whose DoD carries the full-suite demand and is NOT grandfathered → dod-suite-line", () => {
  const text = taskBody({ status: "todo", dod: SUITE_DEMAND_DOD });
  const { violations } = scanTaskText(text, "tasks/new-task.md");
  const v = violations.find((x) => x.code === "dod-suite-line");
  assert.ok(v, JSON.stringify(violations));
  // points at the rule source task (AC2: 报出并指向本任务)
  assert.match(v.what, /gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge/);
});

test("AC2: the same demand is NOT a violation when the file IS on the shrink-only grandfather list", () => {
  const text = taskBody({ status: "todo", dod: SUITE_DEMAND_DOD });
  const grandfathered = new Set(["tasks/legacy-task.md"]);
  const { violations } = scanTaskText(text, "tasks/legacy-task.md", { dodSuiteLineBaseline: grandfathered });
  assert.ok(!violations.some((x) => x.code === "dod-suite-line"), JSON.stringify(violations));
});

test("AC2: a DoD mentioning 完整套件 WITHOUT the demand (new-correct framing) is NOT flagged", () => {
  // 「本任务自身不再要求完整套件」is the NEW correct framing (the gate lives at the batch-merge
  // boundary) — bare 完整套件 must not fire; only the demand phrase (连跑|绿) does.
  const text = taskBody({ status: "todo", dod: "- [ ] `--for-task` 选中集绿（**本任务自身不再要求完整套件——即以自身为首个应用**）" });
  const { violations } = scanTaskText(text, "tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md");
  assert.ok(!violations.some((x) => x.code === "dod-suite-line"), JSON.stringify(violations));
});

test("checkDodSuiteLine: absent DoD section → []", () => {
  assert.deepEqual(checkDodSuiteLine("## Proposal\nx", "tasks/x.md", new Set()), []);
});

test("readDodSuiteLineBaseline: absent file → empty set + null count", () => {
  const root = makeGitRoot("dslbaseline-absent");
  const { baseline, baselineCount } = readDodSuiteLineBaseline(root);
  assert.equal(baseline.size, 0);
  assert.equal(baselineCount, null);
});

test("CLI AC2: a new task with the DoD demand (no grandfather baseline) is REPORTED; ratchet growth → exit 1", () => {
  const root = makeGitRoot("dslcli");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // Establish the contract ratchet over a clean store (baseline-count 0).
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // A NEW task with the DoD demand, NOT on the (absent) grandfather list → new violation → exit 1.
  const demand = taskBody({ status: "todo", dod: SUITE_DEMAND_DOD });
  fs.writeFileSync(path.join(root, "tasks", "t-demand.md"), demand);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /dod-suite-line/);
  assert.match(r.stdout, /new since baseline: 1/);
});

test("CLI AC2: with the file on the grandfather list, the same demand is NOT a violation (exit 0)", () => {
  const root = makeGitRoot("dslgrandfather");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // Write the dod-suite-line grandfather baseline listing the demand task as grandfathered.
  fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
  fs.writeFileSync(path.join(root, DOD_SUITE_LINE_BASELINE_REL), `# baseline-count: 1\n\ntasks/t-demand.md\n`);
  const demand = taskBody({ status: "todo", dod: SUITE_DEMAND_DOD });
  fs.writeFileSync(path.join(root, "tasks", "t-demand.md"), demand);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(!report.violations.some((v) => v.code === "dod-suite-line"), JSON.stringify(report.violations));
});

test("CLI AC2: the grandfather baseline itself is shrink-only — a ceiling breach exits 1", () => {
  const root = makeGitRoot("dslceiling");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // baseline-count says 1 but the file lists 2 entries → the list grew → breach.
  fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
  fs.writeFileSync(path.join(root, DOD_SUITE_LINE_BASELINE_REL), `# baseline-count: 1\n\ntasks/a.md\ntasks/b.md\n`);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /BASELINE CEILING BREACH/);
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

// R6 (gap-tests-never-clean-up-their-tmpdirs): every mkdtemp dir is tracked and removed at the end
// of the run — a test that leaves a /tmp dir behind is the exact defect that task names.
const tempDirs = [];
function makeGitRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cc-cli-${tag}-`));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "analysis"), { recursive: true });
  return dir;
}
after(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

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

test("AC6 reset: --write-ratchet --reset-baseline re-anchors the ceiling to the current set", () => {
  const root = makeGitRoot("resetbase");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, DATA_FILE_REL), "utf8"), /# baseline-count: 0/);

  // A violation NOT in the baseline → the plain --write-ratchet is skipped (refused, exit 1).
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.doesNotMatch(fs.readFileSync(path.join(root, DATA_FILE_REL), "utf8"), /# baseline-count: 7/);

  // --reset-baseline performs the deliberate one-shot re-anchor.
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet", "--reset-baseline"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  const after = fs.readFileSync(path.join(root, DATA_FILE_REL), "utf8");
  assert.match(after, /# baseline-count: 7/);
  assert.match(after, /tasks\/t-bad\.md: measure-no-command/);

  // The ratchet is shrink-only again from the new baseline: the listed set → exit 0.
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /new since baseline: 0/);
});

// ── --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①) ────────
// A task-file Contract/AC syntax violation is a different risk class from "is the product code
// usable" — in the verification-round path (--no-block) it is REPORTED + recorded in a grow-only
// ledger but NEVER sets red. The DEFAULT mode (no --no-block) keeps the shrink-only ratchet blocking
// behavior (maintenance / mutation tests) — the existing tests above pin that unchanged.

test("CLI --no-block: ratchet growth is REPORTED + ledgered but does NOT exit 1 (round proceeds)", () => {
  const root = makeGitRoot("noblock");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // Clean store → --no-block exits 0 with zero recorded.
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--no-block"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /recorded \(non-blocking\): 0/);
  // Introduce a NEW violation → DEFAULT exits 1 (ratchet growth, unchanged), --no-block exits 0.
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--no-block"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  // Reported + recorded, but the runner's static-check failure marker is avoided (no "new since
  // baseline: N" with N>0 — full-suite-runner.ts would otherwise flip the round red).
  assert.match(r.stdout, /VIOLATION:/);
  assert.match(r.stdout, /recorded \(non-blocking\): 7/);
  assert.match(r.stdout, /recorded \(non-blocking, grow-only ledger\): 7/);
  assert.doesNotMatch(r.stdout, /new since baseline: 7/);
  // Grow-only ledger written (one line per violation).
  const ledgerPath = path.join(root, ".quay", "task-file-violation-ledger.jsonl");
  assert.ok(fs.existsSync(ledgerPath), "grow-only ledger must be written");
  const lineCount = () => fs.readFileSync(ledgerPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
  assert.equal(lineCount(), 7);
  // Grow-only: a second run does NOT re-append (只增不减, dedup by (checker, violation)).
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--no-block"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(lineCount(), 7);
});

test("CLI --no-block + strict-subset: a touched task's violation is REPORTED + ledgered but does NOT exit 1", () => {
  const root = makeGitRoot("noblock-subset");
  fs.writeFileSync(path.join(root, "tasks", "t-bad.md"), VIOLATING_TASK);
  // Default strict-subset still FAILS (AC4-i — the scoped contract consumer catches a touched task's
  // violation in DEFAULT mode; unchanged).
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--strict-subset", path.join(root, "tasks", "t-bad.md")], { encoding: "utf8" });
  assert.notEqual(r.status, 0, r.stdout);
  // --no-block strict-subset reports + ledgeres but exits 0 (a scoped run is ALSO a verification —
  // task-file syntax must not stop it).
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--strict-subset", path.join(root, "tasks", "t-bad.md"), "--no-block"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /REPORTED \+ ledgered, NOT blocking/);
  assert.match(r.stdout, /recorded \(non-blocking, grow-only ledger\)/);
});

test("repoRoot walks up to .git", () => {
  const root = makeGitRoot("rootwalk");
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(repoRoot(sub), root);
});

// ── Check 8: wiring/reachability-declaring AC must name a real input probe (gap-wiring-claim-ac-requires-real-input-probe) ──

test("AC1: a wiring/reachability declaration without a real input probe → wiring-claim-ac-no-probe (sample 1)", () => {
  // gap-readdepends-on-indented-extra-depends-on AC1: "10 条命中任务都能被读到" — the test called
  // readDependsOn("depends_on: [a, b]\n") on a string literal, the 10 real files never read.
  const ac = "- [x] AC1（能取假，缩进形态可读）：`readDependsOn` 认到 `extra:` 缩进下的 `depends_on`（10 条命中任务都能被读到）；（⛔ 缩进形态仍读不到 ⇒ 假）。";
  const findings = checkWiringClaimAcProbe(ac);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].code, "wiring-claim-ac-no-probe");
});

test("AC1: sample 2 — '已有 3 条现成样本' without a real input probe → flagged", () => {
  // gap-ac146-human-interface-explicit-owner AC2: "已有 3 条现成样本" — the test copied samples into an
  // mkdtemp synthetic file, the real .quay/promotion-outcome.jsonl never read.
  const ac = "- [x] AC2（能取假，负控制）：造一条 needs-human（`.quay/promotion-outcome.jsonl` 已有 3 条现成样本），该界面须显示它；（⛔ 不显示 ⇒ 假）。";
  const findings = checkWiringClaimAcProbe(ac);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].code, "wiring-claim-ac-no-probe");
});

test("AC2 negative control: a declaration that NAMES a real input probe is NOT flagged", () => {
  const acs = [
    "- [x] AC2 — 负控制的真实输入（主检出真实读数，非 fixture）：`plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --cap 5 --json` 实读主检出 store，`candidates[]` 中 `eligible=false` 的已存在 todo 恰 2 条（都卡 `missing=dod`）",
    "- [x] AC2（能取假，生产回放）：用生产 `verification-round.jsonl` 的 `#599`（buckets=P，lookback=[596,597,598] 全 M）回放——修复后 `packages/quay/test/*` 长文件不再被排到 35%-65% 位置",
  ];
  for (const ac of acs) {
    assert.deepEqual(checkWiringClaimAcProbe(ac), [], ac.slice(0, 60));
  }
});

test("AC3 boundary: a pure-function AC with no quantified reachability/existence claim is NOT flagged", () => {
  const acs = [
    "- [x] AC1（能取假）：`parseFoo` 对缩进输入返回正确的依赖列表；（⛔ 返回错 ⇒ 假）。",
    "- [x] AC1: `--verbose` prints debug output to stderr.",
    "- [x] AC2: 6 条旧路径模式零命中（grep 分写路径）——排除它不抑制任何命中。", // N 条 but grep-hit, not a read/exist claim
  ];
  for (const ac of acs) {
    assert.deepEqual(checkWiringClaimAcProbe(ac), [], ac.slice(0, 60));
  }
});

test("checkWiringClaimAcProbeGated: grandfathered file → [] ; a non-grandfathered file → violation", () => {
  const ac = "- [x] AC1（能取假）：`readDependsOn` 认到 `extra:` 缩进下的 `depends_on`（10 条命中任务都能被读到）；（⛔ 缩进形态仍读不到 ⇒ 假）。";
  const body = taskBody({ status: "done", ac });
  const grandfathered = new Set(["tasks/legacy.md"]);
  assert.deepEqual(checkWiringClaimAcProbeGated(body, "tasks/legacy.md", grandfathered), []);
  const hits = checkWiringClaimAcProbeGated(body, "tasks/new.md", grandfathered);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].code, "wiring-claim-ac-no-probe");
  assert.match(hits[0].what, /gap-wiring-claim-ac-requires-real-input-probe/);
});

test("scanTaskText integration: declaration-without-probe is a violation unless grandfathered", () => {
  const ac = "- [x] AC1（能取假）：`readDependsOn` 认到 `extra:` 缩进下的 `depends_on`（10 条命中任务都能被读到）；（⛔ 缩进形态仍读不到 ⇒ 假）。";
  const body = taskBody({ status: "done", ac });
  // no baseline → NEW occurrence
  assert.ok(scanTaskText(body, "tasks/x.md").violations.some((v) => v.code === "wiring-claim-ac-no-probe"));
  // grandfathered → not a violation
  const grandfathered = new Set(["tasks/x.md"]);
  assert.ok(!scanTaskText(body, "tasks/x.md", { wiringClaimAcProbeBaseline: grandfathered }).violations.some((v) => v.code === "wiring-claim-ac-no-probe"));
});

test("readWiringClaimAcProbeBaseline: absent file → empty set + null count", () => {
  const root = makeGitRoot("wcapbaseline-absent");
  const { baseline, baselineCount } = readWiringClaimAcProbeBaseline(root);
  assert.equal(baseline.size, 0);
  assert.equal(baselineCount, null);
});

test("readWiringClaimAcProbeBaseline: present file → set + count", () => {
  const root = makeGitRoot("wcapbaseline-present");
  fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
  fs.writeFileSync(path.join(root, WIRING_CLAIM_AC_PROBE_BASELINE_REL), "# baseline-count: 1\n\ntasks/gap-x.md\n");
  const { baseline, baselineCount } = readWiringClaimAcProbeBaseline(root);
  assert.equal(baseline.size, 1);
  assert.equal(baselineCount, 1);
  assert.ok(baseline.has("tasks/gap-x.md"));
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
  // gap-suite-concurrency-4-vs-8-measurement.md carries a pre-rule bare-dir Touches entry
  // (`measurements/（若复用 measure-suite 工具）`), grandfathered in the bare-dir-touches baseline —
  // so the scan passes the real baseline to stay change-relevant-aware (bare-dir-touches-check, AC1).
  const { baseline } = readBareDirTouchesBaseline(root);
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    const { violations } = scanTaskText(text, f, { bareDirTouchesBaseline: baseline, root });
    assert.deepEqual(violations, [], `expected ${f} to have zero violations, got: ${JSON.stringify(violations)}`);
  }
});

