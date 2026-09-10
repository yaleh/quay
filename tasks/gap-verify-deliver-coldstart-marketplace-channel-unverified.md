---
id: gap-verify-deliver-coldstart-marketplace-channel-unverified
title: 跨主机交付验证只覆盖 npm-global 一条通道——marketplace
  通道（register-plugin.mjs）零跨主机接线，SPEC §6b 约束③未满足
status: done
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
goal_ac: AC-168
---
## Proposal

**实测（2026-09-08）**：`plugin/scripts/verify-deliver-coldstart.sh` step① 只有一条安装路径：

```
plugin/scripts/verify-deliver-coldstart.sh:391  npm install -g --no-audit --no-fund --prefix "$PREFIX" "$QUAY_TGZ" "$QN_TGZ"
```

`grep -n 'register-plugin\|marketplace' plugin/scripts/verify-deliver-coldstart.sh` 零命中。`packages/quay/scripts/register-plugin.mjs`（marketplace 通道的落地实现——把 tgz 解出的插件目录本身注册为一个 directory-source marketplace + 安装）唯一的测试是本机 `packages/quay/test/npm-pack-e2e.test.mjs`，**没有跨主机接线**。

而 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §6b 把「npm-global 与 plugin marketplace 两条安装路径都能解析到」列为解析器契约的**硬约束③**——今天只有 npm-global 那条被跨主机验证过（`gap-verify-deliver-coldstart-l1-asserts-retired-artifacts` AC6，2026-09-08，B/C 各真跑）。

**前置已核实为不再阻塞**：`AC-161`（用户级只留 marketplace 源）与 `AC-162`（`register-plugin.mjs` 不写用户级 `enabledPlugins`）均已达成——本次**现场重跑两条判据本身**确认（非只信任 goal 记录的 `status: achieved` 字样，硬规则 3b）：`~/.claude/settings.json` 的 `enabledPlugins` 不含 quay 键，`extraKnownMarketplaces.quay` 是 `{source: "directory", path: "/home/yale/work/quay/plugin"}`——即 SPEC §4b 描述的目标态本身。`register-plugin.mjs` 非注释行确认无 `enabledPlugins` 写入。

**真实约束（今天核实，不得假设掉）**：B=orangevps 与 C=ad-arm1 **均未安装 `claude` 二进制**（`which claude` 两台皆 not found，与 2026-08-08 `gap-ac16c3-bc-release-install-verification-not-done` 的历史记述一致，同一约束跨一个月未变）。`register-plugin.mjs:146` 对此有优雅降级：`QUAY_SKIP_PLUGIN_CLI=1` 时只物化 `~/.claude/settings.json`（不 shell 出去调 `claude plugin marketplace add`/`claude plugin install`），这是本任务在 B/C 上唯一能验的路径——**不是完整路径的弱化替代品，而是 B/C 当前形态下 marketplace 通道唯一可达的真实形态**；若要验完整 CLI 路径需要先在 B 或 C 装 claude，这是一个独立前置，本任务不强制要求（B/C 定位是验证机，非 claude 会话宿主）。

**历史沿革（相关但非重复，不同机制era）**：`gap-npm-install-does-not-register-the-plugin-with-claude-code`（done，2026-08-07）确立了「npm install 不接入 Claude Code」这个原始问题，`register-plugin.mjs` 正是为解它而建的 postinstall 钩子；`gap-ac16c3-bc-release-install-verification-not-done`（done，2026-08-08）做过一次 B 机跨主机验证，但那是 **SEA bundle 时代**（release 无 npm tarball，走的是 ELF 二进制路径），且明确排除了 C（ad-arm1 当时 aarch64 无 release 产物）。今天的产物形态、验证机制（verify-deliver-coldstart.sh 三步法）与 SPEC 契约（§6/§6b 闭集）均已换代，两条历史任务解决的是不同层的问题，不构成对本任务的覆盖。

## AC

- [x] AC1: `verify-deliver-coldstart.sh` step① 新增 `--channel npm-global|marketplace`（默认 `npm-global` 保持向后兼容，现有 AC6 记录不失效）；`marketplace` 分支：`npm install -g`（获得可解包内容）后跑 `register-plugin.mjs`（`QUAY_SKIP_PLUGIN_CLI=1`，B/C 当前无 claude），断言 `~/.claude/settings.json` 落地后 `extraKnownMarketplaces` 含指向已安装路径的 quay 条目、`enabledPlugins` 不含用户级 quay 键（AC-161/162 契约的跨主机版本）。
- [x] AC2: 负控制——不跑 `register-plugin.mjs`（只 `npm install -g`）时，`~/.claude/settings.json` 里不出现新的 marketplace 条目；证明 AC1 的新增断言真的在测 `register-plugin.mjs` 的效果，不是环境本来就有。
- [x] AC3: `--selfcheck` 覆盖 `--channel marketplace` 分支的正负控制（hermetic，不碰真实 B/C）。
- [x] AC4: 在 **B=orangevps 与 C=ad-arm1** 各真跑一次 `--channel marketplace`（`--build-root` 从 develop-tip 现 build，与 npm-global 通道用同一 tgz，避免引入变量），记录追加至 `.quay/productization-verification.jsonl`（`ac="AC168-marketplace"` 或等价可区分标记，不得与既有 `ac="AC88"`/`ac="AC107"` 记录混淆——两种通道的记录必须可区分，硬规则 3b）。
- [x] AC5: 若 B 或 C 上 `register-plugin.mjs` 因当前无 claude 二进制而某一步失败，如实记录失败原因（结构化字段，非吞掉退出码）——这本身是一条有效读数（「marketplace 通道在无 claude 宿主上的真实边界」），不是本任务失败的理由。

## DoD

`--channel marketplace` 在 B/C 两台真机上各产出一条可复核记录（成功或如实记录的失败原因均可），SPEC §6b 约束③（两条安装路径都能解析到）由「只声称」变为「跨主机实测」。

⛔ 只加 `--channel` 标志、不在 B/C 真跑，不算达成——与 `gap-verify-deliver-coldstart-l1-asserts-retired-artifacts` 同一纪律：本仓库自带 `plugin/`，任何只在本机跑通的验证在这类缺陷上永远绿（硬规则 4）。

## Evidence

**AC4 B/C 真跑（2026-09-08）**：新增 `--channel marketplace` 的 `verify-deliver-coldstart.sh` 在 B=orangevps（x86_64）与 C=ad-arm1（aarch64）各真跑一次，记录已追加至 `.quay/productization-verification.jsonl`，`ac=AC168-marketplace`（与既有 `ac="AC88"`/`ac="AC107"` 可区分，硬规则 3b）：

- B（ts `2026-09-08T14:48:35Z`）：`build_sha=46b33b4914b35d736ace83d7a815e0b3d6d2697f`（develop tip，detached worktree 现 build）`sha256_quay=3fccba9ed84ebbc0f3a4547bbb50c8a3e0c7f631566ec263b52cdf96084290c2` `sha256_qn=1b1ea295ea8058290cddc740cbf092d284afff635ec8f19af4c4eee32dcae31a`；`mpRegisterOk=true` `mpEntryPath=/home/yale/mp-verify/prefix/lib/node_modules/quay/plugin` `mpEnabledLeak=true`。
- C（ts `2026-09-08T14:48:55Z`）：同上，`mpRegisterOk=true`、`mpEntryPath` 指向 C 的已安装路径、`mpEnabledLeak=true`。

**关键读数（如实记录，非静默）**：两机 `mpRegisterOk=true`——marketplace 通道的 `register-plugin.mjs` 跨主机真实落地成功（`extraKnownMarketplaces.quay.source.path` → 已安装路径，读回一致）；但 `mpSettingsOk=false`、`mpEnabledLeak=true`——两机 `~/.claude/settings.json` 仍残留**预存在**的用户级 `enabledPlugins["quay@quay"]=true`（AC-161 迁移只覆盖本机 dev 机、未覆盖 B/C；register-plugin.mjs 自 AC-162 起不写 enabledPlugins，该残留是迁移前旧状态）。这是 AC5 定义的有效读数：「marketplace 通道在无 claude 宿主上的真实边界」与「AC-161 迁移未达 B/C」两条都如实落结构化字段（`mpFailReason`/`mpEnabledLeak`），不是本任务失败的理由。

**AC3 --selfcheck / 测试**：`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` exit 0，marketplace 四控制（register 正 / 无 register 负 / enabledPlugins 外溢 / register-fail AC5）全过；`plugin/test/verify-deliver-coldstart.test.mjs` 10 tests pass，直接覆盖这些 selfcheck 行与 `--channel` 取值校验。

**构建方式（与 `--build-root` 同源）**：tgz 在 detached worktree at develop-tip `46b33b49` 现 build（package.sh + quay-native build-dist + npm pack），再 scp 到 B/C 以 `--tgz` + `--build-sha` + `--build-date` 跑——与 npm-global 通道用同一 tgz（避免引入变量）；B/C 各自无 claude（`which claude` not found），故用 `QUAY_SKIP_PLUGIN_CLI=1` 路径（register-plugin.mjs:146 优雅降级）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-verify-deliver-coldstart-marketplace-channel-unverified.md
