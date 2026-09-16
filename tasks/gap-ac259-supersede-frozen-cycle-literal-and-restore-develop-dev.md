---
id: gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev
title: AC-259 台账恒假的收口：判据钉在 0.7.0（-dev）这个周期字面量上，而 SPEC §4.3 的发布切版已把仓库推到 0.7.1 ⇒
  结构上永不可再为真；同一次切版还把 develop 留在无 -dev 后缀的已发布版本号上（§4.3 ⛔ 明令禁止，无闸门拦）
status: ready
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

- [ ] **AC1｜终态 = `superseded`，且理由写进记录本体（⛔ 不是只在任务里说）**：`goals/AC-259-….md` 的 `status:` == `superseded`，`statusLog` 末条 `to: superseded`，其 `reason` **逐字含三项**：(i) 臂1 钉字面量 `0.7.0-dev`（AC-105：判据不得引用生命周期短于判据本身的对象）；(ii) 臂2 的 `GOAL-018-AC-257/258` 是已关闭 GOAL-018 的周期专属 id；(iii) 承接者 = `scripts/version-consistency-check.ts`（11 条 ⊇ 8、all-or-none、有突变夹具）+ GOAL-020 的 AC-270/271/272。核法：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts show AC-259 --json` 读出 `status` 与末条 `statusLog[].reason`。**只改 status 不写 reason ⇒ 红**（判据读 reason 文本，不是只读 status）。写入必须经 **goal store 本身**（`goal-store.ts write AC-259 --status superseded --reason "…"`），⛔ 不得手改 `goals/AC-259-*.md` 绕过 store。
- [ ] **AC2｜先证不降覆盖，再允许 supersede（fail-closed）**：产出 `VERSION_ENTRIES` 路径集与 AC-259 8 文件清单的**求交读数 = 8/8，缺 0**，附条目总数（实测 11）、`scripts/version-consistency-check.ts` 的一次实跑（`All 11 files carry version …` + exit 0）、突变夹具路径的存在性。**若求交 < 8/8 ⇒ 不得 supersede**：改为把缺口文件清单逐条写进任务体并停在 `needs-human`（硬规则 3b：读不出合格态时不许给出与合格同形的输出）。
- [ ] **AC3｜臂2 的存续面被点名（⛔ 不许 supersede 了事）**：逐条给出行号 + host + install_scope + quay_version + task_status + ts 的载体读数（`:182`/`:183`/`:184`），并点出周期外的存续面（`GOAL-020/AC-264` 真机部署 + `AC-270`/`AC-271`/`AC-272` 发布渠道版本不变式）。
- [ ] **AC4｜§4.3 现行违反：先取读数再动，三态可区分（硬规则 3b）**：① 取读数 `git show develop:packages/quay/package.json` 的 version + `version-consistency-check.ts` 实跑；② 若仍无 `-dev` 后缀**且**无在飞切版（判据：不存在 tip 未逐字停在同名 tag 上的 `release/*` 分支），把 lockstep 并集（11 条 `VERSION_ENTRIES` + `package-lock.json` 中 `packages/quay{,-native,-github,-backlog}` 4 条）齐步推到下一个 `-dev` 值并**提交**，记录选值与 §4.3 依据，改后实跑 checker 得 `All N files carry version <new>` 且 exit 0；③ 若读数显示已带 `-dev`、或切版在飞 ⇒ 记 **`deferred` + 依据 + 归属 GOAL-020**。⛔ 三种取值不得共用同一个输出词。⛔ 全程不动 `v0.7.1` tag、不碰任何 `release/*` 分支、不重打 tag。
- [ ] **AC5｜台账翻绿的机械读数（终态的独立验证 + 负控制）**：`goal-store.ts check --stale-pass` ⇒ **exit 0 且 `failing == []`**（改前实测 `failing: ["AC-259"]`、exit 1）；且 `check --achieved-failing` 的 `achievedButFailing` 不再含 `AC-242`（改前实测含）。负控制（可证伪）：把 AC1 的 reason 抽掉、或把 AC4 的 bump 回退，上面两个读数必须各自重新变红——**证明这两步真的是该读数翻转的原因**，而不是碰巧。

## DoD

- **真实落点，不是产物清单**：AC1 的 supersede 经 goal store 写入并由 `goal show` 读回（写不进去 = 没做）；AC4 的 bump（若走 ②）必须落在共享检出并**提交**——硬规则 11b：只改工作树、不提交的版本改动已经在影响盘上读数（`version-consistency-check.ts` 读的是盘），却对任何读 git 的人不可见，一次 `git checkout --` 就能静默回退它。
- **证据形态**：行号 + 逐字输出 + exit code 落进任务体，⛔ 不复述「应该会」。
- **反例面**：AC5 的负控制必须真跑过一次并留下前后两个读数（改前红 / 改后绿），不是推理出来的。
- **不做**：⛔ 不把版本改回 `0.7.0-dev`（那是倒退）；⛔ 不改 `goals/AC-259-*.md` 的 criterion 文本本身（改写判据使其通过是取巧路径，本条裁定的终态是 supersede）；⛔ 不为了让它绿而放宽 `version-consistency-check.ts` 的 all-or-none 或移除任何 `VERSION_ENTRIES`。