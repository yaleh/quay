---
id: gap-archive-mechanism-and-exclusion-wiring
title: archive 机制本体尚不存在——落 archive 批次目录 + INDEX.tsv 七字段 + 五个排除面接线（AC157，AC158 执行
  archive 的硬前置）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-09-02 裁定：「**对零调用的工具，先退役（archive），后续发现需要了再恢复。**」
⇒ archive 是**默认动作**而非例外，**举证责任反转**：留下要理由，退役不需要。
`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12a–§12c 已定形状，本任务只把它**建出来**：

- 落点 `archive/<YYYY-MM-DD>-<slug>/<保持原始相对路径>`——保持原始相对路径是为了让**恢复是机械的**（`git mv` 回去即可）。
- `archive/INDEX.tsv` 七字段：`original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`，
  其中 **`evidence` 必须是可复核的读数**（如 `exec_3d=0 callers=0 own_test=yes`），⛔ 不是形容词。
- **五个排除面必须一并接线，否则必红**（§12c）。

⛔ **archive 必须在 `plugin/` 之外**——`packages/quay/package.json` 的 `files` 含 `"plugin"`，
放进去会**随每次发布交付一堆死物**；且 `capability-catalog.sh` 按目录列举 `plugin/scripts`，
子目录形式的 archive 会污染它的清单。npm 侧无需额外处理（`files` 是白名单，`archive/` 天然不在内）。

**本任务只建机制，不移动死集**——移动是 AC158，SPEC 规定它以本任务与 AC156 裸文件名扫描为前置。
**判据落在"真的 archive 一个东西然后套件还绿"上，不落在"目录和表头存在"上**：
后者是文件存在性自证，属硬规则 4 说的结构上不可能取假的量。

## AC

- [ ] AC1 落点与索引：建立 `archive/INDEX.tsv` 并写入 SPEC §12a 的七字段表头；归档路径遵循「保持原始相对路径」约定。
- [ ] AC2 五面接线：`plugin/scripts/capability-catalog.sh`、`plugin/scripts/runtime-usage-inventory.ts`、`scripts/test.sh` 的测试 glob、laydown/交付面闭包（`plugin/scripts/quay-init.sh` 的 `derive_loop_scripts` 与 `plugin/scripts/laydown-set-check.sh`）、`scripts/version-consistency-check.ts` 各自排除 `archive/**`。
- [ ] AC3 端到端负控制（**判据是这一条**）：真实 archive 一个对象及其自带测试（从 SPEC §12e 安全核里选一个），跑全量套件必须**绿**；随后**逐个**撤掉五面中任一面的排除，各自必须**红**——五个红读数逐条入任务体（缺哪一条就说明那一面没真正接线，与"忘了接"在记录上无法区分）。
- [ ] AC4 恢复协议干跑：对同一对象执行 SPEC §12b-3 的恢复（`git mv` 回原路径 + 删 INDEX 行 + 重新登记 catalog 声明/测试 glob/Touches），套件仍绿；恢复不是只把文件放回去，这一点须在读数里体现。

## DoD

一个**真实脚本**经本机制被 archive（套件绿）并被恢复回来（套件仍绿），且 `git mv` 与 INDEX 行落在**同一个提交**里
（硬规则 7：要求记录某动作，就不能把记录排在动作之后）；AC3 的五个"撤掉即红"读数已入任务体。
⛔ 仅建目录与表头、或只跑通一次 archive 而未做撤排除的负控制，均不算达成。

## Touches

- archive/INDEX.tsv（新，七字段索引）
- plugin/scripts/capability-catalog.sh（排除 archive/**）
- plugin/scripts/runtime-usage-inventory.ts（排除 archive/**）
- plugin/scripts/quay-init.sh（derive_loop_scripts 排除 archive/**）
- plugin/scripts/laydown-set-check.sh（laydown 闭包排除 archive/**）
- scripts/test.sh（测试 glob 排除 archive/**）
- scripts/version-consistency-check.ts（排除 archive/**）
- plugin/test/archive-exclusion-wiring.test.mjs（新，五面各自的撤排除即红负控制）
- tasks/gap-archive-mechanism-and-exclusion-wiring.md（自身）
