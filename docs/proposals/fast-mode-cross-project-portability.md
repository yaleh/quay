# 战略文档：fast-mode 双层循环能否真正跨项目迁移，还是过拟合了 quay？

**日期**：2026-08-05
**性质**：战略问题钉住 + 证据收集容器（本文件不是路线图，无 AC/DoD——它是承载问题的容器；
任务体 `tasks/gap-fast-mode-cross-project-portability-strategic-question.md` 驱动本容器的执行与回写）
**关联**：
- 原路线图 Phase 3：`docs/proposals/quay-harness-crystallization-roadmap.md`（**SUPERSEDED by
  ADR-022 2026-08-03**；其 §6 把跨项目可迁移性战略问题转交本容器）
- 调查：`orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`
- 冷启动规格：`orchestration/SPEC-cold-start-one-liner.md`（安装/冷启动 8 步现状）
- 执行任务：`tasks/gap-fast-mode-cross-project-portability-strategic-question.md`

---

## 1. 问题陈述

> **这套机制（fast-mode 双层循环）是真的能跨项目迁移，还是只是在 quay 自己的任务格式、目录布局、
> 约定上过拟合了？**

原路线图 Phase 3（跨项目校准）描述的机制——「把 quay milestone kernel 部署到 archguard、影子模式跑
10 个 milestone、拟合 policy profile」——已随 ADR-022 不存在。**但问题是同一个**：今晚推进的
meta-cc/archguard 冷启动本质上就是在用新机制（双层 fast-mode 循环）回答同一个问题。本文件把问题
从隐式对话中显式钉住，并把每次冷启动的真实结果回写为证据条目。

## 2. 为什么重要

1. **机制的生命线是「可迁移」**：quay 的方法论目标是自举演进——机制的价值在于别人能采纳、能在新项目
   里自己跑起来。若机制依赖 quay 特有约定（任务格式、目录布局、测试命令、会话名），换项目即失效，
   那它只是 quay 的自传，不是可复用方法。
2. **战略问题此前是临场推的**：管理者和外层在对话里回答了问题，但没有对照任何写下来的路线图——问题
   隐式散落（`FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md` 的触发问题「outer 有在做
   整体分析/规划/设计吗」）。本文件给未来会话一个可引用的锚点。
3. **判断要可判，不能停在嘴上**：只有真实冷启动输出能区分「会迁移」与「过拟合」——每条证据形状都要
   有可测判据（§3），每次真实结果回写（§4）。

## 3. 判据：可迁移 vs 过拟合的证据形状

判据可判 = 每一条都有「可测判据」（看到什么输出即算命中）。**未命中不判方向**——不能因为还没跑过就
宣称「会迁移」。

### 3.1 可迁移证据形状（≥2）

1. **P1 — 外来仓的 loop 配置是参数化的，不是 quay 硬编码**。
   `.quay/config.yml` 的 `loop:` 段（`test_command` / `tmux_session` / `worktree_root`）与 gate 集
   逐仓不同：meta-cc 用 `go test ./...` + 自有 `it0` gate 脚本；archguard 用 `npx vitest run` +
   `testPass`（vitest/typecheck/build/lint）。同一机制、不同参数。
   **可测判据**：在两个外来仓实读 `.quay/config.yml`，其 `loop.test_command` ≠ quay 的
   `scripts/test.sh`，且 gate 集 ≠ quay 的 gate 集，循环仍能跑通一次真实派发→关闭。
2. **P2 — 外来仓真实派发并关闭任务，遥测记录形状与 quay 相同**。
   `fast-mode-telemetry:task-start/end` 事件（`.workflow-events/fm-*.jsonl`）在 meta-cc 与 archguard
   里与 quay 相同的 schema 字段，`executionCwd` 为外来仓路径。
   **可测判据**：外来仓 `.workflow-events/` 存在 `fm-*.jsonl`，含 `taskId`/`outcome`/`executionCwd`，
   且有至少一条 `outcome: done` 的真实任务（非空、DIR-026 real-object）。
3. **P3 — 外来仓跑自己的 gate，不依赖 quay 的测试入口**。
   meta-cc 用 `./scripts/gates/it0-*`（Go 项目自己的 gate 脚本）；archguard 用 `npx vitest run` /
   `npx tsc --noEmit` / `npm run build` / `npx eslint`（TS 项目自己的 gate）。
   **可测判据**：外来仓 `.quay/config.yml` 的 gate 命令/脚本路径解析到该仓自己的文件，且派发时执行的是
   这些命令（非 quay 的 `scripts/test.sh`）。

### 3.2 过拟合证据形状（≥2）

1. **O1 — 安装/冷启动仍需 quay 外部知识，不可复现**。
   `SPEC-cold-start-one-liner.md` 的现状表：8 步全部由管理者口述（dist 分支名、热拷贝残留文件名、
   测试命令、会话名、两个监视器、cron 周期）。AC1（≤4 条命令）与 AC6（无 quay 开发树的负控制）仍未
   勾。
   **可测判据**：在无 quay 开发树的环境实跑冷启动，记录每条输入；若输入 >4 条或需要知道 quay 特有
   事实（分支名/残留文件），即命中 O1。
2. **O2 — 任务载体始终是 quay-native markdown 格式**。
   meta-cc 与 archguard 都用 `QUAY_NATIVE_TASKS_DIR: ./tasks` + quay-native 的 frontmatter/`##` 分节
   任务；循环尚未被证明能驱动外来仓**既有的原生任务格式**（如 archguard 自己的 `backlog/`、
   meta-cc 自己的任务约定）。
   **可测判据**：外来仓的任务仓用的是 quay-native 格式（`tasks/*.md` + `id:` frontmatter + `## Proposal`
   /`## Plan`/`## Acceptance Criteria` 分节），而非该仓原生格式；若换成原生格式即派发失败，命中 O2。
3. **O3 — 两次冷启动由同一位掌握 quay 知识的管理者驱动，自举未证**。
   今晚两次冷启动（meta-cc、archguard）都由管理者口述驱动；`SPEC-cold-start-one-liner.md` AC6（把
   `/home/yale/work/quay` 改名后仍能跑通）未执行。可复现性未证。
   **可测判据**：脱离 quay 开发树、脱离知晓 quay 的人，冷启动能否让循环自行跑起来（AC6 负控制）；
   未跑 = 未证，不得判「可迁移」。

## 4. 证据收集容器：meta-cc / archguard 冷启动

每次冷启动真实结果回写为 `- [x]` 条目（`grep -c '^- \[' <本文件>` = 已记录条目数；band ≥1）。
**逐字贴实跑输出。**

### 4.1 meta-cc（Go 项目，`go test ./...`）

- [x] 2026-08-05：meta-cc `.quay/config.yml` 的 `loop:` 段证明参数化——`test_command: go test ./...`、
      `tmux_session: meta-cc-3`、`worktree_root: /home/yale/work/meta-cc-worktrees`；任务仓
      `QUAY_NATIVE_TASKS_DIR: ./tasks`；ADR 目录是 meta-cc 自己的 `docs/architecture/adr`（quay 用
      `adr/`），gate 集是 meta-cc 自己的 `it0` 脚本。**实读输出：**
      ```text
      loop:
        repo_root: /home/yale/work/meta-cc
        test_command: go test ./...
        tmux_session: meta-cc-3
        worktree_root: /home/yale/work/meta-cc-worktrees
      env:
        QUAY_NATIVE_TASKS_DIR: ./tasks
        QUAY_NATIVE_ADR_DIR: ./docs/architecture/adr
      ```
- [x] 2026-08-05：meta-cc 遥测 `milestones/fast-mode-telemetry/2026-08-05.json`——真实派发→关闭，且
      `outcome` 双态（done 与 needs-human）都出现，DIR-026 real-object。**实跑输出：**
      ```text
      {"generatedAt":"2026-08-05T07:31:28.575Z","tasks":[
        {"taskId":"DIR-102","minutes":22.03865,"outcome":"done"},
        {"taskId":"DIR-103","minutes":12.021916666666666,"outcome":"needs-human"}], ...}
      ```
- [x] 2026-08-05：meta-cc `.workflow-events/fm-DIR-102-1785803348909-jfvc26.jsonl`——start/end 事件、
      `commandIdentity: fast-mode-telemetry:task-start/end`、`executionCwd: /home/yale/work/meta-cc`，
      与 quay 相同的 schema 字段（P2 命中）。**实跑输出：**
      ```text
      {"commandIdentity":"fast-mode-telemetry:task-start","eventKind":"start","executionCwd":"/home/yale/work/meta-cc","stage":"Fast","taskId":"DIR-102",...}
      {"commandIdentity":"fast-mode-telemetry:task-end","eventKind":"end","executionCwd":"/home/yale/work/meta-cc","outcome":"done","taskId":"DIR-102",...}
      ```
- [x] 2026-08-05：meta-cc git 历史有真实任务落地的合并提交（DIR-090/082/085 等）——不是空跑。
      **实跑输出：**
      ```text
      f5a12fb Merge task/DIR-090: add make test-scoped target for fail-fast iteration gates
      fa08f91 Merge task/DIR-082: parallelize mcp/executor tests and force codex files backend
      ```

### 4.2 archguard（TypeScript 项目，`npx vitest run`）

- [x] 2026-08-05：archguard `.quay/config.yml` 的 `loop:` 段与 gate 集证明参数化——`test_command:
      npx vitest run`、`tmux_session: archguard-4`、`worktree_root: /home/yale/work/archguard-worktrees`；
      gate 集 `testPass` 是 archguard 自己的 vitest/tsc/build/lint（P1、P3 命中）。**实读输出：**
      ```text
      loop:
        repo_root: /home/yale/work/archguard
        test_command: npx vitest run
        tmux_session: archguard-4
        worktree_root: /home/yale/work/archguard-worktrees
      gates:
        testPass:
        - name: vitest    command: npx vitest run     timeoutMs: 300000
        - name: typecheck command: npx tsc --noEmit   timeoutMs: 120000
        - name: build     command: npm run build      timeoutMs: 300000
        - name: lint      command: npx eslint src/ --max-warnings 0  timeoutMs: 60000
      ```
- [x] 2026-08-05：archguard `.workflow-events/fm-*.jsonl`——TASK-53..TASK-59 全部 `outcome: done`，
      TASK-60/61 进行中（P2 命中）。**实跑输出（逐文件末行 `taskId eventKind outcome executionCwd`）：**
      ```text
      TASK-53 end done /home/yale/work/archguard
      TASK-54 end done /home/yale/work/archguard
      TASK-55 end done /home/yale/work/archguard
      TASK-56 end done /home/yale/work/archguard
      TASK-57 end done /home/yale/work/archguard
      TASK-58 end done /home/yale/work/archguard
      TASK-59 end done /home/yale/work/archguard
      TASK-60 start None  /home/yale/work/archguard
      TASK-61 start None  /home/yale/work/archguard
      ```
- [x] 2026-08-05：archguard git 历史有真实任务合并提交 + 冷启动 tick 记录。
      **实跑输出：**
      ```text
      53c6d95 Merge branch 'task/TASK-61'
      ca2ea9a chore: tick #59 — cold-start recovery after watchdog restart (autonomous-run experiment start)
      5af5887 chore(inner): cold-start tick — TASK-61 fan-in landed, TASK-60 fan-in blocked (merge-conflict), ...
      ```

## 5. 当前判定（基于已录证据；未命中条目不判方向）

- **运行中循环的可迁移性：证据支持（P1/P2/P3 命中）**。meta-cc（Go）与 archguard（TS）用各自参数
  （测试命令、gate 集、tmux 会话、worktree 根、ADR 目录）跑同一 fast-mode 机制，各自真实派发→关闭
  了任务（done 与 needs-human 双态），遥测/事件记录形状与 quay 一致。
- **采纳/安装路径的可迁移性：证据未证（O1/O3 未命中判据，即未证明可迁移 = 维持过拟合嫌疑）**。
  两次冷启动均由掌握 quay 知识的管理者口述驱动（`SPEC-cold-start-one-liner.md` 8 步现状），AC1（≤4
  条命令）与 AC6（无 quay 开发树负控制）未勾。**运行可迁移 ≠ 采纳可迁移**——这是下一个决定性实验。
- **任务载体耦合：边界待观察（O2 部分命中）**。两仓均采用 quay-native markdown 任务仓
  （`tasks/*.md` + frontmatter），尚未证明能驱动外来仓既有原生任务格式。是否算「过拟合」取决于
  quay-native 格式是否被视为可接受的任务载体约定——这是有意的 ABI 设计，但需显式记录。

**结论**：当前真实证据支持「运行中 fast-mode 循环跨项目可迁移」，但「采纳/安装路径」与「任务载体
耦合」是两个未决边界；下一次冷启动（尤其无 quay 知识驱动的自举）是决定性判据。

## 6. 交叉引用

- 原路线图 `docs/proposals/quay-harness-crystallization-roadmap.md` **§6（Phase 3）**：机制已随
  ADR-022 退役，战略问题转交本容器（该任务 `gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode`
  的 AC3 提取）。
- 调查 `orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`：路线图沉默过期的
  发现 + 「战略问题值得保留并重新表述」的建议。
- 冷启动规格 `orchestration/SPEC-cold-start-one-liner.md`：安装/冷启动可复现性的目标（AC1/AC6）——
  本容器的 O1/O3 判据与它共享同一度量面。
- 执行任务 `tasks/gap-fast-mode-cross-project-portability-strategic-question.md`：驱动本容器
  建立 + 首条证据回写。
