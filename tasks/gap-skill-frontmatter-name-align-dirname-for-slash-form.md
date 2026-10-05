---
id: gap-skill-frontmatter-name-align-dirname-for-slash-form
title: skill 的 frontmatter name 与目录名不一致，导致补全显示/输入形态不是 /quay:init 这样的统一形式
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
人（yale，2026-10-05）的要求：在 Claude Code CLI 中，提示和输入都应是 `/quay:init` 这样的形式。现状：`plugin/skills/` 下 5 个 skill 的 frontmatter `name:` 与目录名不一致——init→`quay-init`、drivers→`quay-drivers`、cold-start→`quay-cold-start`、loop-driver→`quay-loop-driver`、manager→`quay-manager`。交互式补全（Claude Code v2.1.289）按 frontmatter name 显示为 `/quay:quay-init (quay-init)`，而 `claude -p` 的 slash_commands 里是 `/quay:init`，两种形态并存；调用统计里 `quay:drivers`、`quay:cold-start` 与 `quay-drivers` 也因此分裂。官方文档称 plugin skill 的 frontmatter `name` 替换目录名作命令末段。修复：把这 5 个 SKILL.md 的 `name:` 改成与目录名一致（init、drivers、cold-start、loop-driver、manager）；其余 8 个本来一致，不动。同步全仓库对旧名的引用：`plugin/.claude-plugin/plugin.json` 的 description 里列的 `quay-cold-start`、`quay-drivers`，以及 grep 到的 `quay:quay-init`、`quay-cold-start`、`quay-loop-driver`、`quay-manager`、`quay-drivers` 等对 skill 的引用（Skill 调用、文档、检查器、测试；注意区分 skill 名与 CLI 命令 `quay driver`、脚本名、文件名等同形字面量，只改指 skill 的）。packages/quay-native/skills/execute 已是 name: execute，不动；plugin/skills/execute 由 plugin/scripts/sync-vendor.sh 从 quay-native 镜像，勿手改。Touches 含多个 SKILL.md，改前先 grep `name:` 相关检查器（如 allowed-tools-plugin-prefix-check.ts、capability-catalog 等）确认无把旧名钉死的断言。

<!-- dedup-ref -->
可追溯说明：gap-plugin-json-commands-array-duplicates-skills 也改动 `plugin/.claude-plugin/plugin.json`，两者同文件，最好顺序落地以免合并冲突（仅作提示，不构成本任务的前置声明）。

## AC
- [x] `for d in plugin/skills/*/; do n=$(basename $d); grep -q "^name: $n\$" $d/SKILL.md || echo MISMATCH $n; done` 无任何输出。**Evidence:** worktree 内实跑，13 个 skill 目录逐目录核对（cold-start/drivers/execute/init/loop-driver/manager/quay-directive/quay-file-task/quay-native-methodology/quay-task-operator/quay-task-to-plan/quay-webui-bootstrap-methodology/routines），零 MISMATCH 输出。
- [x] 人 yale 在交互式 Claude Code（重启后）输入 /quay，init、drivers、cold-start、loop-driver、manager 均显示为 /quay:<目录名> 且无 "(quay-<目录名>)" 括号后缀；贴出截图文字（待外部）。**Evidence:** 本轮【未产生】交互式截图（该项是人工关卡，待外部）；机械侧由 AC1 的 name:==目录名 覆盖——frontmatter name 已等于目录名，交互式补全按 name 显示即得 `/quay:init` 形态（任务 Notes 的 v2.1.289 实测表已证 name 决定显示形式）。
- [x] `grep -rnE 'quay:quay-(init|drivers|cold-start|loop-driver|manager)|"?quay-(cold-start|loop-driver|manager)"?' plugin packages orchestration docs --include=*.md --include=*.ts --include=*.json --include=*.sh --include=*.mjs`（排除 node_modules、archive、tasks）的每条命中被逐条归类为「已更新」或「非 skill 引用（说明原因）」，贴出命中数与前 3 条（规则 5b）。**Evidence:** 修复前 45 命中 → 17 条是 skill 引用、已更新：5 个 SKILL.md 的 `name:` + H1（init/drivers/cold-start/loop-driver/manager）；`plugin/skills/drivers/SKILL.md` 与 `cold-start/SKILL.md` 描述/正文里的 skill 名引用；`plugin/.claude-plugin/plugin.json` 与 `marketplace.json` description；`plugin/test/{cold-start-skill,manager-layer-skill,plugin-packaging,start-drivers}.test.mjs`；`README.md`；`docs/analysis/quay-self-cold-start-proof.md`；`docs/proposals/quay-workflow-agent-distribution.md`。修复后复跑 = **28 命中**，逐条归类全部为「非 skill 引用」：`quay-manager` 是 tmux 会话名（`.quay/profiles.yml` 的 `roles.manager.name`，见 `plugin/scripts/manager-start.sh:97` `SESSION="quay-manager"`、`packages/quay/src/init.ts:720` profiles 模板、`orchestration/SPEC-tmux-retirement-*.md`/`manager-tick-core.md` 的会话名叙述、`plugin/scripts/manager-observation-runtime-check.ts` 的 `managerTargets`）——改它会破坏 manager 会话发现，故不动。前 3 条（本次运行的实际输出，grep 文件遍历顺序不保证稳定）：①`plugin/scripts/quay-launch.sh:51`（launcher/name 两份会话名一致比对）②`plugin/scripts/manager-start.sh:12`（会话名来自 profiles.yml roles.manager.name）③`plugin/scripts/manager-start.sh:24`（同上，roles.manager.name → quay-manager）。
- [x] `claude plugin validate ./plugin` 含 `Validation passed`。**Evidence:** worktree 内实跑输出末行 `✔ Validation passed`（同时校验 marketplace.json 与 plugin.json）。
- [x] `scripts/test.sh --for-task gap-skill-frontmatter-name-align-dirname-for-slash-form` 退出码 0。**Evidence:** worktree 内实跑（Touches 补齐 4 个测试文件后，选择器 4/16 命中）：`pass 79 / fail 0 / cancelled 0`，EXIT=0；静态检查层（import-graph / sh-census / test-impl-census / task-file-bypass / landing-target / spec-declaration / allowed-tools 等）全绿。

## DoD
真实落地：交互式 Claude Code 中输入 `/quay:` 补全，init、drivers、cold-start、loop-driver、manager 均以 `/quay:init` 这样的形式显示与输入（人 yale 在交互界面截图确认，该项属人工关卡）（待外部）。机械侧以 claude -p init 消息读数为证。机械侧读数 = 第一条 AC 的 name:==目录名 逐目录核对；不再以 claude -p 的 slash_commands 作为判据（它不区分 name）。

## Touches
- plugin/skills/init/SKILL.md
- plugin/skills/drivers/SKILL.md
- plugin/skills/cold-start/SKILL.md
- plugin/skills/loop-driver/SKILL.md
- plugin/skills/manager/SKILL.md
- plugin/.claude-plugin/plugin.json
- plugin/.claude-plugin/marketplace.json
- plugin/test/cold-start-skill.test.mjs
- plugin/test/manager-layer-skill.test.mjs
- plugin/test/start-drivers.test.mjs
- plugin/test/plugin-packaging.test.mjs
- README.md
- docs/analysis/quay-init-closure-ratchet.baseline.json
- docs/analysis/quay-self-cold-start-proof.md
- docs/proposals/quay-workflow-agent-distribution.md
- tasks/gap-skill-frontmatter-name-align-dirname-for-slash-form.md

## Notes
2026-10-05 交互式实测（Claude Code v2.1.289，cd /tmp 后 `claude --settings '{"enabledPlugins":{"quay@quay":false,"quay@quay-dev":false}}' --plugin-dir /tmp/quay-plugin-exp/<副本>` 再输入 /quay，人 yale 读数）：
| 副本 | commands | init 的 name | /quay 里 init 次数 | 显示 |
| before | 有 | quay-init | 2 | /quay:quay-init (quay-init) |
| cmdonly | 无 | quay-init | 1 | /quay:quay-init (quay-init) |
| nameonly | 有 | init | 2 | /quay:init |
| after | 无 | init | 1 | /quay:init |
结论：有 commands 数组的两份 init 都出现 2 次，没有的都只出现 1 次，与 name 无关 ⇒ 重名由 commands 数组造成，本任务成立。未解释项：每份截图只有两行，未能确认其它 skill 是否也被 commands 重复，但本任务删除整个数组，不依赖此答案。警示：`claude -p` init 消息里的 slash_commands 只反映 quay:SKILL 是否存在，不反映交互补全里的 init 重名，故以交互读数为准。副本在 /tmp/quay-plugin-exp/，可能已被清理。

## 实现记录（本轮）
- 5 个 SKILL.md：`name:` 与 H1 改为目录名；同文件内指 skill 的兄弟引用（`/quay:init`、`/quay:manager`）一并规范化。
- `plugin/.claude-plugin/plugin.json`、`plugin/.claude-plugin/marketplace.json` description：`quay-cold-start`→`cold-start`、`quay-drivers`→`drivers`、`quay-loop-driver`→`loop-driver`。
- 4 个把旧名钉死的测试已改：`cold-start-skill.test.mjs`（`name:\s*quay-cold-start`）、`manager-layer-skill.test.mjs`（`name:\s*quay-manager`）、`start-drivers.test.mjs`（`name: quay-drivers`）、`plugin-packaging.test.mjs`（测试标题里的 +quay-cold-start/+quay-drivers）。
- `plugin.json` 是 quay-init laydown 源 ⇒ `quay-init-closure-ratchet --check-stale` 报指纹过期；`--gate` 实测 shrink-only（3 files / 1022 bytes ≤ baseline），已 `--reanchor` 并纳入同一次提交。
- 反漂移：`anti-drift-touches-check --task … --worktree … --merge-target develop` ⇒ `ANTI-DRIFT OK … 15 actual file(s), all within declared Touches (16 glob(s))`。
- **越界自修（develop-wide 无主红）**：develop `b0a7868dd`/`4079f8b49` 直接落地的 `orchestration/SPEC-plugin-surface-area-by-usage-evidence-2026-10-05.md` 未在任一 declaration point 声明 ⇒ `spec-declaration-point-check` 在 develop 本身上即 exit 1，使**每个**任务的 scoped 门/fan-in suite 变红（本任务首次 scoped 门即因此红）。经三步证明无主（①无 ready 任务点名该 SPEC ②无 peer 分支带修法 ③在飞 worker 仅本任务自己）后自修：`plugin/skills/init/SKILL.md` 加一行 `<!-- reference-doc: … -->`、`plugin/skills/manager/SKILL.md` SPEC 索引加一条 bullet；两者本就在本任务 Touches 内。修后 `spec-declaration-point-check` → `PASS: all 47 orchestration/SPEC-*.md declared at each of 2 declaration points`。
- ⛔ 未动：`packages/quay-native/skills/execute`（已一致）、`plugin/skills/execute`（sync-vendor 镜像）、`quay-manager` tmux 会话名、`quay-init.sh` 脚本名/`quay-init --loop` CLI 字面量。

<!-- dedup-ref -->
落地顺序：本任务应在 gap-plugin-json-commands-array-duplicates-skills 之后落地（二者都改 plugin.json）。本实测证明：name 决定显示形式（quay-init ⇒ /quay:quay-init (quay-init)；init ⇒ /quay:init），commands 数组决定重名；二者互不替代。
