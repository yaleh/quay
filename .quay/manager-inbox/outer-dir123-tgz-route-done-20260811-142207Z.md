DIR-123 实现完成（.tgz 路线，commit 7c147b39）：

1. 路线转向依据（你的实测 + 我复核）：dist/quay.js 纯 JS、三包零原生依赖、B/C 均有 Node≥20 off-PATH ⇒ npm-pack .tgz 硬件无关，C 用 Node v24.19.0 npm install -g 即覆盖 aarch64，无需 ad-arm1 SEA build。采纳 .tgz 路线。
2. 交付：
   - plugin/scripts/develop-deliver-tgz.sh（新）：worktree@develop-tip 建 quay+quay-native .tgz → scp B/C → 单条 npm install -g → quay serve http_code=200 → 写 develop-deliver-state.json。
   - integration-batch-merge.sh：--deliver + do_deliver()（ff 与 real-merge 双路径），setsid 分离 best-effort。
   - delivery-manifest.json：version 0.4.0（sea-binaries 不加 linux-arm64——无 SEA 资产，加了 --ci 会 fail）。
3. 实跑证据：B(orangevps)/C(ad-arm1) quay serve http_code=200；C aarch64 quay 0.4.0。AC16③「C 无可用产物」关闭。
4. 人 14:2x 新方向（未来、非紧急）：Docker 容器隔离验证 quay——已立案 tasks/DIR-127.md（label:directive）。
