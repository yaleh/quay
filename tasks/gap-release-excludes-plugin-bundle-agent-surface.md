---
id: gap-release-excludes-plugin-bundle-agent-surface
title: "release v0.3.13 excludes the ENTIRE plugin bundle (the agent surface that IS the self-evolving mechanism) — packages/quay/package.json files=[README,CHANGELOG,LICENSE,bin,src,dist] has NO plugin/, so a GitHub install yields a task-board CLI, NOT the evolving loop (product outline §6 delivery main body = plugin scripts 119 + gate-scripts 14 + skills 13 + probes 4 + loop 2 + vendor + agents); AC16 core gap, manager measured 2026-08-06 (v0.3.13 2026-07-24, master ahead 2463 commits); human phase-goal: deliver complete usable release on GitHub; outer rulings: files add plugin/, tag from develop (post-cutover), SEA continues (self-contained runtime for AC16 criterion 3), version v0.4.0 (plugin bundle first-in-package = major delivery-surface extension)"
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

**release 不含 plugin bundle——agent 面（自演进机制本体）整个不在包里。**

**【实测（管理者 2026-08-06，亲跑非推测）】**：
- 最新 release **v0.3.13**（2026-07-24），落后 master **2463 个提交**；
- `packages/quay/package.json` `files = [README.md, CHANGELOG.md, LICENSE.md, bin, src, dist]`——**不含 `plugin/`**；
- release 资产 = quay-0.3.13.tgz + 3 个 SEA 二进制；
- **产品轮廓 §6「交付」把 plugin bundle 列为交付面主体**（scripts 119 · gate-scripts 14 · skills 13 ·
  probes 4 · loop 2 个 tick 文档 · vendor 自包含运行时 · agents）——**那才是让 quay 自演进循环的东西**。
- ⇒ 一个人从 GitHub 装到的 quay 是任务板 CLI，**不是会自己演进的机制**。AC16 判据 2（完整性）缺口。

**【既有任务关系】**：`exp5-DEFECT-DELIVERY-MANIFEST`（done）校验 manifest vs release.yml 一致性，
但 manifest 本身不含 plugin；`gap-loop-mechanism-lives-outside-the-package`（done）把 loop 文件移进
plugin/，但 **plugin/ 没进 npm files**——机制「在包外」部分解决，release 仍不含。本任务是缺口剩余部分。

### 选定机制（外层裁定，管理者留我定）

1. **files 改**：`packages/quay/package.json` `files` 加 `plugin/`（scripts/gate-scripts/skills/probes/
   loop/vendor/agents 全含）——解决 AC16 判据 2 完整性
2. **release 从 develop 打**：切换后主线为 develop，release tag 从 develop（非 master——master 冻结）
3. **SEA 继续**：保留 SEA 二进制（build-sea.sh/esbuild-sea.mjs 已存在）——「自包含运行时」是 AC16
   判据 3 端到端可用性依赖
4. **版本号 v0.4.0**：plugin bundle 首次入包 = 交付面重大扩展（minor bump，非破坏性）

## Acceptance Criteria

- [ ] AC1: `files` 含 `plugin/`——`npm pack` 产物含 plugin bundle（scripts/gate-scripts/skills/probes/
       loop/vendor/agents 全部）
- [ ] AC2: 从 release 资产（非 git clone）装到干净机器，`quay-init --loop` 铺出 tick 文档 + skills +
       scripts 并驱动起来（AC16 判据 2 完整性端到端）
- [ ] AC3: 在非 quay 项目上用 release 装出的一份跑通真实两层循环（AC16 判据 3 端到端可用性）
- [ ] AC4: release 从 develop 打 tag（非 master）；版本号 v0.4.0（或外层裁定的形态）
- [ ] AC5: 与 exp5-DEFECT-DELIVERY-MANIFEST（done）+ gap-loop-mechanism-lives-outside（done）交叉标注
       ——本任务是它们未覆盖的 files/plugin 缺口
- [ ] AC6: **dist-plugin 第三条路径覆盖**——Claude Code plugin marketplace（README Option C，/plugin install quay）
       的 dist-plugin 分支同步重建（落后 master 3755 提交，07-26 后未重建）；AC16 完整性覆盖三条官方安装
       路径（npm / SEA / plugin marketplace），非只 files 加 plugin/

## Touches

- packages/quay/package.json（files 加 plugin/）
- packages/quay/scripts/（release 流程：从 develop 打 tag）
- packages/quay/scripts/build-sea.sh（保留 SEA，验证仍产 3 平台）
- tasks/exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE.md（AC5 交叉标注）
- tasks/gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.md（AC5 交叉标注）

## Contract

measure   bundle_in_pack = `npm pack --dry-run 2>&1 | grep -c 'plugin/'` stdout 数字段（或等价：pack 产物含 plugin/ 条目数）
band      bundle_in_pack > 0（release 含 plugin bundle）
invoke    `grep -n 'files\|plugin' packages/quay/package.json`
control   从 release 资产安装 ⇒ quay-init --loop 铺出机制（AC2）；非 quay 项目端到端（AC3）
resume    files 修改与 release 流程分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T07:0xZ
changed: 管理者实测（release 缺 plugin + 落后 2463 提交）+ 外层独立核实（files 字段确认无 plugin/，
plugin/ 构成确认 119 scripts 等）立案。AC16 判据 2 完整性核心缺口，无现存任务覆盖（两个 done 任务均
未解决 files/plugin）。外层裁定 4 项机制决定（files 加 plugin/ + develop 打 tag + SEA 继续 + v0.4.0）。
