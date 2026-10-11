---
id: gap-release-yml-project-scope-install-not-home-isolated
title: release.yml 的 project-scope 安装未隔离
  HOME，且装上的版本与刚构建的版本不一致时不先失败——渠道被遮蔽时误报为"产物带 -dev"
status: todo
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

<!-- dedup-ref --> **来源**：v0.19.0 发布事故。追溯：同形缺陷已在 `ci.yml` 的 channel job 修过（`HOME`/`CLAUDE_CONFIG_DIR` → `${{ runner.temp }}/scratch-home`，见 `ci.yml:583-607`），`release.yml` 只修了 user-scope 那一臂。

**机制（按位置）**：`release.yml` 仅 user-scope 臂设置了独立 `HOME`（`USER_HOME="${RUNNER_TEMP}/user-scope-home"`，约 :286-290）；**project-scope 的注册/安装/init/断言（step 8–13）在共享的 `/root` 下执行**。当 `/root/.claude/settings.json` 已声明名为 `quay` 的 marketplace 时，`claude plugin marketplace add "${RUNNER_TEMP}/plugin-channel-src"` 静默空操作（实测输出 `Marketplace 'quay' already on disk — declared in user settings`），`install quay@quay` 装的是**别的渠道**，于是断言判的不是本次构建产物。

**第二个缺陷（归因文案）**：`verify-plugin-channel-assertions.ts` 的 `version-consistency` FAIL 文案把原因写成 `the stamped carriers were not rebuilt into the byte bundle (gap-release-bundle-embeds-dev-version-after-stamp)`——在渠道被遮蔽时这是**错误归因**（v0.19.0 实测：构建产物 orphan `7ff57bdc` 的 plugin.json 为 `0.19.0`，被装上的却是 `0.19.0-dev`）。

**修法**：① project-scope 臂同样使用独立的 `HOME` + `CLAUDE_CONFIG_DIR`（与 ci.yml 同法）；② 在跑任何断言之前，先断言"装上的版本 == 构建产物 plugin.json 的版本"，不一致即以**独立原因**（如 `install-not-the-built-artifact`）失败，并打印两边的版本与 marketplace 来源，⛔ 不与 `version-consistency` 共用失败形态（硬规则 3b）。

## AC

- [ ] AC1（按位置）：release.yml 的 project-scope 注册/安装步骤在独立 `HOME`/`CLAUDE_CONFIG_DIR` 下运行
- [ ] AC2：新增的"装上版本 == 构建版本"前置检查存在，不一致时以独立原因失败并打印双方版本与 marketplace 来源
- [ ] AC3（负控制，真实路径）：预先在共享 HOME 写入一个指向别处的 `quay` 声明，再跑该序列——必须**不受影响**（隔离生效）；再在隔离 HOME 内人为制造版本不一致，前置检查必须以独立原因失败。贴两次输出
- [ ] AC4（变异对照）：去掉前置检查后，AC3 第二臂必须退化为原来的 `version-consistency` 误报；贴输出证明该检查确实在验
- [ ] AC5（读生产载体）：落地后的下一次真实 release run，step 8 日志出现 `Successfully added marketplace: quay`，且安装路径版本 == 该 tag 的版本；贴 run id 与日志行

## DoD

真实落地：一次真实 release run 中，project-scope 安装装上的就是本次构建产物（版本与构建产物一致、日志可证）；若渠道再被遮蔽，失败原因直接指向"装上的不是构建产物"，而不是"产物带 -dev"。

## Touches

- .github/workflows/release.yml
- plugin/scripts/verify-plugin-channel-assertions.ts
- plugin/test/verify-plugin-channel-assertions.test.mjs
- tasks/gap-release-yml-project-scope-install-not-home-isolated.md
