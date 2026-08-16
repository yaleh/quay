---
id: gap-suite-fix-red-baseline-2026-08-16
title: "suite-fix：develop 基线红（静态门 + 测试真失败）已修复——execute-suite-fix workflow 全绿 merge develop（679ac913）"
status: done
labels:
  - gap
  - mechanism
  - suite-fix
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 优先级判断（转发 inner needs-human）+ 人 2026-08-16 新阶段裁定。

**关键事实（manager 判断，方向明确；⛔ 数字已更正 04:5xZ）**：develop 基线**确有红块**挡住
drift-mode follow-up 的 fan-in。**⚠️ 原「23 文件/7 族」是 08-12~13 历史并集，非当前状态——已作废**
（manager 复算 212 轮 verification-round 确认，其原转述未复算，记其账上）。**真红分解（两类，分开处置）**：
- **(a) `reason=gate-failed tests=0 failures=19` —— 套件根本没跑（静态红=A15②「suite 没跑」）**：
  18 条 = `tasks/*.md` 文档 lint，散在 **15 个已完成任务**（invoke-evidence-missing×10 /
  contract-line-unknown×4 / dispatch-review-missing×2 / measure-no-field×1 / contract-measure-no-name×1）；
  1 条 = `STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1`（唯一真门）。
- **(b) `reason=failed tests=4929 failures=7` —— 唯一真跑了测试的一轮（08-15 12:27）**，去重后
  **3 文件 / 2 断言**：`select-preflight-cli.test.mjs`（单 case 60s 超时，08-13 起间歇，非断言失败）
  + `loop-shipping.test.mjs`（AC1b「搬迁后不应残留 5 个旧路径引用」）。
- **已知绿点**：08-15 11:34 全绿（tests=4926 failures=0）——bisect 下界。
- **两条陷阱**：① 末轮全量 = 08-15 12:55（16h 前），「恒红」是 16h 前读数非持续观测；
  ② per-task-suite-records 近 6 条绿全 `fullSuiteRan=false doc-only-delta`——**绿但没跑**（硬规则 3b），
  不作基线绿证据。
**⛔ 因果更正（manager 04:5x 负控制证否，971edc5d 的「两条腿」作废）**：**18 条 lint 不是红的成因**——
负控制：08-15 09:00–13:00 窗口跨越 红→绿→红，但那 15 个任务文件**整个窗口改动次数 = 0**
（git log 空），而红轮违规组成逐条相同 ⇒ **绿轮跑的时候这 18 条违规原封不动在树里** ⇒ 它们是
**静态门失败时一并打印的附带输出**，修完 15 个任务体门不会变绿。绿轮独有 `static_phase_ms` 等字段
证明绿轮静态相真跑并通过。
**⇒ 修正后的修法**：①**先跑对照定成因**（归 Fix agent，一条命令级）：在 verify worktree 单独跑
`direct-to-develop-bypass-check`——exit=1 且其余 lint 在 ⇒ bypass 门才是闸（假说成立）；exit=0 ⇒ 证否另找。
⛔ **先不动 15 个任务体**（无关文档债，修了不改变门状态）。②18 条 lint **降为独立清理项**，与 suite-fix
解耦、不进本任务 AC。③(b) 2 断言（select-preflight 60s 超时 / loop-shipping AC1b）不受本更正影响，仍真问题。
时间线佐证（非证明）：末绿 11:34 → 首红 11:54 间落 9 个提交，若有直接落 develop 的恰触发该门。

**⛔ 消费者枚举 + 诊断完成（manager 逐条复算）——「基线红」真实规模**：
```
18 条 lint               → 已证否为成因 ⇒ 独立清理项（另立案 gap-done-task-doc-lint-cleanup）
direct-to-develop-bypass → 唯一剩静态候选成因，⛔ 仍假说，跑对照定它
loop-shipping AC1b       → 已修（d46e3e35，落在失败轮后 66min），负控 hits=0 ⇒ 无动作，⛔ 不退役
                          （它一天内真抓到过 3 处新增引用）
select-preflight-cli     → 真改动两处，全在测试文件：①首行 `// @test-group engine` → `lowconc`
                          （既有机制非新前置）②删 :45-48 与 :50 同路径的重复用例（砍 124.9s→~62s）
                          ⛔ 不单纯上调 timeout（60000 是依赖机器容量的字面值，475→1199 已吃掉一次）
```
**⇒ 真正要写的代码：一行泳道标注 + 删一个 test case。** 其余全是「已修/非成因/待定成因」。
select-preflight 退役前提已成立（唯一非测试消费者 = ADR-022 退役经典循环入口），但**退役是产品决策，
另立案**，不并本任务。

**已确认证据**：最近一次真实全量轮（verification-round 08-15 12:55，lane 16）state=red、19 failures
（任务文件缺口 + 静态检查 + 测试族）。per-task-suite-records 亦见 08-16 00:44 red（5 文件）。

**判定（manager，outer 采纳）**：**必须修**——不能等基线自己好、不能靠 override 替代真修复
（今日 (a) 补 catalog 不豁免的先例同构）。inner 可对自己的任务用 override 解锁（delta 已证非因果，
有负控制），**但本任务 23 文件 7 族的真修复必须单独立案**（规模太大，不折进 AC85-89 任何现有 AC）。

**⛔ 本任务独立于 AC85-89**——它是它们的**前置依赖**（AC88 验证机制 + drift-mode 都需要基线绿）。

## Plan

1. 跑全量套件确认当前真实失败集（23 文件/7 族的具体清单——以真跑为准，非 08-15 的历史快照）。
2. 逐族归因：quay-init* / install-config-driven-e2e* / cold-start-skill / real-target-verify /
   capability-catalog / select-preflight-cli 各自的根因（可能是同一批 08-15 变更，也可能是家族性）。
3. 修复（改代码/测试/夹具），逐族转绿。
4. 全量套件绿（`state=green` 且时间新于 08-16 切换）为达成证据；修红期间不用 override 顶替真修复。

## Acceptance Criteria

- [x] AC1: 以**真跑**确认真实失败集——execute-suite-fix workflow 跑真实轮（无配额），真失败集 =
      两个静态门检查器（fan-in-workflow-check 指向 bug / direct-to-develop-bypass-check 历史直提
      f9577da1 需 ruled 分类）+ referenced-not-landed 声明 + full-suite-runner.test.mjs（283.8s 真失败）
      + 19 条 doc lint（附带输出非成因）。「23 文件/7 族」已证为历史并集非当前状态（manager 复算作废）。
- [x] AC2: 失败族逐族归因 + 修复——Fix agent 修：fan-in-workflow-check 指向 bug（mainRoot/QUAY_MAIN_CHECKOUT）、
      bypass-check 的 f9577da1 ruled-historical 分类、SKILL.md + 核心文档 referenced-not-landed 声明、
      full-suite-runner.test.mjs 等真失败；最终轮全绿。
- [x] AC3: 全量套件 `state=green`（workflow 终态 outcome=green，scope=worktree，
      verifiedCommit=acdd0517，2026-08-16），**未用 override 顶替**；已 fan-in merge 到 develop
      （679ac913，conflict-free，acdd0517 为 develop 祖先）。
- [x] AC4: 修复证据逐族可核——workflow journal（68 agents）+ merged commits（acdd0517/4d3a2767）
      + verification-round green 记录 + 静态门检查器 exit 0。

## Definition of Done

- [x] develop 基线全量套件绿（2026-08-16 workflow 终态 green + merge develop 679ac913），drift-mode fan-in
      不再被红挡住，AC88 验证机制可产出可核记录。

## Touches

- packages/quay/test/* + plugin/test/*（测试族）
- 对应实现（packages/quay/src/* 等，按归因）
- .github/workflows/ 或 scripts/test.sh（如属流程/基线问题）
- tasks/gap-suite-fix-red-baseline-2026-08-16.md（自身）

## Evidence（2026-08-16，workflow 完成）

- execute-suite-fix workflow `wf_7f65d20f-4ad`：**outcome=green**（scope=worktree，verifiedCommit=acdd0517，
  durationMs=1015041 ~17min 终轮）。68 agents / 590 tool uses / ~2.9h 总时。
- 真失败集（Fix agent 修复）：fan-in-workflow-check 指向 bug（mainRoot/QUAY_MAIN_CHECKOUT）、
  direct-to-develop-bypass-check（f9577da1 ruled-historical 分类）、referenced-not-landed 声明
  （SKILL.md + 核心文档）、full-suite-runner.test.mjs（283.8s）。
- 合并：fan-in merge develop `679ac913`（conflict-free），acdd0517 为 develop 祖先；
  direct-to-develop-bypass-check exit 0（merge 记 `merge:` reflog action 被设计跳过）；
  verify worktree 已 remove（分支 ref 保留）。worktree 内 build 的 tgz 经 develop-deliver-tgz.sh
  best-effort 投递 B/C（不阻塞 merge）。
- 前置发现：CPUQuota=400% 制造 CPU 饥饿假红（16 核机 4/16）已随 `da566a50` 修复；
  concurrency-literal-check 覆盖缺口另立案 `gap-concurrency-literal-check-workflows-coverage`。
