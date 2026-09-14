// crystallization-half-life.test.mjs — tests for plugin/scripts/crystallization-half-life.ts
//
// @test-group main
//
// The instrument's PREDICATES are exercised on fixtures (each fixture pins ONE reading, including
// the negative controls that make the reading falsifiable); the instrument's CLAIM is exercised
// against the REAL repo (real `adr/` dir + real git history) — per the task's DoD, a fixture is
// never the evidence for the measurement itself.
//
// The fixture half is where the 硬规则 3b controls live: "carrier unreadable" must produce its OWN
// value and must NOT produce the "zero events" verdict, and "cannot judge" must NOT be counted as
// "no artifact". Each of those has a paired test that asserts the two readings differ.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "crystallization-half-life.ts");

/** Every fixture made here is registered and removed by one `after` hook — an assertion that throws
 * mid-test must not leave a `/tmp` tree behind (learning: a leak whose only symptom is a growing
 * `/tmp` is discovered by a DIFFERENT task's check). */
const CREATED = [];
after(() => {
  for (const d of CREATED) fs.rmSync(d, { recursive: true, force: true });
});

/** The real repo's report, computed once for the whole file (two spawns over a real history is the
 * expensive part; the readings are the same object for every assertion). */
let realReport = null;
function realRepoReport() {
  if (realReport === null) realReport = runJson(["--root", REPO_ROOT]);
  return realReport;
}

/** The class label AC5 pins as the positive control. Spelled out here so the test fails loudly if
 * the script's vocabulary drifts. */
const LABEL_PER_MILESTONE = "enforcement 已接线但 per-milestone 判据无产物";
const LABEL_EVENTS_NOT_EVALUATED = "enforcement 已接线但 GateEvent 载体读不到（未评估，不等于零事件）";
const LABEL_DANGLING = "声明的产物是断链符号链接（在盘上但解析不到目标）";
const LABEL_REMOVED = "声明的产物曾落地但现已不在盘上";

function run(args, opts = {}) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", SCRIPT, ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts },
  );
  return r;
}

function runJson(args) {
  const r = run([...args, "--json"]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function git(dir, args, env = {}) {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

let seq = 0;
/** Build a throwaway workspace: real files, a real git repo, real commits with PINNED dates (so
 * the interval arithmetic is exact rather than clock-dependent). */
function makeFixture({ adrs, claudeMd = null, config = null, gateEvents = null, files = {}, commits = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xh-life-${process.pid}-${seq++}-`));
  CREATED.push(dir);
  fs.mkdirSync(path.join(dir, "adr"), { recursive: true });
  for (const [name, body] of Object.entries(adrs)) {
    fs.writeFileSync(path.join(dir, "adr", name), body);
  }
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, "CLAUDE.md"), claudeMd);
  if (config !== null) {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".quay", "config.yml"), config);
  }
  if (gateEvents !== null) {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".quay", "gate-events.jsonl"), gateEvents);
  }
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  // Commit 1: everything that exists at the start (ADR files, CLAUDE.md, config, fixtures).
  git(dir, ["add", "-A"]);
  const d1 = commits[0] ?? "2026-01-01T00:00:00+00:00";
  git(dir, ["commit", "-q", "-m", "base"], { GIT_AUTHOR_DATE: d1, GIT_COMMITTER_DATE: d1 });
  // Later commits: added/modified paths, each with its own pinned date.
  for (const c of commits.slice(1)) {
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", c.msg ?? "c"], {
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_DATE: c.date,
    });
  }
  return dir;
}

function adr(id, { date = "2026-01-01", status = "accepted", enforcement = null, body = "" } = {}) {
  const lines = [`---`, `id: ${id}`, `status: ${status}`, `date: ${date}`];
  if (enforcement !== null) lines.push(`enforcement: ${JSON.stringify(enforcement)}`);
  lines.push(`---`, body);
  return lines.join("\n") + "\n";
}

function recordFor(report, id) {
  const rec = report.adr.records.find((r) => r.id === id);
  assert.ok(rec, `no record for ${id}: ${report.adr.records.map((r) => r.id).join(",")}`);
  return rec;
}

// ── AC1: the per-ADR field set + the status vocabulary ────────────────────────────────────────

test("AC1: every record carries {id, 落笔日期, enforcement 字段值, 首次落地 SHA+日期, 间隔天数, 状态}", () => {
  const dir = makeFixture({
    adrs: { "ADR-001-x.md": adr("ADR-001", { enforcement: "bash scripts/real.sh" }) },
    files: { "scripts/real.sh": "#!/bin/sh\nexit 0\n" },
  });
  const rep = runJson(["--root", dir]);
  const rec = recordFor(rep, "ADR-001");
  for (const k of ["id", "authoredDate", "enforcementText", "landedSha", "landedDate", "intervalDays", "status"]) {
    assert.ok(k in rec, `record is missing ${k}`);
  }
  assert.equal(rec.authoredDate, "2026-01-01");
  assert.equal(rec.enforcementText, "bash scripts/real.sh");
  assert.equal(rec.landedDate.slice(0, 10), "2026-01-01");
  assert.equal(rec.intervalDays, 0);
  assert.equal(rec.status, "已强制");
});

test("AC1: 状态 取值集合是封闭的，且 '无法判定' 是独立取值", () => {
  const dir = makeFixture({
    adrs: {
      "ADR-001-x.md": adr("ADR-001", { enforcement: "bash scripts/real.sh" }),
      "ADR-002-x.md": adr("ADR-002"),
      "ADR-003-x.md": adr("ADR-003", { enforcement: "N/A — irreducibly judgmental" }),
    },
    files: { "scripts/real.sh": "#!/bin/sh\nexit 0\n" },
  });
  // An ADR that is NOT under git (untracked) AND carries no date in any of the three sources ⇒
  // its 落笔日期 is unreadable ⇒ 无法判定 (its own value, never folded into 无产物).
  fs.writeFileSync(path.join(dir, "adr", "ADR-004-x.md"), "---\nid: ADR-004\nstatus: accepted\n---\nbody\n");
  const rep = runJson(["--root", dir]);
  const allowed = new Set(["已强制", "部分", "无产物", "N/A", "无法判定"]);
  for (const r of rep.adr.records) assert.ok(allowed.has(r.status), `unexpected status ${r.status}`);
  assert.equal(recordFor(rep, "ADR-003").status, "N/A");
  assert.equal(recordFor(rep, "ADR-002").status, "无产物");
  assert.equal(recordFor(rep, "ADR-004").status, "无法判定");
  // The three readings must not be conflated: 无法判定 is in NEITHER of the other two buckets.
  assert.ok(!rep.adr.noArtifact.list.includes("ADR-004"), "无法判定 must not be counted as 无产物");
  assert.ok(!rep.adr.noArtifact.list.includes("ADR-003"), "N/A must not be counted as 无产物");
  assert.deepEqual(rep.adr.undetermined, ["ADR-004"]);
  assert.deepEqual(rep.adr.nA, ["ADR-003"]);
});

// ── AC2: the whole corpus + N/A handled separately ────────────────────────────────────────────

test("AC2: analyzed count == the actual number of adr/*.md files on disk", () => {
  const dir = makeFixture({
    adrs: {
      "ADR-001-a.md": adr("ADR-001"),
      "ADR-002-b.md": adr("ADR-002"),
      "ADR-003-c.md": adr("ADR-003", { enforcement: "N/A — judgement" }),
    },
  });
  const onDisk = fs.readdirSync(path.join(dir, "adr")).filter((n) => n.endsWith(".md")).length;
  const rep = runJson(["--root", dir]);
  assert.equal(onDisk, 3);
  assert.equal(rep.adr.filesOnDisk, onDisk);
  assert.equal(rep.adr.total, onDisk);
  assert.deepEqual(rep.adr.nA, ["ADR-003"]);
});

// ── AC3: interval statistics + the COMPLETE no-artifact list ─────────────────────────────────

test("AC3: median/p90/max come from pinned commit dates; the no-artifact list is complete", () => {
  const dir = makeFixture({
    adrs: {
      "ADR-001-a.md": adr("ADR-001", { date: "2026-01-01", enforcement: "bash scripts/a.sh" }),
      "ADR-002-b.md": adr("ADR-002", { date: "2026-01-01", enforcement: "bash scripts/b.sh" }),
      "ADR-003-c.md": adr("ADR-003", { date: "2026-01-01", enforcement: "bash scripts/c.sh" }),
      "ADR-004-d.md": adr("ADR-004", { enforcement: "(E3, deferred): applies-to milestone" }),
    },
    files: { "scripts/a.sh": "#!/bin/sh\n", "scripts/b.sh": "#!/bin/sh\n" },
  });
  // a.sh/b.sh land on day 0; c.sh lands 10 days after the rule was written. The scripts/ dir is
  // created AFTER the base commit so c.sh's add commit is the one that carries the landing date.
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "c.sh"), "#!/bin/sh\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "add c"], {
    GIT_AUTHOR_DATE: "2026-01-11T00:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-01-11T00:00:00+00:00",
  });
  const rep = runJson(["--root", dir]);
  assert.equal(rep.adr.interval.n, 3);
  assert.deepEqual(rep.adr.interval.values.map((v) => v.days).sort((a, b) => a - b), [0, 0, 10]);
  assert.equal(rep.adr.interval.max, 10);
  assert.equal(rep.adr.interval.median, 0);
  assert.equal(rep.adr.interval.p90, 10);
  // Complete list, not a sample.
  assert.equal(rep.adr.noArtifact.total, 1);
  assert.deepEqual(rep.adr.noArtifact.list, ["ADR-004"]);
});

// ── AC5 positive control (fixture form): the per-milestone label ──────────────────────────────

test("AC5: declared in gates.adr + zero GateEvents ⇒ the per-milestone-no-artifact class", () => {
  const dir = makeFixture({
    adrs: { "ADR-010-x.md": adr("ADR-010", { enforcement: "bash scripts/g.sh" }) },
    files: { "scripts/g.sh": "#!/bin/sh\n" },
    config: "gates:\n  adr:\n    - \"ADR-010\"\n  fixed: []\n",
    gateEvents: '{"gate":"goal","verdict":"pass"}\n',
  });
  const rep = runJson(["--root", dir]);
  const rec = recordFor(rep, "ADR-010");
  assert.equal(rec.adrGateDeclared, true);
  assert.equal(rec.gateEventReading, "evaluated");
  assert.equal(rec.gateEventCount, 0);
  assert.ok(rec.caveats.includes(LABEL_PER_MILESTONE), `caveats: ${JSON.stringify(rec.caveats)}`);
  assert.equal(rec.status, "部分");
});

test("AC5 negative control: the SAME workspace WITH an adr-010 event is 已强制, not 部分", () => {
  const dir = makeFixture({
    adrs: { "ADR-010-x.md": adr("ADR-010", { enforcement: "bash scripts/g.sh" }) },
    files: { "scripts/g.sh": "#!/bin/sh\n" },
    config: "gates:\n  adr:\n    - \"ADR-010\"\n  fixed: []\n",
    gateEvents: '{"gate":"adr-010","verdict":"pass"}\n{"gate":"goal"}\n',
  });
  const rep = runJson(["--root", dir]);
  const rec = recordFor(rep, "ADR-010");
  assert.equal(rec.gateEventCount, 1);
  assert.deepEqual(rec.caveats, []);
  assert.equal(rec.status, "已强制");
});

test("硬规则 3b control: an UNREADABLE GateEvent carrier is NOT reported as zero events", () => {
  // Identical to the AC5 fixture EXCEPT the carrier is absent. The two readings must differ — an
  // unreadable input may not return a value shaped like a verdict (硬规则 3b).
  const dir = makeFixture({
    adrs: { "ADR-010-x.md": adr("ADR-010", { enforcement: "bash scripts/g.sh" }) },
    files: { "scripts/g.sh": "#!/bin/sh\n" },
    config: "gates:\n  adr:\n    - \"ADR-010\"\n  fixed: []\n",
    gateEvents: null,
  });
  const rep = runJson(["--root", dir]);
  const rec = recordFor(rep, "ADR-010");
  assert.equal(rec.adrGateDeclared, true);
  assert.equal(rec.gateEventReading, "not-evaluated");
  assert.equal(rec.gateEventCount, null);
  assert.ok(rec.caveats.includes(LABEL_EVENTS_NOT_EVALUATED), `caveats: ${JSON.stringify(rec.caveats)}`);
  assert.ok(!rec.caveats.includes(LABEL_PER_MILESTONE), "an unreadable carrier must not read as zero events");
});

// ── partial-enforcement readings: dangling / removed artifacts ────────────────────────────────

test("部分: a declaration naming a DANGLING symlink is not 已强制", () => {
  const dir = makeFixture({
    adrs: { "ADR-020-x.md": adr("ADR-020", { enforcement: "bash scripts/real.sh; see scripts/probe.ts" }) },
    files: { "scripts/real.sh": "#!/bin/sh\n" },
  });
  fs.symlinkSync("../../nowhere/missing.ts", path.join(dir, "scripts", "probe.ts"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "dangling probe"], {
    GIT_AUTHOR_DATE: "2026-01-02T00:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-01-02T00:00:00+00:00",
  });
  const rep = runJson(["--root", dir]);
  const rec = recordFor(rep, "ADR-020");
  const probe = rec.artifacts.find((a) => a.raw === "scripts/probe.ts");
  assert.ok(probe, "the dangling path must be extracted as an artifact");
  assert.equal(probe.present, false);
  assert.equal(probe.dangling, true);
  assert.ok(rec.caveats.includes(LABEL_DANGLING), `caveats: ${JSON.stringify(rec.caveats)}`);
  assert.equal(rec.status, "部分");
});

test("部分/无产物: a named path that landed and was then REMOVED keeps its landing moment", () => {
  const dir = makeFixture({
    adrs: { "ADR-030-x.md": adr("ADR-030", { date: "2026-01-01", enforcement: "node scripts/gone.mjs ." }) },
    files: { "scripts/gone.mjs": "// checker\n" },
  });
  // The named path genuinely landed (its add commit is the enforcement moment)…
  const recBefore = recordFor(runJson(["--root", dir]), "ADR-030");
  assert.equal(recBefore.status, "已强制");
  assert.equal(recBefore.landedDate.slice(0, 10), "2026-01-01");
  // …then it was deleted. Now the honest reading is "no artifact", and the landing is still known.
  fs.rmSync(path.join(dir, "scripts", "gone.mjs"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "remove"], {
    GIT_AUTHOR_DATE: "2026-01-05T00:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-01-05T00:00:00+00:00",
  });
  const after = runJson(["--root", dir]);
  const rec = recordFor(after, "ADR-030");
  const art = rec.artifacts.find((a) => a.raw === "scripts/gone.mjs");
  assert.equal(art.resolution, "exact-removed");
  assert.equal(art.present, false);
  assert.equal(rec.status, "无产物");
  assert.equal(rec.landedDate.slice(0, 10), "2026-01-01", "the landing moment must survive removal");
  assert.deepEqual(after.adr.landedThenDecayed, ["ADR-030"]);
});

// ── AC4: the CLAUDE.md hard-rule side ────────────────────────────────────────────────────────

test("AC4: hard rules are parsed per entry, self-labels counted, and the cross-check is listed", () => {
  const claudeMd = [
    "# t",
    "",
    "## 认识论硬规则（不随代码过期）",
    "",
    "1. **有产物的一条**——说明。〔产物：复用 `scripts/checker-one.ts` 的判定手法〕",
    "2. **靠自觉的一条**——说明。〔**无产物，靠自觉**〕",
    "3. **点名了不存在的产物**——说明。〔产物：`scripts/never-existed.ts` 是判据〕",
    "4. **没有任何标注的一条**——说明。",
    "5. **产物存在但无人执行**——说明。〔产物：`scripts/orphan.ts` 已在跑〕",
    "",
    "## 下一节",
    "9. **不在硬规则节里**——不应被计入。",
    "",
  ].join("\n");
  const dir = makeFixture({
    adrs: { "ADR-001-a.md": adr("ADR-001") },
    claudeMd,
    files: {
      "scripts/test.sh": "#!/bin/sh\nrun_checker scripts/checker-one.ts\n",
      "scripts/checker-one.ts": "// c1\n",
      "scripts/orphan.ts": "// never referenced by the runner\n",
    },
  });
  const rep = runJson(["--root", dir]);
  const rules = rep.claudeMd.rules;
  assert.deepEqual(rules.map((r) => r.key), ["1", "2", "3", "4", "5"]);
  assert.equal(rules[0].selfLabel, "有产物");
  assert.equal(rules[0].scriptVerdict, "有产物且点名产物全部落地并已接线");
  assert.equal(rules[0].consistent, true);
  assert.equal(rules[1].selfLabel, "无产物（靠自觉）");
  assert.equal(rules[1].scriptVerdict, "无产物（无对象可核）");
  assert.equal(rules[3].selfLabel, "未标注");
  assert.equal(rules[3].scriptVerdict, "未标注（无法核对）");
  // 未标注 is its OWN bucket, never an "inconsistency" (硬规则 3b).
  assert.deepEqual(rep.claudeMd.notCrossCheckable, ["4"]);
  // The two REAL inconsistencies are listed, one per rule, with a reason.
  assert.deepEqual(
    rep.claudeMd.inconsistencies.map((i) => i.key).sort(),
    ["3", "5"],
  );
  assert.match(rep.claudeMd.inconsistencies.find((i) => i.key === "3").reason, /解析不到/);
  assert.match(rep.claudeMd.inconsistencies.find((i) => i.key === "5").reason, /执行/);
  assert.equal(rep.claudeMd.selfLabelled.total, 1);
  assert.deepEqual(rep.claudeMd.selfLabelled.keys, ["2"]);
});

// ── exit codes / usage ───────────────────────────────────────────────────────────────────────

test("exit codes: usage error ⇒ 2; --help ⇒ 0; missing adr dir ⇒ 3 (NOT-EVALUATED)", () => {
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["--bogus-flag"]).status, 2);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "xh-life-empty-"));
  CREATED.push(empty);
  assert.equal(run(["--root", empty]).status, 3, "no adr/ ⇒ NOT-EVALUATED, never 'zero ADRs'");
  fs.rmSync(empty, { recursive: true, force: true });
});

// ── the REAL repo: the measurement itself (never a fixture) ──────────────────────────────────

test("real repo: corpus size, ADR-007 positive control, and self-consistent aggregates", () => {
  const onDisk = fs.readdirSync(path.join(REPO_ROOT, "adr")).filter((n) => n.endsWith(".md")).length;
  const rep = realRepoReport();
  assert.equal(rep.adr.filesOnDisk, onDisk);
  assert.equal(rep.adr.total, onDisk, "every ADR on disk must produce exactly one record");
  // Status counts partition the corpus.
  const summed = Object.values(rep.adr.statusCounts).reduce((a, b) => a + b, 0);
  assert.equal(summed, onDisk);
  assert.equal(rep.adr.noArtifact.total, rep.adr.noArtifact.list.length);
  assert.equal(rep.adr.noArtifact.total, rep.adr.statusCounts["无产物"] ?? 0);
  // Real git history produced real landings (a fixture-free reading would be a constant here).
  assert.ok(rep.adr.interval.n > 0, "no ADR landed ⇒ the git history source is not being read");
  assert.ok(rep.adr.interval.values.every((v) => Number.isInteger(v.days)));
  // The ADR-007 positive control (AC5): the predicate must place it in the "wired, but a declared
  // face has no landed artifact / has rotted / never ran" class — NOT in 已强制. This is a reading
  // about the CURRENT repo state: if the git-lens probes are repaired and the per-milestone gate is
  // wired into the landing path, this assertion (and docs/analysis/crystallization-half-life.md)
  // must be revisited rather than silently relaxed.
  const adr007 = recordFor(rep, "ADR-007");
  assert.equal(adr007.status, "部分", `ADR-007 was read as ${adr007.status}; caveats=${JSON.stringify(adr007.caveats)}`);
  assert.equal(adr007.adrGateDeclared, true);
  assert.ok(adr007.caveats.length > 0);
});

test("real repo: the CLAUDE.md hard-rule side reads the real file and is internally consistent", () => {
  const rep = realRepoReport();
  assert.ok(rep.claudeMd.rules.length >= 12, `only ${rep.claudeMd.rules.length} hard rules parsed`);
  const keys = rep.claudeMd.rules.map((r) => r.key);
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]) {
    assert.ok(keys.includes(k), `hard rule ${k} was not parsed`);
  }
  assert.ok(rep.claudeMd.selfLabelled.total > 0, "CLAUDE.md self-labels rules 〔无产物，靠自觉〕");
  // The count of self-labelled rules equals the size of the list it is reported with.
  assert.equal(rep.claudeMd.selfLabelled.total, rep.claudeMd.selfLabelled.keys.length);
  assert.equal(rep.claudeMd.notCrossCheckable.length, rep.claudeMd.unlabelled.length);
  // Whatever the cross-check finds, each entry carries a reason (never a bare count).
  for (const i of rep.claudeMd.inconsistencies) assert.ok(i.reason.length > 0);
});
