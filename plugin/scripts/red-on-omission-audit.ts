#!/usr/bin/env node
// red-on-omission-audit.ts — 每条固化行为必须能指出「不做时哪个读数会变红」
// (tasks/gap-ac41-red-on-omission-artifact, AC41 判据 3)
//
// Defect family (2026-08-10 活体实证): A15 裁定5（连续 3 轮 A15 心跳缺失 ⇒ .halt；再 3 轮 ⇒ /clear）
// 在 80 行执行核里、每轮必读、阈值明确、计数器建好、catalog 已声明，**仍连续 9 轮未被执行**直到
// manager 置 `.halt`。固化 + 引用 + tick 解决「记不住」，解决不了「没人执行」——「守」与「不守」在
// 记录上不可区分。今晚三次有效干预（`.halt` / `ruling5_status` 自报字段 / `scope=worktree` fan-in 闸）
// 全部属同一类：让「没做」**变得可见**。
//
// 判据（AC41③，manager 补的第三条限定，人已裁定同意）：**每条固化行为必须能指出「不做时哪个读数
// 会变红」；指不出的，视为未固化。** 本检查器把这条判据机械化：
//   - 每条固化行为 = registry 里的一条，带 `redReading`（不做时变红的读数：文件字段/计数器/检查器
//     exit/门事件）。
//   - 每条带 `verify(root)`——**机械地核对该读数在真实工作区里是 DECLARED 的**（读 tracked 文件，
//     不是 registry 里自证为真的布尔——自证/回显按硬规则 4 不是测量）。删掉变红读数的声明 ⇒ 检查器
//     转红（exit 1），所以它是个 ratchet：保住已固化的读数，缺失的列未固化。
//   - audit[] = 逐条审计清单（执行核 C 段/A 段 + 本任务三条），`covered` 布尔标每条；缺失读数的列
//     未固化（redReading=null），如实列出，不假装在册。
//
// ## Contract:
//   measure   behaviors_with_red_reading = stdout 的 covered/uncov 数字
//   band      behaviors_with_red_reading = uncov = 0（每条固化行为有变红读数）
//   invariant a15_ruling5_has_red_reading = 1 / scope_worktree_gate_covered = 1 / ruling5_status_covered = 1
//
// Usage:
//   node --experimental-strip-types red-on-omission-audit.ts --root <dir> [--json]
//
// Exit: 0 = band 满足（uncov=0 且三条 invariant 全真）· 1 = 有未固化行为或 invariant 断
//       · 2 = usage/env error。
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/red-on-omission-audit.ts --root "$PWD" --json
//   scripts/test.sh plugin/test/red-on-omission-audit.test.mjs

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Verify helpers (mechanical, tracked-file based — never self-asserted) ──────────────────────────

/** Read a file under root; return "" when missing (a missing file is a FAIL, not a pass). */
function readUnder(root: string, rel: string): string {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}

/** True iff `text` contains the literal `needle` (positional content check). */
function has(text: string, needle: string): boolean {
  return text.includes(needle);
}

/** True iff `needle` is wired into the suite's static-gate surface — scripts/test.sh OR the
 *  runner-static-gate.ts it sources (gap-ac128-hub-split-harness-concerns moved run_static_checks out
 *  of test.sh into that file; run_doc_checks stays in test.sh). */
function wiredInSuite(root: string, needle: string): boolean {
  return (
    has(readUnder(root, "scripts/test.sh"), needle) ||
    has(readUnder(root, "plugin/scripts/runner-static-gate.ts"), needle)
  );
}

/** True iff `text` matches the regex anywhere. */
function hasRe(text: string, re: RegExp): boolean {
  return re.test(text);
}

/** True iff the file under root exists. */
function fileExists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

// ── Registry: 每条固化行为 → 「不做时变红的读数」───────────────────────────────────────────────────

export interface RedReadingEntry {
  /** 稳定 id（与 ## Contract invariant 同名时即 invariant 判据）。 */
  id: string;
  /** 归类：invariant（Contract 三条）/ a-reading（执行核 A 段）/ c-constraint（执行核 C 段）/ b-production（B 段产物）。 */
  kind: "invariant" | "a-reading" | "c-constraint" | "b-production";
  /** 固化行为（动作 + 判据）。 */
  behavior: string;
  /** 不做时变红的读数——具体到文件字段/计数器/检查器 exit/门事件。 */
  redReading: string;
  /** 机械核对：该读数在 tracked 文件里确实是 DECLARED 的。返回 ok + 一句证据。 */
  verify: (root: string) => { ok: boolean; detail: string };
}

/** 阅读 helper：读执行核文本（registry 大量 verify 以它为准）。 */
function tickCore(root: string): string {
  return readUnder(root, "orchestration/orchestrator-tick-core.md");
}

export const REGISTRY: RedReadingEntry[] = [
  // ── 三条 Contract invariant（任务体验证锚 (c)，必须 covered）──────────────────────────────────
  {
    id: "a15_ruling5",
    kind: "invariant",
    behavior:
      "outer 执行 A15 裁定5 — 连续 3 轮 A15 心跳缺失（Agent 无新 ts）⇒ 置 `.halt`；再 3 轮 ⇒ `/clear`",
    redReading:
      "`.quay/suite-health-last-run.json` → `ruling5_status` 字段缺失/显示 violated（自报越过 3/6 轮门槛）；A15 ② 每 tick 写该文件，mtime 陈旧 ⇒ 检查器 exit 1",
    verify: (root) => {
      const t = tickCore(root);
      const okRule =
        hasRe(t, /执行保障\s*\(?裁定5\)?/) &&
        hasRe(t, /连续\s*3\s*轮/) &&
        has(t, ".halt") &&
        has(t, "/clear");
      const okField = hasRe(t, /ruling5_status/);
      return {
        ok: okRule && okField,
        detail: okRule && okField
          ? "执行核 A15 ⑤ 声明裁定5 规则 + A15 ② 声明 ruling5_status 字段"
          : `执行核 A15 ⑤ 声明裁定5 规则=${okRule}；ruling5_status 字段声明=${okField}`,
      };
    },
  },
  {
    id: "scope_worktree_gate",
    kind: "invariant",
    behavior:
      "suite-fix fan-in 前必须存在 ≥1 条 `scope=worktree` 且 `state=green` 的轮次记录，否则拒 merge（不自测绿不许合）",
    redReading:
      "`.quay/verification-round.jsonl` 无 `scope=worktree`+`state=green` 记录 ⇒ fan-in 拒（门拒）；`scope` 字段缺失 ⇒ 无法判 ⇒ 拒",
    verify: (root) => {
      const runner = readUnder(root, "plugin/scripts/full-suite-runner.ts");
      const fix = readUnder(root, ".claude/workflows/execute-suite-fix.js");
      const okField = has(runner, 'scope?: "main" | "worktree"');
      const okConsumer =
        has(fix, "scope=worktree") && hasRe(fix, /state\s*===\s*'green'|state\s*===["']green["']/);
      const okDoc = hasRe(tickCore(root), /scope=worktree|scope=main/);
      return {
        ok: okField && okConsumer && okDoc,
        detail: okField && okConsumer && okDoc
          ? "runner 声明 scope 字段 + fan-in 消费者（execute-suite-fix Merge）要求 worktree+green + 执行核声明"
          : `scope 字段声明=${okField}；fan-in 消费者要求 worktree+green=${okConsumer}；执行核声明=${okDoc}`,
      };
    },
  },
  {
    id: "ruling5_status",
    kind: "invariant",
    behavior:
      "A15 ② 每 tick 写 `.quay/suite-health-last-run.json`，含 `ruling5_status` 自报字段（自我诊断同时越过 3/6 轮门槛，越过即 violated）",
    redReading:
      "`suite-health-last-run.json` → `ruling5_status` 缺失 ⇒ 检查器 exit 1（字段缺失 = 自报没写 = 裁定5 没做）",
    verify: (root) => {
      const t = tickCore(root);
      const okDoc = hasRe(t, /ruling5_status/);
      const okWrite = hasRe(t, /①每\s*tick\s*写\s*`\.quay\/suite-health-last-run\.json`/);
      return {
        ok: okDoc && okWrite,
        detail: okDoc && okWrite
          ? "执行核声明 ruling5_status 字段 + 每 tick 写 suite-health-last-run.json"
          : `ruling5_status 声明=${okDoc}；每 tick 写声明=${okWrite}`,
      };
    },
  },

  // ── 执行核 A 段（a-reading）───────────────────────────────────────────────────────────────────
  {
    id: "a15_heartbeat_write",
    kind: "a-reading",
    behavior: "A15 ② 每 tick 写 `.quay/suite-health-last-run.json`（评价 subagent 的输出就是它）",
    redReading: "该文件 mtime 距今 >3 tick 周期 ⇒ 检查器 exit 1（mtime 超时 = 没写 = 心跳断）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = hasRe(t, /①每\s*tick\s*写\s*`\.quay\/suite-health-last-run\.json`/);
      return {
        ok,
        detail: ok
          ? "执行核 A15 ② 声明每 tick 写 suite-health-last-run.json（mtime 是它的读数）"
          : "执行核 A15 ② 未声明每 tick 写 suite-health-last-run.json",
      };
    },
  },
  {
    id: "a17_semantic_judge",
    kind: "a-reading",
    behavior:
      "A17 语义观测器 judge — 读自由文本判 stopped/awaiting；`stopped:true` 而 tick-log 无对应升级 ⇒ 变红",
    redReading: "`semantic-observer-judge.ts` 输出 `redOnOmission:true` 且 **exit 1**（AC41③ 观测层实例）",
    verify: (root) => {
      const judge = readUnder(root, "plugin/scripts/semantic-observer-judge.ts");
      const t = tickCore(root);
      const okCode = has(judge, "redOnOmission") && hasRe(judge, /return\s+redOnOmission\s*\?\s*1\s*:\s*0/);
      const okWiring = has(t, "semantic-observer-judge");
      return {
        ok: okCode && okWiring,
        detail: okCode && okWiring
          ? "judge 带 redOnOmission→exit 1 + 执行核 A17 接线"
          : `judge redOnOmission→exit1=${okCode}；执行核 A17 接线=${okWiring}`,
      };
    },
  },
  {
    id: "a16_observe_inner_failure",
    kind: "a-reading",
    behavior:
      "A16 上层观察下层失能（替代 subagent 计数）— inner 宣称派发但 in-flight 恒 0 / 宣称合并但 diverge 不降 / 宣称修红但轮次不转绿 ⇒ 报「inner 失能」并升级",
    redReading:
      "inner 宣称 vs 观测矛盾 ⇒ tick-log 升级行（不做即静默——读 tick-log 升级列是否出现「inner 失能」）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "宣称要做的事") && has(t, "宣称派发") && has(t, "宣称合并");
      return {
        ok,
        detail: ok
          ? "执行核 A16 声明「宣称 vs 观测矛盾 ⇒ 报 inner 失能」判据"
          : "执行核 A16 未声明 inner 失能判据",
      };
    },
  },
  {
    id: "a14_closure_pass",
    kind: "a-reading",
    behavior:
      "A14 账本·本轮 closure-pass 是否被调用 — `meta-cc query_session_content role=tool tool_name=closure-lag-check` → last(timestamp)",
    redReading: "`meta-cc query` 心跳缺失 >3 tick 周期 ⇒ 写「已停用/已替代/是缺陷」三选一（不做即查不到调用）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "tool_name=closure-lag-check");
      return {
        ok,
        detail: ok
          ? "执行核 A14 声明 meta-cc 查 closure-lag-check 调用（last timestamp 是它的读数）"
          : "执行核 A14 未声明 closure-pass 调用查询",
      };
    },
  },
  {
    id: "a10_closure_lag",
    kind: "a-reading",
    behavior: "A10 `closure-lag-check.sh` — 退出非 0 ⇒ 本 tick 报 WARN 进 tick-log + 报告，不静默",
    redReading: "`closure-lag-check.sh` 退出非 0 ⇒ tick-log 报 WARN（信号是报告不是门控）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "closure-lag-check.sh");
      return {
        ok,
        detail: ok ? "执行核 A10 声明 closure-lag-check（非 0 ⇒ 报 WARN）" : "执行核 A10 未声明 closure-lag-check",
      };
    },
  },
  {
    id: "a6_fixed_cap",
    kind: "a-reading",
    behavior: "A6 占用率固定 cap=5（动态 cap 作废）— `ready-pool-check` 一律 `--cap 5`；floor=20",
    redReading: "`ready-pool-check` 不带 `--cap 5` ⇒ 回退 `CONCURRENCY_CAP_DEFAULT`（= defaultDriverConfig().worker.cap = 5，单一真相源）⇒ floor=20 与真值一致（旧 `=3` ⇒ floor=12 假读数已随 dispatch 单一真相源消除）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "ready-pool-check --cap 5") && has(t, "固定 `cap=5`");
      return {
        ok,
        detail: ok
          ? "执行核 A6 声明固定 cap=5 + ready-pool-check --cap 5"
          : "执行核 A6 未完整声明固定 cap=5 / --cap 5",
      };
    },
  },
  {
    id: "a1_monitor_mount",
    kind: "a-reading",
    behavior: "A1 `monitor-mount-check.sh --json` — 两判据缺一不可：`mounted` + `targetRoot`==本仓根（`targetOk`）",
    redReading: "`monitor-mount-check.sh --json` 的 `mounted`/`targetOk` 判据不满足 ⇒ 报（挂错目标与挂对了从外面一模一样）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "monitor-mount-check");
      return {
        ok,
        detail: ok ? "执行核 A1 声明 monitor-mount-check（mounted+targetOk 判据）" : "执行核 A1 未声明 monitor-mount-check",
      };
    },
  },

  // ── 执行核 C 段硬约束（c-constraint，只收已带机械读数的）────────────────────────────────────
  {
    id: "c1_delivery",
    kind: "c-constraint",
    behavior:
      "C1 驱动 inner 一律用 `supervisor-deliver.sh`，禁止手工拼 send-keys / send-keys-verified.sh / 对活会话 --root",
    redReading:
      "A14/A16 每 tick 统计本会话裸 tmux send-keys 次数（按位置判定），非 0 即违规并记账（tick-log 记 RED）+ drive-contract-check 契约检查",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "裸 tmux send-keys 次数") && has(t, "非 0 即违规并记账");
      return {
        ok,
        detail: ok
          ? "执行核 A14 声明裸 send-keys 计数（非 0 即违规并记账）"
          : "执行核未声明裸 send-keys 计数",
      };
    },
  },
  {
    id: "c2_pane_busy",
    kind: "c-constraint",
    behavior: "C2 忙闲只取 pane 底部 3 行（`tail -3 | grep -q 'esc to interrupt'`）；整屏 md5(capture-pane) 是 ADR-016 明令禁止",
    redReading: "`adr016-screen-use-check` 静态门 exit 1（整屏哈希命中即红，@static-tier change 每 scoped 跑）",
    verify: (root) => {
      const checker = fileExists(root, "plugin/scripts/adr016-screen-use-check.ts");
      const wired = wiredInSuite(root, "adr016-screen-use-check");
      return {
        ok: checker && wired,
        detail: checker && wired
          ? "adr016-screen-use-check 存在 + 接入 suite static-gate (run_static_checks)"
          : `adr016 检查器存在=${checker}；suite 接入=${wired}`,
      };
    },
  },
  {
    id: "c3_resource_gate",
    kind: "c-constraint",
    behavior: "C3 跑全量套件前过 `resource-gate.sh --for full-suite`，非 0 = WAIT ⇒ 只核实便宜的声称",
    redReading: "`resource-gate.sh --for full-suite` 退出非 0 = WAIT ⇒ 全量不跑（门拒，不做就等不到 suite 结果）",
    verify: (root) => {
      const t = tickCore(root);
      const archive = readUnder(root, "orchestration/archive/AC58-retired-clauses.md");
      const script = fileExists(root, "plugin/scripts/resource-gate.sh");
      // AC84/AC76 C3→R32 迁移 (orchestrator-tick-core.md C3 body moved to the archive): accept the
      // direct (unmigrated) form OR the migrated form — core holds the `C3 正身已迁出` pointer AND
      // the archive holds the phrase. Falsifiable: if the clause vanishes from BOTH core and archive,
      // ok=false → uncov → band red.
      const direct = has(t, "resource-gate.sh --for full-suite");
      const migrated = has(t, "C3 正身已迁出") && has(archive, "resource-gate.sh --for full-suite");
      const ok = script && (direct || migrated);
      return {
        ok,
        detail: ok
          ? (direct
              ? "执行核 C3 声明 resource-gate（direct 形态）+ 脚本存在"
              : "执行核 C3 已迁出 → archive#R32 声明 resource-gate（migrated 形态）+ 脚本存在")
          : `执行核 C3 direct 声明=${direct}；migrated(指针∧档案短语)=${has(t, "C3 正身已迁出") && has(archive, "resource-gate.sh --for full-suite")}；脚本存在=${script}`,
      };
    },
  },
  {
    id: "c7_drive_text",
    kind: "c-constraint",
    behavior: "C7 驱动文本只携带数据，不复述行为；要定顺序就把 `checkTouchesPair` 实际输出附在同一条驱动文本里",
    redReading: "`drive-contract-check` exit 1（顺序断言无 pair 输出 ⇒ 门拒，@static-tier change）",
    verify: (root) => {
      const checker = fileExists(root, "plugin/scripts/drive-contract-check.ts");
      const wired = wiredInSuite(root, "drive-contract-check");
      return {
        ok: checker && wired,
        detail: checker && wired
          ? "drive-contract-check 存在 + 接入 suite static-gate"
          : `drive-contract-check 存在=${checker}；suite 接入=${wired}`,
      };
    },
  },
  {
    id: "c14_contract_check",
    kind: "c-constraint",
    behavior: "C14 派发前读候选的 `## Contract` 六键并跑 `task-contract-check.ts`（报出不阻断），介入后改什么写进 `## Dispatch review`",
    redReading: "`task-contract-check` exit 1（@static-tier always，scoped 也跑 ⇒ 契约 ratchet 增长即红）",
    verify: (root) => {
      const checker = fileExists(root, "plugin/scripts/task-contract-check.ts");
      const wired = wiredInSuite(root, "task-contract-check");
      const t = tickCore(root);
      const doc = has(t, "task-contract-check");
      return {
        ok: checker && wired && doc,
        detail: checker && wired && doc
          ? "task-contract-check 存在 + suite 接入 + 执行核 C14 声明"
          : `task-contract-check 存在=${checker}；suite 接入=${wired}；执行核声明=${doc}`,
      };
    },
  },

  // ── B 段产物（b-production）──────────────────────────────────────────────────────────────────
  {
    id: "b2_closure_record",
    kind: "b-production",
    behavior: "B2 留痕 — `closure-lag-check.sh --record --flipped <N>`，零收尾也写 0",
    redReading: "`meta-cc query tool_name=closure-lag-check` 查不到 --record 调用（心跳缺失）⇒ A14 三选一（不做即查不到留痕）",
    verify: (root) => {
      const t = tickCore(root);
      const ok = has(t, "closure-lag-check.sh --record");
      return {
        ok,
        detail: ok ? "执行核 B2 声明 closure-lag-check --record（零收尾也写 0）" : "执行核 B2 未声明 --record 留痕",
      };
    },
  },
];

// ── Audit 逐条审计清单（C 段 + A 段 + 三条 invariant；redReading=null 即「未固化」）──────────────
// 这是 AC2 的产物：每条固化行为标「不做时变红的读数」。in registry 的从 registry 取（机械核对）；
// 不在 registry 的（尚无机械读数）如实列 redReading=null / covered=false ——「缺失的列未固化」。

export interface AuditRow {
  id: string;
  kind: string;
  behavior: string;
  /** null = 未固化（指不出「不做时哪个读数会变红」）。 */
  redReading: string | null;
}

/** C 段逐条：behavior 一句话 + 现存读数（取自执行核）；指不出读数的列 redReading=null（未固化）。 */
const C_AUDIT: { id: string; behavior: string; redReading: string | null }[] = [
  { id: "C1", behavior: "驱动 inner 一律用 supervisor-deliver.sh，禁手工 send-keys / send-keys-verified.sh / 对活会话 --root", redReading: "裸 send-keys 计数非 0 ⇒ tick-log 记 RED（A14 每 tick 统计，按位置判定）" },
  { id: "C2", behavior: "忙闲只取 pane 底部 3 行；整屏 md5(capture-pane) 是 ADR-016 明令禁止", redReading: "adr016-screen-use-check 静态门 exit 1（@static-tier change）" },
  { id: "C3", behavior: "跑全量套件前过 resource-gate.sh --for full-suite，非 0 = WAIT ⇒ 只核实便宜的声称", redReading: "resource-gate.sh 非 0 = WAIT ⇒ 全量不跑" },
  { id: "C4", behavior: "数进程用 comm 精确匹配 / 显式排除自身；pgrep -f 会匹配发起查询的命令自己；判停摆要进程数 0 且 load1<1", redReading: null },
  { id: "C5", behavior: "核实「修好了没有」看行为或读 diff，不要 grep 关键词", redReading: null },
  { id: "C6", behavior: "新检测器的第一条事件默认当待验证，不当发现", redReading: null },
  { id: "C7", behavior: "驱动文本只携带数据，不复述行为；定顺序附 checkTouchesPair 输出", redReading: "drive-contract-check exit 1（顺序断言无 pair 输出）" },
  { id: "C8", behavior: "「在飞」拆两义：括号在飞 / subagent 在飞；核实并发不得用 START 事件或 pane UI 文字", redReading: null },
  { id: "C9", behavior: "输入框是待提交缓冲区不是笔记本；用完 C-u 清空；问责对象是「框里有文本」", redReading: null },
  { id: "C10", behavior: "写任何时刻前先跑 date -u，不许估", redReading: null },
  { id: "C11", behavior: "停摆分类不要靠输入框内容猜（ghost suggestion）；看最后一段 ⏺ 问了什么", redReading: null },
  { id: "C12", behavior: "人机对话期间 cron 不 fire；每次对话结束前手动补一次 tick", redReading: null },
  { id: "C13", behavior: "写 tasks/ 前先确认没有在飞任务把 tasks/ 列进它的 ## Touches；撞上就改为记队列状态 + 指示内层建", redReading: null },
  { id: "C14", behavior: "派发前读候选的 ## Contract 六键并跑 task-contract-check.ts；介入后把改了什么写进 ## Dispatch review", redReading: "task-contract-check exit 1（@static-tier always）" },
  { id: "C15", behavior: "收编到 serial 相仅应在证明相应失败是并发造成后执行（isolated-rerun 贴证据）；not-in-family 不得按负载敏感处理", redReading: null },
];

/** A 段逐条（与 registry 重叠的从 registry 取机械核对，其余标现存读数或未固化）。 */
const A_AUDIT: { id: string; behavior: string; redReading: string | null }[] = [
  { id: "A1", behavior: "monitor-mount-check.sh --json（mounted + targetOk）", redReading: "monitor-mount-check 判据不满足 ⇒ 报" },
  { id: "A3", behavior: "三项目 .halt 存在性 + 内容 + 最后提交时距", redReading: "无 .halt 且长期无产出(>24h) ⇒ 未标记的停摆，升级" },
  { id: "A4", behavior: "观察块：capture-pane / git log / git status / telemetry / drift / batch2-queue", redReading: null },
  { id: "A5", behavior: "ls .quay/manager-inbox/（列目录本身，不依赖 unread 计数器）", redReading: "目录非空且无 consumed 回执 ⇒ 逐条进决策/报" },
  { id: "A6", behavior: "占用率固定 cap=5（动态 cap 作废）；ready-pool-check --cap 5", redReading: "不带 --cap 5 ⇒ floor=12 假读数（≠ floor=20）" },
  { id: "A7", behavior: "inner-blocked-signal.ts --detect-stop --target inner", redReading: "连续 3 次 waiting-input/permission-prompt 才写块；pane 快照陈旧改读活 capture-pane" },
  { id: "A8", behavior: "层间 tick 间隔检查（inner transcript mtime age，阈值 30min）", redReading: "mtime age > 阈值 ⇒ 报" },
  { id: "A9", behavior: "ready-pool-check.ts --root --cap 5 --json → excluded[] 的 not-yet-flipped", redReading: "not-yet-flipped ≥ floor/2 ⇒ 逐个核 AC（≥10 报 done-flip 积压）" },
  { id: "A10", behavior: "closure-lag-check.sh（退出非 0 ⇒ 报 WARN）", redReading: "退出非 0 ⇒ 报 WARN 进 tick-log" },
  { id: "A11", behavior: "读 .quay/full-suite-state.json 的 state/reason/durationMs", redReading: "red ⇒ 停派；缺文件 ⇒ true；aborted 不触发停派" },
  { id: "A12", behavior: "独立核实内层至少一项声称（inner-forensics / self-report-vocab-audit）", redReading: "self-report vocab 连续 3 轮无 batch 自述 = 收敛" },
  { id: "A14", behavior: "账本·closure-pass 是否被调用（meta-cc query tool_name=closure-lag-check）", redReading: "心跳缺失 >3 tick ⇒ 写三选一" },
  { id: "A15", behavior: "suite-health（workflow+subagent 双侧+执行体）——每 tick 写 suite-health-last-run.json + 裁定5 执行保障", redReading: "suite-health-last-run.json mtime 陈旧 / ruling5_status 缺失 ⇒ 红" },
  { id: "A16", behavior: "上层观察下层失能（宣称 vs 观测矛盾 ⇒ 升级）", redReading: "宣称派发但 in-flight 恒 0 / 宣称合并但 diverge 不降 / 宣称修红但轮次不转绿 ⇒ 报 inner 失能" },
  { id: "A17", behavior: "语义观测器 judge（读自由文本判 stopped/awaiting）", redReading: "stopped:true 无升级 ⇒ redOnOmission exit 1" },
];

/** 组 audit 行：registry 的行从 registry 取（机械核对 + redReading 非空）；其余标 covered。 */
export function buildAudit(verified: Map<string, RedReadingEntry>): AuditRow[] {
  const rows: AuditRow[] = [];
  const push = (id: string, kind: string, behavior: string, redReading: string | null) => {
    rows.push({ id, kind, behavior, redReading });
  };
  for (const r of REGISTRY) {
    push(r.id, r.kind, r.behavior, r.redReading);
  }
  for (const a of A_AUDIT) {
    if (!REGISTRY.some((r) => r.id === a.id)) push(a.id, "a-reading", a.behavior, a.redReading);
  }
  for (const c of C_AUDIT) {
    if (!REGISTRY.some((r) => r.id === c.id)) push(c.id, "c-constraint", c.behavior, c.redReading);
  }
  return rows;
}

// ── runAudit: 跑 registry verify，算 covered/uncov + invariants ─────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

export interface AuditResult {
  measure: { covered: number; uncov: number; band: number };
  covered: { id: string; behavior: string; redReading: string; detail: string }[];
  uncov: { id: string; behavior: string; reason: string }[];
  audit: AuditRow[];
  invariants: Record<string, 0 | 1>;
}

export function runAudit(root: string): AuditResult {
  const results: { entry: RedReadingEntry; res: VerifyResult }[] = REGISTRY.map((entry) => ({
    entry,
    res: entry.verify(root),
  }));

  const covered = results
    .filter((r) => r.res.ok)
    .map((r) => ({ id: r.entry.id, behavior: r.entry.behavior, redReading: r.entry.redReading, detail: r.res.detail }));
  const uncov = results
    .filter((r) => !r.res.ok)
    .map((r) => ({ id: r.entry.id, behavior: r.entry.behavior, reason: r.res.detail }));

  const invariants: Record<string, 0 | 1> = {
    a15_ruling5_has_red_reading: 0,
    scope_worktree_gate_covered: 0,
    ruling5_status_covered: 0,
  };
  for (const r of results) {
    if (r.entry.kind !== "invariant" || !r.res.ok) continue;
    if (r.entry.id === "a15_ruling5") invariants.a15_ruling5_has_red_reading = 1;
    else if (r.entry.id === "scope_worktree_gate") invariants.scope_worktree_gate_covered = 1;
    else if (r.entry.id === "ruling5_status") invariants.ruling5_status_covered = 1;
  }

  return {
    measure: { covered: covered.length, uncov: uncov.length, band: 0 },
    covered,
    uncov,
    audit: buildAudit(new Map(REGISTRY.map((r) => [r.id, r]))),
    invariants,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(): number {
  process.stderr.write(
    "red-on-omission-audit.ts — 每条固化行为必须能指出「不做时哪个读数会变红」；指不出的视为未固化。\n" +
      "Usage: --root <dir> [--json]\n",
  );
  return 2;
}

export function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i];
      if (root === undefined) return usage();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "red-on-omission-audit.ts — is every solidified behavior able to point at a reading that turns RED when omitted?\n" +
          "Each registry entry's redReading is mechanically verified against the workspace (tracked files), not self-asserted.\n" +
          "Exit 0 = band satisfied (uncov=0 + invariants true) · 1 = an uncov behavior or broken invariant · 2 = usage.\n",
      );
      return 0;
    } else {
      return usage();
    }
  }

  root = path.resolve(root);
  const result = runAudit(root);
  const pass = result.measure.uncov === 0 && Object.values(result.invariants).every((v) => v === 1);

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`red-on-omission-audit: covered=${result.measure.covered} uncov=${result.measure.uncov} (band ${result.measure.band})\n`);
    for (const c of result.covered) {
      process.stdout.write(`  ✓ ${c.id} — ${c.behavior}\n      redReading: ${c.redReading}\n`);
    }
    for (const u of result.uncov) {
      process.stdout.write(`  ✗ ${u.id} — ${u.behavior}\n      UNCOV: ${u.reason}\n`);
    }
    const notSolidified = result.audit.filter((a) => a.redReading == null);
    for (const n of notSolidified) {
      process.stdout.write(`  未固化: ${n.id} — ${n.behavior}\n`);
    }
    if (!pass) {
      process.stdout.write(`red-on-omission-audit: band NOT satisfied (uncov=${result.measure.uncov})\n`);
    } else {
      process.stdout.write(`red-on-omission-audit: band satisfied (uncov=0, all invariants true)\n`);
    }
  }
  return pass ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
