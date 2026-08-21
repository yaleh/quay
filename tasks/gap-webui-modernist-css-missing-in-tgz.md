---
id: gap-webui-modernist-css-missing-in-tgz
title: webui-modernist.css 打包缺失：serve 页面 200 但 <style> 为空（AC119 跨项目验证发现）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：AC119 跨项目 webui 验证发现（inner 2026-08-20 23:28Z 投递，c04deda5）。AC119 判据「若发现新缺陷按缺陷处置归 outer 立案」——外层立案。

**缺陷**：`webui-modernist.css` 打包缺失——`serve-handlers.ts` 用 `readFileSync(new URL("./webui-modernist.css", import.meta.url))` 从 bundle 同目录读 CSS，但 `quay-0.6.0.tgz` 把该文件放在 `src/webui-modernist.css`（`dist/` 下没有），`quay-init` 的 runtime 落盘（`.quay/runtime/bin/quay.js`）也不带它 ⇒ serve 日志 `[quay serve] webui-modernist.css missing: ENOENT`。**页面 200、内容/结构正确但 `<style>` 为空**——webui 改进的 5 项功能全部工作正确，但视觉样式丢失。

**为什么现在发现**：AC118/AC107 只验 CLI 生命周期未 serve webui，故此前未暴露。AC119 在 meta-cc 真实数据上 serve webui 才首次暴露。

**为什么 inner 执行**：修复涉及 `packages/quay/src/`（serve-handlers 读取路径）+ 打包（tgz 内含 CSS）——产品代码 → inner 域。

## Plan

1. 定位 webui-modernist.css 在 tgz 中的实际位置（src/ 下），核实 bundle（dist/）下确实缺失。
2. 修复：让 tgz/打包产物包含 webui-modernist.css（或改读取路径），serve 时能读到。
3. 验证：真实 `quay serve` 下页面 `<style>` 非空（生产载体，非 fixture）。

## Acceptance Criteria

- [x] AC1: 修复后 `quay serve` 的产物包含 webui-modernist.css（bundle 或 tgz 内含），读取路径正确。
- [x] AC2: 负控制落在生产载体——真实 serve 下页面 `<style>` 非空（读真实 HTTP 响应，非 fixture）。
- [x] AC3: 全量 suite 绿。

## Definition of Done

- [x] webui-modernist.css 随打包产物正确分发；真实 serve 下 `<style>` 非空（真实输出）。

commit: d10be403

## Touches

- packages/quay/src/serve-handlers.ts（CSS 读取路径——若需改）
- packages/quay/scripts/build-dist.mjs（dist 打包入口——CSS inline 进 bundle）
- packages/quay/test/build-dist.test.mjs（打包测试——inline CSS + 真实 serve <style> 非空）
- packages/quay/src/webui-modernist.css（CSS 文件本身，若需复制到分发位）
- tasks/gap-webui-modernist-css-missing-in-tgz.md（自身）
