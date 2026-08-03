---
id: gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed
title: The ## Contract ratchet has no runner — it grew 1 → 12 unnoticed, and 6 of 7
  invoke-evidence-missing findings are false
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`gap-dispatch-gate-has-no-checklist-and-no-trace` 交付了 `plugin/scripts/task-contract-check.ts`
与一份**只能变短**的违规名单 `docs/analysis/contract-violations.md`（`# baseline-count: 1`）。
外层 2026-08-03T10:2xZ 在派发前评审时按 tick 文档 §0c 跑了它，实测两件事都不成立。

### 实测一：没有任何执行者

```
grep -rn "task-contract-check" scripts/ .github/workflows/ plugin/scripts/
  → 仅 plugin/scripts/task-schema.ts 的两条注释（第 56、506 行），无调用
scripts/test.sh 的 run_static_checks() 跑三个检查器：
  it0-split-or-commit-check.sh / test-framework-policy-check.sh / test-isolation-check.sh
  → task-contract-check.ts 不在其中
```

**⇒ 它的唯一消费者是「外层在派发前手工跑一次」。** 而外层从 2026-08-03 03:26Z 起到今天为止
只在少数几个 tick 跑过它——名单于是在没有人看的情况下增长。

### 实测二：名单长了 12 倍，方向与「只能变短」相反

```
node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root . --json
  → exit 1；violations 12 条；ratchet.baselineCount 1、currentCount 11、growth true
```

名单文件里只有 1 条（`gap-no-resource-awareness-heavy-ops-run-blind: dispatch-review-missing`，
且它已被修掉、出现在 `resolved` 里）。**新增 11 条全部落在 `status: done` 的任务上**——
即：违规是在任务被判完成、被合并、被关闭之后才产生的，而机制设计的检查时点是**派发前**。
一个只在派发前跑、只报派发前状态的检查器，被用来判一批已经收尾的任务。

### 实测三：`invoke-evidence-missing` 测的不是它声称的东西

7 条 `invoke-evidence-missing` 的判据是「`invoke` 的反引号命令**逐字**出现在任务体的
Contract 块之外」。外层逐条核对（把「逐字」放宽为「该命令的脚本路径是否出现在别处」）：

| 任务 | 逐字命中 | 脚本路径出现在别处 |
|---|---|---|
| `gap-inner-forensics-verify-reports-nonruns-and-zero-durations` | 否 | **是** |
| `gap-no-cross-project-heavy-op-token` | 否 | **是** |
| `gap-no-inventory-of-what-the-two-layer-mode-actually-runs` | 否 | **是** |
| `gap-serve-task-list-dies-on-one-malformed-task` | 否 | 否 ← **唯一一条真缺口** |
| `gap-task-body-has-n-parsers-and-no-authority` | 否 | **是** |
| `gap-tests-never-clean-up-their-tmpdirs` | 否 | **是** |
| `gap-web-cannot-show-what-the-loop-is-doing-now` | 否 | **是** |

**6/7 是假发现：证据在，只是没按同一串字面写。** 两个具体形态：

- `gap-tests-never-clean-up-their-tmpdirs`：invoke 是 `` `bash scripts/test.sh` ``，
  任务体第 225 行写的是 ``- [x] `scripts/test.sh` 全绿：fan-in 套件 2054 tests / 2035 pass / 0 fail``
  ——**证据比逐字重复更强**（带了数字），但没有 `bash ` 前缀，判为缺失
- `gap-web-cannot-show-what-the-loop-is-doing-now`：invoke 写 `--port 4173`，
  实跑证据是 `--port 4174`（在 scratch worktree 上跑的），判为缺失

**更硬的一条：两条 invoke 命令内含占位符**——
`node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <ISO>` 与
`node --experimental-strip-types plugin/scripts/task-schema-check.ts <file>`。
真实证据里 `<ISO>`/`<file>` 必然被替换成实际值，**逐字命中在构造上不可能发生**。
这两条不是「任务没贴证据」，是**判据自相矛盾**。

### 这属于本仓已经命名过的那一族

`docs/analysis/instrument-failure-mode.md` 的「名不符实」：
**code 叫 `invoke-evidence-missing`，测的是「这串字面没有再次出现」。**
与 tick 文档步骤 0 记的五次误报（`RISKY` 测提交消息字样、`STALLED` 测遥测而非进程、
删除类任务 Touches 语义反）是同一族。

**并且它同时是「写下来但没有执行者的规则等于没有规则」的又一个实例**——
`gap-dispatch-gate-...` 的任务体自己写过：「如果 `## Contract` 没有真读它的消费者，
三天后它就是第五段散文」。**距那次落地 7 小时，名单已经长了 12 倍。**

## Contract

```
measure violations = `node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root . --json` 输出的 violations 数组长度字段
measure growth = `node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root . --json` 输出的 ratchet.growth 布尔字段
band growth = false
invariant 检查器有一个不依赖人记得跑的执行者；名单长度只减不增
invoke `node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root . --json`
control 人为在一个任务体里制造一条新违规 ⇒ 执行者必须报出并 exit 1；修掉它 ⇒ 必须恢复 exit 0
resume 逐个 code 处置，每处置完一类跑一次检查器记数
```

## Chosen mechanism

三件，顺序不可换——**先修判据再接执行者**，否则接上去的第一件事就是把 11 条假发现变成红。

1. **修 `invoke-evidence-missing` 的判据**：逐字子串 → 命中「invoke 命令的**可执行入口路径**
   出现在 Contract 块之外」。含占位符（`<...>`）的 invoke 命令按入口路径判，不按整串判。
   保留严格性的部分：入口路径也没出现 ⇒ 仍然报（`gap-serve-task-list-...` 那条应当继续报出）。
2. **接一个执行者**。两个位置择一并写明理由：`scripts/test.sh` 的 `run_static_checks()`
   （与另外三个检查器同址，代价是每次全量都扫 586 个任务），或 `.github/workflows/ci.yml`
   的独立 step。**不接执行者的方案一律不接受**——本任务的全部证据就是「没有执行者」的后果。
3. **把修完判据后仍然真实的违规写进名单并重设 `# baseline-count`**，
   之后名单恢复只减不增。**重设 baseline 必须在同一个提交里附上重设前后的实跑输出**。

**不做**：不改 `## Contract` 六键语法；不给检查器加 agent 审查；不阻断派发
（§0c 明写「报出而不阻断」，本任务不改这一条——执行者报红的对象是**提交**，不是派发）。

## Acceptance Criteria

- [ ] AC1: `invoke-evidence-missing` 改为按入口路径判定，含占位符的 invoke 命令有专门用例
- [ ] AC2: **负控制**——`gap-serve-task-list-dies-on-one-malformed-task` 这条真缺口在修完判据后
      **仍然被报出**（否则就是把判据放松到失去分辨力），实跑输出贴任务体
- [ ] AC3: 7 条 `invoke-evidence-missing` 中，6 条在修完判据后消失、1 条保留，逐条列出
- [ ] AC4: 检查器接上执行者，写明选了哪个位置与理由；执行者被一次真实调用触发（贴输出）
- [ ] AC5: **双向负控制**——人为造一条新违规 ⇒ 执行者 exit 1 且打印该任务文件名；
      删掉它 ⇒ exit 0。两个方向都贴实跑输出
- [ ] AC6: 名单与 `# baseline-count` 重设，重设前后的 `violations` 数量都贴出来
- [ ] AC7: 扫描 586 个任务的耗时实测记录（若接进 `run_static_checks` 则它进入每次全量的关键路径）
- [ ] AC8: 测试带 `// @test-group governance` 声明，且用 `node:test`

## Definition of Done

- [ ] AC2 与 AC5 的实跑输出贴进任务体——**判据变松而没有负控制，等于把检查器关掉**
- [ ] 完整套件连跑 2 次全绿
- [ ] 任务体记录一句：**本缺陷是外层在派发前评审时跑检查器发现的**，
      不是任何自动信号报出的——这正是要接执行者的理由

## Touches

- plugin/scripts/task-contract-check.ts
- plugin/test/task-contract-check.test.mjs
- docs/analysis/contract-violations.md
- scripts/test.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T10:28:00Z
changed: 建任务时就把三条实测证据写进任务体（无执行者的 grep 结果、名单 1→12 的 ratchet 输出、
7 条逐条核对表），因为「有证据才建任务」是本仓硬规则。并预先拆掉一个陷阱：本任务会**放松**
一条判据，所以 AC2/AC5 强制双向负控制——放松判据而不留负控制，是把检查器悄悄关掉的标准形态。
`## Touches` 含 `scripts/test.sh`：机制第 2 条可能改它，与任何同改该文件的任务不得同批。
