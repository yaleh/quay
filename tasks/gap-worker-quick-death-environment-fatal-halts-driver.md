---
id: gap-worker-quick-death-environment-fatal-halts-driver
title: 环境级快速死亡（model_not_found 等）被按任务计数逐个 park：应判 environment-fatal 并 halt driver
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：worker 在 `quickDeathMs`（60s）内非零退出计为「快速死亡」，**按任务**计数（`plugin/scripts/worker-driver.ts:2727` `recordQuickDeathBackoff`，`state.counts` 以 taskId 为键），连续到上限即把**该任务**翻成 needs-human。成因分类器 `classifyQuickDeathCause`（`:2637`）只有三类（transient-external / ordinary / unclassifiable），且**只读 `selector_reason`**；worker 自己的 stderr 以 `stdio: "inherit"` 流进 driver 进程日志（`:3390`），分类器看不到。

于是一个**环境级**故障（所有 worker 必然同样失败）被当成**任务级**缺陷：driver 逐个派发任务，逐个 park，直到池子被清空。

**生产实例（claudecodeui，2026-09-20）**：`.quay/profiles.yml` 仍是出厂模板（`launcher: claude, model: null`），而本机网关只由 wrapper `claude-fjdac` export `ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN`。worker 拿着网关专用模型名 `v4.1flash` 直连公网 API ⇒ 首次调用 `404 model_not_found` ⇒ 秒死。`.quay/worker-outcome.jsonl` 中 13 条快速死亡**全部**被判 `ordinary`，载体里 `model_not_found` 出现 **0 次**；**5 个任务**被 park，判词为「连续 3 次 <60000ms 快速死亡（退避上限）」。修复方式是项目把 launcher 改成 `claude-fjdac`（claudecodeui `79b4f52c`），而不是任何任务的代码。

**修法（方向）**：
1. 分类器新增第四类 `environment-fatal`：字面签名覆盖 `model_not_found`、`401`/`invalid x-api-key`/`authentication_error`、launcher `ENOENT`、`Could not resolve host` 等（宁窄勿宽，每条签名附一条不命中的反例）。数据源除 `selector_reason` 外还要包括 **worker stderr 的末尾部分**（改为捕获最后 N KB 同时照常转发）。
2. 跨任务关联：窗口内 ≥2 个不同任务以同一签名快速死亡 ⇒ 同样判 `environment-fatal`（即使签名不在清单里）。
3. `environment-fatal` ⇒ **driver 自己 halt**：写 `.quay/worker-control.json` `halted:true` 并附原因与签名原文；⛔ 不翻转任何任务的状态，⛔ 不计入任务的快速死亡计数。
4. `quay driver start --kind worker` 启动时用解析出的 launcher + model 做一次最小冒烟调用；失败 ⇒ 拒绝启动并打印原因。

<!-- dedup-ref -->相关：`gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human`（done）引入了限流类 `transient-external`，本任务补「环境不可用」这一类，且动作是停 driver 而不是退避重试。

## AC

- [ ] `node --test plugin/test/worker-driver-fan-in-s05.test.mjs` 退出 0，新增用例：①stderr 末尾含 `404 … model_not_found` 的快速死亡 ⇒ `environment-fatal`；②两个不同任务以同一未知签名快速死亡 ⇒ 第二次判 `environment-fatal`；③`worker exited with code 1` 单任务 ⇒ 仍为 `ordinary`（负控）；④限流文本 ⇒ 仍为 `transient-external`（不回归）。
- [ ] 用例断言：判为 `environment-fatal` 后 `worker-control.json` 为 `halted:true` 且原因含签名原文；涉事任务状态保持 `ready`（未翻 needs-human），其快速死亡计数未增加。
- [ ] 启动冒烟：launcher 指向一个立即以 `model_not_found` 退出的假可执行文件时，`quay driver start --kind worker` 非零退出并打印该原因（用例或实跑输出）。
- [ ] `bash scripts/test.sh --for-task gap-worker-quick-death-environment-fatal-halts-driver` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：在一个真实第三方项目（或临时 workspace）上，把 `.quay/profiles.yml` 的 launcher 故意指向缺网关环境变量的 `claude`、模型设为网关专用名，启动含修复版本的 worker driver：driver 在第一轮就 halt，`worker-control.json` 带 `model_not_found` 原文，池中没有任何任务被翻成 needs-human。完成记录附 `worker-control.json` 原文与 `git log -- tasks/` 为空的证据，然后恢复 profiles。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/worker-driver-fan-in-s05.test.mjs
- plugin/test/helpers/worker-driver-fan-in-harness.mjs
- tasks/gap-worker-quick-death-environment-fatal-halts-driver.md
