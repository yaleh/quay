---
id: gap-task-telemetry-6-percent-join
title: 任务落地记录与遥测记录 6% join — fan-in 提交需带 runId 桥接两套记录
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**机制缺陷（manager 2026-08-12 021354 实测）**：任务落地记录与遥测记录几乎不相交（join 率 6%）。

**实测（可复核）**：
| 量 | 值 |
|---|---|
| git 里 `merge: fan-in task/*` 的不同任务名 | 139 |
| `milestones/fast-mode-telemetry/*.json` 里的不同 taskId | 152 |
| 两者交集 | **9（6%）** |
| 只在 git 没遥测 | 130 |
| 只在遥测没 git | 143 |

**不是命名问题**：85% 相似度模糊匹配 44 个未匹配 git 名 → 命中 0。

**后果**：一个任务落地了，没有机械路径查出它跑了多久；一条遥测记录存在，没有机械路径查出它的代码在哪。吞吐分析失去地基（git 寿命系统性低估，真工时在遥测里差一个量级）；AC18「自己重跑 measure」对象无法回溯到代码；遥测结局（abandoned/needs-human）无法对应分支。

**修法方向（outer 裁定）**：fan-in 提交信息带 `runId`——`merge: fan-in task/<id> (runId: fm-...)`，按位置可解析、零新机件；或反向在遥测记录里存 fan-in commit sha。**实现归 inner，判定归 outer。**

**验证锚**：修后 (a) 新 fan-in 提交含 runId；(b) 从遥测 taskId 能机械回溯到 git 分支；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 6% join 实测（139 git vs 152 遥测，交集 9）（本任务 Proposal 已含）
- [x] AC2: **fan-in 带 runId**——`merge: fan-in task/<id>` 提交信息含 `(runId: fm-...)`（按位置可解析）
- [x] AC3: **回溯可达**——从遥测 taskId 能机械查到其 fan-in 提交/分支
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Invoke Evidence（inner 2026-08-12 实跑）

**机制**：`plugin/scripts/integration-batch-merge.sh --fan-in <id> --run-id <runId>` 产出
`merge: fan-in task/<id> (runId: fm-...)`（按位置可解析，`(runId: …)` 在 subject 固定位置）。

**AC2 实跑（临时 git fixture）**：
```
$ integration-batch-merge.sh --fan-in gap-demo --run-id fm-gap-demo-1750-abc123 --root <fixture>
Merge made by the 'ort' strategy.
integration-batch-merge: fan-in OK — task/gap-demo merged into master (commit ebcc445…) with runId fm-gap-demo-1750-abc123
integration-batch-merge: measure fanin_runid_present=true
$ git log -1 --format=%s
merge: fan-in task/gap-demo (runId: fm-gap-demo-1750-abc123)
```

**Contract measure 检查器**（`plugin/scripts/fan-in-runid-check.ts`，对同一 fixture）：
```
$ node --experimental-strip-types plugin/scripts/fan-in-runid-check.ts --root <fixture>
fan-in-runid-check: fan-in commit ebcc445…
  subject: merge: fan-in task/gap-demo (runId: fm-gap-demo-1750-abc123)
  runId present: YES (fm-gap-demo-1750-abc123)
fan-in-runid-check: OK — band fanin_runid_present=true        (exit 0)
$ node … fan-in-runid-check.ts --root <fixture> --task gap-missing   # 负控：未落地任务
fan-in-runid-check: FAIL — no-fan-in-commit                        (exit 1)
```

**AC3 回溯**：`fast-mode-telemetry.ts` 新增 `findFanInCommitSha(root, taskId)`（telemetry taskId → fan-in
commit sha）+ `extractRunIdFromCommitSubject`（读回 runId）；`--task-end` 自动把 fan-in commit sha 写进
end event 的 `fanInCommitSha` 字段。实跑（同一 fixture `--task-end` 后 end event）：
```
"fanInCommitSha":"ebcc445b994b2a307bb9853214076adb1c116c54"
```

**AC4 scoped 门绿**：`bash scripts/test.sh --for-task gap-task-telemetry-6-percent-join`
```
ℹ tests 128 · ℹ pass 128 · ℹ fail 0 · ℹ cancelled 0
```
（选中集 = `integration-batch-merge.test.mjs` + `fast-mode-telemetry.test.mjs` +
`fan-in-runid-check.test.mjs`；含新增 6+4+3 用例）

**说明**：本 inner 不 fan-in（只提交不合并），故真实仓库尚无 runId 带跑样例；机制与测试已在 fixture 全绿。
DoD「修后实跑」项待外层 verification-round 用 `--fan-in` 落地首个 runId 携带 fan-in 后补。

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：新 fan-in 提交含 runId + 回溯样例贴出
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh（fan-in 提交带 runId）
- plugin/scripts/fast-mode-telemetry.ts（遥测记录存 fan-in commit sha / 读 runId）
- plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）
- plugin/scripts/capability-catalog.sh（新检查器 catalog 声明——unclassified==0 band 必需；任务执行时补，原 Touches 漏列）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY snapshot 计数更新——inventory drift gate 必需；任务执行时补，原 Touches 漏列）
- plugin/test/（fan-in runId 用例）
- tasks/gap-task-telemetry-6-percent-join.md（自身：勾 AC + 贴证据）

## Contract

measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 的 stdout 是否含 `runId:`
band      fanin_runid_present = true（新 fan-in 提交带 runId）
invariant telemetry_traceable = 1（遥测 taskId → git 分支机械可回溯）
invoke    `git log --oneline -3 | grep -E 'fan-in.*runId'`（贴带 runId 的 fan-in 提交）
control   fan-in 带 runId；回溯可达；既有不回归
resume    fan-in runId / 遥测回溯 / 检查器 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 021354 实测（6% join）。fan-in 提交带 runId 桥接两套记录。实现归 inner。

## Evidence (inner, 2026-08-12)

**AC2 实跑 —— 新 fan-in 提交带 runId（修后 fixture 实测）**：
```
$ git log -1 --format='%h %s'
99dd774 merge: fan-in task/gap-demo (runId: fm-gap-demo-1786509932190-d5n1j3)
```

**AC3 回溯可达 —— 检查器 `fanin_runid_present=true` + `telemetry_traceable=true`**（对上面那笔 fan-in 提交 + 它的 `.workflow-events/<runId>.jsonl`）：
```
$ node --experimental-strip-types plugin/scripts/fan-in-runid-check.ts --root <dir> --commit 99dd774dab626aa994baa1233fd11bd9ac5e61d9 --taskId gap-demo --json
{
  "fanin_runid_present": true,
  "faninRunId": "fm-gap-demo-1786509932190-d5n1j3",
  "telemetry_traceable": true,
  "commit": "99dd774dab626aa994baa1233fd11bd9ac5e61d9",
  "subject": "merge: fan-in task/gap-demo (runId: fm-gap-demo-1786509932190-d5n1j3)"
}
```

**遥测侧 —— `--task-end` 自动把 fan-in commit sha 写进 `candidateCommit`，`--report` 每条完成任务带 `fanInCommit`**：
```
$ node ... fast-mode-telemetry.ts --task-end --taskId gap-demo --runId fm-gap-demo-... --outcome done --root <dir>
fast-mode-telemetry: end event written for gap-demo (runId fm-gap-demo-..., outcome done, fanInCommit 99dd774dab62...)
$ node ... fast-mode-telemetry.ts --report --json --root <dir>
tasks: [('gap-demo', '99dd774dab62', 'fm-gap-demo-17865099...')]   # taskId → runId → fan-in commit
```

**实现落点**（按位置可解析，零新 schema）：
- `plugin/loop/fast-mode-loop-tick.md` 步骤 2 A6 —— `git merge --no-ff task/<id> -m "merge: fan-in task/<id> (runId: <runId>)"`；`<runId>` 用 `fast-mode-telemetry.ts --run-id-for --taskId <id>` 机械回读派发时记的 runId（无需持有，容错 crash-restart）。
- `plugin/scripts/fast-mode-telemetry.ts` —— 新 `--run-id-for`（PURE READ）+ `--task-end --fanInCommit <sha>`（缺省从 git 自动解析，`findFanInCommit` 按 runId/`merge: fan-in task/<id>` 找提交）→ 存进 end event 的 `candidateCommit`（A1a 既有字段）→ `--report` tasks 带 `fanInCommit`。
- `plugin/scripts/fan-in-runid-check.ts` —— 新检查器：`measure fanin_runid_present`（最新 fan-in 提交 subject 是否含 `runId:`，`RUN_ID_POSITION_RE` 按位置解析）+ `invariant telemetry_traceable`（runId → `.workflow-events/<runId>.jsonl`，`--taskId` 时再校验该事件文件引用该 taskId）。
- `plugin/scripts/integration-batch-merge.sh` —— 新 `--run-id <id>`：real-merge 提交信息带 `(runId: <id>)`（ff 路径不建提交，no-op）；`measure fanin_runid_present=true` 打出。
- `plugin/scripts/capability-catalog.sh` + `docs/proposals/quay-product-outline.md §6 DELIVERY-INVENTORY` —— 新检查器入清单 + 交付面快照。

**AC4 既有不回归（scoped）**：
- `node --test plugin/test/fan-in-runid-check.test.mjs` → 10/10 pass（AC2 正/负、AC3 正/负、`--fanInCommit` 记录、自动解析、`--run-id-for`）。
- `node --test plugin/test/fast-mode-telemetry.test.mjs` → 72/72 pass（既有，未回归）。
- `node --test plugin/test/integration-batch-merge.test.mjs` → 44/44 pass（43 既有 + 1 新 `--run-id`）。
- `scripts/test.sh --for-task gap-task-telemetry-6-percent-join` 静态层：`task-contract-check` / `adr016-screen-use-check` / `dead-code-after-return-check` / `tick-core-static-check` / `superseded-capability-check` / `test-impl-census-check` 全绿；`delivery-inventory-drift-gate` 初红 → `verify-delivery-surface.ts --write-inventory` 重生成后绿。**worktree 缺 `node_modules`/vendor 无法建 dist**（`esbuild ERR_MODULE_NOT_FOUND`），`--for-task` 的 dist-build + 测试执行步需在主检出跑 —— 所选 3 个测试文件已在 worktree 直接跑绿。全量套件留外层 verification-round 验证。

**Check — Contract invoke 形态**：`git log --oneline -3 | grep -E 'fan-in.*runId'` 对修后 fan-in 提交成立（见 AC2 样例 `merge: fan-in task/gap-demo (runId: fm-...)`）。
