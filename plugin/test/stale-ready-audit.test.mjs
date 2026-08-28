// @test-group engine
// stale-ready-audit.test.mjs — the 外层 stale-ready / bypass-complete detector (人 2026-08-12 裁定:
// outer 机制要自我保障待办可派发). Two criteria:
//   (a) staleReady  — status:ready + non-empty `## Evidence` (incl. the `## Evidence（…）` heading form)
//                     + ≥1 checked AC  ⇒ "工作已完成、状态陈旧" (forgot-flip).
//   (b) bypassComplete — status:done + mtime ≤6h + NO `gate:"complete"` pass GateEvent for the task in
//                     .quay/gate-events.jsonl  ⇒ completion bypassed the QENG gate path (must have gone
//                     through plugin/scripts/loop-complete-task.ts).
//
// Run: node --test plugin/test/stale-ready-audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/stale-ready-audit.ts");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sra-"));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  return root;
}

function writeTask(root, id, { status, extra = "" }) {
  fs.writeFileSync(
    path.join(root, "tasks", `${id}.md`),
    `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n## Proposal\nlong enough proposal body text for the shape\n## AC\n- [x] a checked ac\n${extra}`,
  );
}

function runAudit(root, extraArgs = []) {
  // Exit code 1 is a NORMAL result when candidates exist (≥1 stale-ready or bypass-complete) — so
  // capture stdout even on non-zero exit instead of letting execFileSync throw.
  const res = spawn("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, root, "--json", ...extraArgs], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  res.stdout.on("data", (c) => { out += c; });
  return new Promise((resolve, reject) => {
    res.on("close", (code) => {
      try {
        resolve({ code, ...JSON.parse(out) });
      } catch (e) {
        reject(new Error(`could not parse audit output (exit ${code}): ${out}`));
      }
    });
  });
}

test("(a) staleReady — ready + Evidence + checked AC is flagged; genuinely-pending is not", async () => {
  const root = makeRoot();
  try {
    // Parenthetical Evidence heading form (the 110+ real tasks use `## Evidence（2026-08-12 …）`).
    writeTask(root, "gap-forgot-flip", {
      status: "ready",
      extra: "## Evidence（2026-08-12 内层 dispatch 实测）\nthe evidence section with plenty of chars over twenty",
    });
    // Exact `## Evidence` heading form.
    writeTask(root, "gap-forgot-flip2", {
      status: "ready",
      extra: "## Evidence\nevidence here also plenty long for the twenty-char gate",
    });
    // Genuinely pending: ready but NO Evidence.
    fs.writeFileSync(
      path.join(root, "tasks", "gap-pending.md"),
      "---\nid: gap-pending\ntitle: gap-pending\nstatus: ready\n---\n## Proposal\nlong enough proposal body text for the shape\n## AC\n- [ ] unchecked\n",
    );
    const r = await runAudit(root);
    assert.equal(r.code, 1, "exit 1 when ≥1 candidate exists");
    assert.equal(r.staleReady.length, 2, `both Evidence-carrying ready tasks flagged; got ${JSON.stringify(r.staleReady)}`);
    const ids = r.staleReady.map((s) => s.id).sort();
    assert.deepEqual(ids, ["gap-forgot-flip", "gap-forgot-flip2"], "both Evidence forms detected");
    assert.equal(r.bypassComplete.length, 0, "no done tasks → no bypass-complete");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("(b) bypassComplete — recently-done task WITHOUT a complete-pass GateEvent is flagged", async () => {
  const root = makeRoot();
  try {
    // Done recently (mtime = now) with NO complete event → bypass-complete.
    writeTask(root, "gap-done-bypass", { status: "done", extra: "## Evidence\nwork landed but completed via direct status write" });
    // Done recently WITH a complete-pass GateEvent → NOT bypass-complete (went through the QENG path).
    writeTask(root, "gap-done-proper", { status: "done", extra: "## Evidence\ncompleted via loop-complete-task" });
    fs.writeFileSync(
      path.join(root, ".quay", "gate-events.jsonl"),
      `{"id":"e1","pipeline_id":"gap-done-proper","gate":"complete","verdict":"pass","timestamp":"2026-08-12T10:00:00Z","payload":{"from":"ready","to":"done"}}\n` +
        `{"id":"e2","pipeline_id":"gap-done-bypass","gate":"retreat","verdict":"pass","timestamp":"2026-08-12T10:00:00Z","payload":{"from":"done","to":"ready"}}\n`,
    );
    const r = await runAudit(root);
    assert.equal(r.code, 1, "exit 1 when the bypass-complete candidate exists");
    assert.deepEqual(
      r.bypassComplete.map((s) => s.id),
      ["gap-done-bypass"],
      "only the done task without a complete pass event is a bypass-complete candidate",
    );
    assert.equal(r.staleReady.length, 0, "no ready tasks in this fixture");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("(b) bypassComplete — old done mtime (>6h) is NOT flagged; --done-within-hours widens/narrows the window", async () => {
  const root = makeRoot();
  try {
    writeTask(root, "gap-done-old", { status: "done", extra: "## Evidence\nflipped long ago, before the audit window" });
    const old = path.join(root, "tasks", "gap-done-old.md");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    fs.utimesSync(old, tenDaysAgo, tenDaysAgo);
    // Old mtime → outside the 6h window → NOT flagged at the default window (exit 0, no candidates).
    const none = await runAudit(root);
    assert.equal(none.code, 0, "exit 0 when no candidates");
    assert.equal(none.bypassComplete.length, 0, ">6h done mtime is not a bypass-complete candidate");

    // A 3h-old mtime with no complete event IS flagged at a 24h window, NOT at a 2h window.
    writeTask(root, "gap-done-3h", { status: "done", extra: "## Evidence\nrecently flipped" });
    const recent = path.join(root, "tasks", "gap-done-3h.md");
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(recent, threeHoursAgo, threeHoursAgo);
    const narrow = await runAudit(root, ["--done-within-hours", "2"]);
    assert.equal(narrow.bypassComplete.length, 0, "3h-old at a 2h window is not flagged");
    const wide = await runAudit(root, ["--done-within-hours", "24"]);
    assert.deepEqual(
      wide.bypassComplete.map((s) => s.id),
      ["gap-done-3h"],
      "3h-old at a 24h window IS flagged (window override works)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
