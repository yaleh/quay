// @test-group engine
// suite-execution-form-counter.test.mjs — tasks/gap-a19-evidence-field-does-not-match-measured-object.
// A19 取证字段与被测对象不对应：旧计数器读 verification-round.jsonl 的 `runner` 字段（full-suite-runner
// 硬编码 outer，140/140 零反例）数「连续 runner=outer 轮数」⇒ signal 结构上永不归零（硬规则 4：不可能取假的量
// 不是测量）。重写（manager 2026-08-13）：执行形态 = launch Bash tool_use 落在哪类 transcript 文件
// （主会话/agent/workflow 三类互斥），invariant 换能取假者「近 N 轮已分类形态出现 ≥2 类」。
//
// Coverage map (task ACs):
//   AC1 — 执行形态取证 = launch tool_use 的 transcript 文件类别（[startedAt ± ε] 窗匹配含
//         full-suite-runner.ts 的 Bash tool_use），不再以 runner 字段为信号。
//   AC2 — invariant 能取假：「近 N 轮已分类形态出现 ≥2 类」（替换恒真 runner_field_tracked=1）。
//   AC3 — 负控制回放：OOM 后 5 轮（全 main-session）⇒ 报 main-session；suite-fix workflow 发起轮
//         ⇒ 报 workflow（不报 main-session）。fixture 忠实重建既有记录形状（r265-270 的结构化记录
//         已不在现 verification-round.jsonl，仅 manager-inbox 散文引用）。
//   AC4 — full-suite-runner.ts runner 字段标注「非执行面取证」（在 runner 文件内完成，本测试断言
//         计数器不再以 runner 为信号——runner 恒 outer 时信号仍由执行形态驱动）。
//   AC5 — 本测试全绿（scoped 门在 scripts/test.sh）。
//   缺值=未查 — 无匹配 launch 的轮次报 unclassified，不当作任何一类。
//   枚举不布尔 — 输出 forms_by_round（三类+unclassified 各计数）+ execution_forms 逐轮，不是单布尔。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isSuiteRound,
  parseIsoMs,
  classifyTranscriptFile,
  isLaunchCommand,
  extractLaunchesFromFile,
  collectLaunches,
  findLaunchForm,
  classifyRounds,
  countConsecutiveOuterRounds,
  judgeInvariant,
  deriveProjectDir,
  DEFAULT_EPSILON_MS,
  DEFAULT_RECENT_N,
  FORM_MAIN_SESSION,
  FORM_SUBAGENT,
  FORM_WORKFLOW,
  FORM_UNCLASSIFIED,
} from "../scripts/suite-execution-form-counter.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CLI = join(repoRoot, "plugin", "scripts", "suite-execution-form-counter.ts");

function run(args, opts = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `suite-form-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── fixture builders ───────────────────────────────────────────────────────────────────────────────

// 一条套件轮次记录（round 记录只需 startedAt 作时间锚）。
function suiteRound(round, startedAt, runner = "outer") {
  return { round, runner, startedAt, state: "green", scope: "worktree" };
}

// 一条 closure-pass 记录（非套件轮次：无 startedAt）——必须被跳过。
function closurePass(round) {
  return { round, at: `2026-08-11T03:2${round % 10}:00.000Z`, suiteGreen: true, closed: ["DIR-001"] };
}

// 一条 assistant 记录的 Bash launch tool_use（name=Bash, input.command 真 launch full-suite-runner.ts）。
function launchRecord(timestamp, cmd) {
  return {
    type: "assistant",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }],
    },
  };
}

// 真 launch 命令（node 执行 runner）。
function launchCmd(root = "/home/yale/work/quay") {
  return `cd ${root}; QUAY_TEST_SUITE_MAX_RUNTIME_MS=7200000 setsid node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root ${root} --lane-count 8`;
}

// 非 launch 命令（grep/sed/node -e 等检查）——必须被拒。
const NON_LAUNCH_CMDS = [
  `cd /home/yale/work/quay; grep -n "timeout" plugin/scripts/full-suite-runner.ts | head -40`,
  `cd /home/yale/work/quay; sed -n '300,345p' plugin/scripts/full-suite-runner.ts`,
  `cd /home/yale/work/quay; node -e "import { buildSystemdRunArgv } from './plugin/scripts/full-suite-runner.ts'; console.log(buildSystemdRunArgv)"`,
  `cd /home/yale/work/quay; git add plugin/scripts/full-suite-runner.ts && git commit -m "wip"`,
  `cd /home/yale/work/quay; echo "=== runner state ==="; node -e 'const s=require("./.quay/full-suite-state.json"); console.log(s.state)'`,
  `cd /home/yale/work/quay; pgrep -caf 'full-suite-runner.ts' 2>/dev/null`,
  // && 吞前一个 echo 的场景（gap-runner-spawn-single-flight 的 DoD 证据测试）：node 前是 echo ⇒ 拒
  `cd /tmp; echo "=== run runner (expect exit 1) ===" && node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root /tmp/x --state-dir /tmp/x/.quay 2>&1`,
];

// 写一个 transcript 文件（多个 launch 记录）。
function writeTranscript(dir, relPath, records) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

// 构造一个三类齐备的 fixture 项目 transcript 根。
function makeProjectDir() {
  const dir = tmp("proj");
  const sess = "abc-session-1";
  // 主会话 <proj>/<session>.jsonl
  writeTranscript(dir, `${sess}.jsonl`, [
    launchRecord("2026-08-10T01:00:00.000Z", launchCmd()), // 距 r1 的 startedAt 1s
  ]);
  // subagent <proj>/<session>/subagents/agent-xxx.jsonl
  writeTranscript(dir, `${sess}/subagents/agent-aaa.jsonl`, [
    launchRecord("2026-08-10T02:00:01.000Z", `nohup ${launchCmd()}`),
  ]);
  // workflow <proj>/<session>/subagents/workflows/wf_1/agent-bbb.jsonl
  writeTranscript(dir, `${sess}/subagents/workflows/wf_1/agent-bbb.jsonl`, [
    launchRecord("2026-08-10T03:00:00.500Z", launchCmd()),
  ]);
  return dir;
}

// ── pure function unit tests ───────────────────────────────────────────────────────────────────────

test("isSuiteRound — suite rounds (runner or startedAt) vs closure-pass records", () => {
  assert.equal(isSuiteRound(suiteRound(1, "2026-08-10T01:00:00.000Z")), true);
  assert.equal(isSuiteRound({ round: 2, startedAt: "2026-08-10T02:00:00Z" }), true);
  assert.equal(isSuiteRound(closurePass(7)), false); // closure-pass：无 startedAt
  assert.equal(isSuiteRound(null), false);
});

test("parseIsoMs — ISO string to ms; missing/bad → null", () => {
  assert.equal(parseIsoMs("2026-08-10T01:00:00.000Z"), Date.parse("2026-08-10T01:00:00.000Z"));
  assert.equal(parseIsoMs("not-a-date"), null);
  assert.equal(parseIsoMs(null), null);
  assert.equal(parseIsoMs(undefined), null);
});

test("classifyTranscriptFile — three mutually-exclusive classes by path position (AC1)", () => {
  const proj = "/proj/-home-yale-work-quay";
  assert.equal(classifyTranscriptFile(`${proj}/abc.jsonl`, proj), FORM_MAIN_SESSION);
  assert.equal(classifyTranscriptFile(`${proj}/abc/subagents/agent-x.jsonl`, proj), FORM_SUBAGENT);
  assert.equal(classifyTranscriptFile(`${proj}/abc/subagents/workflows/wf_1/agent-y.jsonl`, proj), FORM_WORKFLOW);
  // 非三类（meta 文件、无关 jsonl、越界路径）→ null
  assert.equal(classifyTranscriptFile(`${proj}/abc/subagents/agent-x.meta.json`, proj), null);
  assert.equal(classifyTranscriptFile(`${proj}/abc/subagents/workflows/wf_1/agent-y.meta.json`, proj), null);
  assert.equal(classifyTranscriptFile(`${proj}/abc/other.jsonl`, proj), null);
  assert.equal(classifyTranscriptFile(`/somewhere/else.jsonl`, proj), null);
});

test("isLaunchCommand — real node launches pass; grep/sed/node -e/echo-&& test invocations reject (按位置不按关键词)", () => {
  assert.equal(isLaunchCommand(launchCmd()), true);
  assert.equal(isLaunchCommand(`nohup ${launchCmd()}`), true);
  assert.equal(isLaunchCommand(`cd /home/yale/work/quay; QUAY_TEST_SYSTEMD_RUN_LIMITS='MemoryMax=4G' setsid node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root /home/yale/work/quay`), true);
  for (const c of NON_LAUNCH_CMDS) {
    assert.equal(isLaunchCommand(c), false, `非 launch 命令被误判：${c}`);
  }
  assert.equal(isLaunchCommand(""), false);
  assert.equal(isLaunchCommand(null), false);
});

test("extractLaunchesFromFile — only real launches with class, timestamp carried", () => {
  const dir = tmp("ext");
  try {
    const proj = dir;
    writeTranscript(dir, "s.jsonl", [
      launchRecord("2026-08-10T01:00:00.000Z", launchCmd()),
      launchRecord("2026-08-10T01:05:00.000Z", NON_LAUNCH_CMDS[0]), // grep —— 不应被抽取
      launchRecord("2026-08-10T01:06:00.000Z", launchCmd()),
    ]);
    const out = extractLaunchesFromFile(join(dir, "s.jsonl"), proj);
    assert.equal(out.length, 2);
    assert.ok(out.every((l) => l.form === FORM_MAIN_SESSION));
    assert.equal(out[0].tsMs, Date.parse("2026-08-10T01:00:00.000Z"));
    assert.equal(out[1].tsMs, Date.parse("2026-08-10T01:06:00.000Z"));
  } finally {
    cleanup(dir);
  }
});

test("collectLaunches — walks three classes, classifies by file, skips non-transcript", () => {
  const proj = makeProjectDir();
  try {
    const launches = collectLaunches(proj);
    assert.equal(launches.length, 3);
    const byForm = {};
    for (const l of launches) byForm[l.form] = (byForm[l.form] ?? 0) + 1;
    assert.deepEqual(byForm, { [FORM_MAIN_SESSION]: 1, [FORM_SUBAGENT]: 1, [FORM_WORKFLOW]: 1 });
  } finally {
    cleanup(proj);
  }
});

test("findLaunchForm — nearest launch within ε wins; outside ε → null", () => {
  const launches = [
    { tsMs: 1000, form: FORM_MAIN_SESSION },
    { tsMs: 5000, form: FORM_SUBAGENT },
    { tsMs: 20000, form: FORM_WORKFLOW },
  ];
  const m = findLaunchForm(launches, 4500, 5000); // 窗 [−500, 9500]：最近 subagent (500)
  assert.deepEqual(m, { form: FORM_SUBAGENT, gapMs: 500, matchedTsMs: 5000 });
  const none = findLaunchForm(launches, 100000, 5000); // 全部超窗
  assert.equal(none, null);
});

test("classifyRounds — per-round form by [startedAt ± ε], unclassified when no match (缺值=未查)", () => {
  const records = [
    suiteRound(1, "2026-08-10T01:00:01.000Z"), // r1: 主会话 launch 在 01:00:00（1s 前）
    suiteRound(2, "2026-08-10T02:00:00.000Z"), // r2: subagent launch 在 02:00:01（1s 后）
    suiteRound(3, "2026-08-10T03:00:00.000Z"), // r3: workflow launch 在 03:00:00.5
    suiteRound(4, "2026-08-10T04:00:00.000Z"), // r4: 无 launch → unclassified
    closurePass(5),                             // 非套件轮 → 跳过
  ];
  const proj = makeProjectDir();
  try {
    const launches = collectLaunches(proj);
    const forms = classifyRounds(records, launches, DEFAULT_EPSILON_MS);
    const byRound = Object.fromEntries(forms.map((f) => [f.round, f.form]));
    assert.deepEqual(byRound, {
      1: FORM_MAIN_SESSION,
      2: FORM_SUBAGENT,
      3: FORM_WORKFLOW,
      4: FORM_UNCLASSIFIED,
    });
  } finally {
    cleanup(proj);
  }
});

test("countConsecutiveOuterRounds — DISPLAY only (runner 字段非执行面取证), trailing outer run", () => {
  const records = [
    suiteRound(1, "2026-08-10T01:00:00Z", "workflow"),
    suiteRound(2, "2026-08-10T02:00:00Z", "outer"),
    suiteRound(3, "2026-08-10T03:00:00Z", "outer"),
  ];
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  assert.equal(consecutive, 2);
  assert.deepEqual(runnerCounts, { workflow: 1, outer: 2 });
});

// ── invariant judgment (AC2: 能取假) ───────────────────────────────────────────────────────────────

test("judgeInvariant — ≥2 classified forms in recent N ⇒ healthy (invariant holds)", () => {
  const forms = [
    { form: FORM_MAIN_SESSION }, { form: FORM_MAIN_SESSION },
    { form: FORM_SUBAGENT }, { form: FORM_WORKFLOW },
  ];
  const v = judgeInvariant(forms, 4);
  assert.equal(v.signal, false);
  assert.equal(v.band, "healthy");
  assert.equal(v.distinct_forms, 3);
  assert.equal(v.classified_in_recent_n, 4);
});

test("judgeInvariant — all same class in recent N ⇒ rollback signal (invariant FALSE, 能取假)", () => {
  // OOM 后 5 轮主会话直跑：5 轮全 main-session ⇒ invariant 不成立
  const forms = Array.from({ length: 5 }, () => ({ form: FORM_MAIN_SESSION }));
  const v = judgeInvariant(forms, 5);
  assert.equal(v.signal, true);
  assert.equal(v.band, "rollback");
  assert.equal(v.distinct_forms, 1);
  assert.equal(v.classified_in_recent_n, 5);
  assert.equal(v.unclassified_in_recent_n, 0);
});

test("judgeInvariant — 2+ rounds same class false; 2 rounds different true (边界)", () => {
  assert.equal(judgeInvariant([{ form: FORM_MAIN_SESSION }, { form: FORM_MAIN_SESSION }], 2).signal, true);
  assert.equal(judgeInvariant([{ form: FORM_MAIN_SESSION }, { form: FORM_WORKFLOW }], 2).signal, false);
  assert.equal(judgeInvariant([{ form: FORM_MAIN_SESSION }], 5).band, "insufficient-evidence");
});

test("judgeInvariant — all unclassified / insufficient evidence ⇒ NO signal (触发自动治理不是回落)", () => {
  const v = judgeInvariant(
    Array.from({ length: 5 }, () => ({ form: FORM_UNCLASSIFIED })),
    5,
  );
  assert.equal(v.signal, false);
  assert.equal(v.band, "insufficient-evidence");
  assert.equal(v.classified_in_recent_n, 0);
  assert.equal(v.unclassified_in_recent_n, 5);
});

test("deriveProjectDir — encodes workspace root to Claude project transcript root", () => {
  // 只在 homedir 存在时断言编码形态（不依赖具体 home 路径）
  const p = deriveProjectDir("/home/yale/work/quay");
  assert.ok(p.endsWith("-home-yale-work-quay"), p);
  assert.ok(p.includes(".claude"), p);
  assert.ok(p.includes("projects"), p);
});

// ── CLI end-to-end with injected fixtures (AC1/AC2/AC3) ───────────────────────────────────────────

function makeCliFixture(builder) {
  const dir = tmp("cli");
  const proj = join(dir, "proj");
  mkdirSync(proj, { recursive: true });
  const vr = join(dir, "verification-round.jsonl");
  const { records, transcripts } = builder();
  writeFileSync(vr, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  for (const [rel, recs] of Object.entries(transcripts)) {
    writeTranscript(proj, rel, recs);
  }
  return { dir, proj, vr };
}

test("CLI — 三类各报对应形态；窗口错开 ⇒ unclassified 不误报 (AC1)", () => {
  const { dir, proj, vr } = makeCliFixture(() => ({
    records: [
      suiteRound(1, "2026-08-10T01:00:01.000Z"), // 主会话 launch 01:00:00 → main-session
      suiteRound(2, "2026-08-10T02:00:00.000Z"), // subagent launch 02:00:01 → subagent
      suiteRound(3, "2026-08-10T03:00:00.000Z"), // workflow launch 03:00:00.5 → workflow
      suiteRound(4, "2026-08-10T04:00:00.000Z"), // 无 launch → unclassified
    ],
    transcripts: {
      "abc-session.jsonl": [launchRecord("2026-08-10T01:00:00.000Z", launchCmd())],
      "abc-session/subagents/agent-x.jsonl": [launchRecord("2026-08-10T02:00:01.000Z", `nohup ${launchCmd()}`)],
      "abc-session/subagents/workflows/wf_1/agent-y.jsonl": [launchRecord("2026-08-10T03:00:00.500Z", launchCmd())],
      // 一个 30 分钟外的 launch —— 窗口错开，不得误报
      "abc-session/subagents/agent-z.jsonl": [launchRecord("2026-08-10T04:30:00.000Z", launchCmd())],
    },
  }));
  try {
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const o = JSON.parse(res.stdout);
    assert.deepEqual(o.forms_by_round, { main_session: 1, subagent: 1, workflow: 1, unclassified: 1 });
    assert.deepEqual(
      Object.fromEntries(o.execution_forms.map((f) => [f.round, f.form])),
      { 1: "main-session", 2: "subagent", 3: "workflow", 4: "unclassified" },
    );
    // invariant: 近 4 轮已分类 3 类（≥2）⇒ healthy
    assert.equal(o.signal, false);
    assert.equal(o.band, "healthy");
    assert.equal(o.distinct_forms_in_recent_n, 3);
  } finally {
    cleanup(dir);
  }
});

test("CLI — OOM 后 5 轮主会话直跑 ⇒ 逐轮报 main-session，invariant 不成立 ⇒ rollback signal (AC3 正侧)", () => {
  const { dir, proj, vr } = makeCliFixture(() => ({
    records: [
      suiteRound(265, "2026-08-11T01:08:00.000Z"),
      suiteRound(266, "2026-08-11T01:20:00.000Z"),
      suiteRound(268, "2026-08-11T01:32:00.000Z"),
      suiteRound(269, "2026-08-11T01:44:00.000Z"),
      suiteRound(270, "2026-08-11T01:56:00.000Z"),
    ],
    transcripts: {
      "main-session.jsonl": [
        launchRecord("2026-08-11T01:07:59.000Z", launchCmd()),
        launchRecord("2026-08-11T01:19:59.000Z", launchCmd()),
        launchRecord("2026-08-11T01:31:59.000Z", launchCmd()),
        launchRecord("2026-08-11T01:43:59.000Z", launchCmd()),
        launchRecord("2026-08-11T01:55:59.000Z", launchCmd()),
      ],
    },
  }));
  try {
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 1, `OOM 5 轮主会话直跑应报回落 signal，stderr: ${res.stderr}`);
    const o = JSON.parse(res.stdout);
    assert.equal(o.signal, true);
    assert.equal(o.band, "rollback");
    assert.equal(o.distinct_forms_in_recent_n, 1);
    assert.ok(o.execution_forms.every((f) => f.form === "main-session"), "OOM 5 轮逐轮报 main-session");
    assert.equal(o.execution_forms.length, 5);
  } finally {
    cleanup(dir);
  }
});

test("CLI — suite-fix workflow 发起轮 ⇒ 报 workflow，不报 main-session (AC3 负侧)", () => {
  const { dir, proj, vr } = makeCliFixture(() => ({
    records: [suiteRound(41, "2026-08-12T16:00:34.941Z")],
    transcripts: {
      "outer-session/subagents/workflows/wf_4ce5e599/agent-a7e8d414.jsonl": [
        launchRecord("2026-08-12T16:00:33.950Z", launchCmd()),
      ],
    },
  }));
  try {
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.execution_forms[0].form, "workflow");
    assert.notEqual(o.execution_forms[0].form, "main-session");
    assert.equal(o.forms_by_round.workflow, 1);
    assert.equal(o.forms_by_round.main_session, 0);
  } finally {
    cleanup(dir);
  }
});

test("CLI — 全部 unclassified（触发自动治理）⇒ insufficient-evidence，不报 signal (不恒报)", () => {
  const { dir, proj, vr } = makeCliFixture(() => ({
    records: [
      suiteRound(1, "2026-08-10T01:00:00.000Z"),
      suiteRound(2, "2026-08-10T01:12:00.000Z"),
      suiteRound(3, "2026-08-10T01:24:00.000Z"),
    ],
    transcripts: {}, // 无任何 launch
  }));
  try {
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.signal, false);
    assert.equal(o.band, "insufficient-evidence");
    assert.equal(o.unclassified_in_recent_n, 3);
  } finally {
    cleanup(dir);
  }
});

test("CLI — runner 恒 outer 不驱动 signal：同轮次 runner 全 outer，但执行形态 2 类 ⇒ healthy (AC4 断言非执行面取证)", () => {
  const { dir, proj, vr } = makeCliFixture(() => ({
    records: [
      suiteRound(1, "2026-08-10T01:00:01.000Z", "outer"),
      suiteRound(2, "2026-08-10T02:00:00.000Z", "outer"),
    ],
    transcripts: {
      "main-session.jsonl": [launchRecord("2026-08-10T01:00:00.000Z", launchCmd())],
      "abc/subagents/agent-x.jsonl": [launchRecord("2026-08-10T02:00:01.000Z", launchCmd())],
    },
  }));
  try {
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 2, "runner 恒 outer ⇒ 展示 consecutive=2");
    assert.equal(o.runner_counts.outer, 2);
    assert.equal(o.signal, false, "runner 恒 outer 不驱动 signal——执行形态 2 类 ⇒ healthy");
    assert.equal(o.band, "healthy");
    assert.equal(o._non_execution_surface.includes("runner 字段已降级"), true);
  } finally {
    cleanup(dir);
  }
});

test("CLI — missing verification-round / missing project-dir ⇒ 0 classified, healthy (cold-start)", () => {
  const dir = tmp("empty");
  try {
    const proj = join(dir, "proj"); // 不存在
    const vr = join(dir, "verification-round.jsonl"); // 不存在
    const res = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.signal, false);
    assert.equal(o.band, "insufficient-evidence");
    assert.equal(o.project_dir_exists, false);
    assert.equal(o.total_records, 0);
    assert.equal(o.rounds_classified, 0);
  } finally {
    cleanup(dir);
  }
});

test("CLI — invalid --epsilon-ms / --recent-n ⇒ exit 2 (usage error)", () => {
  const dir = tmp("usage");
  try {
    const proj = join(dir, "proj");
    mkdirSync(proj, { recursive: true });
    const vr = join(dir, "verification-round.jsonl");
    writeFileSync(vr, JSON.stringify(suiteRound(1, "2026-08-10T01:00:00.000Z")) + "\n");
    let r = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--epsilon-ms", "0"]);
    assert.equal(r.status, 2);
    r = run(["--root", dir, "--project-dir", proj, "--verification-round", vr, "--recent-n", "-1"]);
    assert.equal(r.status, 2);
  } finally {
    cleanup(dir);
  }
});
