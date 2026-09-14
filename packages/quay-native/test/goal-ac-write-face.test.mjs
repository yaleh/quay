// @test-group product
// goal-ac-write-face.test.mjs — AC-190's rule ON THE WRITER'S PATH
// (tasks/gap-ac190-write-face-rule-unreachable-under-no-verify).
//
// THE DEFECT THIS SUITE PINS: the rule "a NEW `delivery-critical` task must declare a top-level
// `goal_ac`" was implemented at the git `pre-commit` hook (precommit-guard.ts ③), and the production
// filing path never reaches a hook — `task_write` → `store.ts write()` → `commitStoreWrite()` →
// `git commit --no-verify` (store-commit.ts:13-15 puts `--no-verify` in the DESIGN; measured 370/400
// of the last 400 `tasks/` commits are store-commit-shaped). So the judgment was structurally
// unreachable exactly where violations are born.
//
// EVERY CASE BELOW GOES THROUGH THE REAL ABI WRITE PATH (`store.write()` / the native CLI), ⛔ never a
// bare call of the pure predicate — 硬规则 4 推论三: a fixture proves "can produce", not "did
// produce"; the previous fix's own e2e walked the HAND path and was green while the writer path
// stayed unpoliced. The pure predicate is exercised only for the double-direction READING (AC8).
//
// Four axes, each driven to BOTH values (硬规则 4):
//   AC4  negative control — create + `delivery-critical` + no `goal_ac` ⇒ REJECTED, nothing on disk
//   AC5  reverse control  — the same record WITH a top-level `goal_ac` ⇒ written, on disk, committed
//   AC6  grandfathered    — a PRE-EXISTING delivery-critical task without goal_ac gets a status flip ⇒
//                           allowed (over the REAL repo's whole tasks/ reading, not just a fixture)
//   AC7  third party      — a workspace with NO goal layer ⇒ never blocked
//
// Run: scripts/test.sh packages/quay-native/test/goal-ac-write-face.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createStore } from "../src/store.ts";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";
import { parseFrontmatterCompletely } from "../../quay/src/task-parsing.ts";
import {
  ACTIVATION_LINE_ISO,
  DELIVERY_CRITICAL_LABEL,
  GOAL_CARRIER_DIR_NAME,
  INJECTED_UNBACKED_ID,
  activationLineMs,
  goalCarrierHasRecords,
  hasGoalAc,
  isDeliveryCritical,
  judgeStagedDeliveryCritical,
  writeFaceRejectionOnCreate,
} from "../../quay/src/goal-ac-write-face.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DETECTOR = path.join(REPO_ROOT, "plugin", "scripts", "long-term-guarantee-goal-backed-check.ts");
const GUARD_SRC = path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts");
const DETECTOR_SRC = path.join(REPO_ROOT, "plugin", "scripts", "long-term-guarantee-goal-backed-check.ts");
const STORE_SRC = path.join(REPO_ROOT, "packages", "quay-native", "src", "store.ts");
const CORE_SRC = path.join(REPO_ROOT, "packages", "quay", "src", "goal-ac-write-face.ts");

/** The refusal message this suite keys on — the AC-190 judgment is the ONLY thing that emits it. */
const REFUSAL_RE = /refusing to create task "/;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
// Fixtures live in a process-private temp dir, ⛔ never under the checked-in tree
// (checked-in-write-check judges the resolved path; a fixture inside the repo races every concurrent
// whole-tree copier — gap-fixture-dir-write-races-whole-tree-copy).

function git(root, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Every temp workspace this file creates, cleaned in ONE `after()` — the `_createdDirs` + after()
 *  carrier pattern tmp-leak-pairing-check pairs on. An unpaired `mkdtempSync` is a hard RED gate
 *  (the 2026-08-12 /tmp audit: 3389 leftover dirs / 1.1GB), so the pairing is structural here, not a
 *  thing the author remembers to do per test. */
const _createdDirs = [];
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A disposable git workspace. `goalLayer` picks the enable condition's value:
 *   "records" — goals/ holds ≥1 goal-layer record      ⇒ the rule is ENABLED
 *   "empty"   — goals/ exists but is empty (the shape quay-init lays down) ⇒ DISABLED
 *   "absent"  — no goals/ at all                        ⇒ DISABLED
 */
function makeWorkspace(goalLayer = "records") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ac190-${goalLayer}-`));
  _createdDirs.push(root);
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  if (goalLayer !== "absent") {
    const goalDir = path.join(root, GOAL_CARRIER_DIR_NAME);
    fs.mkdirSync(goalDir, { recursive: true });
    if (goalLayer === "records") {
      fs.writeFileSync(
        path.join(goalDir, "AC-1-fixture.md"),
        "---\nid: AC-1\ntitle: fixture AC\nstatus: achieved\nkind: criterion\ngoal: GOAL-1\n---\nbody\n",
      );
    }
  }
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "README.md"), "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "init");
  return { root, tasksDir, goalDir: path.join(root, GOAL_CARRIER_DIR_NAME), store: createStore(tasksDir, { defaultStatus: "todo" }) };
}

/** A minimal task file carrying `delivery-critical` (+ the label set a real filing has). */
function dcTaskText(id, { goalAc = null } = {}) {
  const fm = [`id: ${id}`, "title: t", "status: todo"];
  if (goalAc) fm.push(`goal_ac: ${goalAc}`);
  fm.push("labels:", "  - gap", `  - ${DELIVERY_CRITICAL_LABEL}`);
  return `---\n${fm.join("\n")}\n---\n\n## Proposal\n\ntext\n`;
}

// ── AC4 负控制：创建 + delivery-critical + 无 goal_ac ⇒ 拒（真实写路径） ────────────────────────────

test("AC4 — a NEW delivery-critical task without goal_ac is REFUSED through store.write() and does NOT land on disk", () => {
  const ws = makeWorkspace("records");
  assert.equal(goalCarrierHasRecords(ws.goalDir), true, "fixture precondition: the goal layer is present ⇒ the rule is ENABLED");

  let threw = null;
  try {
    ws.store.write("gap-new-dc", { title: "t", status: "todo", labels: ["gap", DELIVERY_CRITICAL_LABEL] }, { create: true });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "creating a delivery-critical task without goal_ac must throw through the REAL ABI write path");
  // Attributable: the id, what is missing, and how to fix it (the spec's "含 task id + 缺什么 + 怎么补").
  assert.match(threw.message, /gap-new-dc/, "the refusal names the task id");
  assert.match(threw.message, /goal_ac/, "the refusal names the missing field");
  assert.match(threw.message, /Fix:/, "the refusal says how to fix it");
  assert.match(threw.message, new RegExp(DELIVERY_CRITICAL_LABEL), "the refusal names the label that caused it");
  // The rollback arm that matters for a creation: the file is NOT on disk.
  assert.equal(fs.existsSync(path.join(ws.tasksDir, "gap-new-dc.md")), false, "the refused task must NOT be on disk");
  // …and nothing was committed either (no half-visible record in git history).
  const log = git(ws.root, "log", "--oneline", "--", "tasks/gap-new-dc.md");
  assert.equal(log.trim(), "", "no commit may exist for the refused task");
});

test("AC4 — the same refusal reaches the CLI/ABI surface: `task create` exits non-zero and writes nothing", () => {
  const ws = makeWorkspace("records");
  const res = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      QUAY_NATIVE_CLI,
      "task",
      "create",
      "gap-new-dc-cli",
      "--title",
      "t",
      "--labels",
      `gap,${DELIVERY_CRITICAL_LABEL}`,
    ],
    { encoding: "utf8", env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir } },
  );
  assert.notEqual(res.status, 0, `task create must exit non-zero, got ${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  assert.match(res.stderr + res.stdout, REFUSAL_RE, "the CLI surfaces the attributable refusal, not a bare crash");
  assert.equal(fs.existsSync(path.join(ws.tasksDir, "gap-new-dc-cli.md")), false, "the refused task must NOT be on disk");
});

// ── AC5 反向对照：同一内容补上顶层 goal_ac ⇒ 落盘 + 提交成功 ──────────────────────────────────────

test("AC5 — the SAME task WITH a top-level goal_ac is written, lands on disk, and is committed", () => {
  const ws = makeWorkspace("records");
  const written = ws.store.write(
    "gap-new-dc",
    { title: "t", status: "todo", labels: ["gap", DELIVERY_CRITICAL_LABEL], goal_ac: "AC-1" },
    { create: true },
  );
  assert.ok(written, "the reverse control must succeed (the judgment can take the value false)");
  assert.equal(written.goal_ac, "AC-1");
  const file = path.join(ws.tasksDir, "gap-new-dc.md");
  assert.equal(fs.existsSync(file), true, "the accepted task IS on disk");
  assert.match(fs.readFileSync(file, "utf8"), /^goal_ac: AC-1$/m, "the top-level field is really there");
  // The commit half of AC5: the store's own branch-aware commit ran.
  const log = git(ws.root, "log", "--oneline", "--", "tasks/gap-new-dc.md").trim();
  assert.ok(log !== "", "the accepted write must be committed (the store's post-write commit ran)");
  const inHead = git(ws.root, "show", "HEAD:tasks/gap-new-dc.md");
  assert.match(inHead, /^goal_ac: AC-1$/m, "the committed blob carries the field");
});

// ── AC6 不误伤：存量被翻状态 ⇒ 放行；无标签不触发 ────────────────────────────────────────────────

test("AC6 — a PRE-EXISTING delivery-critical task without goal_ac is NOT blocked when its status is flipped", () => {
  const ws = makeWorkspace("records");
  const file = path.join(ws.tasksDir, "gap-old-unbacked.md");
  fs.writeFileSync(file, dcTaskText("gap-old-unbacked"));
  const flipped = ws.store.write("gap-old-unbacked", { status: "ready" });
  assert.equal(flipped?.status, "ready", "flipping stock status must be allowed");
  assert.match(fs.readFileSync(file, "utf8"), /^status: ready$/m);
});

test("AC6 — a NEW task with NO delivery-critical label is not affected by this rule", () => {
  const ws = makeWorkspace("records");
  const written = ws.store.write("gap-plain", { title: "t", status: "todo", labels: ["gap", "mechanism"] }, { create: true });
  assert.equal(written?.id, "gap-plain", "an unlabelled task is outside this judgment's population");
});

test("AC6 — REAL REPO reading: over the WHOLE tasks/ store, pre-existing delivery-critical tasks without goal_ac flip freely, while creation is still refused in the SAME store", () => {
  // The reading must be over the real task corpus (⛔ not just a fixture) AND the enable condition
  // must be genuinely ON during it — otherwise "nothing was blocked" is the vacuous reading of a
  // switched-off gate (硬规则 4: a reading that cannot take the other value is not a measurement).
  const ws = makeWorkspace("records");
  const realTasksDir = path.join(REPO_ROOT, "tasks");
  for (const f of fs.readdirSync(realTasksDir).filter((f) => f.endsWith(".md"))) {
    fs.cpSync(path.join(realTasksDir, f), path.join(ws.tasksDir, f));
  }

  const stock = [];
  for (const f of fs.readdirSync(ws.tasksDir).filter((f) => f.endsWith(".md"))) {
    const raw = fs.readFileSync(path.join(ws.tasksDir, f), "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) continue;
    const fm = parseFrontmatterCompletely(m[1]);
    if (isDeliveryCritical(fm) && !hasGoalAc(fm)) stock.push(f.replace(/\.md$/, ""));
  }
  assert.ok(stock.length > 0, `the real repo must still carry stock delivery-critical tasks without goal_ac for this reading to be non-vacuous (found ${stock.length})`);

  // (a) the grandfathering: every stock task flips without the AC-190 judgment firing.
  let flipped = 0;
  let committedId = null;
  const otherFailures = [];
  for (const id of stock) {
    try {
      ws.store.write(id, { status: "ready" }, { commit: false });
      flipped += 1;
      if (committedId === null) committedId = id;
    } catch (e) {
      if (REFUSAL_RE.test(String(e?.message))) {
        assert.fail(`stock task ${id} was blocked by the AC-190 write face — grandfather semantics broken`);
      }
      otherFailures.push(`${id}: ${e?.message}`);
    }
  }
  assert.ok(flipped > 0, "at least one stock flip must actually have gone through");
  // …and one of them WITH the commit path, so the committed half of the flip is covered too.
  ws.store.write(committedId, { status: "todo" });

  // (b) the control that makes (a) mean something: in the SAME store, with the SAME goal layer, a
  // CREATION of the violating shape IS refused.
  let threw = null;
  try {
    ws.store.write("gap-live-control", { title: "t", status: "todo", labels: [DELIVERY_CRITICAL_LABEL] }, { create: true, commit: false });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw && REFUSAL_RE.test(threw.message), "the write face must be ON in this very fixture — else the stock reading is vacuous");

  console.log(
    `AC6 real-repo reading: ${stock.length} stock delivery-critical tasks without goal_ac (flipped ${flipped}, ` +
      `other failures ${otherFailures.length}); same-store creation refusal = ${threw ? "YES" : "NO"}`,
  );
  if (otherFailures.length > 0) console.log(`  (non-AC-190 flip failures: ${otherFailures.slice(0, 3).join(" | ")})`);
});

// ── AC7 第三方不误伤：没有 goal 层的工作区不得被挡 ────────────────────────────────────────────────

test("AC7 — a workspace with NO goal layer is never blocked (both shapes: no goals/ and an empty goals/)", () => {
  for (const shape of ["absent", "empty"]) {
    const ws = makeWorkspace(shape);
    const written = ws.store.write(
      `gap-3p-${shape}`,
      { title: "t", status: "todo", labels: ["gap", DELIVERY_CRITICAL_LABEL] },
      { create: true },
    );
    assert.ok(written, `goal layer "${shape}" ⇒ the rule's premise does not hold and creating must succeed`);
    assert.equal(fs.existsSync(path.join(ws.tasksDir, `gap-3p-${shape}.md`)), true);
  }
  console.log(
    "AC7 repro (re-runnable): node --no-warnings --experimental-strip-types --test packages/quay-native/test/goal-ac-write-face.test.mjs",
  );
});

// ── AC8 单源：写入面 / 检测器 / 钩子共用同一组判定函数 ──────────────────────────────────────────

test("AC8 — the three surfaces acquire the judgment from ONE module (evidence = the import/export lines themselves)", () => {
  const guardSrc = fs.readFileSync(GUARD_SRC, "utf8");
  const detectorSrc = fs.readFileSync(DETECTOR_SRC, "utf8");
  const storeSrc = fs.readFileSync(STORE_SRC, "utf8");
  assert.equal(fs.existsSync(CORE_SRC), true, "the single-source module exists");

  // The detector re-exports the Core names (its own importers — including this suite's sibling
  // long-term-guarantee-goal-backed-check.test.mjs — keep their import surface).
  assert.match(
    detectorSrc,
    /export\s*\{[\s\S]*?\}\s*from\s*["'][^"']*goal-ac-write-face\.ts["']/,
    "the detector must re-export the Core judgment names",
  );
  // The hook reaches the judgment through the detector's re-export (unchanged import surface).
  assert.match(
    guardSrc,
    /import\s*\{[\s\S]*?judgeStagedDeliveryCritical[\s\S]*?\}\s*from\s*["'][^"']*long-term-guarantee-goal-backed-check\.ts["']/,
    "the hook must import the judgment, not re-implement it",
  );
  // The store (the actual enforcement surface) imports from the Core module directly.
  assert.match(
    storeSrc,
    /import\s*\{[^}]*writeFaceRejectionOnCreate[^}]*\}\s*from\s*["'][^"']*goal-ac-write-face\.ts["']/,
    "the store's creation path must acquire the judgment from the Core module",
  );
  // ⛔ No second implementation of the judgment on any of the three surfaces.
  for (const [name, src] of [["precommit-guard.ts", guardSrc], ["store.ts", storeSrc], ["detector", detectorSrc]]) {
    assert.ok(
      !/\.includes\(\s*["']delivery-critical["']\s*\)/.test(src),
      `${name} must not re-implement the delivery-critical label comparison (single source)`,
    );
    assert.ok(
      !/function\s+judgeStagedDeliveryCritical\s*\(/.test(src),
      `${name} must not carry its own judgeStagedDeliveryCritical definition`,
    );
  }
  // The label literal (as a comparison operand) lives in exactly ONE place.
  assert.match(fs.readFileSync(CORE_SRC, "utf8"), /export const DELIVERY_CRITICAL_LABEL = "delivery-critical";/);
});

test("AC8 — judgeStagedDeliveryCritical keeps its BOTH-WAY readings (violating ⇒ offender; backed / pre-cutoff / unlabelled ⇒ none)", () => {
  const rel = "tasks/gap-x.md";
  const cutoff = activationLineMs();
  const now = Math.max(Date.now(), cutoff);

  assert.deepEqual(
    judgeStagedDeliveryCritical([{ rel, content: dcTaskText("gap-x"), filedAtMs: now }]),
    [`${rel} (id=gap-x)`],
    "violating shape ⇒ the offender string the hook printed before (byte-identical form)",
  );
  assert.deepEqual(
    judgeStagedDeliveryCritical([{ rel, content: dcTaskText("gap-x", { goalAc: "AC-1" }), filedAtMs: now }]),
    [],
    "same shape + goal_ac ⇒ allowed (the judgment can take the value false)",
  );
  assert.deepEqual(
    judgeStagedDeliveryCritical([{ rel, content: dcTaskText("gap-x"), filedAtMs: cutoff - 1000 }], cutoff),
    [],
    "pre-activation-line stock ⇒ grandfathered by the judgment, not filtered out of scope",
  );
  assert.deepEqual(
    judgeStagedDeliveryCritical([{ rel, content: dcTaskText("gap-x") }], cutoff),
    [`${rel} (id=gap-x)`],
    "no add time ⇒ 'filed now' (fail-closed)",
  );
  assert.deepEqual(
    judgeStagedDeliveryCritical([{ rel, content: "no frontmatter here", filedAtMs: now }]),
    [],
    "a file with no frontmatter is not in this judgment's population (neither reject nor pass)",
  );
});

test("AC8 — the store-side entry point is the SAME judgment, gated by an explicit and visible enable condition", () => {
  const content = dcTaskText("gap-x");
  assert.equal(
    writeFaceRejectionOnCreate({ id: "gap-x", rel: "tasks/gap-x.md", content, goalDir: null }),
    null,
    "no goal layer (null) ⇒ disabled",
  );
  const ws = makeWorkspace("empty");
  assert.equal(
    writeFaceRejectionOnCreate({ id: "gap-x", rel: "tasks/gap-x.md", content, goalDir: ws.goalDir }),
    null,
    "empty goals/ (the shape quay-init lays down) ⇒ disabled — existence alone is not the condition",
  );
  const ws2 = makeWorkspace("records");
  const msg = writeFaceRejectionOnCreate({ id: "gap-x", rel: "tasks/gap-x.md", content, goalDir: ws2.goalDir });
  assert.ok(msg && REFUSAL_RE.test(msg), "goal layer present ⇒ the same judgment fires");
  assert.equal(
    writeFaceRejectionOnCreate({ id: "gap-x", rel: "tasks/gap-x.md", content: dcTaskText("gap-x", { goalAc: "AC-1" }), goalDir: ws2.goalDir }),
    null,
    "…and it can take the value false on the same fixture",
  );
  // The real repo's own goal layer is present ⇒ the rule IS enabled in production (not a dead branch).
  assert.equal(goalCarrierHasRecords(path.join(REPO_ROOT, GOAL_CARRIER_DIR_NAME)), true, "production goal layer present");
});

// ── AC1 / AC2 判据链：真仓库绿 + 注入仍非零（⛔ 判据未被放宽） ────────────────────────────────────

test("AC1 — the detector is green on the real repo and its --json reading is OK with no violators", () => {
  const res = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", DETECTOR, "--json"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `default run must be green, got ${res.status}\n${res.stdout}\n${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.violating, []);
  assert.equal(out.cutoff, ACTIVATION_LINE_ISO);
});

test("AC2 — --inject-unbacked-fixture STILL exits non-zero (the criterion was not loosened to get green)", () => {
  const res = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", DETECTOR, "--inject-unbacked-fixture"],
    { encoding: "utf8" },
  );
  assert.notEqual(res.status, 0, "the injected unbacked fixture must stay RED");
  assert.match(res.stdout, new RegExp(INJECTED_UNBACKED_ID));
});
