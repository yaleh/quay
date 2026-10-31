# SPEC：Codex 作为 quay 的长期支持宿主——交互式 operator 阶段（driver 会话链路除外）

**作者**：会话 `Quay 的 codex 支持方案`｜**日期**：2026-10-29｜
**状态**：**ruled**——人 2026-10-29 裁定「长期支持」、以 goal（branch 模式）+ 2 task 承载、先建本 SPEC、AC 先于 GOAL、激活归人裁定。
**来源**：并行会话 `quay 的 resident 模式与特性` 的方案澄清 + 本会话的 DIR-121 核查与 codex cwd 实测。
**前置阅读**：
- `docs/proposals/quay-control-plane-host-adapters-human-control-surface.md`（三层拆分、Host Adapter §5、§11.1 Provider ABI data-only）
- `docs/proposals/exp5-codex-continuous-development-port.md`（Codex 四阶段 port；Stage B.1/§4.3 属本轮范围外）
- `orchestration/SPEC-codex-session-communication-host-adapter-2026-08-24.md`（SessionHostAdapter、send/ack、Codex app-server 路由）
- `orchestration/SPEC-goal-mechanism-2026-09-06.md`（goal 数据模型、§3.2 AC 先 GOAL 后、§11/§12 上移规则与「会回退的量」筛子）
- `orchestration/SPEC-goal-branch-2026-10-03.md`（goal 独立分支；本 SPEC 的 goal 用 branch 模式）
- `tasks/DIR-121.md`（Stage 1 机械面已实现、fresh-session AC 未闭合、现 status=superseded）

**证据标注**：【实测】= 本会话实跑；【读码】= 本会话读当前源码；【人裁定】= 本会话收到的裁定；【转引】= 引自其它 SPEC/任务。⛔ 未标注来源的断言不得进入本文件。

---

## 0. 一句话

**Codex 不是 quay 的又一个 task-store Provider，而是 quay 的一个长期支持宿主：本轮在其交互式 operator 阶段，
以一条 branch 模式的 GOAL 长期维持「Codex 能安全操作 quay」这一保证，以 2 个 task 分别落地「cwd 缺陷修复 +
spawn 校验」与「一次真实 Codex 会话留证据」；driver 派发/worker 执行链路明确排除在外。**

---

## 1. 人的裁定（2026-10-29）

| # | 裁定 | 落点 |
|---|---|---|
| ① | **长期支持**（不是一次性探索） | 建 GOAL 而非只建 task |
| ② | GOAL 使用 **goal branch**（`branch: true`） | §4 |
| ③ | **先创建/更新 SPEC 文档**，再建 goal + task | 本文件 |
| ④ | 2 个 task | §3 |
| ⑤ | 顺序按 ①→⑤，其中 ② **AC 先于 GOAL**（SPEC-goal-mechanism §3.2），③ **激活 goal/AC**（激活归人裁定） | §5 |

---

## 2. 决策摘要（分层，防类别错误）

并行会话 `quay 的 resident 模式与特性` 明确纠正了「加一个 `packages/quay-codex` Provider」的方向，本会话核对其正本后接受：

| 候选层 | 结论 | 正本 |
|---|---|---|
| Provider ABI（task store/manifest/gates） | ⛔ **拒绝**。ABI 是 data-only，execution 不进 ABI；Codex 不是任务后端 | `quay-control-plane-host-adapters-…:577` §11.1 |
| Host Adapter（会话/执行） | 本轮**不实现**。属 control plane，只有 proposal/SPEC，零代码 | `SPEC-codex-session-communication-…:§3.4` |
| **宿主侧载体（交互式 operator）** | ✅ **本轮范围**。Codex 作为 MCP 客户端消费既有的 provider-neutral 工具面，quay Core 不加 `if (provider === 'codex')` | §3 |
| resident（CloudCLI 会话运行时） | ⛔ **范围外**。接缝在 `claudecodeui` 的 `IProviderHostDriver`/`SessionHostManager`，不在 quay | 【读码】`server/shared/interfaces.ts:238` |
| driver 派发 / `codex exec` 短会话 | ⛔ **范围外**（人 2026-10-29 明确排除）。是 exp5 §4.3 / Stage B.1 的 driver 链路 | `exp5-codex-…:§4.3` |

**一句话分层**：本轮做的是「Codex 作为一个 MCP 客户端 + Skill 宿主，能否安全地操作 quay 的任务/goal 存储」，
这是宿主侧载体问题，不是 quay Core 的执行/会话问题。

---

## 3. 证据（三条，都是本会话实测/核查，不是转述）

### 3.1 DIR-121 已被无理由 superseded，且是硬终态

【读码 + git 核查】2026-09-16 `dab4afaca` 把 `tasks/DIR-121.md` 的 `status: needs-human` 单行改成 `superseded`，
提交信息 `tasks: DIR-121 task_write by cli:664663`，**无理由、无 `supersedes`/`superseded_at` 字段**（对照：DIR-101/105/119 等 superseded 任务都带这两个字段）；
gate-events / dispatch-record / manager-tick-log 中 DIR-121 零条；不存在取代它的新任务。
`packages/quay/src/gate/lifecycle.ts:104-105` 逐字：`superseded` 是 **HARD terminal（无正向边、无回退边）**。
⇒ **DIR-121 不可复活，只能重新立案**；其机械面今天仍全绿（见 3.3），是现成底座。

### 3.2 codex MCP 的 cwd 行为（核心新发现）

【实测 2026-10-29，codex-cli 0.156.1】用 `-c mcp_servers.<name>…` 行内注入一个把 `process.cwd()` 落盘的探针 server，从不同位置启动 Codex：

| 场景 | 测到的 server cwd |
|---|---|
| 仓库根启动 | `/data/home/yale/work/quay` |
| `packages/quay/` 启动 | **`/data/home/yale/work/quay/packages/quay`**（= 会话工作根，非项目根） |
| `-C <项目根>` 覆盖 | 项目根 |
| 显式 `mcp_servers.<name>.cwd` | 该字段真实存在且生效 |

三个后果【实测】：
1. `.codex/config.toml` 里 `args = ["packages/quay/bin/quay.ts", "mcp"]` 是**相对路径**；从子目录启动时按子目录 cwd 解析 ⇒ `ENOENT`。
2. 一个必然起不来的 MCP server，`codex exec` 输出里**零警告零提示**——「看起来 enabled」与「其实没起来」同形。
3. 现有 `codex-stage1-selfcheck.sh` **抓不到**：它只做 `codex mcp get/list`（读配置、不 spawn），从子目录跑仍 PASS。

⇒ **这是本 SPEC 要修的第一类缺陷：静默失败 + 现有判据无法区分「查过且合格」与「没查成」（硬规则 3b）。**

#### 3.2b codex **插件** `.mcp.json` 的路径解析（2026-10-31 补测，原 §7-3「未测」已补上）

【实测 2026-10-31，codex-cli 0.165.0】项目级 `.codex/config.toml` 之外，本仓库后来又 ship 了 codex 插件表面（`.codex-plugin/` + `.mcp.json`）。把 user-scope 插件装上后，从 meta-cc（一个**没有自己 quay project-config 的 quay 项目**）调 `task_list` ⇒ `initialize response: connection closed`；直接 `node vendor/quay/dist/quay.js`（相对 args）⇒ ENOENT。

三条结论：
1. codex 插件 `.mcp.json` 的 `args` 同样按**会话 cwd** 解析（`codex mcp list` 显示该 server `Cwd: -`），与项目级 config 一致；相对 args 从任意子目录/别的项目崩。
2. codex **没有** `${CLAUDE_PLUGIN_ROOT}` 等价占位符（`strings` 无命中）——Claude Code 侧 `plugin/.mcp.json` 那条「占位符→绝对路径」的路在 codex 走不通。
3. 故 codex 插件路的处理办法（人 2026-10-31 裁定）：**稳定绝对路径**——dist 单独装到 `~/.local/share/quay/`，`.mcp.json` 写绝对 args，升级时同步更新该稳定位置（见 `gap-codex-plugin-mcp-json-nested-in-wrong-level`）。

### 3.3 机械面底座今天仍全绿（可复用，不是重新发明）

【实测 2026-10-29】`node --test plugin/test/codex-stage1-adapter.test.mjs` → 26/26 pass；
`node --experimental-strip-types scripts/agents-claude-drift-check.ts` → exit 0；
`bash plugin/scripts/codex-stage1-selfcheck.sh` → PASS（codex-cli 0.156.1）。
这些就是 DIR-121 留下的机械面：`.codex/config.toml`、`.agents/skills/{quay-task-operator,quay-directive}`、`AGENTS.md`。

---

## 4. 结构：1 GOAL（branch）+ 4 AC + 2 task

### 4.1 GOAL-912（`branch: true`）

- **语义核心**（§10b，⛔ 不是 AC 的合取）：Codex 是 quay 的一个可安全操作、且保证被长期维持的宿主；driver 会话链路不在本 goal 范围。
- **退出条件**（散文）：一个 fresh Codex 会话在任意工作根下都能连上 quay MCP、能在显式人授权下完成真实 task 编辑/创建并留下可机检证据、宿主侧载体单源无漂移、且 Codex 侧未获得任何超出 operator 契约的生命周期权限——并且这些保证由 goal-driver 每轮复验，不随 task 翻 done 而失效。

### 4.2 三条 AC（每条都套 §12b「会回退的量」筛子）

| AC | 保证 | 会回退? | phase | 理由 |
|---|---|---|---|---|
| AC-927 | Codex MCP 从任意工作根连上 quay（spawn + initialize） | 会 | **pre-merge** + `long-term` | 代码判据，在判据 worktree 上跑分支代码即可验；激活时以 `--force` 越过 evaluability（脚本是 Task A 交付物，落地前 not-evaluable） |
| AC-929 | 真实 Codex 会话做过一次授权交易并留可机检证据 | **不会**（单调） | **pre-merge** | 证据为**提交进分支的**文件（非 gitignored 生产账本），判据 worktree 可见 |
| AC-930 | Codex operator 契约不含生命周期权限（权限边界） | 会 | **pre-merge** + `long-term` | 代码判据（负向测试）；今天已绿，复验域抓权限 creep |

⛔ **AC-928（宿主侧载体单源无漂移）已退役**：初稿把它单列，激活时 fidelity 闸判 `vacuous` 拒绝（单条
drift-check 脚本无显式取假臂）。判定正确——drift-check 已被 AC-930 的 adapter 套件 A1–A6 覆盖，单列即冗余。

⛔ **AC-929 的关键设计选择**：DIR-121 把证据放在 gitignored `.quay/`（`milestone-evidence.json`）。在 branch 模式下，
gitignored 账本在判据 worktree 里要么缺席要么是旧快照 ⇒ 只能 post-merge（SPEC-goal-branch §5 B1′）。
本 SPEC 改为**证据提交进分支**（`docs/codex-stage1/evidence.json`），使 AC-929 可 pre-merge、并入前即验。
代价：证据文件进 git 历史——但它是「真实会话的留痕」，本就该耐久（DIR-026 Reading A）。

### 4.3 两个 task

| task | goal_ac | 做什么 | 状态 |
|---|---|---|---|
| Task A（cwd 修复 + spawn 校验） | AC-927 | 修 `.codex/config.toml`（cwd 或绝对 args）+ 建 `plugin/scripts/codex-stage1-spawn-verify.sh`（从子目录 spawn MCP 并验 initialize，失败非零）+ 自检集成 | todo→ready→done |
| Task B（真实会话留证据） | AC-929 | 人开一个 fresh Codex 会话，`$quay-task-operator` 做一次真实编辑+一次真实建任务，证据提交进 `docs/codex-stage1/evidence.json` | **needs-human** |

**为什么 Task B 必须 needs-human**：AC-929 需要「真实 Codex 会话 + 显式人授权」，goal-driver 每轮自动跑不能产生它；
任务自身禁止用 fixture/probe 顶替（DIR-121 的反伪造 bar 原样保留）。

---

## 5. 落地顺序（branch 模式修正后）

```
0. 建本 SPEC（本节）
1. ② 写 AC-927/929/930（draft）→ 写 GOAL-912（draft, branch:true）   ← AC 先于 GOAL，§3.2
2. ③ 激活 GOAL-912 → 分支 goal/GOAL-912 懒创建；AC 随 goal 激活
3. 建 Task A + Task B（goal_ac 指向 AC-927/AC-929）
4. Task A 落地到 goal 分支 → AC-927 在判据 worktree 上 achieved
5. 人开真实 Codex 会话（Task B）→ 证据提交进分支 → AC-929 achieved
6. AC-928/AC-930 已绿（复验域长期维持）
7. 人 `quay goal merge GOAL-912` → 并入 develop → goal 按现有机制走到 achieved
```

⛔ **顺序硬依赖**：Task A/B 需要 `goal/<id>` 分支存在才能 fan-in 到它（§4.3 解析 `active ∧ branch ∧ 分支存在`）⇒
**goal 必须先 active**，task 才能正确落到 goal 分支。故本 SPEC 的顺序是「先激活、后建 task」，与无 branch 模式下的直觉顺序相反。

---

## 6. 非目标

- ⛔ 不实现 Host Adapter（control plane 层；只有 proposal/SPEC）。
- ⛔ 不实现 resident / `IProviderHostDriver`（CloudCLI 代码，不在 quay）。
- ⛔ 不做 driver 派发 / `codex exec` 短会话 / run·attempt·lease（exp5 §4.3、Stage B.1）。
- ⛔ 不做 Codex Goal/subagent/app-server 作为 restart-safe supervisor（SPEC §4/§7 明确拒绝）。
- ⛔ 不改 Provider ABI；`task_write` 仍只走 ABI。
- ⛔ 不把 transcript/thread 当 quay 权威状态；Codex 完成声明不替代 gate。
- ⛔ 不复活 DIR-121（HARD terminal，无出边）。

---

## 7. 风险与已知不确定

1. **branch 模式适配代价**：本 goal 的代码足迹小（config 一行 + 一个脚本），branch 的隔离收益边际；保留它是因为人裁定②（继续真实试点 goal branch）。若 AC-929 的「证据提交进分支」设计在实现期被证伪（如 live-proof-check 依赖 gitignored 账本），退回「AC-929 post-merge」或由人改判 `branch: false`。
2. **app-server 是 experimental**：0.149.1→0.153.4→0.156.1 协议在漂（【转引】并行会话）。本 SPEC 只用 `codex exec` + MCP 面，不碰 app-server，故不受直接影响，但 Task B 的「fresh 会话」验证要按当时版本实跑。
3. **Codex 插件 `.mcp.json` 的 cwd 语义已补测**（2026-10-31，见 §3.2b）：args 按会话 cwd 解析、无 `${CLAUDE_PLUGIN_ROOT}` 占位符；处理办法 = 稳定绝对路径 `~/.local/share/quay/`（`gap-codex-plugin-mcp-json-nested-in-wrong-level`）。
4. **quay-task subagent 的 tool-allowlist 无 Codex 等价物**（【转引】并行会话）：Codex 插件 schema 无 agents、无 per-agent tool allowlist ⇒ 缓解靠「服务端受限 ABI 或只读沙箱子线程 + MCP 写」，性质从「结构不可能」退化为「协议约定」。AC-930 的负向测试是这一退化的长期看守。
