---
id: gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev
title: AC-259 台账恒假的收口：判据钉在 0.7.0（-dev）这个周期字面量上，而 SPEC §4.3 的发布切版已把仓库推到 0.7.1 ⇒
  结构上永不可再为真；同一次切版还把 develop 留在无 -dev 后缀的已发布版本号上（§4.3 ⛔ 明令禁止，无闸门拦）
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-259
---
**type:** execution

## Touches
- goals/AC-259-版本一致性-仓库-8-处文本-两台真机安装读数均落到-0-7-0.md
- packages/quay/package.json
- packages/quay-native/package.json
- packages/quay-github/package.json
- packages/quay-backlog/package.json
- .claude-plugin/marketplace.json
- plugin/.claude-plugin/marketplace.json
- plugin/.claude-plugin/plugin.json
- plugin/VERSION
- plugin/README.md
- plugin/vendor/quay/package.json
- delivery-manifest.json
- package-lock.json
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev.md

## Finding

**① 本轮当场直接量 = 假（2026-09-16，主检出 `/home/yale/work/quay`，逐字跑判据，⛔ 不是台账尾）**

- 把 criterion 从 `goals/AC-259-…md` 抽出直接跑 → `exit 1`，stderr 逐字：
  `AC-259: repo version mismatch (want 0.7.0-dev): [('packages/quay/package.json', '0.7.1'), ('packages/quay-native/package.json', '0.7.1'), ('packages/quay-github/package.json', '0.7.1'), ('packages/quay-backlog/package.json', '0.7.1'), ('.claude-plugin/marketplace.json', '0.7.1'), ('plugin/.claude-plugin/marketplace.json', '0.7.1'), ('plugin/.claude-plugin/plugin.json', '0.7.1'), ('plugin/VERSION', '0.7.1')]`
- 台账同读数：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass` → `{frozenScope: 92, evaluated: true, failing: ["AC-259"], staleUnverified: [], notEvaluated: []}`，exit 1 —— **92 条冻结 AC 里只有它一条为假**。

**② 两个臂必须分开测：只有臂1 假，臂2 是好的**

- 臂1（仓库 8 处文本字面 version == `0.7.0-dev`）= **假**，8/8 全是 `0.7.1`。
- 臂2（载体 `.quay/productization-verification.jsonl` 中 `GOAL-018-AC-257` / `GOAL-018-AC-258` 各一条 `quay_version=="0.7.0-dev"` ∧ `task_status=="done"`）= **真**，逐行：`:182` AC-258 host=orangevps install_scope=user ts=2026-09-15T16:27:15Z；`:183` AC-257 host=ad-arm1 install_scope=project ts=2026-09-15T17:34:56Z；`:184` 同一 ac 重落 ts=2026-09-15T17:55:43Z。
- ⇒ **两台真机的真实安装读数早就落地了；本条缺的从来不是它们。**

**③ 为什么之前四次修复没有 hold（本条不是重复立案）**

`tasks/gap-ac259-reanchor-two-host-reverification-at-develop-version.md`、`gap-ac259-version-union-lockstep-and-host-install-readings.md`、`gap-ac259-frozen-reading-stale-staging-kernel.md`、`gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck.md` **四条全部 status=done，四条都留下了当场跑判据为真的读数**——它们**当时确实为真**（仓库在 `0.7.0-dev`）。它们失守不是因为修错了，而是因为**判据本身钉在一个会过期的字面量上**：`8f2896500` 把版本并集推到 `0.7.0-dev` → 人裁定的发布切版 `660abbf7c`/`5fdb3e646`（v0.7.0）与 `eb17c4ac1`（v0.7.1）**按 SPEC §4.3 去掉 `-dev` 后缀** ⇒ 仓库文本变成 `0.7.1`，判据要的却仍是 `0.7.0-dev`。**每次发布切版都会让它再假一次。**

**④ 根因：AC-259 是「周期记录」，不是「常驻不变式」——两处把它钉死在 GOAL-018 周期上**

1. 臂1 钉字面量 `0.7.0-dev`（**AC-105 / 硬规则 4c**：判据不得引用生命周期短于判据本身的对象——版本字面量的寿命 = 一个发布周期，判据的寿命 = 台账里的一条记录）。
2. 臂2 钉 `GOAL-018-AC-257` / `GOAL-018-AC-258` 这两个 **GOAL-018 专属的兄弟 AC id**，而 `GOAL-018` 的 `status: achieved`，早已关闭。

⇒ 两处合起来使它**结构上不可能再为真**：任何「把它修绿」的动作都只能把版本改回 `0.7.0-dev`，而这会与已锚定的 `v0.7.1` tag（`eb17c4ac1`，同时含于 `develop` 与 `author`）以及 SPEC §4.3 直接冲突——那是**倒退**，不是修复。⇒ 合法终态只能是 `superseded`。

**⑤ 下游受害者：AC-242 的判据就是这条读数（同一根）**

`quay goal check --achieved-failing` → `{achievedButFailing: ["AC-242"], evaluated: true, scopeSize: 28}`。AC-242 的 criterion 逐字是 `goal-store.ts check --stale-pass` ⇒ **AC-259 一天不为真，AC-242 就一天不可能绿**（这正是 AC-242 立条时要防的形态，只是这次拖住它的是另一条被冻住的失败）。

**⑥ 不降覆盖：存续保证的活体承接者必须被枚举证明，而不是断言**

`scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES` 实测 **11 条**，与 AC-259 臂1 的 8 个文件求交 = **8/8（缺 0）**；多出 `plugin/README.md`、`plugin/vendor/quay/package.json`、`delivery-manifest.json`，并额外断言 **all-or-none**（半带后缀 = 漂移 = 红）⇒ **严格强于臂1**。该 checker 已接进静态门，且有突变夹具 `plugin/scripts/checker-mutation-cases/version-consistency-check.sh`（`plugin/test/checker-mutation-check.test.mjs` 覆盖）⇒ 它是**能取假**的闸，不是恒绿检查器。

**⑦ 同一次切版留下一个真人裁定过的 ⛔ 违反，且没有任何闸门拦**

`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.3（人 2026-09-15 裁定，选项 ii）逐字：develop 常态 = `X.Y.Z-dev`，且**「⛔ 不要让 develop 停留在无后缀的已发布版本号上，否则 §2.5 的歧义原样复发，只是方向相反」**。实测 `git show develop:packages/quay/package.json` → `"version": "0.7.1"`（**无后缀**），`eb17c4ac1` 同时含于 `develop`/`author` ⇒ **违反成立**；而 `VERSION_ENTRIES` 的判定是 all-or-none，**裸值照样绿** ⇒ 这条裁定没有任何执行者（硬规则 9：可见性 ≠ 执行）。它是 AC-259 臂1 所断言保证的**活体形态**（「仓库文本自称的是一个 `-dev` 开发版」）⇒ 收口 AC-259 不能把它留在原地不管。

## AC

- [x] **AC1｜终态 = `superseded`，且理由写进记录本体（⛔ 不是只在任务里说）**：`goals/AC-259-….md` 的 `status:` == `superseded`，`statusLog` 末条 `to: superseded`，其 `reason` **逐字含三项**：(i) 臂1 钉字面量 `0.7.0-dev`（AC-105：判据不得引用生命周期短于判据本身的对象）；(ii) 臂2 的 `GOAL-018-AC-257/258` 是已关闭 GOAL-018 的周期专属 id；(iii) 承接者 = `scripts/version-consistency-check.ts`（11 条 ⊇ 8、all-or-none、有突变夹具）+ GOAL-020 的 AC-270/271/272。核法：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts show AC-259 --json` 读出 `status` 与末条 `statusLog[].reason`。**只改 status 不写 reason ⇒ 红**（判据读 reason 文本，不是只读 status）。写入必须经 **goal store 本身**（`goal-store.ts write AC-259 --status superseded --reason "…"`），⛔ 不得手改 `goals/AC-259-*.md` 绕过 store。
  - 取证：`goal-store.ts get AC-259 --json` → `status: superseded`；末条 `statusLog` = `{from: achieved, to: superseded, actor: worker:gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev}`，其 `reason` 逐字含三项（16 个探针全部 OK：`0.7.0-dev` / `AC-105` / `生命周期短于判据本身` / `GOAL-018-AC-257` / `GOAL-018-AC-258` / `已 status: achieved 关闭` / `周期专属` / `version-consistency-check.ts` / `11 条` / `8/8` / `all-or-none` / `突变夹具` / `GOAL-020` / `AC-270` / `AC-271` / `AC-272`）。⚠️ 本条正文点名的 `goal-store.ts show` 子命令**不存在**（CLI 只认 `list|get|write|batch|gate|check`，`show` 报 unknown subcommand）⇒ 读回用等价的 `get AC-259 --json`；AC 的**意图**（读出 status 与末条 statusLog 的 reason 文本）被完整满足。写入经 goal store 本身：`git log` ⇒ `d522a09d0 goals: AC-259 status achieved→superseded by cli:1858128`，⛔ 未手改 `goals/AC-259-*.md`。`git diff e440e8f61..HEAD -- goals/AC-259-*.md` = 10 insertions / 1 deletion，逐行看只有 `status: achieved→superseded` 一行 + 一条 statusLog 条目 ⇒ **criterion 文本逐字未变**（DoD 的 ⛔ 未触犯）。
- [x] **AC2｜先证不降覆盖，再允许 supersede（fail-closed）**：产出 `VERSION_ENTRIES` 路径集与 AC-259 8 文件清单的**求交读数 = 8/8，缺 0**，附条目总数（实测 11）、`scripts/version-consistency-check.ts` 的一次实跑（`All 11 files carry version …` + exit 0）、突变夹具路径的存在性。**若求交 < 8/8 ⇒ 不得 supersede**：改为把缺口文件清单逐条写进任务体并停在 `needs-human`（硬规则 3b：读不出合格态时不许给出与合格同形的输出）。
  - 取证（机械求交，⛔ 非手数）：从 `scripts/version-consistency-check.ts` 抽出 `VERSION_ENTRIES` = **11** 条（逐条打印过）；从 AC-259 criterion 正文的 `files = [...]` 抽出臂1 清单 = **8** 条；**求交 = 8/8，缺 0**（`missing list: (none)`）；VERSION_ENTRIES 额外多出 3 条：`delivery-manifest.json`、`plugin/README.md`、`plugin/vendor/quay/package.json`。checker 实跑：`All 11 files carry version 0.8.0-dev`、**exit 0**。突变夹具存在：`plugin/scripts/checker-mutation-cases/version-consistency-check.sh`（6795 字节，可执行）。⚠️ 诚实边界（硬规则 4）：checker 自己的注释说明 `all-or-none`（`suffixPolicyOf`/`isPrereleaseVersion`）在**当前精确串比对**下与 `drift` 冗余（`mixed ⇒ drift`，它自己写明「does not add a second independent gate TODAY」）⇒ 它不是今天的第二个独立闸；它强于臂1 的是**覆盖集**（11 ⊇ 8，且多出的 3 条正是臂1 漏掉的面）与「将来若有人把比对放宽为前缀相等时仍拦半带」的结构守卫。求交 = 8/8 ⇒ 未触发 fail-closed 分支（⛔ 未停在 needs-human）。
- [x] **AC3｜臂2 的存续面被点名（⛔ 不许 supersede 了事）**：逐条给出行号 + host + install_scope + quay_version + task_status + ts 的载体读数（`:182`/`:183`/`:184`），并点出周期外的存续面（`GOAL-020/AC-264` 真机部署 + `AC-270`/`AC-271`/`AC-272` 发布渠道版本不变式）。
  - 取证（载体 `.quay/productization-verification.jsonl`，逐行 JSON，🔴 该载体是 gitignored 的 workspace-local 产物，只在生产检出 `/home/yale/work/quay` 上存在）：`:182` `{ac: GOAL-018-AC-258, host: orangevps, install_scope: user, quay_version: 0.7.0-dev, task_status: done, ts: 2026-09-15T16:27:15Z}`；`:183` `{ac: GOAL-018-AC-257, host: ad-arm1, install_scope: project, quay_version: 0.7.0-dev, task_status: done, ts: 2026-09-15T17:34:56Z}`；`:184` 同一 ac 重落 `{ac: GOAL-018-AC-257, host: ad-arm1, install_scope: project, quay_version: 0.7.0-dev, task_status: done, ts: 2026-09-15T17:55:43Z}`。⇒ 两台真机的真实安装读数**早已落地**（本条缺的从来不是它们）。**周期外的存续面（⛔ 不是 supersede 了事）**：`GOAL-020/AC-264`（quay-fleet 以 project-scope marketplace 渠道真实部署 + driver 驱一条真任务）、`AC-270`（master 值域不变式）、`AC-271`（release 分支合回即删 / tip 逐字停在同名 tag）、`AC-272`（滚动渠道 marketplace/dist-plugin 自证版本带 `-dev`）——实测四条**全部留在** `check --achieved-failing` 的 `inScope`(28) 内，未随本条的 supersede 离开复验域。
- [x] **AC4｜§4.3 现行违反：先取读数再动，三态可区分（硬规则 3b）**：① 取读数 `git show develop:packages/quay/package.json` 的 version + `version-consistency-check.ts` 实跑；② 若仍无 `-dev` 后缀**且**无在飞切版（判据：不存在 tip 未逐字停在同名 tag 上的 `release/*` 分支），把 lockstep 并集（11 条 `VERSION_ENTRIES` + `package-lock.json` 中 `packages/quay{,-native,-github,-backlog}` 4 条）齐步推到下一个 `-dev` 值并**提交**，记录选值与 §4.3 依据，改后实跑 checker 得 `All N files carry version <new>` 且 exit 0；③ 若读数显示已带 `-dev`、或切版在飞 ⇒ 记 **`deferred` + 依据 + 归属 GOAL-020**。⛔ 三种取值不得共用同一个输出词。⛔ 全程不动 `v0.7.1` tag、不碰任何 `release/*` 分支、不重打 tag。
  - 取证 ①（先取读数，再动）：`git show develop:packages/quay/package.json` → `"version": "0.7.1"`（**无 `-dev` 后缀** ⇒ §4.3 违反成立）；`scripts/version-consistency-check.ts` 实跑 → `All 11 files carry version 0.7.1`、exit 0（**裸值照样绿** ⇒ 这条裁定此前没有任何执行者，硬规则 9）。附加实测漂移：`package-lock.json` 的 4 条 workspace 条目停在 `0.7.0-dev`（:2541 / :2560 / :2571 / :2582）⇒ 与 package.json 早已不一致。切版在飞判据（AC4 ② 的前置）：`git for-each-ref` 实测**无任何 `release/*` 分支**（本地与远端均无）⇒ **走 ②**。
  - 取证 ②（bump 并提交）：并集 = `VERSION_ENTRIES` 11 条 + `package-lock.json` 4 条 = **15 条**，齐步推到 **`0.8.0-dev`**。**选值依据（SPEC §4.3 逐字）**：落实口径表「合回 develop 之后 | `0.8.0-dev` | 下一轮开发立即带上新的 `-dev`（⛔ 不要让 develop 停留在无后缀的已发布版本号上）」；最新已发布 = v0.7.1（tag `ba9bc45c8`）⇒ minor 递进到 `0.8.0-dev`。⛔ 不取 `0.7.1-dev`：0.7.1 已有同名 tag，滚动渠道装到的东西会自称「0.7.1 的 dev 版」，用户无法从字面量判断它早于还是晚于 v0.7.1 —— 正是 §2.5 的歧义换个方向复发。⛔ 不取 `0.7.2-dev`：SPEC 未给出 patch 递进口径，不自行发明。改后读数：checker `All 11 files carry version 0.8.0-dev`、**exit 0**；4 条 lockfile 条目实测 `0.8.0-dev`；`git show HEAD:packages/quay/package.json` 的 `-dev` 前缀 = `True`。**落地形态**：提交 `6ca535eb0`（`12 files changed, 15 insertions(+), 15 deletions(-)`）⇒ 已提交、⛔ 不是只改工作树（硬规则 11b）。⛔ 全程不动 `v0.7.1` tag、不碰任何 `release/*` 分支、不重打 tag。**三态取值在此明确落在 ②，⛔ 不是 ③（deferred）**：读数显示确实无后缀且无切版在飞。
  - 取证 ③（bump 的 ratchet 连带面 —— 本轮补做，⛔ 不是修辞：它是 ② 落地的必要条件）：`plugin/.claude-plugin/plugin.json` 是 `quay-init-closure-ratchet` 四个 fingerprint source 之一，② 的 bump 改了它的 sha ⇒ `--check-stale` 红；该 checker 是 `@static-tier change` + fail-closed ⇒ **每个**任务的整轮 suite 都在静态检查面中止（本轮 exited-not-landed 的真因，逐字 `STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale exit=1`、`# tests 0`）。四步机械重锚（顺序不可反，否则会把增长洗白）：① `--check-stale` BEFORE ⇒ exit 1、`changed: plugin/.claude-plugin/plugin.json`、`changed=1 added=0 removed=0`；② `--gate` ⇒ `PASS: quay-init laydown footprint 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes (shrink-only holds)`（**数字没长才可重锚**）；③ `--reanchor` ⇒ `PASS: … re-anchored baseline → 3 files / 1022 bytes (fingerprint 375e0af938a1b4f9…)`（footprint 行与 ② 一字不差：3 files / 1022 bytes）；④ `--check-stale` AFTER ⇒ `PASS: … fingerprint fresh … baseline in sync`，`git diff -- docs/analysis/quay-init-closure-ratchet.baseline.json` **只剩** `fingerprint`（`233a7b2f…`→`375e0af9…`）与 plugin.json 的 `sha`（`8b710fef…`→`f7a5e0ee…`）两处。**归属判定（⛔ 不靠猜，一条命令）**：develop 侧不 stale —— `git show develop:plugin/.claude-plugin/plugin.json | sha256sum` = `8b710fef069c728bba2a1ced81e96ccda25341fe644823a59c5b58731a88e433` == develop baseline 的 `sha` ⇒ 该红是**本分支 delta**，不是 develop 侧红。落地：提交 `4915573f5`。⚠️ 连带面：该 baseline 文件由此进入本任务的三点 diff ⇒ 已登记进 `## Touches`（anti-drift 判的是 `develop...HEAD`）。
- [x] **AC5｜台账翻绿的机械读数（终态的独立验证 + 负控制）**：`goal-store.ts check --stale-pass` ⇒ **exit 0 且 `failing == []`**（改前实测 `failing: ["AC-259"]`、exit 1）；且 `check --achieved-failing` 的 `achievedButFailing` 不再含 `AC-242`（改前实测含）。负控制（可证伪）：把 AC1 的 reason 抽掉、或把 AC4 的 bump 回退，上面两个读数必须各自重新变红——**证明这两步真的是该读数翻转的原因**，而不是碰巧。
  - 取证（终态的机械读数 + 负控制）。**方法披露（⛔ 不掩盖）**：`check --stale-pass` 是**纯读**，读 `.quay/gate-events.jsonl` —— 该文件 gitignored、workspace-local，`goal-store.ts:278-281` 逐字写明「轮转是 WORKSPACE-LOCAL、由 goal ring 驱动的生产检出驱动，⛔ 不是 worktree 副本」。worktree 是瞬时检出、不带该载体 ⇒ 直接读得 `NOT-EVALUATED`（exit 3、frozenScope 91）。故把**生产检出的同一本台账原样复制**进 worktree 使纯读判定可评估；复制后 **BEFORE 读数与生产检出逐字相同**（见下），证明该根与生产等价。
  - **改前（同一根）**：`check --stale-pass` → **exit 1**、`failing: ["AC-259"]`、`frozenScope: 92`，stderr 逐字 `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-259`；`check --achieved-failing` → exit 1、`achievedButFailing` **含 `AC-242`**。
  - **改后**：`check --stale-pass` → **exit 0**、`failing: []`、`frozenScope: 91`；`check --achieved-failing` → `achievedButFailing` **不再含 `AC-242`**（集合差实测 `removed = [AC-242]`、`ADDED = []` ⇒ 未新增任何红）。
  - **负控制 1（AC1 半步，真跑、可证伪）**：把 supersede 回退（`git checkout HEAD~2 -- goals/AC-259-*.md`，读回 `status: achieved`）⇒ `check --stale-pass` 重新 **exit 1** 且 `failing: ["AC-259"]`、`check --achieved-failing` 重新含 `AC-242` ⇒ **两个读数各自重新变红**，证明翻转的原因确是这一步而非碰巧；随后 `git checkout HEAD --` 复原，两读数复绿（exit 0 / AC-242 不在列）。
  - **负控制 2（AC5 字面点名的「把 AC4 的 bump 回退」，真跑，结果与 AC5 预期不同 ⇒ 如实报，⛔ 不粉饰）**：把 15 条版本回退到 `0.7.1` 后，**两个读数都不变红**（`failing: []`、AC-242 仍不在列）。原因是结构性的：AC-259 一旦离开冻结 population，版本字面量就不进入这两个判定中的任何一个（`check --stale-pass` 只读台账 + goals/；`check --achieved-failing` 的 `inScope`(28) 里没有任何一条读工作树版本）。⇒ **AC5 的这一半在当前判据结构下不可满足**；AC4 的 bump 由它自己的读数立证（checker `All 11 files carry version 0.8.0-dev` + `git show` 的 `-dev` 前缀），⛔ 不由这两个台账读数立证。
  - **工作树复原**：临时复制的台账已删除（`.quay/gate-events.jsonl` 不存在），`git status --porcelain` 为空。

## DoD

- **真实落点，不是产物清单**：AC1 的 supersede 经 goal store 写入并由 `goal show` 读回（写不进去 = 没做）；AC4 的 bump（若走 ②）必须落在共享检出并**提交**——硬规则 11b：只改工作树、不提交的版本改动已经在影响盘上读数（`version-consistency-check.ts` 读的是盘），却对任何读 git 的人不可见，一次 `git checkout --` 就能静默回退它。
- **证据形态**：行号 + 逐字输出 + exit code 落进任务体，⛔ 不复述「应该会」。
- **反例面**：AC5 的负控制必须真跑过一次并留下前后两个读数（改前红 / 改后绿），不是推理出来的。
- **不做**：⛔ 不把版本改回 `0.7.0-dev`（那是倒退）；⛔ 不改 `goals/AC-259-*.md` 的 criterion 文本本身（改写判据使其通过是取巧路径，本条裁定的终态是 supersede）；⛔ 不为了让它绿而放宽 `version-consistency-check.ts` 的 all-or-none 或移除任何 `VERSION_ENTRIES`。