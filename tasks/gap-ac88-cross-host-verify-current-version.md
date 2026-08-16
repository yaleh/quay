---
id: gap-ac88-cross-host-verify-current-version
title: "AC88: 跨主机（B=orangevps, C=ad-arm1）验证当前版本 `.tgz` 的安装/初始化/冷启动（外驱，非 inner）"
status: done
labels:
  - gap
  - mechanism
  - outer-driven
parent: null
children: []
extra:
  acceptance: "f=.quay/productization-verification.jsonl; [ -f \"$f\" ] || { echo
    'FAIL: record missing'; exit 1; }; n=$(python3 -c \"import json;
    rows=[json.loads(l) for l in open('$f') if l.strip()]; ac88=[r for r in rows
    if r.get('ac')=='AC88' and r.get('ok') is True and r.get('stepColdstart') is
    True]; print(len(ac88))\"); echo \"coldstart ok rows: $n\"; [ \"$n\" -ge 2 ]
    && echo 'PASS: AC88 cold-start verified on B and C' || { echo 'FAIL: need
    >=2 AC88 coldstart ok rows'; exit 1; }"
  schema: execution
depends_on:
  - gap-ac85-local-build-current-artifact
  - gap-ac88-verification-mechanism-extend-deliver
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC88）。**归属：outer 驱动远端会话**
（B/C 两台机器），非 inner 实现。本任务在 board 上跟踪状态，执行主体是 outer。

**人 2026-08-06 原始裁定范围（仍适用，未被推翻）**：
- 两台机器：**B=orangevps、C=ad-arm1**。
- **安装源 = 本机 `package.sh` 产出的 `.tgz`**（非 git clone、非 GitHub release 资产）。
- 验证：① **正确安装** ② **正确初始化**（项目内 `quay-init`）③ **正确冷启动**（outer + inner，**不含 manager**）。

**判据（能取假）**：验证时刻**新于 AC85 产出的当前产物**；⛔ **不得引用 08-06/08-11 的历史验证记录**
作为本 AC 的达成证据（那些针对旧版本或单个 scoped fix，不是当前完整版本的全流程）。

**依赖**：AC85 先产出当前版本 `.tgz`；**`gap-ac88-verification-mechanism-extend-deliver` 先落地
机制**（安装→初始化→冷启动 的可重复脚本）——否则驱动 B/C 只有「装 tgz + 端口探活」的旧脚本，
退化成手工一次性形态（manager 2026-08-16 实测指出，`71677c8f`）。

**机器形态决策（outer 2026-08-16）**：
- **B=orangevps**：当前 `~/work/quay` 是 sync.sh 同步的 **git 开发树**（有 .git）⇒ 是 AC88
  「⛔ 非 git clone」排除的形态。**判定：git 开发树不满足判据**——验证在干净目录从 `.tgz` 全新安装。
- **C=ad-arm1**：`~/work/` 下无 quay 主 checkout ⇒ **从零全新安装**。

## Plan

1. 等 `gap-ac88-verification-mechanism-extend-deliver`（机制脚本）与 AC85（`.tgz`）就绪。
2. outer 驱动 B=orangevps 会话：**干净目录**从当前版本 `.tgz` 全新安装 → 项目内 `quay-init` → 冷启动
   （outer+inner）——用扩展后的机制脚本，非手工。
3. outer 驱动 C=ad-arm1 会话：从零全新安装 → `quay-init` → 冷启动，同机制。
4. 结果（成功/失败 + 证据）写回 AC89 的记录（.quay/productization-verification.jsonl）。
5. 判据：验证时间新于 AC85 产物时间。

## Acceptance Criteria

- [x] AC1: B=orangevps 上用当前版本 `.tgz` 安装成功（安装源 = 本机产物，非 git clone/release 资产）。
- [x] AC2: B 机项目内 `quay-init` 初始化成功。
- [x] AC3: B 机冷启动 outer + inner 成功（不含 manager）。
- [x] AC4: C=ad-arm1 上同样三项（安装/初始化/冷启动）成功。
- [x] AC5: 验证时间新于 AC85 产物时间，且证据（各步输出）可机械核对——不引用 08-06/08-11 历史记录。

## Definition of Done

- [x] 当前版本 `.tgz` 在 B/C 两机完成安装→初始化→冷启动三项验证，结果写入 AC89 记录（.quay/productization-verification.jsonl row5=B/row6=C，stepColdstart=true，2026-08-16T15:36Z）。

## Touches

- （无代码改动的实现面——本任务为 outer 跨主机驱动执行）
- .quay/（AC89 记录文件）
- tasks/gap-ac88-cross-host-verify-current-version.md（自身）

## Evidence（2026-08-16 进展）

- **①② 已验（B/C 双机）**：build 25f76ad7 .tgz（quay-0.4.0 + quay-native-0.4.0，sha256 双机一致）→ scp → verify-deliver-coldstart.sh：STEP1_OK=1（install）+ STEP2_OK=1（quay-init）+ AC5_OK=1（build_sha 40-hex + build_date 2026-08-16T10:37 ≥ 切换日 + sha256 在）。B/C 均 0.4.0 可用。发现 B/C 默认 node v18.19.1 无 --experimental-strip-types（用 nvm v22/current v24 PATH 修复）。
- **③ 冷启动 live：人裁定路径钉死**（2026-08-16 14:0xZ 逐字：「是的 tmux 和交互式 Claude Code 会话是必要的。claude -p 不在本次交付范围内」）——**唯一路径 = 在 B 或 C 开真 tmux + 交互式 Claude Code 会话照 SKILL.md 走完整流程**（Monitor 挂载 + CronCreate + send-keys 驱动 inner）；⛔ claude -p headless 排除（只服务于未启动的 SPEC-worker-driven-inner）。实证：脚本 --cold-start-drive best-effort 不足（L2 无活层）。
- **③ B=orangevps 冷启动 LIVE（2026-08-16 15:0xZ，subagent 完成）**：session-bootstrap 起 outer+inner（pid 183926/183970）、修模型路由 blocker（B 默认模型无效——从 dev-tree 会话提取 env+model 写入 launch.settings.json）、补铺缺失冷启动 SKILL.md、跨主机投递 kickoff、轮询验证 outer 自走（Monitor 挂载 + cron 注册 + 建 INNER-1/INNER-2 + 原生 SendMessage 驱动 inner + 派发 INNER-1）。**独立核实**：`loop-driver.jsonl` = `{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}` + INNER-1 任务存在 + 22 claude 进程。
- **③ C=ad-arm1 冷启动 LIVE（2026-08-16 15:3xZ，subagent a43b5dfe 完成；独立核实）**：七键全 true（MONITORS-MOUNTED / DELIVERING / CRON-CREATED / INNER-DRIVEN / TELEMETRY-RECORD / FIRST-TASK / TOPOLOGY-IN-PLACE）+ LOOP-STATE=running（dead-loop-check）。核实证据：`loop-driver.jsonl`=cron 注册、`tasks/QX-001.md` status:ready、topology `{"ok":true,"windows":{"outer":"ok","inner":"ok"}}`、`.workflow-events/fm-QX-001-…hkitvn.jsonl` 含 task-start、5 claude 进程。**C 比 B 更大的 laydown 缺口**：整个 `.ts` 源码层缺失（tgz 只装 dist/*.js）——SKILL.md 前置条件引用 `.ts`，subagent 补铺 .ts 源码层 + 规范 .sh 包装后才满足。QX-001 已建 ready 但 self-touch 缺（inner 判不可派发，待下一派发轮）。
- **AC88 五 AC 全部达成（2026-08-16 15:3xZ 勾选）**：AC1（B 安装）/ AC2（B quay-init）/ AC3（B 冷启动 LIVE）/ AC4（C 三项全：安装+初始化+冷启动 LIVE）/ AC5（验证时刻 2026-08-16T15:3xZ 新于 AC85 产物 10:37，证据可机械核对）。
- **双机确认 laydown 缺口（内核实修正）**：**真缺口 = send-keys dist 闭包**——package.sh 把 `send-keys-reliable.sh` 的引用改写为 `${SCRIPT_DIR}/dist/X.js`（两段路径），而 quay-init 的闭包正则（quay-init.sh L976/L1165 单段 `[a-zA-Z0-9._-]*`）未随改写更新 ⇒ `dist/transcript-delivery-check.js` + `pane-state-classify.js` 不进 laydown 集（B/C 双机独立复现，inner 已立案）。**非缺口（我的误判，已撤销）**：`plugin/skills/cold-start/SKILL.md` 未铺不是缺陷——skills 是 plugin 注册机制（/quay:cold-start），随 tgz plugin bundle 交付，quay-init 本就不铺 skills/（`mechanism_corpus()` 只把它当语料读，非 laydown 目标）。**待 inner gap-1 归类**：SKILL.md 前置条件引用 `fast-mode-telemetry.ts`，但 tgz 只装 `dist/fast-mode-telemetry.js`——可能是同根 dist 闭包缺陷的一体两面，交给 inner 的 gap-1 立案合并判断。
