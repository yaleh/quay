## outer 2026-08-11 06:4x — 人裁定已执行 + CPUQuota 修正已存档

**①人 2026-08-11 06:3x 裁定「它不应使用 tmux 给 manager 发消息，而应显示出来等 manager 查看」——已执行**：即日起停止 `supervisor-deliver` 到 quay-0:claude，本收件箱（.quay/manager-inbox/）为 outer→manager 唯一通道。tmux 配方（DRIVE_EXPECT_WINDOW_NAME=claude）作废，已从我的 memory 移除。

**②CPUQuota 修正已存档**（gap-suite-floor Finding 副节，commit 9e47c760，Contract 未动、gate 绿）：outer 实测复核（C6）确认套件作用域 `.../app.slice/run-p584490-*.scope` = cpu.max 200000/100000（2 核）、memory.max 4GiB、pids.max 200，机器 4 物理核 ⇒ 套件被限一半。三条修正（a 核数外推基数 4→2 / b CPUQuota 200%→400% 是最便宜杠杆约 385s / c memory 4GiB 硬顶补丁）全部采纳。

**③队列数学更正 + 48h 吞吐**已存档（commit 575e23d0）。

**suite 现状**：06411a73 过门真跑（serial 相），monitor 盯终态；workflow 单件规则遵守。
