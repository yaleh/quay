---
id: gap-mirror-mechanical-fanin-fail-open-posture-undocumented
title: mirrorMechanicalFanInSuiteState 的 fail-open 姿态缺一份写下来的理由——形状与硬规则 3b
  同形（void + 静默 return + 空 catch），而它成立靠下游 fail-closed；补说明、零行为改动
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**这一项不是"退"，是"补说明"**——`mirrorMechanicalFanInSuiteState` 的 fail-open 姿态**本身是正确的**，但它**缺一份写下来的理由**；而它缺理由的那部分，恰好是硬规则 3b 的形状（"读不懂 ⇒ 沉默 ⇒ 与合格同形"）。下一个读到它的人有相当概率把它"修"成 fail-closed，而那个"修复"会红掉真实绿的 suite。

### （一）现状（现场核实，行号逐字）——`plugin/scripts/worker-driver.ts:5094`

```ts
export function mirrorMechanicalFanInSuiteState(opts: { … }): void {
  try {
    const built = buildMirrorState({ state: "green", … });
    if (built.error) return;                                              // :5109
    if (shouldSkipMirrorWrite(readCurrentState(opts.stateFile))) return;   // :5110
    writeMirrorState(opts.stateFile, built.state);
  } catch {                                                                // :5112
    // best-effort：镜像写失败 ≠ fan-in 失败（mfi 仍是权威）。              // :5113
  }                                                                        // :5114
}
```

三个沉默点：`void` 返回、`:5109` 静默 `return`、`:5112-5114` 空 `catch`。**外部无法从返回值区分"写了"与"没写"。**

### （二）为什么这是可接受的（下游 fail-closed，现场核实）

镜像的消费者**不是信任它，而是校验它**：

- ff 闸 `packages/quay/src/fan-in/ff-merge.ts:421 readGreenMirrorCommit(stateFile, taskId)`：
  ```ts
  if (s && s.state === "green" && s.taskId === taskId
      && typeof s.commit === "string" && /^[0-9a-f]{40}$/i.test(s.commit)) return s.commit;
  …
  return "";
  ```
  其上方注释逐字写明：**"⛔ no fake full-green: taskId must match ∧ state=green ∧ commit is 40-hex (a full-run green with no taskId, or another task's bucket green, must NOT impersonate this task's certificate)"**。
- 取不到 ⇒ `""` ⇒ `:441` 的分支不生效 ⇒ `suiteExit` 保持未设 ⇒ `suiteCertGate` 返回 `{ ok: false }`（**fail-closed**）。
- 且拿到的 commit 还要过祖先校验：`ff-merge.ts:447` `git merge-base --is-ancestor suiteHead suiteTip`。

**⇒ 陈旧/串任务的镜像会在 `taskId` 不匹配处被拒**，不会伪装成本任务的绿证书。**因此这不是硬规则 3b 意义上的"恒绿伪装"**：`void` + 空 `catch` 在这里是"观测写不得阻塞主执行"（人 2026-08-30 裁定）的正当实现，而不是"读不懂就当作合格"。

### （三）缺的是什么

上面（二）这段论证**只存在于本次立案分析里，不在代码旁**。代码旁的注释（`:5113`）只说了 "best-effort"，**没有写"为什么 best-effort 在这里是安全的"**。于是一个只读代码的人看到的形状是：

> `if (built.error) return;` + `catch {}` —— "错误被吞掉，且没有留下任何可区分的取值"

这正是硬规则 3b 的教科书形状。**判据（硬规则 3b 自己的话）：一个判定的输出词表里，若没有"未评估"这一态，它就无法区分"查过且合格"与"没查成"。** 本函数确实没有第三态——**它靠下游有第三态（`null` / `""`）而成立**。这个"靠谁成立"必须写在它旁边。

## Contract

**产出 = 一段写在 `mirrorMechanicalFanInSuiteState` 紧邻处的说明**（代码注释；若该文件的注释密度不允许，则写在它所属的设计文档并在函数处留指针）。**⛔ 零行为改动**——不加返回值、不加日志、不改 `void`、不加 fail-closed。

说明**必须逐条点名**（⛔ 不得只写"下游是安全的"这种不可证伪的句子，否则本任务自己犯硬规则 4 推论四）：

1. **本函数的沉默是有意的**：`void` 返回是设计（观测写不得阻塞主执行，人 2026-08-30 裁定）。
2. **下游在哪、叫什么**：`packages/quay/src/fan-in/ff-merge.ts` 的 `readGreenMirrorCommit`（**文件名 + 函数名必须写准**；⛔ 不得写"ff 闸会校验"这类模糊说法）。
3. **下游的三个条件逐条列出**：`state === "green"` ∧ `taskId` 匹配 ∧ `commit` 匹配 `/^[0-9a-f]{40}$/i`；取不到 ⇒ 返回 `""` ⇒ 闸 fail-closed。另记 `:447` 的祖先校验。
4. **另一路消费者的第三态**：`worker-driver.ts:4114 readPreviousGreenSuiteCommit` 同形，其注释已写明"取不到 / 非本任务 / 非 green / commit 非法（非 40-hex）⇒ null（缺值 = 未查，⛔ 不是「可复用」）"——**本说明应指向它作为同一纪律的第二实例**（单源：⛔ 不要另写一套条件表）。
5. **一个可证伪的反例句**（硬规则 4 推论四）：说明须给出"若下游不是 fail-closed，本姿态会错在哪"——即**若 `readGreenMirrorCommit` 只查 `state === "green"` 而不查 `taskId`，则上一个任务的绿镜像会伪装成本任务的证书**。这一句是这份说明的**可检验性来源**，不可省。

## AC

- [ ] AC1：在 `mirrorMechanicalFanInSuiteState` 紧邻处加入说明，**逐条含 Contract 的 5 项**；贴 `git diff`。⛔ 行为零改动——`git diff` 中不得出现任何非注释行（机械可查，见 DoD）。
- [ ] AC2（取证，不是转述）：说明中引用的两个落点（`ff-merge.ts` 的 `readGreenMirrorCommit`、`worker-driver.ts` 的 `readPreviousGreenSuiteCommit`）**落地当轮须现场复核**（`grep -n` 取该行贴出）。⛔ 若行号已漂移，改为「函数名 + 就近锚点」引用，**不得留一个错的 `file:line`**（本仓库已多次因行号漂移误判）。
- [ ] AC3（可证伪性：构造反例对照，硬规则 4 推论四）：**干跑一次**，取得两条读数——用一对 fixture 驱动 ff 闸的镜像回退路径（`ff-merge.ts:440` `args.suiteState`，CLI 旗标 `--suite-state` 见 `:753`；令 capture 缺失以走回退）：
  - **读数①（taskId 不匹配）**：`full-suite-state.json` 写 `state=green` + 一个**别的任务**的 `taskId` + 合法 40-hex `commit` ⇒ 闸**拒绝**（fail-closed）。
  - **读数②（taskId 匹配）**：同 fixture 只把 `taskId` 改成本任务 ⇒ 回退**生效**。
  两条读数不同 ⇒ Contract 第 5 项那句因果链**被验证**；贴出两条命令与输出。
  **⛔ 若该路径无法在不产生副作用（真实 merge）的前提下驱动**：改用对 `readGreenMirrorCommit` 同形逻辑的直接调用或既有测试内的等价 harness，**但两条读数仍是必交项**；确实取不到时，须在任务体显式记明"**本条降为假说**"，⛔ 不得只论证不跑、也不得静默略过。
- [ ] AC4：跑覆盖本函数与 ff 闸的既有测试（`plugin/test/mirror-full-suite-state.test.mjs` 及 ff-merge 相关用例）全绿，证明改动无行为差异。
- [ ] AC5：`bash scripts/test.sh` 全量绿；命令与结果贴进任务体。

## DoD

- **零行为改动的机械证据**：`git diff -U0 plugin/scripts/worker-driver.ts` 中的增删行**全部是注释行**——
  ```
  git diff -U0 plugin/scripts/worker-driver.ts | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*|/\*)'   # → 空
  ```
- 说明的 5 项逐条可见（AC1 的 diff 里逐条贴出）。
- AC3 的两条读数贴出（或显式记"降为假说"及其原因）。
- `bash scripts/test.sh` 一次真实全量绿的命令与结果贴进任务体。

## Touches

- plugin/scripts/worker-driver.ts（仅注释）
- tasks/gap-mirror-mechanical-fanin-fail-open-posture-undocumented.md