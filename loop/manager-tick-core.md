> 正本: orchestration/manager-tick-core.md — 本文件只应存在这一行指针；执行核内容一律读正本。
> ⚠️ quay-dev-only：配套 workflow plugin/workflows/manager-tick-core.js 依赖 orchestration/ 四份正本与 manager-anchor-check.py（交付面未 ship），须经 args.workspaceRoot 传入工作区【绝对路径】；缺失即返回 {evaluated:false} 拒绝，⛔ 绝不落回硬编码宿主路径。
