manager 路由（**归属：归 outer**）：**archguard 在真实使用 quay 的过程中撞出两条 quay 侧缺陷，它自己改不了、明确标记路由给我们**。第一条我已独立核实并复现，第二条是转达。

**背景**：ad-arm1 上的 archguard loop 已跑完并干净停机（`84a26f21` B12 stop：「3 consecutive ticks with no task-state advance — **Not a stall — legitimate completion**: seed arc TASK-81→87 closed, 61/61 done」）。今晚它完成 7 个任务（TASK-81→87），其中 82/84/85 是真实代码变更。停机前它在 escalations 里留了「2 quay-side defects to route」。

---

**缺陷① `slot-refill.sh --cap` 在【消费方】参数解析损坏（我已复现，含关键差异）**

- **消费方实测**（ad-arm1 `/home/yale/work/archguard`）：`bash plugin/scripts/slot-refill.sh --cap 3` → `ERROR: charter not found: --cap`
- **本机源码树实测**：同一命令 **exit 0，正常**
- **关键差异**：消费方有 `plugin/scripts/dist/slot-refill.js`，**本机没有 dist 版** ⇒ `.sh` wrapper 在消费方走 dist 分支，**那份 dist 的参数解析是坏的**
- archguard 报告称与它安装的 `ready-pool-check` dist / `slot-free-trigger` dist **同形**（旧版 charter 解析器 regress）⇒ **可能是一族，不是单点**
- archguard 侧已绕过（用 `.ts` 源 / 不传 `--cap`），**但绕过掩盖了缺陷**

⇒ **需要你判的是**：这是「消费方装的是旧 dist」（则属已知的 deliver≠adopt，重装即可）还是「当前 release 的 dist 构建本身就坏」（则是活的打包缺陷，会影响每一个新装用户）。**这两者在结果上完全不同，而我这边无法区分**——本机没有 dist 版可测。建议核对当前 `.tgz` 里那几个 dist 文件的参数解析。

**缺陷② `laydown-set-check` 消费方 0-derived fail-closed 假阴性仍未改**（archguard 转达，TASK-80 盲区 #6 仍存）——原文如此，我未独立核实。

---

**顺带三条 archguard 的非 quay 升级项**（**归属：人**，我不代转为任务，只登记）：①一键发布决策（`@yalehwang/archguard-claude-plugin@0.1.33` 已打包验证毕，`cd plugin && npm publish` 即可）②新能力 roadmap 方向 ③TASK-49 凭据环境。

**另一个观察（不是缺陷，是设计上的印证）**：archguard 停机时**主动停掉了 session-liveness 与 suite-state-trigger 两个监视器**，理由逐字是「eliminate periodic OVERDUE/REPO-STALL noise and complete the shutdown」——**它遇到了与我们今晚同一类的信号噪声问题**（REPO-STALL 在非工作态下持续误报），处理方式是在「已完成」状态下关掉那些只会误报的监视器。这与我 20:31 报的「REPO-STALL 在 Fix/worktree 活跃期稳定误报」是同一个判据的两种失效工况，可一并考虑。
