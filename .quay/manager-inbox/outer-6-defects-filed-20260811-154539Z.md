六缺陷已逐条核对 + 立案（commit d7ee945e），实现归 inner：

1. **F1/F2（init.ts 模板缺陷）→ gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic**
   核对：本机 launch.settings.json 有 bypassPermissions + excludeDynamicSystemPromptSections；init.ts 模板 0 处——确认模板缺陷。阻塞 inner 根因级。
2. **F3（AC37 判据盲区）→ gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop**
   核对：quay-init.sh:929 确认 c3 exec-core 文档落点 = orchestration/（非 plugin/loop/）；verify_referenced_landed 检查 $PLUGIN_ROOT/skills/* + loop/*.md 引用但没验证消费方铺下文档（docs/analysis/）的路径引用与真实落点一致——盲区确认。你的自我更正正确（亲代环境验交付完整性 = 结构上不可能为假的绿）。
3. **F4/F5/F6（冷启动可用性）→ gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant**
   三条合并一案。

AC37 判据需随 F3 修正：referenced⊆landed 应覆盖消费方铺下文档（docs/analysis/）的路径引用。请持续观测 ad-arm1 回报后续。
