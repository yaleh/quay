---
id: gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename
title: "semantic-dedup-scan: digest-identical 8-line body across the
  plugin/product boundary, declared in the product copy as a deliberate 复刻, and
  the rename is exactly what hid it from na"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
digest-identical 8-line body across the plugin/product boundary, declared in the product copy as a deliberate 复刻, and the rename is exactly what hid it from name-based scans; it bakes no host-dependent literal (only the empty-string sentinel) so the no-hardcoded-limit rule is not implicated

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`mergeEnv`、`mergeProfileEnv`
- 涉及文件：
- `plugin/scripts/profile-policy.ts:91`
- `packages/quay/src/goal-store.ts:2840`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract mergeEnv to a module both layers reach and delete the renamed copy

## Disposition

**复核结论：finding 属实，且逐字核对后没有任何夸大或漏报 —— 两个 8 行 body 在把 `export` 关键字与函数名
归一化之后逐字节相同。** 取证（2026-09-26 实测，取 HEAD 上的两份原文）：

```
git show HEAD:plugin/scripts/profile-policy.ts | sed -n '91,98p'  | sed -E 's/^(export )?function [A-Za-z0-9_]+\(/function FUNC(/'
git show HEAD:packages/quay/src/goal-store.ts   | sed -n '2840,2847p' | sed -E 's/^(export )?function [A-Za-z0-9_]+\(/function FUNC(/'
diff <(…) <(…)   → 空（IDENTICAL，md5 2fd3147e3e191f38ef1136c92403ea71）
```
归一只动了**声明行的名字与 `export`**；digest 相关的 6 行核心（`2..7`）两侧 md5 都是
`b1c601e5e23cf2c45f87861802a34ce5`。HEAD 上该 body 的生产树命中数 = **2**（`git grep -c -F`：两个文件各 1）。

**处置 = 修掉（extract），不是「已注意到」，也不是「已有机制在管」。**

- 实现落 **`packages/quay/src/kernel/env-merge.ts`**（kernel 叶：零 import，故不参与任何 value/type 环，
  也天然满足 import-graph-check 的 kernel 边界第四规则）。
- 两个消费方改为读这一份，各自形式不同：
  - 产品侧 `packages/quay/src/goal-store.ts` —— in-package `import { mergeEnv } from "./kernel/env-merge.ts"`，
    删掉原 `mergeProfileEnv`（函数体 + 其「复刻 profile-policy mergeEnv」注释）。
  - 方法学侧 `plugin/scripts/profile-policy.ts` —— 跨树 `import … from "../../packages/quay/src/kernel/env-merge.ts"`
    （方向恒为 plugin → kernel），并把 `mergeEnv` **原样转出**（`export { mergeEnv }`），公开面与签名不变。
- **计数（本次最直接的一条）：生产树里该 body 的副本 2 → 1。**

**为什么落 kernel**：`packages/quay/src/goal-store.ts` 是产品层、kernel 是产品层的叶；方法学层可以 import
产品层，反过来不行 —— `packages/**` → `plugin/**` 是 import-graph-check 的 `reverseEdges` 棘轮（基线 0）
明令的逆向边（`goal-store.ts` 自己就写着 "DIRECTION OF THE DEPENDENCY: product → plugin, never the
reverse"）。kernel 是**两层唯一共同可达**的落点。

**⛔ 为什么这次【没有】在 plugin 侧加一个 re-export shim（与 regex-escape 那次的差别，是判据不是手感）**：
shim 存在的**唯一**理由是「被 quay-init 平坦铺出去的 loop 工具用 `./X.ts` 兄弟说明符，而铺出闭包的
step (d) 只扫 shell 兄弟引用、看不见 ESM 的 `./`」。本模块**不在铺出集**（`grep profile-policy
plugin/scripts/quay-init-steps.ts plugin/scripts/quay-init.sh` = 0 命），其消费者
（`driver-runtime.ts` / `worker-driver.ts` / `profiles-role-coverage-check.ts`）都经 bundle 由
`coreSrcAliasPlugin` 内联 ⇒ 兄弟 shim 无对象，还会给 capability-catalog 增加一个「无消费者的声明」
并把铺出闭包面推高。故直接跨树 import：形态与 `packages/quay/src/kernel/proc-identity.ts` 的 5 个
plugin 消费者（同样**无 shim**）逐字一致。

### 新增判据 + 红控制

`packages/quay/test/kernel-env-merge.test.mjs`（5 条）：
- ① 该 body 在生产树里**【恰好一个文件】**（EXACT set 断言，不是 `<= N`），且两个 former copy 点名不得再现；
- ② 两个消费方**都 import kernel 叶**（接线，而非只有 body 计数）——「产品侧与编排侧是同一判断」这句话
  原来是注释，现在会红；
- ③ 两层拿到的是**同一个函数对象**（`profilePolicyNs.mergeEnv === kernelNs.mergeEnv`）——复制出来的会是不同对象；
- ④ 行为：`""` 删键（不是置空串）、`"0"` 是有效值（falsy 测试会静默吃掉它）、override 覆盖、base 不被改、
  退化形状逐个枚举；
- ④ 的**负控制**：朴素 spread（`{...base, ...override}`）**不删键** ⇒ 否则 ④ 的删键断言是空转。

**红控制（两臂，都实测变红并点名）**：
- A 把逐字节副本注回 finding 点名的那一份 `packages/quay/src/goal-store.ts` ⇒ 红，输出
  `["packages/quay/src/goal-store.ts","packages/quay/src/kernel/env-merge.ts"]`；
- B 注入到**无关**生产文件 `plugin/scripts/task-ops.ts` ⇒ **也红**（证明在咬的是「恰好一份」这条计数，
  不只是那份点名清单）。撤掉即绿（needle 计数回到 0/0）。注入前都用 `grep -cF` 确认逐字节命中 = 1，
  故这次红控制**有效**（不重复 regex-escape 那次「printf 吞反斜杠导致红控制无效」的坑）。

⚠️ **诚实记录一次判据自己的失败**：① 的第一版写的是 `hits.length <= 2`（照抄 regex-escape 判据的形状），
**注入到无关文件时它不红**（2 ≤ 2）—— 那正是硬规则 4c 的**空转**形态（判据恒真而什么都没验到）。
已改为 EXACT set 后**重做**红控制。判据本身也会取不到假，这是实例。

### 行为等价的取证（改动前后对拍）

`ts-typecheck`（`for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done`）**exit 0**。
受影响测试逐文件跑：`kernel-env-merge` **5/5**、`profile-policy` **28/28**、
`criterion-fidelity-gate` **10/10**、`criterion-fidelity-default-wiring` **4/4**、
`profiles-role-coverage-check` **6/6** —— 全绿（后两个正是消费 `mergeProfileEnv` 那条 goal-store 路径的判据）。

### 门

- `import-graph-check.ts --json`：`verdict.ok=true`，`valueSccs 0 / typeSccs 0 / reverseEdges 0`，
  `kernelBlocked=false`（新 kernel 叶零 import，第四规则 vacuous 成立）。
- `capability-catalog.sh` rc=0：`360 scripts | 360 declared | 0 unclassified | 355 ship`
  —— ⛔ 本次**未新增 plugin/scripts 文件**，故无新声明义务（这正是「不加 shim」省下的面）。
- `quay-init-closure-ratchet.ts --gate` PASS：footprint 3 files / 1022 bytes **未变**。
- `kernel-sibling-resolution-check.ts` PASS：389 kernel files，0 naive kernel resource resolution。
- `rhythm-consumer-check.ts --check` rc=0。

### 5b 划界（同一原则的其它适用点，全部列出 + 逐条处置）

- **本 finding 的精确谓词（8 行 body）**：2 → 1（上面已给逐字取证）。
- **相邻族：显式 `unset` 取消继承** —— `for (const k of unset) delete …` 共 **4 处**：
  `plugin/scripts/profile-policy.ts:102`（`delete out[k]`）、`packages/quay/src/goal-store.ts:2880`、
  `packages/quay/src/goal-store.ts:2915`、`plugin/scripts/driver-runtime.ts:1693`（后三处**互相逐字相同**）。
  ⛔ **本次不动**：本条 finding 的谓词是 8 行函数体的 `byte-identical-body`，这 4 处是**单行**、且与
  `mergeEnv` **不同义**（unset 是显式列表形态，恰是 shell 层迁移后的 L1 目标形态）；收进来要把
  `driver-runtime.ts`（`DRIVER_SCOPE_FILES` 成员，锚点拼法单入口）拉进本任务 diff，收益 3 行 vs 代价一个
  driver 文件 + 其整片静态检查面 ⇒ 留作下一次语义扫描的候选，理由写在这里而不是沉默跳过。
- **其它「删键」但规则不同（不同义，都在谓词之外）**：`plugin/scripts/peer-identity-probe.ts:483`
  （`=== "__DELETE__"` 哨兵）、`plugin/scripts/ci-runs-collect.ts:487` 与 `packages/quay/bin/quay.ts:86,108`
  （`=== undefined`）。逐条都不是「`""` = 取消继承」。
- **死锚点（本轮实测发现，已修）**：两个副本的原注释都引 `quay-launch.sh:98` 的 jq
  `with_entries(select(.value != ""))` 当规则出处。**该 jq 已不在树里**
  （`git show HEAD:plugin/scripts/quay-launch.sh | grep -c with_entries` = **0**）；shell 层已迁到显式
  `unset` 列表，并就地声明「取消继承 = 从 base env 删 unset 键（**显式列表，⛔ 非空串约定**）」
  （`quay-launch.sh:124`），`applyUnset` 即该形态的 TS 对应物。已修在**同载体**：`profile-policy.ts:12`
  的 ⚠️ 段与 kernel 叶注释都改为「本层保留 `""` 是刻意向后兼容，⛔ 不是因为 shell 层还有定义点」。
  仍带该死锚点的**历史载体**（⛔ 不在本任务 Touches，故只报数不改）：
  `orchestration/SPEC-web-session-observability-and-control-2026-08-24.md:517,757`、
  `tasks/gap-profile-policy-when-which-profile.md:29`。

### 本条不声称什么

⛔ 本条**没有**消除全仓所有「env 合并 / 取消继承」写法（见 5b 的 4 处 unset 族与 4 处不同义删键）。
只把 finding 点名的 **2 处逐字节副本收敛为 1 处**，并把「产品侧与编排侧是同一个判断」从一句注释
变成结构（判据③ 直接断言同一个函数对象）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `mergeenv-cross-layer-byte-identical-under-renamed-symbol`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/profile-policy.ts`
- `packages/quay/src/kernel/env-merge.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/kernel-env-merge.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename.md`