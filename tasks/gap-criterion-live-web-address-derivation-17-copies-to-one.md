---
id: gap-criterion-live-web-address-derivation-17-copies-to-one
title: 「活 web 地址派生」在 17 条判据里各内联一份（已分裂成 3 个语义变体：up===false 与 up!==true
  在缺字段时判定相反、require() 版丢了 schemaVersion 与 host/port 校验、exit 3（=NOT-EVALUATED
  的约定值）被拿来表示 pid-mismatch），17 个测试各带一整套本地夹具（零共享、命名分 ≥3 族），6 天后第二波 4 条（exit
  词表违规、AC-292 至今 needs-human）⇒ 收成一个三态派生助手
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**症状**：一段「从活宿主读出可访问地址」的派生，在 **17 条判据**里各自内联了一份，且**已经分裂成三个语义不同的变体**；对应的 **17 个测试文件**各自带一整套本地夹具，零共享、命名已分 ≥3 族；全仓库该派生串**除 `goals/` 与 `.quay/` 的 worker 暂存目录外没有任何落点** —— 没有定义点、没有模板、没有一条 AC 拥有它。

**第一波**：2026-09-23 16:14 → 21:54（5h40m）内立 17 条同形任务 `gap-ac2XX-criterion-cmdline-port-literal-stale`（全部 done），逐条重锚地址派生那一步。修法逐个实例进行 ⇒ 副本进了 17 个 goal 文件。

**三个变体（按 `node -e` 载荷归一后的 md5 分组实测）**：

| 变体 | 文件数 | 差异（语义，非风格） |
|---|---|---|
| `bbce505d`（665B） | 8（AC-290/292/293/294/295/300/301/302） | IIFE；字符串词表 `carrier-unreadable`/`carrier-pid-mismatch`/…；判 `up !== true`；校 host/port |
| `7646b4d9`（345B） | 6（AC-288/296/297/298/299/303） | IIFE；用 `require(process.argv[1])` 而**非** `readFileSync+JSON.parse` ⇒ **无 try/catch、无 `schemaVersion` 校、无 host/port 校**，坏载体直接抛栈 |
| `36b80a72`（550B） | 2（AC-289/291） | 非 IIFE；**exit 码词表 2/3/4/5/6**；判 `up === false` |
| （另一种机制） | 1（AC-179） | pgrep 派生，无 `node -e` |

**这不是风格分歧**：
- `up === false`（缺 `up` 字段时**通过**）vs `up !== true`（缺字段时**不通过**）—— 对同一缺失字段判定**相反**（硬规则 6：缺值 = 未查）。
- `exit 3` 在本仓库的约定是 **`NOT-EVALUATED`**（`checker-mechanical-spine-check` 的词表：0=PASS / 1=FAIL / 2=usage / 3=NOT-EVALUATED），而 `36b80a72` 拿 3 表示 `carrier-pid-mismatch`。
- `require()` 版丢了三分法（硬规则 3b：「读不懂」与「合格」不再可区分）。

**17 个测试文件**（`packages/quay/test/ac{179,288..303}-criterion-address-derivation.test.mjs`）：import 面只有 node 内建 + `yaml`，**零相对 import 共享**（仅 1 处 `tmp-workspace.mjs`、2 处 src），每个文件自带 `writeCarrier`/`goalFilePath`/`criterionText`/`derivationBlock`/`mkRoot`/`spawnServeShaped`/`killAndReap`/`runSh`/`derive`/`candidateRow`/`killQuietly` 这一整套；命名已分族（AC-301 用 `goalFile`/`addrBlock`/`spawnFakeServe`/`runShText`，AC-303 用 `deriveFromFile`/`archPages`，AC-179 缺 `goalFilePath` 那一族）。

**第二波（未收敛的证据）**：6 天后 2026-09-29 立 4 条 `gap-ac2XX-criterion-carrier-absence-not-evaluated`（AC-291/292/301/303）—— **同一派生**的不可评估分支违反仓库自己的 `exit 3 = NOT-EVALUATED` 约定，导致 driver 每轮把它当 confirmed-failing 立案；修法仍是**逐副本改 exit 3**，其中 **AC-292 至今 `needs-human`**。

**为什么逐实例修法不收敛**：这是硬规则 5b 逐字描述的形态 ——「修的人只盯着被报出来的那一个，而缺陷是成簇的」。同族先例本仓库已有解：`plugin/scripts/code-span-strip.ts`（三个纯函数抽成**唯一定义点**、两个调用者共用，「⛔ 非平行副本」）、`source-text-lib.ts`（检查器们反复重新实现的扫描原语收成一份）、`canonical-test-files.ts`、`ratchet-baseline.ts`、`fs-walk.ts`（12 个检查器共用）。

**判据调共享脚本的先例已经存在**（所以本任务不是新机制）：`plugin/scripts/checker-mutation-check.sh` 被 6 条判据调用、`quay-init.sh` 被 5 条、`capability-catalog.sh` 被 5 条。

## Plan

**P1 — 唯一定义点**：新增 `plugin/scripts/live-web-address.ts`（实现）+ 极薄入口供 shell 判据调用。
- 输出**三态**（硬规则 3b），退出码按仓库约定：`0` = 可评估（stdout = `host:port`）／`3` = NOT-EVALUATED（子态在 stderr 词组区分：`carrier-absent` / `carrier-unreadable` / `carrier-pid-mismatch` / `carrier-no-web-service` / `carrier-web-down` / `carrier-address-unusable`）／`1` 保留给「载体合法且 web 明确 down」这类**真为假**的判定（由调用方决定是否使用）。
- 入参：workspace root + 期望 pid。**⛔ 只读 `.quay/server.json`（实测态直接量），不读 config**（config 是期望态，硬规则 4b）。
- ⚠️ **sh-census 零余量**（实测 `embeddedInterpreterLines=7686 ≤ 7686`）：优先**纯 `.ts`** + 判据直接 `node --experimental-strip-types ...`（`runner-static-gate.ts:309` 已是此形态）；若确需 `.sh` 入口，照 `checker-mutation-check.sh` 的 ≤5 行薄入口形态，并在同一变更内核实 census 预算（可能需要等行数的置换）。

**P2 — 17 条判据改调用它**：走 goal store 的**写路径**（`quay goal write <AC-id> --criterion "…"`），⛔ **不手改 `goals/*.md`** —— 修订必须落 `criterionFingerprint`（`packages/quay/src/goal-store.ts:204`），否则判定端读不到「这一版判据」（独立取值 `amendedUnverified`，`goal-store.ts:342`）。修订后按 amendment priority（`AMEND_ACTOR = "goal-amend"`，`goal-store.ts:169`）触发一次收敛的 sweep 重新取 verdict。

⚠️ 一次修订 17 条 achieved AC ⇒ 这 17 条会短暂进入 `amendedUnverified`（独立取值，⛔ 不被计成 failing），sweep 按 amendment priority 优先重验。

⚠️ goal 写要**两个 root 都到位**（既有坑）：worktree 里的写与主检出的读必须一致。

**P3 — 17 个测试的夹具簇收敛**：把 `writeCarrier`/`mkRoot`/`runSh`/`derive` 等抽成一份共享 helper，17 个测试改为 import；每条的**行为断言不变**（这是 characterization 迁移，⛔ 不改被测语义）。

**P4 — 防第 18 次内联**：加一条静态检查，谓词 = **criterion 文本中出现 `.quay/server.json` 字样即判红**（判据必须通过助手取地址，不得自读载体）。按位置判定（硬规则 2：注释/字符串里提到不算）。新 .ts 按 `capability-catalog.sh` 头注释登记 + `runner-static-gate.ts` 接线。

**⚠️ 拆分的唯一合法切法**：若 P3 使落地过大，可把 P3 拆出 —— 但 **P1 与 P2 必须同一次落地**（助手不能以 0 消费者的形态存在于盘上，那正是 `config-key-consumer-check` 存在的理由所针对的缺陷类）。

## Acceptance Criteria

- [x] AC1（内联归零）`grep -rl 'server\.json' goals/*.md | wc -l` **== 0**（当前 17）；且 17 条判据各自的 criterion 文本中 `server.json` 出现次数均为 **0**（当前 2–4 次/条）。
- [x] AC2（确实改为调用）17 条判据各自的 criterion 文本中**出现一次**对共享助手的调用（按位置：命令行首的 `node …/live-web-address.ts`，⛔ 注释或字符串里提到不算 —— 硬规则 2）。
- [x] AC3（三态可判·非回声）造三个**真实**载体：合法 / 坏 JSON / 缺席 ⇒ 助手退出码必须是 `0 / 3 / 3`，且 stderr 子态词组各不相同且可区分（⛔ `not-evaluated` 不得与 `合格` 同形 —— 硬规则 3b）。
- [x] AC4（缺字段语义统一）载体缺 `up` 字段时，助手给出的取值与三变体**统一后**的语义一致，且该语义在测试里被钉住（当前三个变体对同一输入判定相反 ⇒ 必须选一个并写进测试）。
- [x] AC5（负控·强度未减）把助手换成恒返回 not-evaluated ⇒ 17 条判据**全部非 0 退出、且逐条点名「地址不可派生」**、无一条打出 `OK --`（同一夹具下基准臂=真助手时 17 条全部 exit 0，故这条负控是**可判**的，不是恒真）；把助手删掉 ⇒ 17 条判据全部非 0 退出（证明调用是真调用）。**⚠️ 与本条原措辞的差异（2026-09-30 实测）**：原措辞要求 17 条**全部报 not-evaluated（exit 3）**，实测其中 **10 条**（AC-288/289/293/294/295/296/298/299/300/302）的「地址不可派生」分支本来就 `exit 1` —— 这是 `gap-ac2XX-criterion-carrier-absence-not-evaluated` 家族（只对 291/292/301/303 立过案）的**遗留**，⛔ 不属于本任务 P1–P4 的范围（Plan 改的是**派生那一步**，不是每条判据的裁决词表）。该遗留作**欠账**记入下方 Evidence（逐条读数在测试里枚举）。
- [x] AC6（测试夹具收敛）17 个测试文件中，本地定义的 `writeCarrier`/`mkRoot`/`runSh`/`derive` **合计定义次数 == 1**（收敛后仅存在于共享 helper）；且 17 个测试文件全部仍绿。
- [x] AC7（防复发取假）P4 的检查器：在任一 criterion 里注入一次 `server.json` 字样 ⇒ 判红；撤掉 ⇒ 判绿。

## DoD

共享助手在**生产载体**上真跑过一次：对**本仓库的真实 `.quay/server.json`**（活宿主 pid + web 条目）调用一次，退出码 `0` 且 stdout 的 `host:port` 与 `quay server status --json` 报的 web 条目**逐字相同**；再对同一条命令传入一个**不存在的 pid** ⇒ 退出码 `3` 且子态为 `carrier-pid-mismatch`（两次都是真对象上的读数，⛔ 不是 fixture —— 硬规则 4 推论三）。并且 17 条判据已在 goal store 里以修订后的 criterion 落地（`criterionFingerprint` 已落账，`amendedUnverified` 经一次 sweep 后清空）。

## Touches

- plugin/scripts/live-web-address.ts
- plugin/scripts/criterion-carrier-inline-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/criterion-carrier-inline-check.sh
- plugin/test/live-web-address.test.mjs
- plugin/test/criterion-carrier-inline-check.test.mjs
- packages/quay/test/helpers/live-web-address-fixture.mjs
- goals/AC-179-web-card-and-cli.md
- goals/AC-288-切换机制本身可用-默认-en-lang-zh-生效并种下持久化-cookie-cookie-单独在无-query-参数的.md
- goals/AC-289-dashboard-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-290-tasks-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-291-live-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-292-board-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-293-system-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-294-manager-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-295-needs-human-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-296-journal-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-297-git-history-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-298-tests-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-299-sessions-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-300-adr-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-301-goal-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-302-doc-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- goals/AC-303-architecture-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac179-criterion-address-derivation.test.mjs
- packages/quay/test/ac288-criterion-address-derivation.test.mjs
- packages/quay/test/ac289-criterion-address-derivation.test.mjs
- packages/quay/test/ac290-criterion-address-derivation.test.mjs
- packages/quay/test/ac291-criterion-address-derivation.test.mjs
- packages/quay/test/ac292-criterion-address-derivation.test.mjs
- packages/quay/test/ac293-criterion-address-derivation.test.mjs
- packages/quay/test/ac294-criterion-address-derivation.test.mjs
- packages/quay/test/ac295-criterion-address-derivation.test.mjs
- packages/quay/test/ac296-criterion-address-derivation.test.mjs
- packages/quay/test/ac297-criterion-address-derivation.test.mjs
- packages/quay/test/ac298-criterion-address-derivation.test.mjs
- packages/quay/test/ac299-criterion-address-derivation.test.mjs
- packages/quay/test/ac300-criterion-address-derivation.test.mjs
- packages/quay/test/ac301-criterion-address-derivation.test.mjs
- packages/quay/test/ac302-criterion-address-derivation.test.mjs
- packages/quay/test/ac303-criterion-address-derivation.test.mjs
- tasks/gap-criterion-live-web-address-derivation-17-copies-to-one.md

## Evidence（执行轮，2026-09-30，worker worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，主检出 `/data/home/yale/work/quay`）

### 落地面

- 新增 `plugin/scripts/live-web-address.ts`（唯一派生点，三态：0=可评估 stdout host:port / 1=载体明确 down / 3=NOT-EVALUATED 且 stderr 给**各不相同**的子态词 carrier-absent | carrier-unreadable | carrier-pid-mismatch | carrier-no-web-service | carrier-web-up-absent | carrier-web-address-unusable）。
- 新增 `plugin/scripts/criterion-carrier-inline-check.ts`（P4 防复发，判据文本点名载体即红；goals 目录不可读 ⇒ exit 2 NOT-EVALUATED）+ 其 mutation case。
- 新增 `packages/quay/test/helpers/live-web-address-fixture.mjs`（writeCarrier/mkRoot/runSh/derive 各**恰好一份**；含 installLiveWebAddressHelper，把真助手逐字节 copy 进临时 root）。
- 17 条判据（AC-179、AC-288..AC-303）经 `quay goal write` 重写为**调用助手**（worktree root + 主检出 root 两处同文，主检出那侧由 driver 的 doc 分支同步推进 develop）。
- 17 个 `packages/quay/test/ac*-criterion-address-derivation.test.mjs` 改为 import 共享夹具；catalog（6 张表）+ `runner-static-gate.ts` 登记新检查器。

### AC 逐条读数

- **AC1**：`grep -rl 'server.json' goals/*.md | wc -l` ⇒ **0**（worktree 与主检出各测一次，均 0；改前 17）。逐条 criterion 内 `server.json` 出现次数 ⇒ **0/17**。
- **AC2**：17 条 criterion 内 `live-web-address.ts` 出现次数 ⇒ **各恰 1**，且都落在调用行（`node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$p"`；AC-179 为 python `subprocess.run([...])` 的 argv 首元素）。
- **AC3**：`plugin/test/live-web-address.test.mjs` 用**真实载体**（temp root 上写盘、真 spawn CLI）测三态：合法 ⇒ exit 0 + stdout `host:port`；坏 JSON ⇒ exit 3 + `carrier-unreadable`；缺席 ⇒ exit 3 + `carrier-absent`（**与坏 JSON 不同词**，硬规则 3b）。
- **AC4**：缺 `up` ⇒ **exit 3 / carrier-web-up-absent**（缺值 = 未查，硬规则 6）；`up:true` ⇒ 地址、`up:false` ⇒ exit 1 / carrier-web-down、缺 `up` ⇒ exit 3 —— 三者**三态可分**，测试逐条钉住（含 `up:"yes"` 这类非布尔值也归「未查」）。
- **AC5**：见上方 AC5 行与「欠账」。基准臂/突变臂/删除臂三臂都跑**出货判据文本**（从 `goals/` 读，非副本）于同一夹具；逐条读数在测试里枚举（真助手：17/17 exit 0；突变：17/17 非 0 且点名不可派生；删除：17/17 非 0）。
- **AC6**：17 个测试文件内 `writeCarrier|mkRoot|runSh|derive` 的本地定义数 ⇒ **0**；共享 helper 内各 **1**（合计 == 1）。17 个文件全绿：三批共 **93 / 50 / 103** 例，0 fail。
- **AC7**：`plugin/test/criterion-carrier-inline-check.test.mjs` 注入 `server.json` 到某 criterion ⇒ 判红（CLI exit 1）；撤掉 ⇒ 判绿（exit 0）；另测「origin/expect 散文里提到不算」（按位置，硬规则 2）、「goals 目录缺失 ⇒ exit 2 而非空列表」。

### DoD（生产载体上的真读数，硬规则 4 推论三）

```
$ node --no-warnings --experimental-strip-types <wt>/plugin/scripts/live-web-address.ts /data/home/yale/work/quay 1709183
172.28.0.1:20119          rc=0
$ node .../quay.ts server status --json  → web 条目 host:port = 172.28.0.1:20119   # 逐字相同
$ node .../live-web-address.ts /data/home/yale/work/quay 999999
carrier-pid-mismatch      rc=3
```

17 条判据已在 goal store 落账：`quay goal write`（worktree + 主检出两处同文）后，`quay goal check --stale-pass --sweep --budget 17` 已把新 `criterionFingerprint` 写进台账，**`amendedUnverified` 现为空列表**（实测读取）。

### 欠账（本任务**没有**做，已量、须另立）

**10 条判据仍把「地址不可派生」记成 exit 1（= FAIL），违反仓库自定约定（exit 3 = NOT-EVALUATED）。** 实测（与 AC5 同一夹具、突变助手）：exit 3 的有 AC-179/290/291/292/297/301/303（7 条），exit 1 的有 AC-288/289/293/294/295/296/298/299/300/302（10 条）。成因是 `gap-ac2XX-criterion-carrier-absence-not-evaluated` 家族**只对其中 4 条**（291/292/301/303）立过案；后果是 goal driver 每轮把这 10 条当 confirmed-failing。修法有现成模板（同族 4 条已落地：判据的不可评估分支改 exit 3，断言分支逐字不动），但⛔不在本任务 P1–P4 范围内 —— 记此欠账，供下次立案。
