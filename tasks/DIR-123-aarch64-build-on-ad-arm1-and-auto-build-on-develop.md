---
id: DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop
title: 人裁定 2026-08-11：release/package 构建须支持 aarch64（覆盖验证环境 C=ad-arm1）；构建在 ad-arm1 本机跑（不
  用 GitHub ARM runner，billing/可用性风险）；每次 merge 到 develop 后自动执行 arm64 build（解决 release 新鲜度退化）
status: todo
labels:
  - directive
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** directive

## 人的裁定（2026-08-11 13:3xZ + 14:1xZ 精化，逐字意图）

**13:3xZ**：要求尽早输出一个覆盖验证环境的 build（验证环境含 B=orangevps x86_64 与 C=ad-arm1 aarch64——需要 release/package 构建流程支持 aarch64 目标，补上此前报的「C 无可用产物」缺口），并且此后每次 merge 到 develop 后都自动执行这一 build 过程（解决「release 新鲜度退化，develop 领先 release 已 2216 提交」）。

**14:1xZ 精化（覆盖 13:3x 的 arm 构建方式部分）**：**不要用 GitHub-hosted ARM runner**（billing/可用性风险太大）。改为**在 ad-arm1（真实 aarch64 机器，已确认可达 / 有 node v24.19.0）上直接拉代码 build**——即 develop merge 后触发的 arm64 构建流程改成 **ssh 到 ad-arm1 → 拉最新 develop → 本机跑 package.sh / SEA 构建脚本 → 产出 arm64 包**，而不是走 GitHub Actions 的 `ubuntu-24.04-arm` runner。

## Acceptance Criteria

- [ ] AC1: **aarch64 产物可建**——在 ad-arm1（aarch64, node v24.19.0 @ ~/.local/opt/node-current/）上本机跑 package.sh / build-sea.sh 产出 `quay-sea-<ver>-linux-arm64.tar.gz`（含 plugin sidecar + 两 SEA 二进制）
- [ ] AC2: **develop merge 后自动触发**——每次 merge 到 develop 后，arm64 build 流程自动 ssh 到 ad-arm1、拉最新 develop、本机构建、产出 arm64 包（留在 ad-arm1 供 AC16③ 复测使用）
- [ ] AC3: **x86_64 走 CI**——B=orangevps 的 x86_64 产物由现有 release.yml CI 路径覆盖（linux-x64 已存在）
- [ ] AC4: **delivery-manifest 更新**——`delivery-manifest.json` 加 `linux-arm64` 平台（quay + quay-native）+ version 0.3.13→0.4.0
- [ ] AC5: **AC16③ 复测可用**——ad-arm1 用本机产出的 arm64 包跑通 `quay --help` / `quay serve`（补上此前「C 无可用产物」的缺口）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 本机构建产物贴出（uname -m=aarch64 + 产物存在 + 可运行）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/scripts/build-sea.sh（在 ad-arm1 本机跑，无需改——arch 由本机 node 决定）
- packages/quay-native/scripts/build-sea.sh（同上）
- plugin/scripts/release-freshness-check.sh（新：develop-vs-release 领先差 + 触发 ssh ad-arm1 build）
- plugin/scripts/arm64-build-on-ad-arm1.sh（新：ssh ad-arm1 → pull develop → 本机构建 → 产物留 ad-arm1）
- delivery-manifest.json（加 linux-arm64 + version 0.4.0）
- tasks/gap-release-freshness-no-recut-mechanism.md（交叉标注——recut 触发 + arm64 构建）
- tasks/DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop.md（自身：勾 AC + 贴证据）

## Contract

measure   arm64_artifact_present = `ssh ad-arm1.wan.hwang.men 'ls quay-sea-*-linux-arm64.tar.gz'` 的 stdout 非空
band      arm64_artifact_present 每次 develop merge 后 ad-arm1 上存在新 arm64 产物（fresh）
invariant build_on_ad_arm1_not_gh_runner = 1（arm64 构建走 ad-arm1 本机，不用 GitHub ARM runner）
invoke    `bash plugin/scripts/arm64-build-on-ad-arm1.sh`（贴构建产物 + uname -m）
control   aarch64 产物可建可复测；develop merge 自动触发；x86_64 走 CI；既有不回归
resume    ad-arm1 构建脚本 / 自动触发 / delivery-manifest / 复测分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人 13:3x 裁定 build 覆盖 aarch64 + 每次 develop merge 自动 build；14:1x 精化——不用 GitHub ARM runner，改 ssh 到 ad-arm1（真实 aarch64, node v24.19.0）本机拉 develop 构建，产物留 ad-arm1 供 AC16③ 复测。x86_64 走 CI。实现归 inner，判定归 outer
