---
id: gap-ac259-reanchor-two-host-reverification-at-develop-version
title: AC-259 再锚定：两台真机按 develop 现版本（0.7.0-dev）重跑安装/重注册并重落 GOAL-018-AC-257/AC-258 载体记录
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-develop-version-union-missing-dev-suffix
goal_ac: AC-259
---
**type:** execution

## Finding

**缺口｜AC-259 本轮（2026-09-15T15:03Z）当场实测 fail，失败在【臂1】，而实质残留是【臂2】——臂2 在仓库里没有任何落点。**

当场读数（本机主检出直跑 store 自己的 runner，⛔ 不是台账尾）：

```
$ node packages/quay/bin/quay.js goal gate AC-259
verdict=fail（判据内部 exit 1；gate 命令本身 exit 0）
reason: "acceptance failed (exit 1) — AC-259: repo version mismatch (want 0.7.0-dev):
        [('packages/quay/package.json','0.7.0'), ('packages/quay-native/package.json','0.7.0'),
         ('packages/quay-github/package.json','0.7.0'), ('packages/quay-backlog/package.json','0.7.0'),
         ('.claude-plugin/marketplace.json','0.7.0'), ('plugin/.claude-plugin/marketplace.json','0.7.0'),
         ('plugin/.claude-plugin/plugin.json','0.7.0'), ('plugin/VERSION','0.7.0')]"

$ node packages/quay/bin/quay.js goal gate AC-257   → verdict=pass
$ node packages/quay/bin/quay.js goal gate AC-258   → verdict=pass
```

**判据两臂（正本 `goals/AC-259-版本一致性-仓库-8-处文本-两台真机安装读数均落到-0-7-0.md`）**：

- **臂1**：8 个版本承载文件（4× `packages/quay*/package.json` + 两处 `marketplace.json` + `plugin/.claude-plugin/plugin.json` + `plugin/VERSION`）字面 version == `0.7.0-dev`。**现在 8 条全为 `0.7.0`** ⇒ 这就是本轮 fail 的那一臂。
- **臂2**：载体 `.quay/productization-verification.jsonl` 中 `GOAL-018-AC-257` 与 `GOAL-018-AC-258` **各存在一条** `quay_version == "0.7.0-dev"` ∧ `task_status == "done"` 的记录。载体现有 173 行，那两条（line 158 / line 173）的 `quay_version` 都是 **`0.7.0`** ⇒ **臂1 一旦修好，臂2 立刻显形**，且臂2 是本任务真正要产出的东西。

**为什么上一轮的修复没有保持住（本任务存在的原因，逐字登记）**：AC-259 曾由 `gap-ac259-version-union-lockstep-and-host-install-readings`（**status=done**，`goal_ac: AC-259`）在 `want = "0.7.0"` 下真实满足过。**该字面量于 2026-09-15T14:54:07Z 被改写**——commit `e8a6adb94`（`goals/AC-259-…md`，`want: 0.7.0 → 0.7.0-dev`），改写者是 `gap-develop-version-union-missing-dev-suffix`（AC-272）的 **Requested action 第 7 条**。

**⇒ 这不是漂移，是有据的连带处置**：人 2026-09-15 逐条裁定 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.3 **选项 ii**——「develop 上的版本写作 `0.7.0-dev`；`release/vX.Y.Z` 上去掉 `-dev` 后缀；tag 打在去后缀的提交上」。AC-259 的 `want` 跟着新纪律走是对的。**但改写只处理了臂1**：那条任务自己逐字预判「本次 bump 之后它按构造读假，轮转会为它另立一条 `frozen-violated` 任务」，**本任务就是那条**；臂2 的残留被显式留给轮转，留在这里。

**臂2 的机制落点（读码，⛔ 非推测）**：

- 载体写入的唯一 choke point 是 `plugin/scripts/verify-deliver-coldstart.sh` 的 `ac_record_append`，经 `--ac89 <path>` 触发；`GOAL-018-AC-257` / `GOAL-018-AC-258` 两行**已登记**在该脚本的 `AC_RECORD_SCHEMA` 里，字段含 `quay_version:str`——**`str` 而非钉死字面量** ⇒ writer 结构上**能**写 `0.7.0-dev`，缺的是**一次真的把主机装成那个版本的运行**。
- ⛔ 手写 JSONL 不算（那正是 AC-259 的 `expect:` 逐字禁止的「只改文本」形态）；记录必须由该 writer 在**真机跑完之后**产出。

**依赖面的当场读数（本任务的前置，⛔ 不是本任务的工作）**：

```
$ git show origin/dist-plugin:VERSION          → 0.7.0-dev        （已发布）
$ git log -1 --format=%s origin/dist-plugin    → dist-plugin: build from 7b3b0cc
$ git show develop:plugin/VERSION              → 0.7.0            （并集尚未合入 develop）
$ git show HEAD:plugin/VERSION                 → 0.7.0            （author 亦未合入）
$ node packages/quay/bin/quay.js goal gate AC-272 → verdict=pass
$ git worktree list | grep dev-suffix
  /home/yale/work/quay-worktrees/gap-develop-version-union-missing-dev-suffix  7b3b0ccb9 [task/…]
```

⊢ `dist-plugin` 已由**未合入的任务分支** `7b3b0cc` 发布为 `0.7.0-dev`（AC-272 的判据只读 `dist-plugin:VERSION` ⇒ 已翻绿），**而并集改动仍在任务分支上**（`gap-develop-version-union-missing-dev-suffix` 现 status=ready）⇒ **臂1 由它落地，本任务 depends_on 它**。

**⚠️ 一条尚未结算的外生前提（决定本任务可行性，见 Requested action 第 2 步）**：SPEC §10 残留 1 —— **Claude Code marketplace 渠道是否接受预发布版本号（`0.7.0-dev`）尚未验证**；AC-272 的 AC7（一次真实 `/plugin install` 读回 `0.7.0-dev`）**仍未勾**。若该渠道**拒绝**预发布，则「把两台机器装成 `0.7.0-dev`」这件事**结构上不可满足** ⇒ 臂2 无解 ⇒ 正确的输出是**带原文上报要人裁定**，⛔ 不是伪造一条记录。

**⚠️ 环境前提（两台机共有，AC-257/AC-258 的建立者已各自登记过）**：`claude` 二进制在 ad-arm1 / orangevps 上**只在登录 shell 可见**（`bash -lc which claude` 有、非登录 shell 读到 `NO_CLAUDE`）⇒ 重跑时的所有 `claude` 调用必须走登录 shell，否则会误判为「该机没有 claude」。

**同族扫描（硬规则 5b：修好一个实例 ≠ 它只有那一个）**：全 store 里钉死版本字面量的 criterion 只有 AC-259 一条被改；AC-257/AC-258 的 criterion **仍钉 `quay_version != "0.7.0"`**，因此它们**当前 pass**（读的是既有记录）。⇒ 本次改写**没有**把同族的另两条一起带走；但**「两台机器装的是 `0.7.0`、develop 现在写 `0.7.0-dev`」是同一个物理事实**，本任务重跑之后落下的新记录会让三条判据同时处于一致状态。

<!-- dedup-ref -->
**与既有任务的关系（机制不同，故不是重复）**：

- `gap-ac259-version-union-lockstep-and-host-install-readings`（**done**，`goal_ac: AC-259`）—— 它在 `want="0.7.0"` 下满足了当时的判据；**它没有失败，是判据的字面量被后续裁定改掉了**。本任务不是它的重复，是**判据新字面量下的第一次真正达成**。
- `gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun`（done，AC-257）与 `gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`（done，AC-258）—— 它们各自产出了 `quay_version="0.7.0"` 的那两条记录，**判据仍读那个字面量**；本任务要在同一台机器上**再跑一次**并落下**新字面量**的记录（载体 append-only，旧记录保留 ⇒ 那两条判据不会因此转红，见 AC8）。
- `gap-develop-version-union-missing-dev-suffix`（ready，AC-272）—— 它管**滚动渠道自证非发布版**（判据读 `dist-plugin:VERSION`）；本任务管**两台真机的实际安装读数与该版本一致**。两者的共同前置是它先落地。
- `gap-verify-deliver-coldstart-marketplace-channel-unverified`（done，AC-168）—— 它管的是**通道接线**（marketplace 通道此前零跨主机接线）；本任务管的是**该通道上装到的版本读数**与仓库现行版本一致。机制不同。

## Requested action

0. **当场重取前置读数**（⛔ 不采信本任务正文的立案读数，会过期）：AC-259 / AC-257 / AC-258 / AC-272 四条 gate 读数、`git show HEAD:plugin/VERSION`、`git show origin/dist-plugin:VERSION`、`depends_on` 所指任务的当前 status。**若并集尚未合入（8 文件仍非 `0.7.0-dev`）⇒ 停并报告，⛔ 不代做 AC-272 的 bump。**

1. **前置边判定（机械，一个分支）**：确认 `depends_on` 任务 status=done 且 8 文件 == `0.7.0-dev`。不满足 ⇒ 记 `needs-human` 并写明阻断点，停。

2. **外生前提先结算（SPEC §10 残留 1，最便宜的决定性一步）**：用一次真实 `/plugin install`（或等价渠道命令）从 marketplace 拉到 **`0.7.0-dev`** 的产物，贴命令与原始输出（在登录 shell 下执行）。
   - **接受** ⇒ 继续第 3 步，并把该读数贴进 evidence（它同时结算 AC-272 的 AC7，但⛔ 不在本任务里勾那条任务的格子）。
   - **拒绝**（原文含 prerelease / version 之类措辞）⇒ **停**。把拒绝原文逐字落进任务体，写明「臂2 经插件渠道不可满足 ⇒ 本 AC 需人裁定（备选方向：把判据的比较对改成读仓库当前版本，或裁定两台机器保持发布版读数）」，记 `needs-human`。⛔ 不得用自报字符串或历史记录凑一条合格记录让判据翻绿——那是伪造。

3. **ad-arm1 / archguard 重跑（project scope）**：`ssh ad-arm1`，在登录 shell 下把 quay 装成 **`0.7.0-dev`** 的**持久**位置（路径 ⛔ 不含 `verify-|probe|/tmp/`），重跑 `quay-init`（**合并非空 `.claude/settings.json`** 的既有 Stop hook 语义），确认 `.quay/config.yml` 的 provider 绑定不指向探测目录，并**真的**驱动一条任务 `todo→ready→done`、留下**非记账**提交（按位置判定：至少一个改动文件不在 `tasks/`、`goals/`、`.quay/` 之下）。

4. **orangevps / meta-cc 重跑（user scope）**：`ssh orangevps`，在同一机器上把指向旧注册的 quay 键**删键**（⛔ 不是 disable —— disable 只置 false 不删键，判据会误判「已注册」）后重注册到 **`0.7.0-dev`** 的持久安装位置，重跑 `quay-init`，确认 `~/.claude/settings.json` 的**非 quay 键集逐字不变**，并**真的**驱动一条任务 `todo→ready→done` + 非记账提交。

5. **载体落账**：用 `plugin/scripts/verify-deliver-coldstart.sh` 的 `--ac89` 通道在两台上各落一条 `GOAL-018-AC-257` / `GOAL-018-AC-258` 记录：`quay_version` == **`0.7.0-dev`**、`task_status == "done"`、`commit_sha` 非空、`produced_by_driver is True`、`merge_preserved is True`、`quay_init_rerun is True`。⛔ 手写 JSONL / 手改文件不算。

6. **判据复跑**：把 AC-259 的 criterion **原样**跑两次——落账**前**（须 exit 1，并指明落在 `repo version mismatch` 还是 `missing qualifying … record` 分支）与落账**后**（须 exit 0）；两次 exit code 与 stderr 都贴。用 `node packages/quay/bin/quay.js goal gate AC-259`。

7. **同族不回归**：复跑 AC-257 / AC-258 的 gate，须仍 **pass**（载体 append-only ⇒ 旧 `0.7.0` 记录仍在）。两条都贴。

> ⚠️ **不要改判据去凑读数**：AC-259 的 `want` 是被 人 2026-09-15 的 SPEC §4.3 裁定钉到 `-dev` 的，⛔ 不许为了让它变绿而把它改回去。唯一例外是第 2 步的拒绝分支——那要**人裁定**，不是本任务自行改判据。

## Acceptance Criteria

- [x] **AC1 前置读数当场重取**：贴 Requested action 第 0 步的七条原始输出，并显式写出 `depends_on` 任务 status 与 8 文件的逐条字面值。⛔ 不引用立案基线。
- [x] **AC2 外生前提已结算（SPEC §10 残留 1）**：贴一次真实 `/plugin install`（或等价渠道命令）拉 `0.7.0-dev` 的命令与**原始输出**。接受 ⇒ 进入 AC3；**拒绝 ⇒ 贴拒绝原文并记 `needs-human`，AC3–AC9 明确标注为「被外生前提阻断、未执行」**（⛔ 不得静默跳过、⛔ 不得以模糊措辞结案）。
- [x] **AC3 臂1 已成立（依赖面，非本任务所改）**：8 个版本承载文件逐条字面值 == `0.7.0-dev`，贴命令与输出；并贴 `git show HEAD:plugin/VERSION` 证明是**已提交**状态。
- [x] **AC4 ad-arm1 真机重跑**：贴 ① 该机**实际安装读数**（`plugin/VERSION` 或 `installed_plugins.json` 里该条的 `version`，⛔ 不是自报字符串）② `quay-init` 重跑命令与退出码 ③ 重跑前后 `.claude/settings.json` 的 `hooks.Stop` 段 md5（须逐字相同）④ `enabledPlugins` 出现 quay 键 ⑤ 任务 id + 状态翻转提交 sha + **实现提交** sha（非记账）⑥ `.quay/config.yml` 的 `grep -nE 'verify-|probe|/tmp/'` 归零。所有 `claude` 调用标注为登录 shell。
- [x] **AC5 orangevps 真机重跑**：贴 ① `installed_plugins.json` 中 `quay@quay` 那条 `scope:"user"` 原文（须 `version == "0.7.0-dev"`、`installPath` 不含探测模式）② `known_marketplaces.json.quay.source.path` 原文 ③ 重注册前后 `~/.claude/settings.json` **非 quay 键集逐字比对**（须相同）④ `quay-init` 重跑命令与退出码 ⑤ 任务 id + 翻转提交 sha + 实现提交 sha（非记账）。
- [x] **AC6 载体落账（经 writer，非手写）**：贴 `.quay/productization-verification.jsonl` 里两条新记录的**原样输出**，并对每条做一张 `谓词 → 实际值 → 满足?` 表（`ac` / `quay_version` / `task_status` 三项是 AC-259 臂2 逐字读的，须逐条列出）；另贴 `grep -c 'GOAL-018-AC-257' plugin/scripts/verify-deliver-coldstart.sh` ≥1 与 `--ac-record-schema-report` 对应行的原样输出（硬规则 ②：引用计数前先打印前 3 条命中）。
- [x] **AC7 判据复跑（两向）**：AC-259 criterion 落账前 exit 1 / 落账后 exit 0，两次 exit code 与 stderr 都贴，并指明落账前那次落在哪个失败分支。⛔ 只贴绿读数不算（一条恒绿判据与「合格」同形，硬规则 3b/4）。
- [x] **AC8 同族不回归**：AC-257 / AC-258 的 gate 各贴一条读数，须仍为 pass（证明 append-only 没有把旧记录挤掉）。
- [x] **AC9 负控制（臂2 判据能取假）**：在**临时副本**上构造一条 `quay_version="0.7.0"`（不带后缀）的 `GOAL-018-AC-257` 记录、且副本内不存在任何 `-dev` 记录 ⇒ AC-259 的判据在副本上须 exit 1 且落在 `missing qualifying … record`；补一条 `-dev` 记录 ⇒ exit 0。两次读数都贴（⛔ 不动真实载体）。
- [x] **AC10 承接纪律**：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## Definition of Done

**REAL LANDING 的判据是「两台机器上的对象真的被换成了 `0.7.0-dev` 并被驱动跑过一条真任务」，不是「载体里多了一行 JSON」**（DIR-026 Reading A）：

- ad-arm1 与 orangevps 上**各自**真的安装/重注册到了 `0.7.0-dev` 的持久位置，且该读数取自**机器本身**（`installed_plugins.json` / `plugin/VERSION`），**与记录字段逐台交叉核对一致**（AC4 / AC5）——⛔ 自报字符串不算；
- 两台**各自**真的有一条任务被自己的 driver 驱动到 `done` 并留下**非记账**提交（AC4 / AC5 的实现提交 sha）；
- 载体里**真的**多出两条经 `--ac89` writer 写入的 `GOAL-018-AC-257` / `GOAL-018-AC-258` 记录，`quay_version == "0.7.0-dev"` ∧ `task_status == "done"`（AC6）；
- AC-259 判据由 **exit 1 翻到 exit 0**，前后两次读数都在（AC7）；
- 判据**能取假**由 AC9 的负控制证明，⛔ 只贴一次 exit 0 的绿读数不算；
- 外生前提（渠道是否接受预发布）**已结算或已带原文上报**（AC2），⛔ 不静默。

⛔ 只改仓库文本、只在本机隔离副本里跑、或用历史记录 / 自报字段凑一条记录让判据翻绿，都不算 —— 本 AC 的被测对象是**那两台机器上的实际安装读数**（`expect:` 逐字：把「版本已 bump」锚在真实安装点，不是只锚在一次文本替换）。

## Touches

- tasks/gap-ac259-reanchor-two-host-reverification-at-develop-version.md
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- goals/AC-259-版本一致性-仓库-8-处文本-两台真机安装读数均落到-0-7-0.md

⛔ 不声明版本承载文件（`packages/*/package.json`、`plugin/VERSION` 等）——那 8 处的 bump 由 `depends_on` 的 AC-272 任务落地，本任务**只读它们**。若第 1 步发现并集未合入 ⇒ 停，不改。

## Result

**Disposition:** arm 1 of the AC-259 criterion was **already satisfied** on arrival (the AC-272 version union
had landed on develop: all 8 carriers read `0.7.0-dev`), so the remaining object was **arm 2** — the two
per-host `quay_version="0.7.0-dev"` carrier records. Both were produced by **real runs on both hosts**
(install → quay-init rerun → a task genuinely driven `todo→ready→done` by the target project's own drivers
→ record written on the host by the writer, then transported into the carrier).

Raw evidence bundle: `.quay/ac259-evidence/` (index in `README-evidence-index.md`).

### AC1 — step-0 prerequisites re-taken on the spot

`quay goal gate AC-259` → `fail`, reason `acceptance failed (exit 1) — AC-259: missing qualifying
quay_version=0.7.0-dev done-record for ['GOAL-018-AC-257', 'GOAL-018-AC-258']` — i.e. the failure is in
**arm 2**, not `repo version mismatch`. AC-257 / AC-258 / AC-272 all `pass`.
`git show HEAD:plugin/VERSION` = `0.7.0-dev`; `origin/dist-plugin:VERSION` = `0.7.0-dev`
(`origin/dist-plugin` = `1e9c65114d2f33a8758089e6ce4c9261ba92bb75` — "dist-plugin: build from 7b3b0cc");
`develop:plugin/VERSION` = `0.7.0-dev`. `depends_on` task
`gap-develop-version-union-missing-dev-suffix` = **done**. All 8 carriers literal `0.7.0-dev`
(4 × `packages/quay*/package.json`, both `marketplace.json` `plugins[0].version`,
`plugin/.claude-plugin/plugin.json`, `plugin/VERSION`). Raw: `ac1-ac3-prereq-readings.txt`.

### AC2 — the channel ACCEPTS the prerelease (so the step-2 rejection branch does not fire)

Isolated `HOME`, real `dist-plugin` content:

```
$ claude plugin validate <dist-plugin-src>   → ✔ Validation passed
$ claude plugin marketplace add <dist-plugin-src>  → ✔ Successfully added marketplace: quay
$ claude plugin install quay@quay            → ✔ Successfully installed plugin: quay@quay (scope: user)
```

and it records the prerelease verbatim:
`"installPath": ".../plugins/cache/quay/quay/0.7.0-dev", "version": "0.7.0-dev",
"gitCommitSha": "1e9c65114d2f33a8758089e6ce4c9261ba92bb75"`. Raw: `step2-probe.txt`.

### AC3 — arm 1 holds (dependency side; ⛔ not changed by this task)

See the AC1 table plus `git show HEAD:plugin/VERSION` → `0.7.0-dev` (committed).

### AC4 — ad-arm1 / archguard real rerun (project scope)

* ① **actual install reading**: `/home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin/VERSION`
  → `0.7.0-dev` (read from the delivered artifact, ⛔ not self-reported).
* ② `quay-init` rerun: `[⑨d] quay-init --force rc=0 (rerun=true)`.
* ③ `hooks.Stop` **verbatim identical** before/after: `[⑨c] md5=e5255b86660f` → `[⑨e] md5=e5255b86660f
  verbatim-preserved=1`.
* ④ `enabledPlugins` gained the key: `[⑨e] enabledPlugins={"quay@quay":true} gained-quay-key=1`;
  project settings confirm `1`.
* ⑤ task `TASK-AC259-ARCHGUARD-SMALLDEFECT` created **by this run** (`[⑨h2] task created`), driven to
  `status: done`; done-flip commit `d5edeb4b`; **implementation commit**
  `ef48077ae710d52cf51961886cd7756e7a05806d` — `fix(check): feed real relations to no-dependency fitness
  rules`, files `src/cli/commands/check.ts`, `src/cli/utils/cluster-archjson-loader.ts`,
  `tests/unit/cli/commands/check.test.ts` (non-accounting, 3 files).
* ⑥ `.quay/config.yml` `grep -nE 'verify-|probe|/tmp/'` → **zero hits**; provider bound to
  `/home/yale/.local/opt/quay/0.7.0-dev/.../vendor/quay-native`.
* All `claude` invocations ran under a **login shell** (`ssh <host> "bash -ls"`). Raw: `ac4-ad-arm1-after.txt`.

### AC5 — orangevps / meta-cc real rerun (user scope)

* ① `installed_plugins.json`, `scope:"user"` entry verbatim: `{"scope": "user", "installPath":
  "/home/yale/.claude/plugins/cache/quay/quay/0.7.0-dev", "version": "0.7.0-dev", "installedAt":
  "2026-09-15T16:27:32.465Z", ...}` — version `0.7.0-dev`, installPath non-probe.
* ② `known_marketplaces.json.quay.source.path` = `/home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin`.
* ③ non-quay keyset of `~/.claude/settings.json` **verbatim identical**: `[⑩f] ①non-quay keyset
  verbatim-preserved=1 (before md5=577be3d80ee2 after md5=577be3d80ee2)`.
* ④ `quay-init` rerun `[⑩g] rc=0 (rerun=true)`.
* ⑤ task `FIX-AC259-SMALLDEFECT` created **by this run** (`[⑩i2] task created`), poll finished
  `task_status=done`; done-flip commit `36cfc0d`; **implementation commit**
  `48ad935bb1ccf4d2dc370684e2f15401285bdbd1` — `fix(docs): gate every top-level page, correct
  CONTRIBUTING.md Go prerequisite`, files `CONTRIBUTING.md`, `internal/release/doc_contract_test.go`
  (non-accounting). `gate_events_task=1`, `produced_by_driver=1`.
* Also: `[⑩f] ②quay replaced probe→persistent=1` — the fixture was reset to its documented probe-path
  start state before the run. Raw: `ac5-orangevps-after.txt`.

### AC6 — carrier records, via the writer

Both records are in `.quay/productization-verification.jsonl` (carrier grew 181 → 183 lines) and were
produced **on the host** by `ac_record_append` through `--ac89`; they were transported back with the
delivery script's own `transport_evidence_append` (`appended=1`, ⛔ no hand-written JSONL). The two new
lines, verbatim, are in `ac6-carrier-records.txt`, together with the `谓词 → 实际值` tables. The three
fields arm 2 reads:

| ac | quay_version | task_status |
|---|---|---|
| GOAL-018-AC-257 (new, line 183) | `0.7.0-dev` | `done` |
| GOAL-018-AC-258 (new, line 182) | `0.7.0-dev` | `done` |

Supporting: `grep -c 'GOAL-018-AC-257' plugin/scripts/verify-deliver-coldstart.sh` → `5`
(first 3 hits printed in `ac6-schema-support.txt`, per 硬规则 ②), `grep -c 'GOAL-018-AC-258'` → `3`; and
`--ac-record-schema-report` prints `GOAL-018-AC-257 [ok] criterion=11 schema=11 writer=11` and
`GOAL-018-AC-258 [ok] criterion=11 schema=11 writer=11`.

### AC7 — the criterion read BOTH ways

* before (2026-09-15T16:25:23Z, from the repo root): `verdict=fail`, **EXIT 1**,
  `reason=… missing qualifying quay_version=0.7.0-dev done-record for ['GOAL-018-AC-257', 'GOAL-018-AC-258']`
  — i.e. the failing branch is **`missing qualifying … record`**, NOT `repo version mismatch`
  (arm 1 was already true).
* after both records landed (2026-09-15T17:39:50Z): `verdict=pass`, **EXIT 0**.
* intermediate reading (AC-258 landed, AC-257 not) also taken: `fail`, `missing … ['GOAL-018-AC-257']` —
  the predicate is monotone in the records, not stuck-green.
Both raw readings: `ac7-criterion-before-after.txt`.

### AC8 — siblings do not regress

`quay goal gate AC-257` → `pass`; `quay goal gate AC-258` → `pass` (after the new records were appended —
the carrier is append-only, so the older `quay_version="0.7.0"` records those two criteria literally
require are still present).

### AC9 — negative control: arm 2 takes FALSE

On a **temp copy** (`/tmp/ac259-ac9`: the real goal file + the 8 carriers at `0.7.0-dev` + a constructed
carrier), run as `quay goal gate AC-259 --root /tmp/ac259-ac9` (store dialect, real carrier untouched):

| test | carrier | verdict | exit | branch |
|---|---|---|---|---|
| 1 | only `quay_version="0.7.0"` records for both ac | fail | **1** | `missing qualifying … record` |
| 2 | + one `0.7.0-dev` record per ac | pass | **0** | — |

Raw: `ac9-negative-control.txt`.

### AC10 — mechanism defects found on the way

1. **`gap-ac257-verify-leg-misses-declared-worker-env`** — the `--verify-ac257` transport leg does not ship
   the declared worker env (`$(ac258_worker_env_export)`), although both legs share
   `step_ac257_project_scope`, whose first action is `ac258_worker_preflight`. Consequence measured on
   ad-arm1: the leg's own remote run prints
   `[⑨0] worker preflight: AC258-PREFLIGHT credentials probe exited 1` and aborts
   `AC257-NOT-EVALUATED` before any destructive step, while the local preflight (which does read the
   declared probe cmd) passes — a same-machine, same-predicate two-direction reading
   (`ac10-mechanism-gap.txt`). The AC-257 drive was therefore done by invoking the **same** remote
   verification script directly on the host with the declared env in the login shell (which is what
   Requested action step 3 literally prescribes), and transporting its evidence back.
   **Status: this gap was fixed on develop during this session** — `develop-deliver-tgz.sh:2251` now
   carries `$(ac258_worker_env_export)` in the AC-257 heredoc.
2. **`gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall`** — ad-arm1's **user-level**
   `~/.claude/settings.json` carried `enabledPlugins["quay@quay"]`, so `write_ac257_record` refused the
   AC-257 record (`AC161-USER-SCOPE: … record refused … present:quay@quay`) even though the whole run had
   genuinely succeeded. The record was obtained after removing exactly that one key (keeping the
   marketplace source the AC-161 doctrine wants at the user level) and re-running the write
   (`ac161-depollution.txt`). **The writer of that key is NOT identified**: my first attribution (the
   delivery pipeline's own npm postinstall) was **refuted by a control I then ran** — two sandbox-HOME
   postinstall runs, with and without the declared endpoint env and with `claude` on PATH, wrote only
   `extraKnownMarketplaces.quay` and never an `enabledPlugins` key (`ac161-attribution-control.txt`). The
   filed task's body was corrected to carry the refutation and the open question rather than the wrong
   cause.

No other blocking defects were found. Two incidental observations, not filed because neither blocks this
AC: (a) both target hosts' Claude Code OAuth is dead (`accessToken`/`refreshToken` empty, `expiresAt=0`),
so the human-authorized FJDAC endpoint is the only login face there; (b) my first manual AC-257 attempt
passed a 12-char `--build-sha`, which `ac_record_append` refuses (40-hex required) — a property of my
throwaway runner, not of the product.