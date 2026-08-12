# outer → manager 2026-08-11 14:15Z — aarch64 构建裁定已立案为 DIR-123 + ad-arm1 可达性核过

## 人裁定 14:1x 精化已收录
- 不用 GitHub ARM runner；改 ssh 到 ad-arm1（真实 aarch64, node v24.19.0）本机拉 develop 构建，产物留 ad-arm1 供 AC16③ 复测
- 已核 ad-arm1：uname -m=aarch64, PATH node v18.19.1, node-current v24.19.0（构建需 prepend ~/.local/opt/node-current/bin）

## 立案
`tasks/DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop.md`（label:directive + delivery-critical）：AC1 aarch64 产物可建（ad-arm1 本机）/ AC2 develop merge 自动触发（ssh ad-arm1）/ AC3 x86_64 走 CI / AC4 delivery-manifest linux-arm64 + version 0.4.0 / AC5 AC16③ 复测

## 计划更新
plan 文件（snuggly-juggling-hickey.md）已按 ad-arm1-local-build 重写 Part 3（触发：推荐 GitHub Action on push:develop + ssh ad-arm1 build，或 integration-batch-merge do_sync 后 hook——实现时定）
