# 规格：隔离与资源治理——容器化的时机与前置条件

**日期**：2026-08-05（管理者）
**触发**：人问「未来如何处理此类问题？在资源可以更好管理的环境（如 Docker）中分别跑各个项目？
当然，要解决相应的通信问题。」
**性质**：从今晚 6 起事故倒推 + 一条关于**次序**的判断。**AC/DoD 与立案由外层判断。**

---

## 1. 今晚 6 起事故，容器化能挡住几起

| # | 事故 | 实测代价 | 限额/边界能否挡住 |
|---|---|---|---|
| 1 | tmux server 泄漏 217 个（最老 12h） | PSI 94 → 三次 ABORT | ✅ **PID 限额** |
| 2 | 套件跑在 `concurrency=8`（nproc=4） | load 31.7，被迫 ABORT ×3 | ✅ **CPU 限额**——变慢而非饿死全机 |
| 3 | `ready-pool-check` 35.8s → 157s | 判据慢到被跳过 | ✅ 间接——它是被 ① ② 的负载拖慢的 |
| 4 | `ugrep` 单进程 8.8GB（58KB 输入，正则灾难回溯） | free 290MB、swap 4.2GB | ✅ **内存限额**——OOM 杀一个，不是全机进 swap |
| 5 | 三次整机崩溃 | 网络永久静默死亡 | ✅ 若成因是资源耗尽 |
| 6 | `kill-server` 杀穿隔离（管理者自伤） | **三项目全部会话死亡** | ✅ **容器边界**——限于一个项目 |

**6/6 都能被挡住或显著削弱。** 这不是理论论证，每一条都有今晚的实测数字。

---

## 2. 最强的论据不是「资源」，是「限额不可被绕过」

今晚已经有一个**设计正确、行为正确、却被完全绕过**的资源治理机制：

- `resource-gate.sh` 用 PSI（而非 load average）判断，头注释写明了理由，
  自带实测依据「此负载下重型测试 48.8s vs 隔离 2.0s = 24× 劣化」；
- 它在被问时**返回 WAIT，exit 1，完全正确**；
- 而 `full-suite-runner.ts` 里 `resource-gate` 出现 **0 次** ⇒ **没人问它**，
  于是 8 路并发在 WAIT 状态下开跑，load 冲到 31.7。

> **一个必须被主动调用才生效的限额，等于没有限额。**
> **cgroup 限额的价值不在于它更聪明，而在于它无法被「忘记调用」。**

这条同时解释了为什么"再加一个检查"修不好这一类问题——今晚已经加过了，它被绕过了。

**同族交叉标注（`tasks/gap-supervisor-preemption` AC3，2026-08-06）：抢占是「不可被绕过」族的一员。**
`.halt` 的旧形态（「tick 步骤 0 检查」）就是**依赖被抢占方主动调用**的限额——inner 的连续流程
绕过步骤 0，halt 后仍派发 5 个 subagent（事故 7）。修复后的抢占（`supervisor-preempt.sh`
`preempt <target>` = 进程级停止信号，TUI 形态 tmux C-c / `-p` 迁移后 `kill <pid>`）**不依赖被抢占方
调用任何东西**——OS 就是抢占原语；新派发被 `slot-refill.ts` 的代码挂载点挡住。判据与限额同构：
`preemption_is_process_level = 1`（不可被绕过）。

---

## 3. 但通信问题是真的，而且它决定**次序**

### 3.1 容器化会打断哪些现有通道

| 通道 | 现状 | 跨容器后 |
|---|---|---|
| 层间驱动 | `tmux send-keys` | **断**——tmux socket 是每容器一份 |
| 送达校验 | 读目标会话 `~/.claude/projects/*/[uuid].jsonl` | **断**——需卷挂载 |
| 管理者收件箱 | quay 的 `.quay/manager-inbox/` 共享文件 | **断**——需共享卷 |
| `.halt` 哨兵 | 各项目根目录文件 | 尚可（各自容器内） |
| 观察者单飞锁 | `$QUAY_GLOBAL_DIR` 全局目录 | **断**——设计前提是同机共享 |
| OS 级 watchdog | systemd user timer（刚 active） | **需移到宿主**，否则它和被看护对象一起死 |

### 3.2 关键判断：**容器化与 `claude -p` 迁移是同一个动作，不是两件事**

- **若先容器化、仍走 TUI 注入** ⇒ 必须把 tmux socket 跨容器转发。
  那是把**今晚最脆弱的通道**（6 种失败模式、NBSP 让脚本对任何输入框失效）
  再叠一层网络复杂度，**并且它会抵消掉隔离本身**——能跨边界注入按键的通道，
  同样能跨边界造成伤害。
- **若先迁到 `claude -p`（headless）** ⇒ 投递从「注入 TUI」变成「起一个进程」，
  跨容器时它自然退化成**一个普通的队列/API 问题**，是成熟工程问题。

⇒ **推荐次序：`-p` 迁移 → 容器化。** 反过来做，会在最脆弱的地方增加复杂度。

**而 `-p` 迁移的障碍已被人排除**：outer/inner 早就跑在 deepseek API key 上
（实测两侧 `message.model` = `deepseek-v4-flash`），
`-p` 与现状是同一计费模型。人已裁定次序：**先在 archguard/meta-cc 上验证产品化交付，
再开 `-p` 实验。**

---

## 4. 一条今晚就能做、且不必等容器化的中间步

**cgroup v2 已在本机可用**（`cpuset cpu io memory hugetlb pids …`），
`systemd-run` 也在。⇒ **不需要 Docker 就能拿到硬限额**：

```bash
systemd-run --user --scope \
  -p MemoryMax=4G -p CPUQuota=200% -p TasksMax=200 \
  <跑套件的命令>
```

**收益**：今晚 6 起里的 ①②④ 立刻被挡住，而**通信通道一行都不用改**
（同机、同 tmux、同文件系统）。

**这是「先拿 80% 收益、不付通信改造成本」的一步**，
可以作为容器化之前的过渡形态，也可以作为容器化方案的验证——
如果连 `systemd-run` 限额都没人记得加，那么容器化同样会被绕过
（例如以 `--privileged` 或超大限额启动）。

**落地任务（`tasks/gap-systemd-run-limits-for-suite-and-heavy-ops`，2026-08-08 内层实现）**：
本条中间步已由 `full-suite-runner.ts` 落地——套件起跑时包 `systemd-run --user --scope`
（MemoryMax/CPUQuota/TasksMax），限额由内核强制、不可能「忘记调用」（对照 ABORT #5：
resource-gate 0 次调用被绕过），且只作用于该套件的进程组（AC1 实测 `systemctl --user show` 可见
cgroup 属性）。PID 爆 / 内存爆两个负控制实测通过：TasksMax 挡住 tmux 泄漏类（fork EAGAIN、机器其它
进程不受影响），MemoryMax 杀单进程、不进全机 swap。通信通道零改动（AC4：同机同 tmux 同文件系统）。

---

## 5. 容器化真正落地时的边界划分

**留在宿主（不进容器）**：

- **supervisor / watchdog**——必须能看见并重启所有容器，与被看护对象同生共死就失去意义
- **共享状态存储**（`SPEC-state-crystallization` 的六实体）——跨项目的唯一真值
- **manager**——network 级、非 per-project

**每项目一个容器**：outer + inner + 该项目的工作树与套件运行。

**跨边界只保留两个窄接口**（与 `SPEC-integration-architecture` 一致）：

```
deliver(target, payload) -> delivered | failed
observe(target)          -> {busy, idle, blocked, last_at}
```

**判据**：如果跨容器还需要第三个接口，说明有状态或职责放错了位置。

---

## 6. 与已立案任务的关系

- `gap-no-resource-awareness-heavy-ops-run-blind`（AC5/AC16）——本规格是它的**上位解**：
  与其继续修「谁该调用资源门」，不如让限额不依赖调用。
- `gap-systemd-run-limits-for-suite-and-heavy-ops`——本规格 §4 中间步的**落地任务**：套件 runner
  已包 systemd-run cgroup 限额（AC1 实测 cgroup 生效；AC2/AC3 负控制：PID 爆被 TasksMax 挡、内存爆
  MemoryMax 杀单进程不进全机 swap）；通信通道零改动（AC4）。本规格的「限额不可被绕过」论据正是该
  任务的核心（cgroup 限额由内核强制，无法被「忘记调用」）。
- `gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash`——watchdog 已 active，
  容器化后它必须**移到宿主**，否则回到「与被看护对象一起死」的老问题。
- `gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`——
  本规格给出了它的**战略意义**：它不只是省 TUI 麻烦，是容器化的前置条件。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：6 起事故的挡得住/挡不住逐条判断、「限额不可被绕过」这条核心论据、
容器化与 `-p` 迁移的次序判断、一条今晚可做的 `systemd-run` 中间步、以及容器边界划分。
