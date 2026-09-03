---
id: gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic
title: promotion-driver fix-worker 直接 spawn 携带 profiles.yml --model
  deepseek-v4-pro-anthropic——Claude Code CLI 不识别，近期约 85% fix 尝试超时空转
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

**回答"promotion-driver 会不会检查和纠正 DoD<40 字符这类立案缺陷"引出的实测**：会——`promotion-driver.ts` AC132/AC133 确有真实机制：不合格任务（`fourArtifacts=false missing=[dod]` 等三类可修判定）会 spawn 一个短命 `claude -p` fix worker（`buildFixWorkerArgv`/`spawnFixWorker`），退出后重新跑同一个闸验证（`⛔ 不信 worker 自述`），连续 3 次仍不合格才标 needs-human。**但实测这个纠正机制当前大部分时候根本没机会真正尝试**——被一个无关的环境/配置缺陷挡住了。

**实测证据（`.quay/promotion-outcome.jsonl`，非猜测）**：
- `gap-fan-in-doc-check-cache` 3 次 fix 尝试中 2 次（04:21:18、04:40:30）报 `spawned exit=null (timed-out) stderr=...[claude-code:unrecognized_model] {"model":"deepseek-v4-pro-anthropic","query_source":"sdk"}`；第 3 次（04:31:15）`exit=0` 但期间**零文件提交**（`git log` 核实该任务文件在 04:11:49 立案与 04:40:29 needs-human 之间无任何提交）。
- `DIR-130` 3 次 fix 尝试（11:39:53/11:43:43/11:48:43）**全部**命中同一 `unrecognized_model` 超时——本次 48h 复盘早前把 DIR-130 的 needs-human 归因为"genuine 需要人授权"，**这个归因需要修正**：机械触发原因和上面的 DoD 案例完全相同，只是碰巧事后人也确实要对它做授权决定，两件事被合并看错了。
- 全库统计：`unrecognized_model` 签名的 fix 尝试 **47 次**，时间跨度 **2026-08-25 → 2026-09-02T11:48:43**（本次分析窗口内仍在发生，非历史遗留）；抽样最近 ~2000 条 outcome 记录里 fix 尝试的 21 条中 **18 条（85.7%）** 是这个超时签名。

**根因链路（已定位到具体配置不一致，非猜测）**：
1. `.quay/profiles.yml` `worker-default.model: deepseek-v4-pro-anthropic`（`a7a507eab`，2026-08-27，为治 litellm 侧 400 风暴，给模型名加 `-anthropic` 后缀以命中 litellm fallback group）。
2. `promotion-driver.ts` 的 `buildFixWorkerArgv` 经 `driver-runtime.ts` 的 `launchArgv("fix-worker", prompt, root)` 读这份 profile，把 `--model deepseek-v4-pro-anthropic` 直接放进 spawn 的 argv。
3. `claude-fjdac` 包装脚本（`~/.local/bin/claude-fjdac`）设置 `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL="deepseek-v4-pro"`（**不带 `-anthropic` 后缀**，与①的值不一致）再 `exec claude "$@"`。
4. Claude Code CLI 收到显式 `--model deepseek-v4-pro-anthropic` 后按字面值解析，**在它自己的已知模型表里找不到这个 id**（既非真实 Anthropic 模型 id，也不匹配包装脚本 env 里那个不带后缀的值）⇒ `unrecognized_model`，进程挂起直到 `spawnFixWorker` 超时。
5. `a7a507eab` 的提交信息称"改一行连带 task-worker/selector/fix-worker/pool-judge 全部生效"——但实测只有 fix-worker（`spawnSync` 同步直调）稳定复现该问题；worker-driver 常规 task-worker 派发似乎经某个中间层（selector？）正常消化了这个模型名，没有以同一形态报 `unrecognized_model`（这一半差异**尚未验证到底层机制**，是本任务 Plan 第一步要查清的，⛔ 不在此断言）。

**影响**：任何本身可修的立案缺陷（DoD 太短、selfTouchOk、touchesNarrow 等三类可修项），只要撞上这个超时，就会白白烧掉重试预算而不是真的被尝试修复——是本次 48h needs-human 复盘里除"probe 饿死"外的另一条独立、当前仍在发生的浪费源。

**已排除的重复**：`gap-manager-layer-launch-config-test-pin-deepseek-v4-pro`/`gap-manager-layer-launch-config-test-pin-fjdac`（done，测试 pin 漂移，非本问题）；`gap-fix-worker-edit-exit-4`（done，编辑成功后 exit=4 的不同症状，其"kimi/session-title"假设已被自己的对照证伪，未覆盖 unrecognized_model）；`gap-worker-driver-selector-api-error-no-backoff`（done，治的是 400 风暴的退避策略，Proposal 里断言"模型名根因已由 a7a507eab 修"——**本任务的证据显示这个断言对 fix-worker 这条路径不成立**，硬规则 5b：在一处修好 ≠ 全部路径都修好）。

## Plan

1. 查清 worker-driver 的常规 task-worker/selector 派发路径为什么没有以同一形态复现 `unrecognized_model`（是否经过某个把模型名规范化/剥掉后缀的中间层；若有，fix-worker 的直接 `spawnSync` 调用绕过了它）。
2. 让 fix-worker 的模型解析与实际生效的模型保持一致——可选方向：① 让 `claude-fjdac` 包装脚本的 `ANTHROPIC_DEFAULT_*_MODEL` 也带上 `-anthropic` 后缀（与 profiles.yml 对齐）；② 让 `--model` 传参前先做一次规范化（剥掉 CLI 不认的后缀，只把后缀语义交给 litellm 路由层）；③ 换一个 fix-worker 专用的、CLI 端确认识别的 model 值。三选一前先确认 litellm 侧对该模型名的 fallback 依赖是否仍需要那个后缀（不能盲目改掉 a7a507eab 治好的 400 风暴）。
3. `spawnFixWorker` 对 `unrecognized_model` 这一类"根本没开始工作就超时"的失败，与"确实尝试了但改错了"的失败，做区分记录（不强制并入本任务范围，但落地时若顺手可做则做——三态可区分同硬规则 3b）。

## Acceptance Criteria

- [ ] AC1（能取假）：用与生产相同的 profile/wrapper 组合重放一次 `buildFixWorkerArgv` 产出的 argv 直接 spawn，此前必现 `unrecognized_model`；改动落地后同一 argv 不再命中该签名（负控制：不改的旧 argv 仍应复现，证明测试本身有效）。
- [ ] AC2（真实生产载体验证，非 fixture）：实现落地**之后**，`.quay/promotion-outcome.jsonl` 里新产生的 fix-worker 记录不再出现 `unrecognized_model`/该超时签名（贴出落地后的真实记录，硬规则 4 推论三：N 只计落地之后的时间窗）。
- [ ] AC3：`--for-task` scoped 门 + 全量 suite 绿；不引入新的 flaky（尤其 `manager-layer-shipping.test.mjs`/`manager-layer-skill.test.mjs` 的 model pin 断言，这两个文件是 `a7a507eab` 刚同步过的，改动前重读避免二次漂移）。
- [ ] AC4：litellm 侧 400 风暴的 fallback 路由不回归——`gap-worker-driver-selector-api-error-no-backoff` 已 done 的行为（selector API 400 有 fallback 不再一击即死）在本任务改动后仍然成立。
- [ ] AC5（三态可区分）：无法在本地复现/无法判定是否修好时，不得伪称已修——按 AC2 的真实生产载体验证为准，不靠本地 fixture 单独收尾。

## Definition of Done

真实一次 promotion-driver fix-worker spawn（非 fixture、非本地重放）不再报 `unrecognized_model`/该超时签名；AC1-AC5 全部勾选，AC2 落在实现落地之后的真实运行载体上核验过；`gap-worker-driver-selector-api-error-no-backoff` 已修的 400 风暴 fallback 行为不回归；全量 suite 绿；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- .quay/profiles.yml（worker-default model / claude-fjdac 包装层的对齐方案）
- plugin/scripts/promotion-driver.ts（buildFixWorkerArgv / spawnFixWorker 附近，如需三态诊断）
- plugin/scripts/driver-runtime.ts（launchArgv 模型解析）
- plugin/test/promotion-driver.test.mjs
- plugin/test/manager-layer-shipping.test.mjs（model pin 断言，避免与本改动二次漂移）
- plugin/test/manager-layer-skill.test.mjs（同上）
- tasks/gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic.md（自身）
