---
id: gap-m264-build-evidence-regress-flaky
status: todo
labels: []
parent: null
children: []
extra: {}
---
---
id: gap-m264-build-evidence-regress-flaky
title: "M264 regress test is flaky — green in one full-suite run, red in the next, same commit"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`plugin/test/build-evidence-manifest.test.mjs` 的 M264 regress 测试
（`incidental prose does NOT upgrade evidence class to real-workflow (no fail-open)`）
在同一次 merge 后的连续两次全量运行中结果不同：

| 运行 | 结果 | 耗时 |
|---|---|---|
| relation-sync 全量 #1 | ✔ 绿 | 3392ms |
| relation-sync 全量 #2 | ✖ 红 | 2688ms |

同一 commit、同一测试文件、同一套件配置——**flaky**。代码未变。

### 与 relation-sync 无关

relation-sync 修复只改了 `packages/quay-native/test/relation-sync.test.mjs`（harness 输出 + mkdtemp），
未触及 `build-evidence-manifest.test.mjs` 或 M264 测试。它在两次运行中都是 relation-sync 全量验证的
旁观者——relation-sync 修复本身已验证（run1 全绿、run2 仅 M264 失败）。

### 性质待查

- 隔离下是否稳定（绿/红）？
- 是否负载相关（2688ms 与 3392ms 差 700ms，可能某路径超时）？
- 失败时具体是哪条断言（手写 harness？输出是否可诊断）？

## Chosen mechanism

1. **先让它能说话**：确认失败输出是否有断言级细节；若无，参照 relation-sync 的处理加断言级输出。
2. **隔离连跑 N 次**：确认隔离下是稳定绿还是也偶发红。
3. **负载对照**：若隔离稳定绿、套件内偶发红，是负载/并发依赖（与 M136、relation-sync 同族的可能性）。

## Acceptance Criteria

- [ ] AC1: 确认 M264 隔离下是否稳定（连跑 ≥3 次记录）
- [ ] AC2: 若套件内偶发红，配对跑定位干扰源（与 relation-sync/M136 同族手法）
- [ ] AC3: 根因明确（数据不是推测），或如实记录为「隔离稳定、套件内偶发、根因待进一步定位」
- [ ] AC4: 修复后全量连跑 2 次一致（若可修）
- [ ] AC5: 任务体记录这是「隔离绿/套件红」类还是「纯偶发 flaky」的判定
- [ ] AC6: 测试带 `// @test-group engine` 声明（若产出脚本）

## Definition of Done

- [ ] AC1 的隔离连跑记录贴进任务体
- [ ] 明确记录：flaky 与既有失败不同——它每次结果不同，比「稳定红」更难定位，因为它可能被误当「修复成功」
- [ ] 若确认是同类（隔离绿/套件红），记入该类成员清单（M136 第 1、relation-sync 第 2、本任务候选第 3）

## Touches

- plugin/test/build-evidence-manifest.test.mjs
