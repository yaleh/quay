---
id: AC-275
title: CI 与本地构建走同一过程：marketplace 渠道禁旁路构建逻辑（静态闸）
status: achieved
kind: criterion
goal: GOAL-019
criterion: 'grep -q "publish-dist-branch.sh"
  .github/workflows/publish-plugin-dist.yml || { echo "FAIL:
  publish-plugin-dist.yml no longer calls publish-dist-branch.sh" >&2; exit 1;
  }; grep -v "^[[:space:]]*#" .github/workflows/publish-plugin-dist.yml | grep
  -Eq "esbuild|rsync -a|node .*build-dist|cp .*vendor/quay/dist" && { echo
  "FAIL: publish-plugin-dist.yml has inlined build logic (outside comments)
  bypassing publish-dist-branch.sh" >&2; exit 1; }; exit 0'
expect: CI 的 publish-plugin-dist.yml 只调用 publish-dist-branch.sh 完成构建+发布，不得在 YAML
  内内联 esbuild/rsync/cp dist 等旁路构建逻辑——保证 CI 与本地手工发布走同一条脚本路径，不产生第二份实现
origin: 人 2026-09-16 追问：要求确认 GitHub CI 与本地手工构建走的是同一条流程（允许少量环境设置 wrapper），且产出的
  build 一致；并要求把这条要求并入 GOAL-019。实测（本轮，直接读脚本原文）：marketplace/dist-plugin 渠道
  CI（publish-plugin-dist.yml）与本地手工发布调用同一脚本
  plugin/scripts/publish-dist-branch.sh（该脚本头注释自证 single mechanism used by BOTH
  CI and a human running it by hand）；CI job 的 run 步骤只有 checkout/setup-node/npm
  install + 对该脚本的一次调用，无内联构建逻辑；该脚本经 sync-vendor.sh 全量模式 -> build-dist.sh ->
  build-dist.mjs 完成 dist 构建，与 release.yml 的 Build dist bundles 步骤直接调用的 node
  packages/quay/scripts/build-dist.mjs 是同一份脚本文件。已知反例（npm/SEA 渠道，超出本 GOAL 范围，另立
  gap 任务追踪）：build-sea.sh 用 cp 把构建当时 PATH 上的 node 二进制本体复制进 SEA 可执行文件，CI 的
  sea-release pin node-version 20，本机开发环境是 Node 25——同一份脚本在两处运行会嵌入不同的 Node
  运行时，说明脚本相同不能当然推出产出一致，必须逐条核实，不可一概而论。
activatedAt: 2026-09-16T00:25:58.075Z
statusLog:
  - at: 2026-09-16T01:36:12.155Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
