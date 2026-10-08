// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 11/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { LANDING_BEHIND_THRESHOLD_DEFAULT, LANDING_STALENESS_MS_DEFAULT, __dirname, analyzeTasks, applyPromotions, assert, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, os, parseTask, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("analyzeTasks: AC17 catch-up — criterion_met True AND landing_blocked True reported explicitly (AC1/AC2)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lb-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  // master advances with un-migrated commits (the AC17 catch-up backlog) — develop/integration frozen.
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // Three pairwise-disjoint ready tasks ⇒ dispatchable_disjoint ≥ cap ⇒ criterion_met True (the
  // "dispatchable visible" half) — yet landing is structurally blocked.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1, // floor 3 — pool 3 ≥ floor, no promotion noise
    now: baseEpochSec * 1000 + 3 * 60 * 60 * 1000, // 3h after base — integration frozen past the 2h window
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatchable candidates exist (the old visibility)");
  assert.equal(r.landing_blocked, true, "AC2: catch-up incomplete ⇒ landing-blocked reported");
  assert.match(r.report, /landing-blocked/);
  assert.match(r.landing_blocked_reason, /3 commit/);
});


test("analyzeTasks: AC4 negative — normal landing (integration advancing) ⇒ no landing-blocked false report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lbn-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // integration keeps advancing — a task lands on it (normal landing, NOT structurally blocked).
  git("checkout", "-q", "integration");
  fs.writeFileSync(path.join(root, "task.txt"), "task\n");
  git("add", ".");
  git("commit", "-q", "-m", "Merge branch 'task/gap-r1'");
  const intEpochSec = Number(git("log", "-1", "--format=%ct"));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1,
    now: intEpochSec * 1000 + 30 * 60 * 1000, // 30 min after the last integration commit — NOT frozen
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h window
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatch still healthy");
  assert.equal(r.landing_blocked, false, "AC4: normal landing (integration fresh) ⇒ no false report");
  assert.doesNotMatch(r.report, /landing-blocked/);
});


test("CLI Contract measure surface: blocked stdout carries the 'landing-blocked' literal (measure)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lbc-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  fs.writeFileSync(path.join(root, "m.txt"), "m\n");
  git("add", ".");
  git("commit", "-q", "-m", "master commit");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  // A 1ms staleness window makes the just-made base commit "frozen" deterministically (no --now on the CLI).
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--landing-staleness-ms", "1", "--landing-behind-threshold", "1"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.landing_blocked, true, "CLI reports landing_blocked in the JSON");
  assert.match(out, /landing-blocked/, "Contract measure: stdout carries the 'landing-blocked' literal (grep surface)");
});

// ── HEARTBEAT MODE (gap-ready-pool-promotion-same-class-as-slot-refill) ───────────────────────────
// The tick heartbeat must UNCONDITIONALLY run ready-pool-check and — when pool < floor AND
// promotions non-empty — land the promotion ON DISK (status todo → ready), no volition. Same root
// cause as slot-refill-only-triggered-on-completion-not-tick-heartbeat (a detector answers, nothing
// mechanically guarantees it is asked). AC1 applies; AC3 is the negative control (pool ≥ floor OR
// promotions empty ⇒ zero writes); the default (no --apply) stays a pure detector.


test("--apply heartbeat: pool < floor + eligible todo ⇒ promotion lands on disk (AC1)", (t) => {
  const root = makeWorkspace("apply-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // eligible: four-artifacts + deps + touches-resolve

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const before = analyzeTasks(opts);
  assert.equal(before.pool, 2);
  assert.equal(before.deficit, 1);
  assert.equal(before.promotions.length, 1);

  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "AC1: pool<floor + promotions non-empty ⇒ should_apply");
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].ok, true);

  // The status actually landed on disk.
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "frontmatter status must be ready on disk");

  // Re-analyze: the pool has recovered to floor (candidate now ready) — AC4 "恢复 pool 到 floor".
  const after = analyzeTasks(opts);
  assert.equal(after.pool, 3, "pool recovered to floor after mechanical promotion (AC4)");
});


test("--apply: pool >= floor with qualified candidate ⇒ apply lands it (AC48 — pool<floor gate retired)", (t) => {
  const root = makeWorkspace("apply-pos-pool");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // eligible todo — pre-AC48 this was the no-busy-work case

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 3
  const r = applyPromotions(opts);
  assert.equal(r.deficit, 0, "pool at floor");
  assert.equal(r.should_apply, true, "AC48: qualified candidate promotes even at pool ≥ floor (合格即晋)");
  assert.equal(r.applied_promotions.length, 1, "one promotion applied");
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "candidate promoted to ready — pool size no longer gates");
});


test("--apply heartbeat negative control: promotions empty ⇒ zero writes (AC3)", (t) => {
  const root = makeWorkspace("apply-neg-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Candidate ineligible: missing DoD (four-artifacts incomplete) ⇒ never in `promotions`.
  writeTask(root, "gap-no-dod", gapTask("gap-no-dod", { body: fourArtifactBody().replace("## Definition of Done", "## Resolution") }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // pool 2 < floor 3, deficit 1
  const r = applyPromotions(opts);
  assert.equal(r.deficit, 1, "pool below floor");
  assert.equal(r.promotions.length, 0, "no qualified candidate");
  assert.equal(r.should_apply, false, "AC3: promotions empty ⇒ no apply");
  assert.deepEqual(r.applied_promotions, []);
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-no-dod.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "ineligible candidate must remain todo");
});

// ── COMMIT-AFTER-WRITE (gap-apply-promotions-commit-status-writes) ────────────────────────────────
// A todo→ready status write must be committed IMMEDIATELY — a status write left uncommitted leaves the
// main checkout dirty, and fan-in-ff-merge.sh treats any dirty tree as exit 2 (blocking every fan-in).
// AC1 (能取假): a promoted task leaves `git status --porcelain` clean — the commit is the fix; without
// it the tree would be dirty. Production root is the main checkout (a git repo); unit-test fixtures are
// repo-less, where the commit is a no-op (committed=false) and the write still lands.
// GOAL-030 ②: "clean" means no uncommitted TRACKED residue; the untracked `.quay/task-status-events.
// jsonl` runtime carrier the flip now appends is filtered out below (same shape as s12's check).


test("applyPromotions commits the status write — git status clean + committed record (AC1)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-commit-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  // Two ready tasks + one eligible todo, all committed as a clean baseline.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("status", "--porcelain"), "", "baseline must be clean before promotion");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].committed, true, "a landed promotion in a git repo must commit");

  // AC1 (能取假): the main checkout is immediately clean — the commit is what cleared the status write.
  //
  // GOAL-030 ② (gap-goal030-promotion-writes-via-kernel-transition): a landed flip now ALSO appends
  // one structured event to the workspace's `.quay/task-status-events.jsonl` (runtime state, never
  // git-tracked — the same family as `.quay/gate-events.jsonl`, which this checkout gitignores). A
  // bare fixture repo has no `.gitignore`, so that carrier legitimately shows as untracked. The AC1
  // judgment is about TRACKED residue ("did the commit land?"), so the untracked `.quay/` telemetry is
  // filtered out — the shape `ready-pool-check-s12.test.mjs` already uses for the same reason.
  assert.equal(
    git("status", "--porcelain").split("\n").filter((l) => l.trim() && !l.includes(".quay/")).join("\n"),
    "",
    "AC1: after promotion the tree is clean (tracked residue dirty ⇒ the commit did not land)",
  );
  const subject = git("log", "-1", "--format=%s");
  assert.equal(subject, "tasks: gap-candidate todo→ready（promotion-driver 机械晋升）", "the commit subject names the task and transition");
});


test("applyPromotions never-committed file → 首次登记 message, not 机械晋升 (AC3, gap-promotion-commit-message-misleading-on-first-track)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-firstreg-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  // Baseline: only the ready tasks are committed. The todo candidate is written AFTER the baseline,
  // so it sits on disk but is never tracked by git — its promotion commit is the file's BIRTH commit
  // (the exact case the Proposal names: 会话先写盘未提交, driver 抢先扫到并晋升 ⇒ 诞生提交被误标「机械晋升」).
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("log", "--oneline", "--", "tasks/gap-candidate.md").trim(), "", "candidate is not yet tracked (birth commit has not happened)");
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // untracked todo

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].committed, true, "the birth commit lands");

  const subject = git("log", "-1", "--format=%s");
  assert.doesNotMatch(subject, /机械晋升|翻转/, "⛔ must not claim a todo→ready flip that never happened");
  assert.match(subject, /首次登记/, "first-registration wording for a never-committed file");
  assert.match(subject, /status=ready/, "records the status it landed with");
});

// ── DETACH PROPAGATION (gap-fan-in-ff-ref-update-detach-develop AC6 → gap-doc-develop-sync-…-resolution) ──
// The main checkout sits on a doc-only work branch (author) while develop is bare (the
// detach). A promotion flip committed on the doc branch must reach develop — fast-forward push —
// so task worktrees branching from develop see the new status (otherwise dispatch reads ready on the
// doc branch while the worktree base still has the old status). Non-ff (develop advanced independently)
// ⇒ mechanical ff-only 失败 ⇒ 升级语义兜底（semanticSyncDocToDevelop：merge -X theirs + ff，develop 权威）。
