---
id: gap-dead-set-registry-bare-filename-scan
title: 死集闭包检测不到注册表里的裸文件名引用（quay-deliver.ts:19 的
  supervisor-bus-identity.sh）——AC156 裸文件名扫描 + 死集重算，AC158 的硬前置
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12f 记录的已知检测缺口：
`plugin/scripts/quay-deliver.ts:19` 以 **`file: "supervisor-bus-identity.sh"` 这种裸文件名清单项**引用脚本，
而 §12e 的传递闭包只识别**两种形式**——import 说明符、`node|bash|sh|tsx … plugin/scripts/<name>` 调用行
⇒ **注册表/清单里的裸文件名引用检测不到** ⇒ 死集里可能混进仍被清单引用的脚本，archive 它们会留下悬空引用或直接弄红检查。

**同族先例（机制相邻、已 done，供参照，⛔ 不是重复）**：
`gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure` ——
那次是 **laydown 派生**的前缀正则漏掉裸文件名（`transcript-delivery-check.ts` 因被裸名引用而没被落地），
本次是**死集闭包**漏掉裸文件名。**同一个"引用拼写敏感性"缺陷类别的第二个实例，载体不同**
（那个已修的是 `quay-init.sh` 的派生正则，本任务动的是死集闭包的判定面）。

⛔ **`capability-catalog.sh` 不算引用**——它是**对种群的描述**，不是使用；
把 catalog 条目当引用会让所有脚本永远活着，那正是硬规则 4 说的「结构上不可能取假的量」。

**为什么必须重算而不能沿用 SPEC 的名单**：SPEC §12e 自述那份 97 个的清单是
「**带测量日期的快照，不是活文档**」，并明写「执行 archive 前须按 §12d 重算一次」。
本任务立案当天已发现该快照的一个腐烂实例（§11b 引用的 `monitor-mount-check.sh` 已被删除）。

## AC

- [ ] AC1 扫描器：新增 `plugin/scripts/registry-bare-filename-scan.ts`，在注册表/清单类载体（`quay-deliver.ts` 这类以数组/映射登记脚本的地方、`*.json` 清单）中**按位置**扫裸文件名引用；显式排除 `capability-catalog.sh`。
- [ ] AC2 对已知真样本干跑（零计数的配套动作）：对 `plugin/scripts/quay-deliver.ts` 里的 `supervisor-bus-identity.sh` **必须命中**，并**打印命中的前 3 条实际内容**；命中数为 0 时判谓词写错，⛔ 不判「无此类引用」。
- [ ] AC3 死集重算：按 SPEC §12d 判据重算一次死集（⛔ 不得直接沿用 §12e 的 2026-09-02 快照名单），报出 **before/after 两个数字**与被摘出对象的清单，全部入任务体，并产出一份**机器可读**的重算结果文件。
- [ ] AC4 执行读数来源须已修：重算若使用 `runtime-usage-inventory.ts` 的执行数据，则须在 `gap-runtime-usage-inventory-workflow-blind-spot` 落地之后进行（该仪器有已知枚举盲区，SPEC §11b 明写其 `unaccounted` 清单不得作退役依据）；若改用手工实测方法，须在任务体写明方法与时间窗。二者择其一并写明。
- [ ] AC5 生产调用者：扫描器须有一个真实调用点（archive 流程或套件），⛔ 不得只被自己的测试调用——SPEC §12d 明确「它自己的测试不算生产调用者」，死集里 56/94 正是这一类。

## DoD

产出一份**重算后**的死集清单（机器可读文件已落盘），清单中不含任何被裸文件名引用的脚本，
且该结论以 AC2 的样本作过一次负控制（把 `supervisor-bus-identity.sh` 从清单载体里删掉，它应重新落回死集）。
⛔ 仅有扫描器脚本与单测不算达成——本任务的产物是**一份可被 AC158 直接消费的清单**，不是一个工具。

## Touches

- plugin/scripts/registry-bare-filename-scan.ts（新，裸文件名引用扫描器）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/test/registry-bare-filename-scan.test.mjs（新，含 quay-deliver.ts 真样本命中与删除即落回死集的负控制）
- tasks/gap-dead-set-registry-bare-filename-scan.md（自身）
