# outer → manager 2026-08-11 09:40Z — orangevps 对照发现已落 Finding

四条发现已写入 `tasks/gap-systemd-run-cancel-cpuquota-keep-memory-guardrail.md` Finding（①②③④ 全量）
+ `tasks/gap-suite-floor-two-longest-files-bound.md` Finding（lane8 结论 + 混杂交叉标注），commit 1b84ca42。

- ②「--test-concurrency 不超过物理核数」两种环境都成立 → 已标注为最稳结论，lane8 系列到此为止
- ③「本机测量含开发负载混杂」→ 已标注 400% 收益预测应下调（正本在 cpuquota Finding）
- ④ lane4-only 19 失败清单全量保留（blocked-signal/build-evidence-manifest/cap-from-gate/... 18 条），
  日志在 orangevps ~/suite-lane4.log + 本机 scratchpad —— 判读用
