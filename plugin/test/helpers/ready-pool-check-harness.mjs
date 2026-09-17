// Shared harness for the ready-pool-check shards (split of ready-pool-check.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../ready-pool-check.test.mjs", import.meta.url).href;

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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  analyzeTasks,
  artifactsComplete,
  notYetFlipped,
  isParked,
  isFixture,
  classifyKind,
  POOL_FLOOR,
  CONCURRENCY_CAP_DEFAULT,
  POOL_FLOOR_MULT_DEFAULT,
  computePoolFloor,
  maxMutuallyDisjointSubset,
  PARKED_MARKER_RE,
  SUPERSEDED_MARKER_RE,
  computeRelevance,
  computeDependedOnCount,
  readChildren,
  strategicTraceable,
  touchesScale,
  readConsolidates,
  STRATEGIC_REF_RE,
  STRATEGIC_WEIGHT,
  BLOCKING_WEIGHT,
  CONSOLIDATION_WEIGHT,
  computeLandingBlocked,
  detectLandingBlocked,
  LANDING_STALENESS_MS_DEFAULT,
  LANDING_BEHIND_THRESHOLD_DEFAULT,
  setTaskStatus,
  applyPromotions,
  applyRevaluations,
  retreatReadyToTodo,
  buildTargetedPromotion,
  ensureDeliveryCriticalLabel,
  computeSuiteBlocking,
  isDirectoryGlob,
  consecutiveRedRounds,
  collectFailureFiles,
  isRedRound,
  isExperimentRound,
  readJsonLines,
  readVerificationRounds,
  countUnattributedFailures,
  SUITE_BLOCKING_WEIGHT,
  RED_WINDOW_MIN_DEFAULT,
  isSuiteFixTask,
  exemptFromSuiteBlocking,
  buildCommitTraceIndex,
  commitSubjectTracesTask,
  commitTraceLanded,
  isCompoundTask,
  isExternalVerificationItem,
  isPendingImplementationItem,
  priorityLevel,
  deriveDefaultLane,
  readPerTaskSuiteRecords,
  isSuiteRecordSkip,
  computeMergeWorktreeSurfaces,
  resolveMergeWorktreeSurfaces,
  unmergedConflictPaths,
  readTaskFileAtRef,
  readTaskStatusAtRef,
  prosePrereqRefs,
  prosePrereqGap,
  declaresPrereq,
  PREREQ_KEYWORD_RE,
  readTaskFilesAtRefBatch,
  listRefTaskBlobs,
  loadParsedTaskStoreAtRef,
  loadLandingIndex,
  rpcStoreCacheMaxBytes,
  PROPAGATION_LEDGER_REL,
  readLastPropagationRecords,
  isWriteFacePropagationFailure,
  commitsAheadOfRefForTask,
  judgeBodyFreshness,
} from "../../scripts/ready-pool-check.ts";
import { INFLIGHT_WORKTREE_STALE_MS } from "../../scripts/concurrent-batch-scheduler.ts";
import { propagateDocBranchToDevelop } from "../../scripts/driver-filters.ts";
import { parseTask } from "../../scripts/task-schema.ts";
import { taskWorkLanded, buildGitHistoryIndex } from "../../scripts/task-status-drift-check.ts";
// The EXACT-equality worktree judgment the leftover-worktree exemption used alone before
// gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption — imported so the AC1 negative
// control asserts the PRE-FIX predicate directly, not a knob on the new one.
import { worktreeMatchesTask } from "../../scripts/fast-mode-telemetry.ts";


// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────







// ── AC1 / AC6: pool computation with the three exclusions ─────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, children = [], role = null, goal_ac = null, body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    role ? `role: ${role}` : null,
    `labels:`,
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    children.length > 0 ? "children:" : "children: []",
    ...children.map((c) => `  - ${c}`),
    goal_ac ? `goal_ac: ${goal_ac}` : null,
    "extra:",
    "  schema: v1",
    "---",
  ].filter((x) => x !== null).join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

// A minimal contract-shape body carrying the four artifacts (Proposal / Contract / AC / DoD).
// `checkedAc` marks the first N AC boxes `- [x]` (default 0 — all unchecked, the fan-in merge shape).
// `uncheckedText` overrides the text of the UNCHECKED AC boxes — the workLanded arm reads the author-
// DECLARED annotation at the item END (（待外部）/（待本任务）, closed enum; unannotated = 待本任务
// fail-closed, gap-ready-pool-remaining-external-vs-implementation), so done-flip fixtures set it to
// an external-verification item ending in （待外部） (e.g. "全量套件绿（外层 verification-round 验证）（待外部）").
function fourArtifactBody({ acBoxes = 4, touches = "", extra = "", checkedAc = 0, uncheckedText = "an AC item that is long enough" } = {}) {
  const acLines = Array.from({ length: acBoxes }, (_, i) =>
    i < checkedAc ? "- [x] an AC item that is long enough" : `- [ ] ${uncheckedText}`);
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invariant promotion_order = gap-first",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    ...(touches ? [`## Touches`, ...touches] : []),
    "## Acceptance Criteria",
    ...acLines,
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    extra,
  ].join("\n");
}

// AC1 (gap-ac46-pool-criteria-in-gate): the todo→ready promotion gate now requires the candidate's
// OWN tasks/<id>.md in ## Touches without `(new)` (C8 self-touch — the dispatch gate's grant). Todo
// fixtures are promotion candidates by default, so gapTask injects the self-touch into the body
// unless the test already declared it (a test that specifically wants self-touch-MISSING passes an
// explicit `touches`/`body` omitting it). `withSelfTouch` appends `- tasks/<id>.md` to the body's
// `## Touches` section, or adds the section when the body has none.
function withSelfTouch(body, id) {
  const line = `- tasks/${id}.md`;
  const idx = body.indexOf("## Touches");
  if (idx === -1) return `${body}\n## Touches\n${line}\n`;
  // Insert the self-touch after the LAST line of the existing Touches section (before the next `## ` heading or EOF).
  const rest = body.slice(idx);
  const nextHeading = rest.indexOf("\n## ");
  const cut = nextHeading === -1 ? body.length : idx + nextHeading;
  return body.slice(0, cut) + `\n${line}` + body.slice(cut);
}

function gapTask(id, opts = {}) {
  // When the test passes an explicit `touches` (not a full `body`), thread them through fourArtifactBody.
  const body = opts.body
    ? withSelfTouch(opts.body, id)
    : fourArtifactBody({ ...opts, touches: [...((opts.touches || []).map((t) => (t.startsWith("- ") ? t : `- ${t}`))), `- tasks/${id}.md`] });
  return { id, status: "todo", labels: ["gap"], ...opts, body };
}

function dirTask(id, opts) {
  return { id, status: "todo", labels: ["milestone-candidate"], body: fourArtifactBody(opts), ...opts };
}

const MISMATCH_FULL_ID = "gap-nyf-name-mismatch-as-fast-death-and-parks-task-needs-human";

const MISMATCH_TRUNCATED_ID = "gap-nyf-name-mismatch"; // the full id minus a REAL suffix

function makeTruncatedWorktreeFixture(t, tag) {
  const root = makeRealGitRepo(tag);
  const wtRoot = path.join(root, "..", `${path.basename(root)}-worktrees`);
  const wtPath = path.join(wtRoot, MISMATCH_TRUNCATED_ID);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtRoot, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  // The touch EXISTS on disk and is committed ⇒ the workLanded arm fires, so the ONLY thing standing
  // between this task and a done-flip verdict is the leftover-worktree exemption.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  gitCommit(root, "seed + landed");
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/landed.ts (new)"] });
  writeTask(root, MISMATCH_FULL_ID, { status: "ready", labels: ["gap"], body });
  fs.mkdirSync(wtRoot, { recursive: true });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${MISMATCH_TRUNCATED_ID}`, wtPath]);
  return { root, wtPath, task: { id: MISMATCH_FULL_ID, status: "ready", body } };
}

// ── eligible-no-goal-source-check: the anti-regression invariant + bidirectional negative control ──
// AC3 (gap-promotion-admission-reads-goal-layer-field): the checker must be able to take the value
// FALSE (injected fixture ⇒ exit non-zero), must be GREEN on this repo (exit 0), and must give
// "cannot read the input" an INDEPENDENT value (NOT-EVALUATED / exit 3) — never the same shape as
// "compliant" (硬规则③b). All three exit codes are asserted from REAL runs of the script.
function runGoalSourceCheck(args) {
  const script = path.resolve(__dirname, "..", "scripts", "eligible-no-goal-source-check.ts");
  try {
    return { code: 0, out: execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function writeRounds(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const recs = rows.map((r, i) => ({
    taskId: `fixture-${i}`,
    runId: `fixture-run-${i}`,
    state: r.state,
    laneCount: r.laneCount ?? 16,
    durationMs: 1000,
    failedFiles: Array.isArray(r.failures) ? r.failures.map((f) => f.file).filter(Boolean) : [],
    fullSuiteRan: true,
    startedAt: `2026-08-15T00:00:0${i}Z`,
    finishedAt: `2026-08-15T00:00:0${i}Z`,
  }));
  fs.writeFileSync(path.join(root, ".quay", "per-task-suite-records.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n"));
}

const PREREQ_BODY = (prereqIds, { withEdge = false } = {}) => {
  const lines = [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars in total length.",
    `**Do not dispatch until all of these have landed**: ${prereqIds.map((p) => `[[${p}]]`).join(", ")}.`,
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = true",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   ok",
    "resume    前置任务全 done 后才 dispatch",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as a real acceptance criterion box",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, definitely long enough content.",
  ];
  return lines.join("\n");
};

// ── prose-prereq widen: 阻塞 keyword + backtick citation form (gap-prose-prereq-detector-blind-to-repo-own-conventions) ──
// A representative pre-edge AC-207 body snippet — 3 阻塞 paragraphs, each carrying a backtick-cited
// task id. The pre-fix keyword table had none of 阻塞, so 63/64 paragraphs of the real body never
// entered the scan; the pre-fix ref matcher only recognized wikilinks, so even a matched paragraph
// yielded 0 ids (the repo cites ids with backticks 740:67 over wikilinks).
const PRE_EDGE_AC207_SNIPPET = [
  "AC2/AC3/AC5 ⛔ 阻塞（第 4 轮）：原阻塞已解除——`gap-driver-resource-gate-path-anchored-at-root-third-party` 已 done 落 develop。",
  "AC2/AC3/AC5 ⛔ 阻塞复核（第 5 轮）：修复任务 `gap-shipped-profiles-missing-worker-roles` 已 ready、AC1/AC2 已勾。",
  "AC2/AC3/AC5 ⛔ 阻塞复核（第 7 轮）：第三阻塞 `gap-promotion-driver-ready-pool-check-path-third-party` 仍未落 develop。",
].join("\n\n");

const SAMPLE_1_DENYING_PARA =
  "**⚠️ 这是今晚第三条同形缺陷**（记为观察项，⛔ 不作为本任务的阻塞）：`gap-git-graph-lane-colour-assertion-assumes-contiguous-columns`（断言强于渲染器承诺的不变量）、`gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry`（枚举面强于「入口」的真实定义）、本条（把一次快照当不变量）。三条都是**测试断言强于机制承诺**，且三条都是在别人的 fan-in 里以「无关红」的形态显形。若后续再出现，应考虑造一个针对该形态的检测器而非逐条修。";

const SAMPLE_1_GENUINE_PARA =
  "**⇒ 它正在烧每一次 fan-in**：上述 fan-in 已因此失败一次，该任务退回 ready 等重试；而它是 `gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable` 的前置 ⇒ **AC-214 这条链整体被挡住**。";

const SAMPLE_2_PARA =
  "**相关但机制不同的既有任务（均不覆盖本条，⛔ 不重复立案）**：`gap-third-party-evidence-no-transport-to-driving-repo-carrier`（done，回传层）、`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`（done，步骤顺序/flag/远端 stdout）、`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`（done，新鲜度锚）。同文件还有两条在飞任务（`gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit` ready、`gap-aged-project-post-upgrade-driver-e2e` todo）——Touches 重叠由派发锁串行化，⛔ 不另立 depends_on 边（它们不改变「配对」这一性质）。";

const SAMPLE_IDS = [
  "gap-git-graph-lane-colour-assertion-assumes-contiguous-columns",
  "gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry",
  "gap-third-party-evidence-no-transport-to-driving-repo-carrier",
  "gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable",
  "gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207",
  "gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit",
  "gap-aged-project-post-upgrade-driver-e2e",
  "gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable",
];

function makeRealGitRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rpc-git-${tag}-`));
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

// Commit everything, optionally pinning the author+committer dates (GIT_COMMITTER_DATE is what
// `git log --format=%ct` reads, so pinning it makes a worktree's last-commit-time deterministic).
function gitCommit(dir, message, date) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
  });
}

// A real mid-merge worktree: `conflict-a/b/c.md` conflict on BOTH branches (3 unmerged paths),
// `clean.md` changes only on master (merges cleanly, staged — the file the OLD full-delta surface
// listed but the unmerged-only surface must NOT). Returns { dir (main repo), wtPath (mid-merge) }.
function makeConflictedMergeWorktree(tag, date) {
  const dir = makeRealGitRepo(tag);
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "base-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "base-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "base-c\n");
  fs.writeFileSync(path.join(dir, "clean.md"), "base-clean\n");
  gitCommit(dir, "base", date);
  // ours branch: change the three conflict files, leave clean.md untouched.
  execFileSync("git", ["checkout", "-q", "-b", "ours"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "ours-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "ours-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "ours-c\n");
  gitCommit(dir, "ours", date);
  // master (theirs): change the three conflict files AND clean.md.
  execFileSync("git", ["checkout", "-q", "master"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "conflict-a.md"), "theirs-a\n");
  fs.writeFileSync(path.join(dir, "conflict-b.md"), "theirs-b\n");
  fs.writeFileSync(path.join(dir, "conflict-c.md"), "theirs-c\n");
  fs.writeFileSync(path.join(dir, "clean.md"), "theirs-clean\n");
  gitCommit(dir, "theirs", date);
  // Worktree on ours, then merge master → 3 conflicts (a/b/c) + 1 clean merge (clean.md).
  const wtPath = path.join(dir, "..", `${path.basename(dir)}-wt`);
  execFileSync("git", ["worktree", "add", "-q", wtPath, "ours"], { cwd: dir });
  try {
    execFileSync("git", ["merge", "master"], { cwd: wtPath, stdio: ["ignore", "pipe", "pipe"] });
  } catch (_) {
    // A conflicted merge exits non-zero — expected; the worktree is left mid-conflict.
  }
  return { dir, wtPath };
}

function bodyUnannotatedNewFiles(id) {
  return fourArtifactBody({
    touches: [
      "- plugin/scripts/fresh-a.ts",
      "- plugin/scripts/fresh-b.ts",
      "- plugin/scripts/fresh-c.ts",
      `- tasks/${id}.md`,
    ],
  });
}

function bodyAnnotatedNewFiles(id) {
  return fourArtifactBody({
    touches: [
      "- plugin/scripts/fresh-a.ts (new)",
      "- plugin/scripts/fresh-b.ts (new)",
      "- plugin/scripts/fresh-c.ts (new)",
      `- tasks/${id}.md`,
    ],
  });
}

function appendPropagationRecord(root, rec) {
  const file = path.join(root, PROPAGATION_LEDGER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
  return file;
}

function makeGitWorkspace(tag, { n = 0, statusFor = () => "done", bodyFor = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-git-${tag}-`));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "fixture");
  git("config", "commit.gpgsign", "false");
  for (let i = 0; i < n; i++) {
    const id = `gap-cache-fixture-${String(i).padStart(5, "0")}`;
    writeTask(root, id, { status: statusFor(i), labels: ["gap"], body: bodyFor ? bodyFor(id, i) : cacheFixtureBody(id, i) });
  }
  if (n > 0) { git("add", "-A"); git("commit", "-qm", "fixture"); }
  return { root, git };
}

function cacheFixtureBody(id, i) {
  return [
    "**type:** execution",
    "## Proposal",
    `Fixture ${id}: a proposal paragraph comfortably longer than forty non-whitespace characters.`,
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invariant promotion_order = gap-first",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    "## Touches",
    `- code/file${i}.ts`,
    `- tasks/${id}.md`,
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough",
    "- [ ] another AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

const normStore = (m) => JSON.stringify([...m].map(([id, t]) => [id, t.frontmatterRaw, t.body]).sort());

const normIndex = (ix) => JSON.stringify({
  commits: [...ix.commits].map(([h, r]) => [h, r.parents, r.subject, [...r.paths].sort()]).sort(),
  byPath: [...ix.byPath].map(([p, hs]) => [p, [...hs].sort()]).sort(),
});

const refTaskIds = (root) => fs.readdirSync(path.join(root, "tasks")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

function withCacheOff(fn) {
  const prev = process.env.QUAY_READY_POOL_CACHE;
  process.env.QUAY_READY_POOL_CACHE = "0";
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.QUAY_READY_POOL_CACHE; else process.env.QUAY_READY_POOL_CACHE = prev;
  }
}

function rpCachePath(root, name) {
  const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
  return path.join(path.resolve(root, common), "quay-ready-pool-cache", name);
}

export { BLOCKING_WEIGHT, CONCURRENCY_CAP_DEFAULT, CONSOLIDATION_WEIGHT, INFLIGHT_WORKTREE_STALE_MS, LANDING_BEHIND_THRESHOLD_DEFAULT, LANDING_STALENESS_MS_DEFAULT, MISMATCH_FULL_ID, MISMATCH_TRUNCATED_ID, PARKED_MARKER_RE, POOL_FLOOR, POOL_FLOOR_MULT_DEFAULT, PREREQ_BODY, PREREQ_KEYWORD_RE, PRE_EDGE_AC207_SNIPPET, PROPAGATION_LEDGER_REL, RED_WINDOW_MIN_DEFAULT, SAMPLE_1_DENYING_PARA, SAMPLE_1_GENUINE_PARA, SAMPLE_2_PARA, SAMPLE_IDS, STRATEGIC_REF_RE, STRATEGIC_WEIGHT, SUITE_BLOCKING_WEIGHT, SUPERSEDED_MARKER_RE, __dirname, analyzeTasks, appendPropagationRecord, applyPromotions, applyRevaluations, artifactsComplete, assert, bodyAnnotatedNewFiles, bodyUnannotatedNewFiles, buildCommitTraceIndex, buildGitHistoryIndex, buildTargetedPromotion, cacheFixtureBody, classifyKind, collectFailureFiles, commitSubjectTracesTask, commitTraceLanded, commitsAheadOfRefForTask, computeDependedOnCount, computeLandingBlocked, computeMergeWorktreeSurfaces, computePoolFloor, computeRelevance, computeSuiteBlocking, consecutiveRedRounds, countUnattributedFailures, declaresPrereq, deriveDefaultLane, detectLandingBlocked, dirTask, ensureDeliveryCriticalLabel, execFileSync, exemptFromSuiteBlocking, fileURLToPath, fourArtifactBody, fs, gapTask, gitCommit, isCompoundTask, isDirectoryGlob, isExperimentRound, isExternalVerificationItem, isFixture, isParked, isPendingImplementationItem, isRedRound, isSuiteFixTask, isSuiteRecordSkip, isWriteFacePropagationFailure, judgeBodyFreshness, listRefTaskBlobs, loadLandingIndex, loadParsedTaskStoreAtRef, makeConflictedMergeWorktree, makeGitWorkspace, makeRealGitRepo, makeTruncatedWorktreeFixture, makeWorkspace, maxMutuallyDisjointSubset, normIndex, normStore, notYetFlipped, os, parseTask, path, priorityLevel, propagateDocBranchToDevelop, prosePrereqGap, prosePrereqRefs, readChildren, readConsolidates, readJsonLines, readLastPropagationRecords, readPerTaskSuiteRecords, readTaskFileAtRef, readTaskFilesAtRefBatch, readTaskStatusAtRef, readVerificationRounds, refTaskIds, resolveMergeWorktreeSurfaces, retreatReadyToTodo, rpCachePath, rpcStoreCacheMaxBytes, runGoalSourceCheck, setTaskStatus, strategicTraceable, taskWorkLanded, test, touchesScale, unmergedConflictPaths, withCacheOff, withSelfTouch, worktreeMatchesTask, writeRounds, writeTask };
