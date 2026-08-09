---
id: gap-ac19-two-line-model-actually-runs
title: AC19：两线模型机制已装但从未真正跑过——方向倒置（task fan-in 直合 develop 而非 integration）+
  integration 领先恒 0（fork_baseline 结构性不可观测）；让任务真正合 integration 制造领先窗口验证可分辨
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**AC19（人 2026-08-08「以分支策略跑起来为主」）：两线模型机制已装但从未真正跑过——方向倒置 + 结构性不可观测。立案：让任务真正走声明方向（fan-in 合 integration），制造 integration 领先 develop 的真实窗口，验证 fork_baseline 可分辨。**

### 实测（管理者正式发出 + 外层核实）

- config 声明 `fork_baseline: develop / merge_target: integration`（.quay/config.yml:116-117）；
- **缺口①（方向倒置）**：文档明确「fan-in 合到 `$MERGE_TARGET`（integration），不合并到 `$FORK_BASELINE`（develop）；`$FORK_BASELINE` 只由外层批量合推进」（fast-mode-loop-tick.md:400/414/426）——**机制正确，但内层 fan-in 没执行**：d6633082/b30d739e 等 task fan-in 直合 develop，再 develop→integration(FF)；
- **缺口②（结构性不可观测）**：integration 领先 develop 持续 = 0（当前 develop 领先 61），integration 从未真正接收 task 合并 → fork_baseline 的"分叉基线即依赖声明"机制携带零信息（拓扑从没让它起作用）。

### AC19 判据（已写入 orchestration/manager-phase-goal.md）

① 至少一次**真实合并走声明方向**（task → integration）；② 至少一次 **integration 领先 develop 的真实窗口**，且窗口内验证分叉基线可分辨；③ 不为凑数造空转任务、不为达成放宽分支模型判据。

### 管理者更正（2026-08-08 08:2x，任务从 done 退回 ready）

判据2 有两半，此前只验了前半（真实窗口），后半未达成：
- **判据2 后半原文**：「【且】该窗口内有新任务的分叉基线被验证过——声明依赖的任务从 integration 切、
  独立任务从 develop 切，两者的分叉点可被机械区分」。
- **实测后半未达成**：
  - 现存 9 个 task/* 分支，【每一个】对 develop 与 integration 的 merge-base 都相同 ⇒ 不可区分
    （gap-ac19 / gap-ac8-import / gap-chart2-s2 / gap-no-resource / gap-observer-registry /
    gap-probe-mechanism / gap-send-keys-verified / gap-shipped-ts / serial-recompose，mb_dev==mb_int 全同）；
  - 窗口期 07:38–08:08 的 reflog 内【零条】新建分支；
  - 连 ff469248 那条 fan-in 的分支头 640af5a8 也是从两者共同点切的。
  - **（2026-08-08 08:5x 判别式更正——上面这条 merge-base 判定被替换，见 AC3/Contract）**：
    merge-base 不等是必要非充分，「已合入 integration」同样满足；判「从 integration 切」须看分叉点
    （p=分支首个独立提交的父，integration 祖先 + 非 develop 祖先）。按更正判别式现存分支仍【无一满足】。
- ⇒ 判据1 成立、判据2 成立一半 ⇒ **AC19 整条未达成**，退回 ready。

**缺口（可执行）**：需要一次在 integration 领先 develop 的窗口内、从 integration 切出的
声明依赖型任务分支。制造方式归外层（判据原文：「怎么制造这个窗口、要不要主动排一个声明依赖的
任务去触发它 ＝ outer 的机制决定」）。**判据3 第一条同时约束：不得为凑窗口造空转任务。**

### 机制决定（外层）

**不改 config 方向**（声明正确——task 应合 integration、develop 只被批量合推进）。修复 = **内层 fan-in 严格遵守文档**：下一批任务合到 integration（MERGE_TARGET），形成 integration 领先 develop 的窗口，窗口内验证 fork_baseline 可分辨，再批量合回 develop。这是让已装机制真正跑起来，非新机制。

### 现状读数（管理者）

inner 面板 40→6 重合并卡在自己的 AC2（干净窗口全量绿）——最后一次无争议绿 02:50-03:02(718.2s)，之后几轮 red 是受控测量仪器噪声（node --test 全 fail 0），非真回归。

### 执行前读数（内层 2026-08-08，本任务开工时）

- `integration..develop` = 62（develop 领先 integration 62，方向倒置的直接读数）；
- `develop..integration` = 0（integration 从未领先，fork_baseline 不可观测）；
- `git merge-base --is-ancestor integration develop` → YES（integration 是 develop 的严格祖先）；
- 本任务 fan-in 目标 = **integration**（`.quay/config.yml:116-117` `fork_baseline: develop / merge_target: integration`）；
- 内层近期 task 提交（d6633082/b30d739e/b5de2467）直合 develop → 方向倒置的实锤（文档要求 fan-in 合 integration，执行没跟上）。

**本任务执行 = 纯 git 行为**（fan-in 合 integration + 批量合回），无代码改动；`plugin/loop/fast-mode-loop-tick.md:400/426-427` 已明文
「fan-in 合到 `$MERGE_TARGET`，不合并到 `$FORK_BASELINE`」「合回 integration，不直接合 develop」——文档正确，缺的是执行。

## Contract

measure integration_lead = `git rev-list --count develop..integration` stdout 数字段（制造窗口后应 > 0——integration 领先 develop 成立）
measure direction_ok = `git log --oneline integration -3 | grep -cE "task/|fan-in.*integration"` stdout 数字段（任务 fan-in 合 integration 后 ≥1）
measure integration_lead = `git rev-list --count develop..integration` stdout 数字段（制造窗口后应 > 0——integration 领先 develop 成立）
measure direction_ok = `git log --oneline integration -3 | grep -cE "task/|fan-in.*integration"` stdout 数字段（任务 fan-in 合 integration 后 ≥1）
measure fork_baseline_called = `grep -c "integration-branch-model.ts --fork-baseline" <内层派发会话 transcript>` stdout 数字段（≥1：每次派发都调用 fork-baseline 判定）
measure fork_baseline_not_always_false = `grep -c "overlaps-unverified \"\"" <内层派发会话 transcript>` stdout 数字段（**= 0**：不得恒传空串使 overlapsUnverifiedIntegration 恒 false）
band integration_lead = > 0 且 direction_ok = ≥1 且 fork_baseline_called = ≥1 且 fork_baseline_not_always_false = 0（每次派发实际调用判定 + 传入参数不得使任一判定路径恒为假）
invoke `bash scripts/test.sh --for-task gap-ac19-two-line-model-actually-runs 2>&1 | tail -3`
control 2026-08-08 人裁定改判据测法：判据2 后半从「必须出现一次从 integration 切的分支」改为 (i) 每次派发都实际调用 fork-baseline 判定且结果与配置一致 + (ii) 传入参数不得使任一判定路径恒为假。**实测缺口（manager 09:3x 定位，外层复核成立）**：dispatch 调用 `--overlaps-unverified ""`（空串，5 次），`integration-branch-model.ts:47` 的 `overlapsUnverifiedIntegration` 路径恒不生效——机制半死：被调用但参数使一条路径恒假。取值来源：`git log --oneline develop..integration` 里 fan-in 的未验证任务 id（脚本 :139 Contract invoke 正是这条命令）。批量合回 develop（integration 重新成为 develop 祖先）；不造空转任务、不放宽判据
resume 若中断，先跑 measure 读 integration 领先数 + 方向确认 + fork_baseline_called/not_always_false

## Acceptance Criteria

- [x] AC1: **方向修正**——内层 fan-in 合 integration（MERGE_TARGET），不再直合 develop；至少一次真实合并走声明方向
      **证据**：本任务 fan-in `git merge --no-ff task/gap-ac19-two-line-model-actually-runs` → integration
      （在 /tmp/quay-intg2 检出 integration 上执行），merge commit f35fb380「merge: fan-in
      task/gap-ac19... → integration (AC19: two-line model direction fix)」。方向走声明方向（task → integration），
      非直合 develop。
- [x] AC2: **integration 领先窗口**——integration 领先 develop > 0（真实窗口，非 0）
      **证据**：fan-in 后 `git rev-list --count develop..integration` = **2**（integration 领先 develop 2 提交），
      `git rev-list --count integration..develop` = 0（develop 无 integration 缺的提交），
      `git merge-base --is-ancestor integration develop` → **NO**（integration 不再是 develop 祖先，真实窗口）。
- [x] AC3: **fork-baseline 判定活着**——(i) 每次派发都实际调用 fork-baseline 判定且结果与配置一致；
      (ii) 传入参数不得使任一判定路径恒为假（2026-08-08 09:3x 人裁定改判据测法）
      **实测（manager 09:3x 定位，外层复核成立）**：dispatch 5 次调用 `integration-branch-model.ts
      --fork-baseline tasks/<id>.md --overlaps-unverified ""`——空串 ⇒ `integration-branch-model.ts:47`
      的 `overlapsUnverifiedIntegration` 分支恒不生效 ⇒ (ii) 不成立：机制半死（被调用但一条路径永远假）。
      **修法方向（归外层机制决定）**：调用方把 `--overlaps-unverified` 从空串改为
      `git log --oneline develop..integration` 里的 fan-in 未验证任务 id（脚本 :139 Contract invoke
      正是这条命令）；修后复测 `fork_baseline_called ≥1` + `fork_baseline_not_always_false = 0`。
      **旧判别式（08:5x 分叉点法）并入 (i) 的结果一致性**：从 integration 切的任务分支分叉点 =
      integration 祖先 + 非 develop 祖先，仍须成立，但不再作为唯一判据。
      **证据（2026-08-08 本任务执行，按更正判别式）**：
      **(i) 每次派发实际调用判定**：`fast-mode-loop-tick.md` 派发步改为机械命令（`--overlaps-unverified
      "$UNVERIFIED_IDS"`，见下）；本任务实测 corrected invocation 一次 → stdout `integration`
      （fork_baseline_called ≥1；该结果被 declaredDependency 假阳性主导——见「假阳性观察」，当前
      develop..integration 为空故 overlap 路径无贡献）。
      **(ii) 实参不再恒为空串**：派发步改为
      ```bash
      UNVERIFIED_IDS=$(node --experimental-strip-types plugin/scripts/unverified-integration-task-ids.ts --root "$(pwd)")
      node --no-warnings --experimental-strip-types plugin/scripts/integration-branch-model.ts --fork-baseline tasks/<id>.md --overlaps-unverified "$UNVERIFIED_IDS" --root "$(pwd)"
      ```
      ——literal 空串不再出现；未验证 id 由 helper 从 `git log --oneline develop..integration`
      机械提取（integration-branch-model.ts:139 Contract invoke），内层无需记忆。helper 行为：
      `unverified-integration-task-ids.ts` 跑该 git 命令、从 fan-in 合并信息提取 `task/<id>` / `gap-<id>`
      **（2026-08-08 10:3x 二次修正——取证看来源不看值）**：批量合后 integration 被清空 ⇒
      `git log develop..integration` 为空 ⇒ `UNVERIFIED_IDS` 合法等于空串——**此刻的空是正确的**。
      「写死 ""」与「计算得 ""」在派发那刻同形，故判据两条：(ii-a) 实参是计算表达式
      （`grep '"$UNVERIFIED_IDS"'` 且无字面 `""`）+ (ii-b) 该来源在 integration 非空时确实产出非空
      （下方 fixture 实测：integration 有未验证任务 ⇒ `UNVERIFIED_IDS=[gap-uv-live]` 非空）。
      模式（去重、校验 `tasks/<id>.md` 存在）、逗号分隔输出、无则空。**fixture 实测**：有未验证任务时
      `UNVERIFIED_IDS=[gap-uv-live]`，命令实参为 `"gap-uv-live"`（非空 ⇒ 空串 = 0 成立）。
      **overlap 路径 LIVE 证明（before/after 对照，同一候选 touches `plugin/loop/fast-mode-loop-tick.md`）**：
      ```text
      # 旧形态（机制半死）：literal 空串 → overlap 路径恒不触发
      $ node .../integration-branch-model.ts --fork-baseline tasks/candidate-overlap.md --overlaps-unverified "" --root <fixture>
      develop
      # 修正形态：真实未验证 id（helper 提取）→ overlap 路径触发
      $ node .../integration-branch-model.ts --fork-baseline tasks/candidate-overlap.md --overlaps-unverified "gap-uv-live" --root <fixture>
      integration
      # 独立候选（touches 不相交）→ 仍从 develop 分叉
      $ node .../integration-branch-model.ts --fork-baseline tasks/candidate-disjoint.md --overlaps-unverified "gap-uv-live" --root <fixture>
      develop
      ```
      **假阳性观察（记录，未修——正则按散文匹配依赖声明的已知局限）**：`declaredDependency` 正则
      （integration-branch-model.ts:192-193 `/depends_on|声明依赖|依赖前序|前序任务|先决/`）匹配本任务
      自身散文里的「声明依赖的任务从 integration 切」（tasks/gap-ac19...md 第 30/44 行）——对本任务返回
      `integration` 是假阳性；本任务实际独立（develop..integration 当前为空）。修复聚焦实参恒空串（本次）；
      正则假阳性属另一缺陷，非本次范围。
- [x] AC4: **批量合回**——窗口后批量合回 develop（integration 重新成为 develop 祖先）
      **证据**：`integration-batch-merge.sh --root /home/yale/work/quay --sync` → `integration-batch-merge: OK —
      develop fast-forwarded to integration`（ref-level FF，develop 从 c230780b → 6911d6d1），
      post-merge `git merge-base --is-ancestor integration develop` → **YES**（integration 重新成为 develop 祖先），
      `git rev-list --count develop..integration` = 0（窗口闭合）。sync-lag-check + periodic-push-backup 随
      land 顺带 push（develop → origin，641 unpushed → 0）。
- [x] AC5: **不凑数**——不造空转任务、不为达成放宽分支模型判据；40→6 AC2 全量绿后推进重合并
      **证据**：本任务即 AC19 载体（人裁定「以分支策略跑起来为主」），非空转——其工作 = fan-in 方向修正 +
      integration 领先窗口 + fork_baseline 可分辨验证 + 批量合回，全是真实 git 行为，无凑数任务；分支模型
      判据未放宽（同 AC19 判据 ③ 两条禁止：不为窗口造空转、不为达成放宽）。40→6 重合并仍卡 AC2 全量绿，
      待绿后推进（不因本 AC 达成而推进）。
      **scoped 验证（entry path 在场）**：`bash scripts/test.sh --for-task gap-ac19-two-line-model-actually-runs`

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（方向修正前后、integration 领先窗口、fork_baseline 可分辨验证、批量合回）——见各 AC 证据
      **注意**：AC1/AC2/AC4/AC5 的旧证据按更正判别式复核后仍成立（方向修正、窗口、批量合回、不凑数——
      这些与判别式无关）；**AC3 证据已按更正判别式重验**（作废状态解除）：修正后的机械命令 + overlap
      路径 live before/after 证明 + 假阳性观察记录，见 AC3 证据块
- [ ] 两线模型真正跑起来（任务合 integration → 批量合回 develop 的完整循环 ≥1 次 + 窗口内分叉基线可分辨
      ——按更正判别式：存在任务分支 p 为 integration 祖先且非 develop 祖先）
      **复核中**：AC3 机制修复已落地（overlap 路径不再半死）；integration 领先窗口的重验归外层下一轮
      （按 AC19 判据原文「怎么制造窗口、要不要排声明依赖任务触发它 = outer 的机制决定」）

## Touches
- tasks/gap-ac19-two-line-model-actually-runs.md（self——派发授权）
- 内层 fan-in 行为（任务合 integration 而非 develop——执行，非代码）
- plugin/loop/fast-mode-loop-tick.md（若需强化 fan-in 合 integration 的执行纪律）
- orchestration/manager-phase-goal.md（AC19 判据，交叉标注）
- plugin/scripts/unverified-integration-task-ids.ts（AC3 修复——new helper，机械提取未验证 id）
- plugin/test/unverified-integration-task-ids.test.mjs（AC3 测试——git-fixture 端到端）

## Dispatch review

reviewer: outer
at: 2026-08-08T05:0xZ
changed: AC19（人「以分支策略跑起来为主」）两条缺口核实：方向倒置（机制对、内层 fan-in 没执行——
  直合 develop 而非 integration）+ integration 领先恒 0（fork_baseline 不可观测）。机制决定：
  不改 config（声明正确），让内层按文档 fan-in 合 integration，制造 integration 领先窗口验证
  fork_baseline 可分辨。AC19 判据 ①②③ 见任务体。
