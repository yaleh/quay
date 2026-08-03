# tools 会话日志

跨项目机件的实现记录。管理者定义、tools 实现。

| 时刻 | 做了什么 | 证据 |
|---|---|---|
| 2026-08-03T12:31Z | 给 `plugin/scripts/outer-liveness.sh` 写了自动化测试（`plugin/test/outer-liveness.test.mjs`，5 个测试全绿）；并把 `tick_log_for` 加了 `OUTER_TICK_LOGS` 覆盖（镜像 `OUTER_TARGETS`，OVERDUE 判据因此可测）。五类事件各有正控制：A OUTER-IDLE/RESUMED 用真会话 `quay-0:probe`（忙→闲，`sleep 20` 制造几十秒忙窗口，flash 答得快所以采样 INTERVAL=1 不能错过）；B GONE/BACK、C STALL（回填 2000 年提交）、D OVERDUE（`touch -d "3 hours ago"` tick 文件）、E .halt 门控（STALL/OVERDUE 被压、GONE 仍报）都在隔离 socket（`TMUX_TMPDIR` 私有）上跑，不碰三个真项目。 | `node --test plugin/test/outer-liveness.test.mjs` → 5 pass 0 fail（真会话实测 RESUMED→IDLE 都在一个轮询周期内报出）；`scripts/test.sh` 全链：split-or-commit 602 任务无违规、test-framework-policy PASS、test-isolation 50 个违规全部已基线化（无新增）、合同 ratchet 0 new。改的是 `plugin/scripts/outer-liveness.sh`（+10 行）与新测试文件，没碰任何项目产品代码。 |
| 2026-08-03T12:40Z | 按待办 #3 的【预防】版做了 `plugin/scripts/send-keys-verified.sh`（不建检测——那行未发送文字已消失、无法区分丢 Enter 还是灰色 ghost，为不可复现现象造仪器是错的）。助手封装「C-u → 文本 → Enter」三次分开调用 + 发送后确认送达（比较前后 pane 哈希，未变则 exit 1；目标不存在则 exit 1 不静默 0）。测试 `plugin/test/send-keys-verified.test.mjs` 4 个正控制：缺参 exit 2、不存在的目标 exit 1、吞输入 pane（`stty -echo`）哈希不变 exit 1、正常 pane 送达 exit 0 且文本真实落地（pane 里出现发送的标记命令）。 | `node --test plugin/test/send-keys-verified.test.mjs` → 4 pass 0 fail；`scripts/test.sh` 全链隔离检查无新增。已提交 56666600（外层监视器）与本机件（见 git log）。 |
