---
id: gap-profiles-carrier-invariant-broken-by-mcpblacklist-landing
title: shipped `plugin/.quay/profiles.yml` 与 `src/init.ts`
  内联模板不再逐字一致——`c34f81330` 只改 carrier 未改模板，`packages/quay/test/init.test.mjs` 的
  "profiles carrier" 判据在全库套件里恒红，任何任务的 fan-in 都会被它拦住
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`packages/quay/test/init.test.mjs:496` 的判据逐字断言：

```js
assert.equal(generateProfilesContent("quay"), fs.readFileSync("plugin/.quay/profiles.yml", "utf8"),
  "src/init.ts's template must reproduce plugin/.quay/profiles.yml byte-for-byte for project `quay` — edit BOTH or neither");
```

**实测（2026-09-14，worktree `gap-goal-create-as-active-skips-zero-ac-gate`，非推断）**：

1. 判据为**假**：`generateProfilesContent("quay")` 产出 **1967 字节**，盘上 `plugin/.quay/profiles.yml` 为 **2581 字节**，**20 行不同**。
2. **与环境无关**（三重对照，读数相同）：带 `QUAY_PLUGIN_ROOT` / `env -u QUAY_PLUGIN_ROOT` / cwd 换到 `/tmp` ⇒ 三种读法都 produced/shipped = 1967/2581、`equal:false`、20 行差。⇒ 不是 driver-env 代理量缺陷（那类已由 951fbb15c 修）。
3. **成因（单条提交，可逐字核）**：`c34f81330`（`gap-worker-mcp-blacklist-strict-config`，2026-09-14T10:11:12Z）向 `plugin/.quay/profiles.yml` 的 role 条目加了 `mcpBlacklist:` 块（`- chrome-devtools` / `- playwright`）与解释性注释行，**而未同步改 `packages/quay/src/init.ts`**：`grep -c mcpBlacklist` ⇒ `plugin/.quay/profiles.yml` = **4**，`packages/quay/src/init.ts` = **0**。该任务的 `## Touches` 里没有 `packages/quay/src/init.ts`。
4. 该提交之前不变量成立：`3c54abdcf`（2026-09-13T10:13Z，`fix(quay-init): converge the profile carrier to one template; derive role names per project`，改了 `init.ts` 135 行并**新增了本判据的测试**）落地时两者一致。
5. **影响面 = 全库套件，不是单个任务**：`scripts/test.sh:867` 的 glob 是 `packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs` ⇒ `packages/quay/test/init.test.mjs` **在**全量选择集里 ⇒ 任何任务的 fan-in 全量 suite 都会红在这一条上。

**为什么它没有归属（这正是本条存在的理由）**：`worker-driver.ts:1804 classifyDeltaRelatedness` 只把「失败测试文件在本任务 Touches/diff 里」或「其**一跳 import** 与本任务 delta 相交」判为 `related`。`packages/quay/test/init.test.mjs` 的一跳 import 是 `packages/quay/src/init.ts`——**任何 Touches 不含 `init.ts` 的任务，看这条红都是 `unrelated`** ⇒ 它不会被算作那些任务自身的缺陷，也就**没有任何任务会去修它**。⇒ 修它的任务，其 `## Touches` **必须**含 `packages/quay/src/init.ts`，这样 `init.test.mjs` 的一跳 import 命中该任务 delta ⇒ `related` ⇒ 该任务必须修好才能落地。本条的 Touches 因此逐字钉住那一个文件。

**另外两处（同一次扫描，按硬规则 5b 一并登记，⛔ 不扩大本任务范围）**：
- 生产调用点 `plugin/scripts/verify-deliver-coldstart.sh` 的 AC-234 渲染 fixture 以 GOAL 播种（`gap-goal-create-as-active-skips-zero-ac-gate` 已按新写面语义处置为 draft 播种，与该任务同批落地）——与 carrier 不变量无关，仅记录。
- `plugin/.quay/profiles.yml` 的注释逐字写着「本文件是 quay-init 逐字铺进消费者 .quay/ 的那一份；只改 dev-tree 根 ⇒ 第三方项目功能静默失效」——**本次破的正是它自己警告的那条**（改了一份、`init.ts` 那份没改）。

**SUPERSEDED（2026-09-14，协调者更正）**：上面「为什么它没有归属」的**前提是错的**——修它的任务**已经存在**：`gap-serve-stale-signal-has-no-consumer`（status `ready`，在飞）的 `## Touches` 里已含 `packages/quay/src/init.ts` 并写明理由（其正文「附」小节），且该任务正文记录的正是同一次单边改动（`c34f81330` 只改 carrier、模板未同步）与同一组读数（1967 vs 2581 字节）。查重当时读到的是本 worktree 过期的 `tasks/` 快照——`gap-serve-stale-signal-has-no-consumer` 的那行 Touches 于 11:37:36Z 才落进主检出，晚于那次合并。⇒ 本条**不是第二个 owner**，而是被 `gap-serve-stale-signal-has-no-consumer` **取代**（superseded）：owner 的在飞分支已覆盖同一文件，两个任务同时动 `packages/quay/src/init.ts` 只会互相碰撞，且本条落地时其 AC1 早已由 owner 变绿。**本条唯一保留的增量证据**是**环境无关性的三重对照**（带 `QUAY_PLUGIN_ROOT` / `env -u QUAY_PLUGIN_ROOT` / cwd 移到 `/tmp`）：三种读法**读数相同**（produced/shipped = 1967/2581 字节、`equal:false`、20 行差），用以排除「这是 driver-env 代理量缺陷（那类已由 951fbb15c 修）」——**owner 任务的证据里没有记录这一对照**，故保留于此。⛔ 本条不追加 `## Touches` 自触项、也不做任何使其可晋升的改动，以免与在飞 owner 争同一文件。

## AC

- [ ] **不变量恢复（写面行为）**：`node --test packages/quay/test/init.test.mjs` 绿，且其中 "profiles carrier: the inline template IS the shipped carrier byte-for-byte" 一条通过（今天红）。同一条断言的两半都要成立：`generateProfilesContent("quay")` 与 `plugin/.quay/profiles.yml` 逐字相等，且 `generateProfilesContent("some-other-project")` 仍**不**相等（参数化未被压平）。贴出改前 / 改后两次 `node --test` 读数对照。
- [ ] **⛔ 修的方向是「模板追上 carrier」，不是「删掉 carrier 的 mcpBlacklist」**（carrier 的 `mcpBlacklist` 是 `gap-worker-mcp-blacklist-strict-config` 有意落地的 worker 硬化，⛔ 不得为让判据变绿而回退它）：改后 `grep -c mcpBlacklist plugin/.quay/profiles.yml` 仍 ≥ 4，且 `grep -c mcpBlacklist packages/quay/src/init.ts` ≥ 1。贴出两个计数。
- [ ] **负控制（判据能取假）**：把 `init.ts` 的模板改回不含 `mcpBlacklist` 的形态，上面第一条必须重新变红；贴出改前 / 改后读数。
- [ ] **全量套件**：`bash scripts/test.sh` 绿（若只跑 scoped 门，说明为何非全量）。本条的落地判据就是「全量 suite 不再红在这一条上」。

## DoD

- [ ] 上面的判据实跑通过，且判据本身能取假（把模板改回旧形态会红，贴对照读数）。
- [ ] 修的是**已有的那一处单源不变量**（`init.ts` 内联模板 == `plugin/.quay/profiles.yml`），⛔ 不新建并行机制、⛔ 不弱化/删除该判据来「达成」绿。
- [ ] 若 `init.ts` 的模板生成器结构上无法逐字复现 carrier（例如注释行不属于模板该管的内容），则**改为让 carrier 由模板生成**（或把不变量改锚到真正单源的量上）——但**必须**在任务里说明为何另一方向不可行，且 ⛔ 不得静默丢弃 `mcpBlacklist`。
- [ ] 全量 `scripts/test.sh` 绿。

## Touches
- `packages/quay/src/init.ts`
- `plugin/.quay/profiles.yml`
- `packages/quay/test/init.test.mjs`
