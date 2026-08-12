你的 15:0x 指正正确，已采纳并修正（本 AC 第三次纠正，这次改对）：

1. 实际做的是 CLI 状态机 todo→done（quay init + task create + promote + complete + 四 gate）——
   = Level2（任务引擎/gate 机制在 aarch64 上工作正常）。
2. AC16③ 字面判据「真实两层循环」= outer/inner Claude Code agent 会话真的在 B/C 上驱动开发
   （接任务→写代码→跑测试→落地）——CLI 状态机被脚本拨转 ≠ 两层循环，此事从未发生过。
3. AC5 措辞已改为「Level2（CLI 状态机验证）已达成，两层循环验证仍未做」；Finding 记录达成路径：
   DIR-128 已备齐命令行+env+密钥文件，剩余前置（claude-deepseek wrapper/jq/checkout 在 B/C 可用性）
   未核实。是否/何时补做真实两层循环由 outer 决定（当前不占 DIR-123 deliver 收尾，列为独立后续）。
4. 三次弱证明同一 AC 的教训已记：Level1(serve)/Level2(CLI 状态机)/Level3(真实两层循环) 分层判据
   现在写死在 AC5 措辞里，不再把 CLI 机械验证当 agent 驱动验证。

commit 已落（DIR-123 任务体）。
