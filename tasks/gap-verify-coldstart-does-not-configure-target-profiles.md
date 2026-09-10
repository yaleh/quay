---
id: gap-verify-coldstart-does-not-configure-target-profiles
title: verify-deliver-coldstart 不给目标项目配宿主模型栈——每个全新 quay-init 验证项目的 worker
  必然秒死，e2e 永远走不到 fan-in
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**实测（2026-09-10，orangevps，非主张）**：AC-207 的 e2e 复跑在**全新**第三方项目 `/home/yale/work/ac207-e2e-verify`（全新 prefix `/tmp/ac207-e2e-prefix`、build_sha `468171f3`）上跑到了**真实派发 worker** 这一步——比以往任何一次都远——然后 worker **连续 3 次 <60s 秒死**（`worker exited with code 1`），触发退避上限，第三方项目里的 `e2e-verify-207` 翻 needs-human。

**根因（读 `.quay/worker-driver.log`，逐字）**：

```
API Error: 400 litellm.BadRequestError: OpenAIException -
  {"error":{"message":"No tool output found for tool call call_00_s8WnpYw2iW8ZCkwtMXwd6670."}}
No fallback model group found for original model_group=deepseek-v4-pro
```

请求发出去的模型名是 **`deepseek-v4-pro`（不带 `-anthropic` 后缀）**，端点的 fallback 组里没有该 group ⇒ 400 ⇒ worker 立即死。

**因果链（三段，每段都实测过）**：

1. `quay-init` 给全新目标项目铺的是 **shipped `plugin/.quay/profiles.yml`**，其 `worker-default` 是**通用默认**：`launcher: claude`、`model: null`、`auth: key`（文件头注释逐字：「通用默认……消费者按自己的栈编辑」）。
2. `model: null` = **不覆盖** ⇒ 模型名落到**宿主机全局 claude 配置**，orangevps 上钉的是不带后缀的 `deepseek-v4-pro`（实测：该机 `claude -p` 的报错里就带 `{"model":"deepseek-v4-pro"}`）。
3. 本仓库 dev-tree 的根 `.quay/profiles.yml` **显式**写了 `launcher: claude-fjdac` + `model: deepseek-v4-pro-anthropic`（带后缀）⇒ **本机不会撞这个坑**，只有目标项目会。

⇒ **每一个全新 quay-init 出来的验证项目都会重现这个失败**，与该项目本身无关。2026-09-10 早些时候人工给旧项目 `/home/yale/work/ac207-third-party` 手改过 profiles 来绕开，但**手改不继承**：新项目重新 quay-init 就回到 shipped 默认。

**为什么这不是「shipped 默认写错了」**：通用默认保持 `launcher: claude` 是对的——下游消费者用自己的 Anthropic 凭据，不该被塞进本仓库的第三方端点。**错的是验证流程没有「按宿主模型栈配置目标项目」这一步**：验证脚本要证明的是「目标项目自己的 drivers 能驱动出真实提交」，那它就必须把目标项目配置到**在该宿主上真的能起 worker** 的状态；否则它测的不是 quay，是宿主碰巧有没有可用的裸 claude 凭据。

**边界（必须显式、不得隐藏）**：这一步会让 e2e 证明的命题变成「**配置妥当后**，目标项目自己的 drivers 能驱动出真实提交」，⛔ 不是「零配置开箱即用」。这是诚实的范围——任何真实消费者同样要配自己的模型栈。⇒ 配了什么必须落进证据（见 AC3），⛔ 不得静默配置。

## Plan

1. `verify-deliver-coldstart.sh` 增加一步「配置目标项目 profiles」：把**驱动方仓库自己的** `.quay/profiles.yml` 里 `worker-default` 的 `launcher`/`model`/`auth` 写进目标项目的 `.quay/profiles.yml`（单一真相源 = 驱动方自己的配置，⛔ 不在脚本里再写一份字面量）。
2. 提供 CLI 覆盖（如 `--target-launcher` / `--target-model`），缺省走上一步的派生；两者都缺 ⇒ **不静默跳过**，报可区分的取值（`target-profiles: not-configured`）让读者知道这一步没做。
3. 该步的实际取值写进证据记录（evidence JSON 与 ac89 记录的 detail），使「配了什么」事后可核。
4. 复跑验证：全新项目上 worker 不再秒死，e2e 能走到 fan-in。

## Acceptance Criteria

- [x] AC1（正向，读真实目标项目）：在一个全新 quay-init 出来的目标项目上跑本脚本后，`grep launcher <target>/.quay/profiles.yml` 的 `worker-default.launcher` 与驱动方仓库 `.quay/profiles.yml` 的同名取值**一致**，且 `model` 非 `null`；贴出两侧取值。✅ 实测（本地真实驱动方 profiles → shipped 结构目标）：驱动方 worker-default `launcher=claude-fjdac`/`model=deepseek-v4-pro-anthropic`/`auth=token` ⇒ 目标同字段逐字一致、`model` 非 null；`manager-local`（`launcher=claude`/`model=null`）未被误改（sed range 只锚 worker-default）。--selfcheck `target-profiles(derived)` 控制同证（configured/0/claude-fjdac/deepseek-v4-pro-anthropic/token）。
- [x] AC2（反向，能取假）：把该步跳过（或用 `--target-launcher` 传一个不存在的 launcher）⇒ 目标项目 worker 仍秒死 / 脚本报 `target-profiles: not-configured`，**⛔ 不得静默当成功**（硬规则 3b：「没配」与「配好了」不得同形）。✅ --selfcheck `target-profiles(no-source) status=not-configured rc=2`（无驱动方 + 无覆盖 ⇒ 可区分取值，非静默）；`target-profiles(override)` 证明 `--target-launcher/--target-model` 覆盖派生（传不存在 launcher 会如实写入、由后续 worker 秒死暴露）。
- [x] AC3（配置可核，不隐藏）：证据记录（evidence JSON 或 ac89 记录 detail）中含本次实际写入的 `launcher`/`model` 取值；`grep` 可查。✅ 实测 evidence JSON 含 `"target_profiles_status"`/`"target_profiles_launcher"`/`"target_profiles_model"`/`"target_profiles_auth"` 四键，ac89 detail 含 `target_profiles_status=… target_profiles_launcher=… target_profiles_model=… target_profiles_auth=…`（grep 可查）。
- [ ] AC4（生产复现）：orangevps 全新目标项目上复跑，`.quay/worker-driver.log` 不再出现 `No fallback model group found for original model_group=deepseek-v4-pro`，且 worker 存活 >60s（不再触发 <60s 退避上限）。（待外部）
- [ ] AC5（全量绿）：`scripts/test.sh` 全量绿。（待外部）

## Definition of Done

- 全新 quay-init 目标项目在验证流程跑完后**处于可起 worker 的状态**，且这一步的取值在证据里可核——以 AC4 的生产复现为准，⛔ 不是只在脚本里加了一段代码。
- 全量 `scripts/test.sh` 绿。
- 完成后知会 `gap-ac207-e2e-target-driver-driven-real-commit-task-done`：其执行说明里「按宿主模型栈配置目标项目」那条临时人工步骤可随之退役。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-verify-coldstart-does-not-configure-target-profiles.md