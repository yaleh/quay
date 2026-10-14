// @test-group engine
// discovery-closed-loop-report.test.mjs — 架构发现闭环读侧总账的判定
// (tasks/gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts)
// plugin/scripts/discovery-closed-loop-report.ts.
//
// ── 本文件要能取假的三件事 ────────────────────────────────────────────────────────────────────────
// ① **AC5 负控制：修了但概念复发 ⇒ `recurred-after-fix`，不是 closed。** 这是本报告最容易退化成
//    「恒真」的地方 —— 一个只读 `recurred` 字段的实现会在任何 off-the-shelf 载体上打出 `false`，
//    而它证明不了「修完之后真的没人再看见这个概念」。所以 fixture 走**真 git**：一条真 done 提交
//    在 develop 上，一条 ts 位于**该提交之后**的同 concept_key 簇记录 ⇒ 读数必须是
//    `recurred-after-fix` 且 `closed:false`；把那条后续记录的 ts 挪到提交**之前** ⇒ 同一个 fixture
//    读成 `no-recurrence-after-fix`。**两次运行只差一个时间戳**，所以它测的是判据而不是回声。
// ② **九类轮结局逐类可区分。** 每个类的 Fact 按生产里真实出现过的两种拼法各喂一次（新散文形
//    `budget-usd-24h: …` 与旧 `not-evaluated:budget-usd-24h`），并断言**一个类别的计数变化不会
//    静默落进另一个类别**（`budget-blocked(calls)` 与 `(usd)` 是两个键，不是一个布尔）。
// ③ **不认识 ≠ 归入某一类。** 一个形状未知的 Fact 必须落在 `unclassified(…)` 里并**带着自己的
//    reason 原文**，⛔ 不是被塞进最近的桶 —— 那正是「把读不懂伪装成读过了」（硬规则 3b）。
//
// ── 复用的是真机件，不是它的副本 ──────────────────────────────────────────────────────────────────
// 端到端那几条走 CLI（`node --experimental-strip-types <script> --host=… --json`），所以被测的是
// 用户会跑的那条路径；纯度那几条直接 import 导出的判定函数。两边都读 fixture 的**真载体**。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ROUND_CLASSES,
  UNCLASSIFIED_PREFIX,
  LINK_ORDER,
  classifyRoundFact,
  classifyRounds,
  readCarrier,
  originClassOf,
  parseHostSpec,
  sharedCheckoutOf,
  isOnBranch,
  notEvaluated,
} from "../scripts/discovery-closed-loop-report.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "discovery-closed-loop-report.ts");

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

/** A temp dir under the OS tmp root, cleaned by the caller. */
function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dcr-${tag}-`));
}

/** Run `git -C root <args…>` with a FIXED identity and committer date, so a fixture's commit time is a
 *  value the test chose rather than the wall clock. */
function git(root, args, { date = "2026-10-01T00:00:00Z" } = {}) {
  const r = spawnSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** A git repo whose `develop` branch already carries one `done` commit on `tasks/<taskId>.md`.
 *  Returns `{root, sha}` — a REAL landing the report has to find by reading git, not by being told. */
function repoWithLandedFix(taskId, { date = "2026-10-01T00:00:00Z" } = {}) {
  const root = tmpdir("repo");
  git(root, ["init", "-q", "-b", "develop"]);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: done\n---\n# ${taskId}\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `tasks: 翻 ${taskId} done（driver 机械 fan-in）`], { date });
  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  return { root, sha };
}

const writeJsonl = (root, rel, records) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
};

/** The report, driven through its CLI exactly as an operator would run it. */
function runReport(root, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", SCRIPT, `--host=fixture=${root}`, "--json", ...extraArgs],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `report exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const findingBy = (host, id) => host.findings.find((f) => f.finding_id === id);

// ── ① AC5: THE NEGATIVE CONTROL — a fix landed, the concept came back ─────────────────────────────

const CONCEPT = { concept_kind: "duplication", components: ["a.ts", "b.ts"] };
const CONCEPT_KEY = "duplication|a.ts,b.ts";

/** One fixture finding whose fix is a real `done` commit on develop, plus an OSD carrier. The ONLY
 *  difference between the recurred and not-recurred cases is `laterTs`.
 *
 *  The evidence store is PRESENT BUT EMPTY on purpose: it is the second effect reading, and an absent
 *  store would make that reading `not-evaluated` — which would leave `recurred-after-fix` reachable but
 *  `no-recurrence-after-fix` NOT, i.e. the control's negative arm could not be taken. An empty store
 *  makes "was looked at, nothing found" a real reading, which is exactly the value under test. */
function fixtureFinding({ laterTs }) {
  const taskId = "gap-fixture-fix-landed";
  const { root, sha } = repoWithLandedFix(taskId);
  writeJsonl(root, ".quay/architecture-evidence-store.jsonl", []);
  writeJsonl(root, ".quay/discovery-portfolio.jsonl", [
    {
      kind: "portfolio_finding",
      id: "portfolio_finding-fixture0001",
      finding_id: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      origin: "autonomous-routine",
      origin_ref: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      origin_carrier: ".quay/open-semantic-discovery-findings.jsonl",
      evidence_level: "production-open",
      concept_key: CONCEPT_KEY,
      claim: "fixture: two components define the same judgment twice",
      components: CONCEPT.components,
      outcome: "supported",
      fix_task: taskId,
      fix_landed_commit: sha,
      fix_landed_reason: `DONE_SUBJECT_ON_develop:tasks/${taskId}.md`,
      recurred: false,
      recurred_reason: "NO_LATER_OUTCOME_ON_SAME_COMPONENTS",
      duplicate_of: null,
      ts: "2026-09-30T00:10:00.000Z",
    },
  ]);
  writeJsonl(root, ".quay/open-semantic-discovery-findings.jsonl", [
    {
      kind: "cluster",
      routine: "open-semantic-discovery",
      ts: "2026-09-30T00:05:00.000Z",
      record_id: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      cluster: 1,
      concept_kind: CONCEPT.concept_kind,
      components: CONCEPT.components,
      members: ["r1:H1"],
      claim: "fixture cluster",
      verifier_verdict: "supported",
      refutation_verdict: "supported",
      confirmed: true,
    },
    // the LATER occurrence — the effect reading's whole object of study.
    {
      kind: "cluster",
      routine: "open-semantic-discovery",
      ts: laterTs,
      record_id: `open-semantic-discovery@${laterTs}#1`,
      cluster: 1,
      concept_kind: CONCEPT.concept_kind,
      components: CONCEPT.components,
      members: ["r1:H1"],
      claim: "fixture cluster, rediscovered",
      verifier_verdict: "supported",
      refutation_verdict: "supported",
      confirmed: true,
    },
  ]);
  return { root, sha };
}

test("AC5 negative control: a merged fix whose concept recurs AFTERWARDS is `recurred-after-fix`, not closed", () => {
  // The landing commit is dated 2026-10-01T00:00:00Z; this occurrence is strictly later.
  const { root, sha } = fixtureFinding({ laterTs: "2026-10-02T00:00:00.000Z" });
  const report = runReport(root);
  const host = report.hosts[0];
  const f = findingBy(host, "open-semantic-discovery@2026-09-30T00:00:00.000Z#1");
  assert.ok(f, "the fixture finding must be in the chain report");

  // The merge link is a REAL reading: it names the commit the fixture actually made, and checks it
  // against develop with git rather than trusting the row's own field.
  assert.equal(f.merge_commit.sha, sha, "the landing sha is read from the row AND re-checked on develop");
  assert.equal(f.merge_commit.on_branch, true, "the fixture commit was made ON develop");
  assert.match(String(f.merge_commit.committed_at), /^2026-10-01T00:00:00/, "cutoff comes from the commit, not the clock");

  // THE ASSERTION THIS TEST EXISTS FOR.
  assert.equal(f.effect.kind, "recurred-after-fix", "a later occurrence of the same concept key must read as recurrence");
  assert.equal(f.effect.readings[0].recurred, true);
  assert.equal(f.effect.readings[0].concept_key, CONCEPT_KEY, "the recurrence is judged by the finding's OWN resolved key");
  assert.equal(f.effect.readings[0].later_occurrences.length, 1, "the later cluster is cited by record_id");
  assert.match(String(f.effect.readings[0].later_occurrences[0].record_id), /^open-semantic-discovery@2026-10-02/);

  // …and it is NOT reported as closed. A chain whose links are all present but whose effect came back
  // positive is a DIFFERENT state from a closed loop, and the two must not share a word.
  assert.equal(f.chain.complete, true, "every link resolved to a value — the chain itself ran to the end");
  assert.equal(f.chain.closed, false, "recurred-after-fix must NOT be reported as closed");

  fs.rmSync(root, { recursive: true, force: true });
});

test("AC5 control's other arm: the SAME fixture with the later occurrence before the merge reads `no-recurrence-after-fix`", () => {
  // One value changed — the later occurrence's ts is now BEFORE the 2026-10-01 landing. If the reading
  // were an echo (e.g. hardcoded, or taken from the record's own `recurred: false` field) this arm and
  // the previous one could not differ.
  const { root } = fixtureFinding({ laterTs: "2026-09-30T12:00:00.000Z" });
  const report = runReport(root);
  const f = findingBy(report.hosts[0], "open-semantic-discovery@2026-09-30T00:00:00.000Z#1");
  assert.equal(f.effect.kind, "no-recurrence-after-fix", "an occurrence BEFORE the landing is not a recurrence");
  assert.equal(f.effect.readings[0].evaluated, true, "the reading WAS taken — it just came back negative");
  assert.equal(f.effect.readings[0].later_occurrences.length, 0);
  assert.equal(f.effect.readings[1].evaluated, true, "the evidence-store reading was taken too");
  assert.equal(f.chain.closed, true, "all links present + no recurrence ⇒ closed");
  fs.rmSync(root, { recursive: true, force: true });
});

test("the effect link is `not-evaluated` when there is no merge commit to read it after", () => {
  const taskId = "gap-fixture-fix-landed";
  const { root } = repoWithLandedFix(taskId);
  writeJsonl(root, ".quay/discovery-portfolio.jsonl", [
    {
      kind: "portfolio_finding",
      id: "portfolio_finding-fixture0002",
      finding_id: "F-none",
      origin: "operator",
      components: ["a.ts"],
      outcome: "supported",
      fix_task: null,
      fix_landed_commit: null,
      fix_landed_reason: "NO_FIX_TASK",
      recurred: null,
      recurred_reason: "NO_COMPONENT_SET",
      duplicate_of: null,
      ts: "2026-09-30T00:00:00.000Z",
    },
  ]);
  const report = runReport(root);
  const f = findingBy(report.hosts[0], "F-none");
  assert.equal(f.effect, notEvaluated("no-merge-commit-to-read-the-effect-after"));
  assert.equal(f.chain.complete, false);
  assert.equal(f.chain.closed, false, "an unread effect must never read as closed (硬规则 3b)");
  assert.ok(f.chain.missing.includes("merge") && f.chain.missing.includes("effect"));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── ② THE NINE ROUND CLASSES, each distinguishable, both spellings ────────────────────────────────

const fact = (over) => ({ name: "open-semantic-discovery", state: "not-evaluated", value: {}, reason: "", ...over });
const rec = (over = {}) => ({ ts: "2026-10-13T00:00:00Z", round: 1, run_id: "g", facts: [], ...over });

test("every class in the declared vocabulary is producible, and each is its OWN key", () => {
  const seen = {};
  const classify = (f, r = rec()) => {
    const c = classifyRoundFact(f, r, "open-semantic-discovery");
    seen[c.cls] = (seen[c.cls] ?? 0) + 1;
    return c.cls;
  };

  assert.equal(classify(fact({ state: "verified", value: { kind: "scan-round", clusters: { total: 3 } } })), "ran-with-clusters");
  assert.equal(classify(fact({ state: "verified", value: { kind: "scan-round", clusters: { total: 0 } } })), "ran-empty");
  assert.equal(classify(fact({ reason: "not due: ran 30m ago within the 60m interval — nothing spawned" })), "not-due");
  assert.equal(classify(fact({ reason: "not-evaluated:not-due" })), "not-due", "the OLD spelling must classify identically");
  assert.equal(classify(fact({ reason: "budget-24h: 120 model call(s) in the trailing 24h >= max_model_calls_per_24h 120" })), "budget-blocked(calls)");
  assert.equal(classify(fact({ reason: "not-evaluated:budget-24h" })), "budget-blocked(calls)", "old spelling");
  assert.equal(classify(fact({ reason: "budget-usd-24h: $35.72 in the trailing 24h >= max_usd_per_24h $30" })), "budget-blocked(usd)");
  assert.equal(classify(fact({ reason: "not-evaluated:budget-usd-24h" })), "budget-blocked(usd)", "old spelling");
  assert.equal(classify(fact({ reason: "not-evaluated:uninstrumented-exit-1: the investigator produced NO parsed hypothesis cluster" })), "call-failure(uninstrumented-exit-1)");
  assert.equal(classify(fact({ reason: "not-evaluated:some-new-class: whatever" })), "call-failure(some-new-class)", "a NEW failure class names ITSELF, not a generic bucket");
  assert.equal(classify(fact({ reason: "disabled: loop.open_semantic_discovery section absent or enabled:false — nothing spawned" })), "disabled");
  assert.equal(classify(fact({ reason: "not-evaluated:disabled — enabled:false (kill switch, zero spawns)" })), "disabled");
  assert.equal(classify(fact({ state: "not-evaluated", value: {}, reason: "whatever" }), rec(), seen), "unclassified(whatever)");
  assert.equal(classify(fact({ reason: "engine modules unresolved — OPEN_DISCOVERY_MODULES_UNRESOLVED: x" })), "engine-failure");
  assert.equal(classify(fact({ reason: "stopped-mid-round: the resident loop's stop signal arrived during the verifier step" })), "stopped-mid-round");
  assert.equal(classify(fact({}), rec({ stopped_mid_round: true })), "stopped-mid-round", "the record-level flag is its own signal");
  assert.equal(classify(fact({}), rec({ skipped_routines: ["open-semantic-discovery"] })), "stopped-mid-round", "a routine skipped by the stop is not `not-due`");

  // Every DECLARED class name is producible (the class vocabulary is not aspirational)…
  for (const c of ROUND_CLASSES) {
    if (c === "call-failure(<class>)") {
      assert.ok(seen["call-failure(uninstrumented-exit-1)"] > 0, "the parametrised class must be produced under its parameter");
      continue;
    }
    assert.ok(seen[c] > 0, `declared class never produced by any shape: ${c}`);
  }
  // …and the two budget classes are TWO keys: a calls refusal never lands in the usd bucket.
  assert.equal(seen["budget-blocked(calls)"], 2);
  assert.equal(seen["budget-blocked(usd)"], 2);
});

test("an unrecognised Fact keeps its own reason in the class name rather than joining a named bucket", () => {
  const c = classifyRoundFact(fact({ state: "failed", reason: "some brand-new refusal nobody has seen" }), rec(), "r");
  assert.ok(c.cls.startsWith(UNCLASSIFIED_PREFIX), `expected an unclassified(…) class, got ${c.cls}`);
  assert.match(c.cls, /some brand-new refusal/);
  assert.equal(c.reason, "some brand-new refusal nobody has seen", "the verbatim reason is the citation");
  assert.ok(!(ROUND_CLASSES).includes(c.cls), "an unclassified shape must not wear a declared class name");
});

test("classifyRounds counts every Fact separately and windows on the round carrier's own ts", () => {
  const records = [
    { rec: { ts: "2026-10-12T00:00:00Z", facts: [{ name: "x", state: "verified", value: { kind: "scan-round", clusters: { total: 2 } }, reason: "ran" }] }, line: 1 },
    { rec: { ts: "2026-10-14T00:00:00Z", facts: [{ name: "x", state: "not-evaluated", value: {}, reason: "not due: ran 1m ago" }] }, line: 2 },
    { rec: { ts: "2026-10-15T00:00:00Z", facts: [{ name: "other", state: "verified", value: {}, reason: "not mine" }] }, line: 3 },
  ];
  const carrier = { rel: "r", file: "r", present: true, lines: 3, records, malformed_lines: 0, reason: null };
  const all = classifyRounds(carrier, "x", null);
  assert.deepEqual(all.classes, { "ran-with-clusters": 1, "not-due": 1 });
  assert.equal(all.records_examined, 2, "only rounds carrying a Fact for THIS routine are examined");
  const windowed = classifyRounds(carrier, "x", "2026-10-13T00:00:00Z");
  assert.deepEqual(windowed.classes, { "not-due": 1 }, "--since is exclusive of earlier rounds");
});

test("a partially-unreadable round carrier reports NOT-EVALUATED instead of counts over a truncated population", () => {
  const carrier = { rel: "r", file: "r", present: true, lines: 2, records: [], malformed_lines: 1, reason: null };
  const out = classifyRounds(carrier, "x", null);
  assert.match(String(out.not_evaluated), /^not-evaluated:round-carrier-partial:/);
  assert.deepEqual(out.classes, {}, "no counts are printed from a truncated read");
});

// ── ③ READERS: absence is its own value ───────────────────────────────────────────────────────────

test("readCarrier distinguishes 'absent' from 'unreadable' from 'present but empty'", () => {
  const root = tmpdir("carriers");
  const absent = readCarrier(root, ".quay/nope.jsonl");
  assert.equal(absent.present, false);
  assert.equal(absent.reason, null, "an ABSENT carrier is a reportable fact, not a read error");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay/empty.jsonl"), "");
  const empty = readCarrier(root, ".quay/empty.jsonl");
  assert.equal(empty.present, true);
  assert.equal(empty.records.length, 0);
  fs.writeFileSync(path.join(root, ".quay/bad.jsonl"), '{"a":1}\nnot json\n{"b":2}\n');
  const partial = readCarrier(root, ".quay/bad.jsonl");
  assert.equal(partial.records.length, 2);
  assert.equal(partial.malformed_lines, 1, "the unparseable line is COUNTED, never silently dropped");
  assert.equal(partial.records[1].line, 3, "line numbers are the 1-based citation the chain carries");
  fs.rmSync(root, { recursive: true, force: true });
});

test("sharedCheckoutOf refuses (rather than guessing) a root that is not a git repo", () => {
  const root = tmpdir("nogit");
  const r = sharedCheckoutOf(root);
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /git-rev-parse-exited/);
  assert.equal(r.root, null, "an unresolvable shared checkout is null, never the caller's cwd");
  fs.rmSync(root, { recursive: true, force: true });
});

test("isOnBranch answers `null` when the question could not be ASKED, and only 1 means `no`", () => {
  const taskId = "gap-fixture-fix-landed";
  const { root, sha } = repoWithLandedFix(taskId);
  assert.equal(isOnBranch(root, sha, "develop"), true);
  assert.equal(isOnBranch(root, sha, "no-such-branch"), null, "git exit 128 is `could not ask`, NOT `not an ancestor`");
  assert.equal(isOnBranch(root, "0".repeat(40), "develop"), null, "an unknown sha could not be asked about");
  fs.rmSync(root, { recursive: true, force: true });
});

test("originClassOf makes `unknown` its own value and never folds it into the autonomous count", () => {
  const origins = ["autonomous-routine", "autonomous-experiment", "operator", "user", "mechanical-instrument"];
  const autonomous = ["autonomous-routine", "autonomous-experiment"];
  assert.equal(originClassOf("autonomous-routine", origins, autonomous), "autonomous");
  assert.equal(originClassOf("operator", origins, autonomous), "known-non-autonomous");
  assert.equal(originClassOf(null, origins, autonomous), "unknown");
  assert.equal(originClassOf(undefined, origins, autonomous), "unknown");
  assert.equal(originClassOf("", origins, autonomous), "unknown");
  assert.equal(originClassOf("something-else-entirely", origins, autonomous), "unknown", "out-of-vocabulary is NOT silently a known origin");
});

test("parseHostSpec fails closed on a malformed --host instead of inventing a name or a root", () => {
  assert.deepEqual(parseHostSpec("quay=/x"), { name: "quay", root: "/x" });
  assert.deepEqual(parseHostSpec("a=b=c"), { name: "a", root: "b=c" }, "only the FIRST `=` splits — a path may contain `=`");
  assert.ok("error" in parseHostSpec("no-equals"));
  assert.ok("error" in parseHostSpec("=root"));
  assert.ok("error" in parseHostSpec("name="));
});

// ── ④ AC4: the origin enumeration, end to end through the CLI ─────────────────────────────────────

test("AC4: unknown origin is its own count and the autonomous share excludes it from the denominator", () => {
  const root = tmpdir("origins");
  git(root, ["init", "-q", "-b", "develop"]);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const mk = (id, origin) => ({
    kind: "portfolio_finding",
    id: `portfolio_finding-${id}`,
    finding_id: id,
    origin,
    components: [`${id}.ts`],
    outcome: "supported",
    fix_task: null,
    fix_landed_commit: null,
    fix_landed_reason: "NO_FIX_TASK",
    recurred: false,
    recurred_reason: "NO_LATER_OUTCOME_ON_SAME_COMPONENTS",
    duplicate_of: null,
    ts: "2026-09-30T00:00:00.000Z",
  });
  writeJsonl(root, ".quay/discovery-portfolio.jsonl", [
    mk("A", "autonomous-routine"),
    mk("B", "autonomous-experiment"),
    mk("C", "operator"),
    mk("D", null), // no recorded origin
    mk("E", "not-in-the-vocabulary"), // a value the vocabulary does not contain
  ]);
  const host = runReport(root).hosts[0];
  const o = host.origins;
  assert.equal(o.counts["autonomous-routine"], 1);
  assert.equal(o.counts["autonomous-experiment"], 1);
  assert.equal(o.counts.operator, 1);
  assert.equal(o.unknown, 2, "both the absent origin AND the out-of-vocabulary value are `unknown`");
  assert.equal(o.known_total, 3, "the denominator is findings with a KNOWN origin");
  assert.equal(o.autonomous, 2);
  assert.equal(o.autonomous_share, Number((2 / 3).toFixed(6)), "autonomous / known — not autonomous / all");
  assert.notEqual(o.autonomous_share, Number((2 / 5).toFixed(6)), "unknown must not be in the denominator");
  // …and the same enumeration over the RAW line population is reported beside it, not instead of it.
  assert.equal(o.over_carrier_lines.unknown, 2);
  assert.equal(o.over_carrier_lines.known_total, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── ⑤ AC1/AC2 shape: an absent Portfolio is `0 findings` with a reason, never an error or success ──

test("AC2 shape: a host with no Portfolio reads 0 findings with an explicit reason — not an error, not success", () => {
  const root = tmpdir("noportfolio");
  git(root, ["init", "-q", "-b", "develop"]);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  writeJsonl(root, ".quay/quality-round.jsonl", [
    {
      ts: "2026-10-13T01:00:00Z",
      round: 1,
      run_id: "g",
      facts: [{ name: "open-semantic-discovery", state: "not-evaluated", value: { enabled: true }, reason: "budget-usd-24h: $31 in the trailing 24h >= max_usd_per_24h $30 — nothing spawned" }],
    },
  ]);
  const host = runReport(root).hosts[0];
  assert.equal(host.portfolio.findings_only.count, 0);
  assert.equal(host.findings.length, 0, "an absent carrier yields an EMPTY chain list");
  assert.equal(host.portfolio.read_reason, notEvaluated(".quay/discovery-portfolio.jsonl").replace("not-evaluated:.quay", "not-evaluated:portfolio-carrier-absent:.quay"));
  assert.equal(host.origins.autonomous_share, null, "a share over 0 known origins is NOT-EVALUATED, never 0 or 1");
  // The round table is what explains WHY there are no findings here.
  assert.equal(host.rounds.classes["budget-blocked(usd)"], 1);
  assert.ok(host.rounds.records_examined > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the chain reports the furthest link REACHED, so an unfinished chain is not a blank", () => {
  const taskId = "gap-fixture-fix-landed";
  const { root } = repoWithLandedFix(taskId);
  writeJsonl(root, ".quay/discovery-portfolio.jsonl", [
    {
      kind: "portfolio_finding",
      id: "portfolio_finding-fixture0003",
      finding_id: "F-partial",
      origin: "operator",
      origin_carrier: ".quay/open-semantic-discovery-findings.jsonl",
      origin_ref: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      components: ["a.ts"],
      outcome: "supported",
      fix_task: taskId,
      fix_landed_commit: null,
      fix_landed_reason: null,
      recurred: false,
      recurred_reason: "NO_LATER_OUTCOME_ON_SAME_COMPONENTS",
      duplicate_of: null,
      ts: "2026-09-30T00:00:00.000Z",
    },
    {
      kind: "portfolio_finding",
      id: "portfolio_finding-fixture0004",
      finding_id: "F-noverdict",
      origin: "operator",
      origin_carrier: ".quay/open-semantic-discovery-findings.jsonl",
      origin_ref: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      components: ["a.ts"],
      outcome: "supported",
      fix_task: null,
      fix_landed_commit: null,
      fix_landed_reason: "NO_FIX_TASK",
      recurred: false,
      recurred_reason: "NO_LATER_OUTCOME_ON_SAME_COMPONENTS",
      duplicate_of: null,
      ts: "2026-09-30T00:00:00.000Z",
    },
  ]);
  writeJsonl(root, ".quay/open-semantic-discovery-findings.jsonl", [
    {
      kind: "cluster",
      ts: "2026-09-30T00:00:00.000Z",
      record_id: "open-semantic-discovery@2026-09-30T00:00:00.000Z#1",
      concept_kind: "duplication",
      components: ["a.ts"],
      verifier_verdict: "supported",
      refutation_verdict: "supported",
      confirmed: true,
    },
  ]);
  const host = runReport(root).hosts[0];
  const partial = findingBy(host, "F-partial");
  // verifier/refuter resolved from the OSD carrier BY ID, and the merge re-derived from git because the
  // row carried a task but no commit — so this chain reaches `merge`.
  assert.equal(partial.verifier, "supported");
  assert.equal(partial.refuter, "supported");
  assert.equal(partial.verifier_source.line, 1, "the verdict cites the carrier line it was read from");
  assert.equal(partial.merge_commit.on_branch, true);
  assert.equal(partial.chain.furthest_link, "effect", "merge resolved from git ⇒ the chain goes on to the effect");
  const noTask = findingBy(host, "F-noverdict");
  assert.equal(noTask.chain.furthest_link, "refuter", "with no task the chain stops after the refuter");
  assert.deepEqual(noTask.chain.missing, ["task", "merge", "effect"]);
  assert.equal(noTask.task_id, notEvaluated("no-fix-task-on-the-row"));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── ⑥ read-only / deterministic contract ──────────────────────────────────────────────────────────

test("the report writes NOTHING: carrier bytes are identical before and after", () => {
  const { root } = fixtureFinding({ laterTs: "2026-10-02T00:00:00.000Z" });
  const snap = () => {
    const out = {};
    for (const rel of [".quay/discovery-portfolio.jsonl", ".quay/open-semantic-discovery-findings.jsonl"]) {
      out[rel] = fs.readFileSync(path.join(root, rel), "utf8");
    }
    return out;
  };
  const before = snap();
  const one = runReport(root);
  const after = snap();
  assert.deepEqual(after, before, "no carrier may be written by the report");
  // Determinism: same carriers ⇒ byte-identical output (no wall-clock `now` enters it).
  const two = runReport(root);
  assert.equal(JSON.stringify(one), JSON.stringify(two), "two runs over unchanged carriers must agree byte for byte");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a usage error exits 2 rather than printing an empty report", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--host=broken"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--host expects <name>=<root>/);
  assert.equal(r.stdout, "", "no report is printed when the inputs were rejected");
});

test("LINK_ORDER is the AC3 chain, in the order the task states it", () => {
  assert.deepEqual([...LINK_ORDER], ["carrier", "verifier", "refuter", "task", "merge", "effect"]);
});
