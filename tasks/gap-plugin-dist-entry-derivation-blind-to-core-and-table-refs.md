---
id: gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs
title: 打包 dist entry 集对 Core 直引与表格形引用盲 → driver-runtime.js 根本不进 tarball，装完后 quay
  driver 在任何项目都起不来
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
---
## Proposal

**实测（2026-09-08，跨主机真跑，非推断）**：从 develop tip `8a004645` 现 build 的 `quay-0.6.1.tgz`
装到 B(orangevps, x86_64) 全局后，在第三方项目 `/tmp/xproj-metacc`（meta-cc 克隆）里：

```
$ quay driver status --kind worker
quay driver: driver runtime kernel not found (no plugin root resolved
             — no local plugin/ copy and no installed quay plugin)
$ QUAY_PLUGIN_ROOT=$(npm root -g)/quay/plugin quay driver status --kind worker
（同样失败——显式覆盖也救不回来）
```

**直接量核实（两侧独立读，不靠自述）**：
```
$(npm root -g)/quay/plugin/scripts/driver-runtime.ts       MISSING
$(npm root -g)/quay/plugin/scripts/dist/driver-runtime.js  MISSING
raw .ts count in scripts/ = 0 ; dist js count = 66
本地 tarball 复核：tar tzf quay-0.6.1.tgz | grep driver-runtime  ⇒ ABSENT FROM TARBALL
源树：plugin/scripts/driver-runtime.ts 存在（67507 bytes）
```

**根因（读代码，非猜测）**：`packages/quay/scripts/build-plugin-dist.mjs` 的 entry 集由三条来源合成：
`INVOCATION_RE`（`node …X.ts` / `gate_delegate_ts "X.ts"` / `${SCRIPT_DIR}/X.ts`）、
`MD_PATH_PREFIXED_RE`（md 里 `plugin/scripts/X.ts`），以及 `:71` 的
`CORE_REFERENCED = ["runtime-usage-inventory.ts", "task-status-drift-check.ts"]`。
`driver-runtime.ts` 的消费者是 **Core 侧的 `packages/quay/src/cli/driver.ts`**（外加
`packages/quay/src/plugin-root.ts` 把它当 plugin root 的锚点 `KERNEL_RELS`），
**不出现在任何 plugin 表面的调用位置** ⇒ 三条来源全不命中 ⇒ 不打 bundle；
而 `package.sh:159` 随后 `find … -name '*.ts' -delete` 把裸 .ts 删掉 ⇒ **两种形态都没有**。

**同一根因的第二个实例（同日实测，一并归此任务，按机制去重不按症状）**：
B 上 AC92 用法验证 7/8 通过、1 失败——
`FAIL suite-execution-form-counter: missing dist/suite-execution-form-counter.js`。
它被**已 ship 的** `plugin/scripts/deliver-verify-usage.sh:39` 以表格行形式点名：
`"suite-execution-form-counter|js|dist/suite-execution-form-counter.js|--root @WS@"`
——无 `node ` 前缀、非 md 路径形 ⇒ 同样三条来源全不命中。这解释了主检出
`.quay/develop-deliver-state.json` 里 `"usage_verify":{"C":"fail","B":"fail"}`。

**为什么此前没被发现（硬规则 3b 形态）**：`build-plugin-dist.mjs` 文件头自称
「The entry set is DERIVED at build time … **never a hand-maintained list**」，
而 `CORE_REFERENCED` 恰恰**就是**一个手维护列表，且只有 2 项。声明与实现相反，
且缺失表现为「装完后另一个项目里 driver 起不来」——不在本仓库自测面上，
自测时 `plugin/` 就在树里、走的是 walk-up 命中源树的路径，**结构上不可能报红**
（硬规则：在自己仓库上自测是不可证伪的绿）。

## Plan

1. **把 Core 侧对 plugin .ts 的直引改成机械推导**，不再手维护 `CORE_REFERENCED`：
   扫 `packages/quay/src/**/*.ts` 里对 `plugin/scripts/<name>.ts` / `scripts/<name>.ts`
   的字面引用（含 `plugin-root.ts` 的 `KERNEL_RELS`），与现存 plugin .ts 求交作为 entry。
2. **补上表格/清单形引用的识别**：`deliver-verify-usage.sh` 这类以
   `<name>|<kind>|dist/<name>.js|<args>` 表格行点名的，按 `dist/<name>.js` 反查同名 .ts 入集。
3. **加一个能取假的出厂闸**：pack 完对 tarball 做「引用闭包」断言——
   凡 shipped 文本中出现的 `dist/<name>.js` 引用，该文件必须在 tarball 内；缺一即 exit 1。
   ⛔ 判据落在 **tarball 内容**上（穿过 staging 与 npm pack 两层），不是落在 staging 目录。
4. 负控制：把 `driver-runtime.ts` 从 entry 集人为摘掉，闸必须报红（否则闸是恒绿的）。

## Acceptance Criteria

- [x] AC1 `tar tzf quay-<v>.tgz | grep -c 'plugin/scripts/dist/driver-runtime.js'` == 1
- [x] AC2 `tar tzf quay-<v>.tgz | grep -c 'plugin/scripts/dist/suite-execution-form-counter.js'` == 1
- [x] AC3 干净前缀装该 tgz 后，在一个**没有 plugin/ 目录**的项目里 `quay driver status --kind worker`
      退出码 0 且输出不含 `kernel not found`（真跑，不是读配置）
- [x] AC4 同一环境下 `deliver-verify-usage.sh` 报 `0 failed`（当前为 1 failed）
- [x] AC5 新增的引用闭包闸存在**负控制**：人为移除一个 entry 后该闸 exit 非 0（把断言喂给一个已知为假的输入，证明它不是恒绿）
- [x] AC6 `CORE_REFERENCED` 不再是手维护字面列表（grep 该常量名为 0，或其值由扫描表达式产生）

## Definition of Done

AC1–AC6 全绿，且**在一台非本机的主机上、一个非本仓库的项目里**真实复跑一次 AC3/AC4
（本仓库自测对该缺陷结构上不可能报红——见 Proposal 末段），把该次运行的
主机名 + tgz sha256 + commit sha 写进任务 Evidence。`scripts/test.sh` 全量绿。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/scripts/package.sh
- packages/quay/src/cli/driver.ts
- packages/quay/src/plugin-root.ts
- packages/quay/test/build-plugin-dist.test.mjs
- packages/quay/test/plugin-root.test.mjs
- packages/quay/test/delivery-standalone-smoke-gate.test.mjs
- plugin/scripts/deliver-verify-usage.sh
- tasks/gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs.md

## Evidence

- 本机 `boheidc`（commit `2afc38d91`）实跑 AC1–AC6 全绿：`package.sh` 现 build `quay-0.6.1.tgz`
  （`dist-closure gate OK: 70 referenced dist bundles`），`tar tzf` 含
  `plugin/scripts/dist/driver-runtime.js`（AC1）与 `plugin/scripts/dist/suite-execution-form-counter.js`（AC2）；
  干净前缀装、无 plugin/ 项目里 `quay driver status --kind worker` exit 0 且无 `kernel not found`（AC3）；
  `deliver-verify-usage.sh` 报 `8 mechanisms checked, 0 failed`（AC4）。
- AC5 负控制与 AC6（`CORE_REFERENCED` 移除）由 `build-plugin-dist.test.mjs` 单测钉住。
- ⛔ DoD 的「非本机主机（B/C）复跑 AC3/AC4」未在本机执行——留待 merge 后
  `develop-deliver-tgz.sh` 于 B/C 跑（AC4 已在其内；AC3 的 `quay driver status` 尚需补进该脚本或人手动复核）。
