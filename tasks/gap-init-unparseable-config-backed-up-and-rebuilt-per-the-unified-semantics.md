---
id: gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics
title: 统一后的 init 对无法解析的配置应"备份后重建"（议定语义），现实现却拒绝且不留备份——与议定设计偏离，并使"/quay:init
  总能得到匹配新版本的配置"对损坏配置不成立
status: ready
labels:
  - gap
  - priority:p1
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-329
---
## Proposal
**背景(GOAL-029,人 2026-10-07)**:统一后的 init 按配置状态自动决定:不存在 → 全新安装;可解析 → 升级(先在内存算出并校验,通过才写;失败非零并保留原配置);**解析不了 → 备份后从默认重建**(这是旧 `quay init --reconcile` 的既有语义,也是议定的统一语义,见任务 gap-init-single-engine-state-based-upgrade-validate-before-write 的 Proposal"corrupt → 备份(`.quay/config.yml.corrupt-<ts>`)后从默认重建")。**偏离的来源**:该任务的实现者把 plain `quay init` 对无法解析的配置实现成"拒绝(非零、字节不变、不留备份、不重建)",并在该任务证据里如实记录了偏离及理由——依据是 AC-329 判据的最后一段"要求 plain init 对无法解析的配置非零退出且字节不变"。**那是判据的缺陷,不是需求**:判据最后一步本想测"loop.gates 指向不存在 gate ⇒ 非零且字节不变",但它在已升级的配置里又插入一行 `gates:`,造成**重复键**;PyYAML 接受重复键,Node `yaml` 库抛 `Map keys must be unique`,于是 init 把它当作"无法解析的配置",判据通过的其实是 corrupt 分支。(2026-10-07 实测复现:`printf 'loop:\n  gates:\n    - acceptance\n  gates: bad\n' | node yaml.parse` 抛 `Map keys must be unique at line 4`。)**同日实测的现状**(develop 尖端 cfc56798e 的发布形态产物,临时 HOME):对不可解析的配置运行 plain `quay init` ⇒ 退出 1,stderr `.quay/config.yml exists at … but could not be read as a config: YAML parse failed: Map keys must be unique …`,配置字节不变,`.quay/` 里没有备份;对"不可解析的 gate 值"(独立临时项目、初始配置含 `gates: no-such-gate-zz`)⇒ 退出 1,`upgrade REFUSED — the upgraded config did not validate, so nothing was written (your config is byte-identical)`,并点名该值——这条按设计工作。**议定后的 AC-329 判据已改正**:负例改为独立临时项目 + 初始含 `gates: no-such-gate-zz`(并要求报错点名该值),并新增 corrupt 步骤:不可解析配置 ⇒ plain `quay init` 退出 0、`.quay/config.yml.corrupt-<ts>` 备份与原文字节相同、重建后的配置通过 `quay config validate`。**修法**:在 `packages/quay/src/init.ts`/`cli/init.ts` 让 corrupt 状态走"备份 → 从默认重建(与全新安装同一路径)→ 校验 → 原子写 → 退出 0",输出与 `--json` 报告里明确 `outcome: rebuilt`、备份路径,并提示"重建会丢掉原配置里的项目值(例如固定的 serve 绑定、loop.test_command、gates),请对照备份重新应用"(这是重建的真实代价,必须显式告知,⛔ 不得静默);`--dry-run` 只报告将要备份与重建、不写;备份文件名沿用 `.quay/config.yml.corrupt-<ts>`,同一秒内重复则不覆盖已有备份;重建出的配置若仍通不过校验 ⇒ 非零并保留损坏原文件与备份。MCP `init` 返回同一结果。不改动"可解析配置升级失败 ⇒ 非零并保留原配置"的行为。
## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/test/init.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `tasks/gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics.md`
## Test-Files
- `packages/quay/test/init.test.mjs`
- `plugin/test/quay-init.test.mjs`
## AC
- [x] AC-329 的(已改正的)判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-329 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`;其 corrupt 步骤与"不可解析 gate 值 ⇒ 非零且字节不变且点名该值"两个负例都必须真实执行到(完成记录里贴出判据逐步输出,证明不是在更早的步骤就退出)。
- [x] 取假:把 corrupt 分支改回"拒绝"后 AC-329 判据在 corrupt 步骤变红;把重建后的校验去掉并故意写出非法默认后判据在 `rebuilt-config-fails-validate` 变红;把备份步骤去掉后判据在 `corrupt-config-no-backup` 变红(附三次实跑输出,每次 mutation 用 cp 备份还原,不用 git checkout)。
- [x] 单元/集成测试(真 `.quay/config.yml` 的临时 workspace):①不可解析配置(重复键、未闭合括号两种)⇒ 退出 0、备份字节一致、重建配置校验通过、报告含备份路径与"丢失项目值"提示;②`--dry-run` 不写任何文件;③同一秒内重复运行不覆盖已有备份;④重建后再跑 init 字节不变(幂等);⑤可解析但校验不过的配置仍是"非零且字节不变且点名该值"(回归保护);`node --experimental-strip-types --test` 对相关测试文件退出 0。
- [x] 既有测试同步:`packages/quay/test/init.test.mjs` 里因任务 gap-init-single-engine… 把 corrupt 实现成"拒绝"而改过的用例(其证据里记录了"corrupt 语义"一条)按议定语义改回,保留原意图,完成记录列出每个被改用例;`bash scripts/test.sh --for-task gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics` 退出 0 且执行了 ≥1 个测试文件。
## DoD
真实落地:用发布形态产物(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下 `claude plugin marketplace add`+`install --scope user`),对一个重复键的损坏配置运行 `bin/quay init`,得到退出 0、备份与原文字节相同、重建配置通过 `quay config validate` 与 MCP `config_validate`;原始输出贴进完成记录(⛔ 不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。
## Evidence
### 实现
- `init.ts`:删除 corrupt 拒绝分支 —— 三态三动作,无 flag 介入(absent → 全新;valid → 升级;corrupt → 备份后重建)。新增 `corruptBackupPathFor(cfg, stamp)`(固定 stamp + `-N` 后缀 ⇒ 同一秒内两次重建**不覆盖**先前备份)。重建体走**同一个升级引擎**(`upgradeConfigContent`):(a) 落到升级后的不动点 ⇒ 重建后二次 init 字节不变(幂等);(b) 该引擎的 `ok` 就是"先校验后写" —— 造不出合法体则 `outcome:"rebuild-invalid"`、**什么都不写**(损坏原文件与备份都保留)。`corruptReason` 携带解析器原文,`corruptBackupPath` 点名备份,`rebuildIssues` 携带重建体裁决。
- `cli/init.ts`:`rebuilt` 臂(原因 + 备份路径 + 真实代价:"重建的是本版默认值,不是旧文件的项目值")与 `rebuild-invalid` 臂(非零、问题点名);`--dry-run` 计划里点名将要写的备份。旧的 `corrupt` 拒绝臂保留为**防御臂**(不再产生)。
- `mcp-server.ts`:payload 增 `corruptBackupPath` / `rebuildIssues`;`rebuilt` 是成功、`rebuild-invalid` 是拒绝;`reconcile` 选项描述改为 legacy/inert。

### AC1 — AC-329 判据实跑 exit 0,且逐步执行到(`bash -x` 追踪)
`bash <判据>` → `EXIT=0`。判据是 `set -u`(无 `-e`),每条检查都带 `|| { echo CAUSE=…; exit 1; }`,故 exit 0 即全部通过;追踪证明不是中途退出(trace 行号):
```
21:+ cp /tmp/ac329.Xozqtb/.quay/config.yml /tmp/ac329.Xozqtb/after1.yml      # 阶段1 升级
23:+ cmp -s …/after1.yml …/.quay/config.yml                                    # 阶段1 二次运行字节不变
31:+ printf '…gates: no-such-gate-zz…'                                         # 阶段2 不可解析的 gate 值
34:+ rc3=1
36:+ grep -q no-such-gate-zz /tmp/ac329n.ruQnqo/err                            # 报错点名该值
46:+ cp …/config.yml …/corrupt.yml                                             # 阶段3 corrupt
48:+ rc4=0
54:+ cmp -s …/corrupt.yml …/.quay/config.yml.corrupt-1791345024                # 备份逐字节相同
56:+ exit 0                                                                   # ← 到达末尾,非更早退出
```
阶段2 的 stderr 原文含 `no-such-gate-zz`;阶段3 的 backup 名与 `ls "$C"/.quay/config.yml.corrupt-*` 一致。

### AC2 — 取假(三次 mutation;每次用 `cp` 还原原始文件,不用 `git checkout`)
| # | mutation | 判据退出 | CAUSE |
|---|---|---|---|
| a | corrupt 改回"拒绝"(`classifyConfig` 后对 corrupt 直接 `return outcome:"corrupt"`) | 1 | `CAUSE=corrupt-config-not-rebuilt-rc1` |
| b | 去掉重建校验 + 故意写非法默认(重建分支替换为 `content += 'loop:\n  gates: ["no-such-gate-zz"]'`) | 1 | `CAUSE=rebuilt-config-fails-validate — Map keys must be unique at line 162` |
| c | 去掉备份(删 `fs.copyFileSync(configPath, corruptBackupPath)`) | 1 | `CAUSE=corrupt-config-no-backup` |
还原后同一判据复跑 → `exit=0`(阴性对照)。

### AC3 — 测试
`node --experimental-strip-types --test packages/quay/test/init.test.mjs` → `tests 68 / pass 68 / fail 0`。新增/改造用例:AC1 corrupt(重建而非拒绝);REBUILD ①(未闭合括号 / 重复键**两种**损坏形态,各自断言 exit 0 + 备份字节相同 + 过校验 + 报告含备份路径);REBUILD ②(`--dry-run` 不写 config/backup/tasks/profiles/launch.settings 任何文件);REBUILD ③ unit(`corruptBackupPathFor` 固定 stamp 下不返回已占用名)+ integration(连续两次重建留两份备份、第一份未被覆盖);REBUILD ④(重建后二次 init 字节不变、不再产生备份);REBUILD ⑤(可解析但 `gates: no-such-gate-zz` ⇒ 非零 + 字节不变 + 点名该值 + 不产生备份 —— 回归保护);REBUILD rebuild-invalid(重建体自身校验不过 ⇒ 不写、原文件保留)。
`node --experimental-strip-types --test packages/quay/test/mcp-server.test.mjs` → exit 0。

### AC4 — 既有用例同步
- 改动的用例(**1 个**):`AC1 corrupt: a malformed .quay/config.yml is NOT reported as an existing config (the real cause is printed)` → 改名并改写为 `AC1 corrupt: an unparseable .quay/config.yml is BACKED UP and REBUILT — exit 0, never a name conflict`。**保留原意图**(不得声称 "already exists"、必须转述解析器原文),把"拒绝 + 字节不变"改成议定语义(exit 0 + 备份逐字节相同 + 重建配置过校验 + 报告含备份路径与"丢失项目值"警告)。
- 核实(硬规则 5b):`git show 9656d520c -- packages/quay/test/init.test.mjs | grep corrupt` **为空** —— 任务 gap-init-single-engine… 迁移的 5 个用例(AC3 / AC10c / AC2 serve 读取反转 / AC2 already-current / AC2 负对照 / AC2②)**都不是 corrupt 用例**;编码"corrupt=拒绝"的那条由 `9ef94fe18`(gap-quay-init-native-reconcile)引入,本次按议定语义改正。那 5 个迁移用例在统一语义下仍成立,未再改。
- 未动:`AC1 corrupt: --reconcile repairs it and PRESERVES the unparseable bytes`(legacy/inert flag 仍走同一路径,原样通过)、`AC1 corrupt: quay-native's init handler carries the same three-state vocabulary`(quay-native.ts 不在 Touches,未改)。
- `bash scripts/test.sh --for-task gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics --allow-thin` → **exit 0**,`tests 183 / pass 183 / fail 0`(补 `## Test-Files` 后 init.test.mjs 与 plugin/test/quay-init.test.mjs 被选入)。

### DoD — 发布形态产物上的真实落地
`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`(不 push)⇒ orphan commit `81e3f48f92b23a7dd2979c9c22bad68688012caf`;`git archive plugin-channel-verify | tar -x` 到临时 HOME。**真装插件**(非直接跑 bundle):
```
$ HOME=<tmp> claude plugin marketplace add <tmp>/home/plugins/quay
✔ Successfully added marketplace: quay (declared in user settings)
$ HOME=<tmp> claude plugin install quay@quay --scope user
✔ Successfully installed plugin: quay@quay (scope: user)
  installPath = <tmp>/home/.claude/plugins/cache/quay/quay/0.17.0-dev
```
在"重复键 + 未闭合括号"的损坏配置上跑产物里的 CLI:
```
$ node <install>/vendor/quay/dist/quay.js init --root <ws>
exit=0
--- stdout ---
<ws>/.quay/config.yml: rebuilt from this version's defaults.
  the previous file could not be read as a config: YAML parse failed: Map keys must be unique at line 4, column 3:

    - acceptance
  gates: duplicate-key-makes-this-unparseable
  ^

  its bytes were preserved at <ws>/.quay/config.yml.corrupt-1791345092 (byte-identical)
Created <ws>/tasks/ (or already existed)
Created <ws>/.claude/launch.settings.json
Created <ws>/.quay/profiles.yml
branch model (default branch: develop): …
--- stderr ---
warning: the rebuilt config carries THIS VERSION's defaults, not the old file's project values (e.g. a pinned serve binding, loop.test_command, loop.gates). Compare it with the backup at <ws>/.quay/config.yml.corrupt-1791345092 and re-apply what you need.
```
```
md5(corrupt.yml)                     = 60c56320e94c0e5b6f078d670e7ca576
md5(config.yml.corrupt-1791345092)   = 60c56320e94c0e5b6f078d670e7ca576   ← 备份逐字节相同
$ node <install>/vendor/quay/dist/quay.js config validate --root <ws>
Config valid.                                                            (exit 0)
$ (MCP stdio) tools/call config_validate {root:<ws>}
{"ok":true,"issues":[]}
$ (MCP stdio) tools/call init {root:<ws2>}      # 第二份损坏配置
{"outcome":"rebuilt","configState":"corrupt","corruptReason":"YAML parse failed: Map keys must be unique at line 4, column 3:…","corruptBackupPath":"<ws2>/.quay/config.yml.corrupt-1791345106",…}   ← isError 未置位,备份亦逐字节相同
```
⛔ 全程 `HOME` 指向临时目录,未触碰真实 `~/.claude`。

### 已知边界(不属本任务)
- `packages/quay-native/bin/quay-native.ts` **不在 Touches,未改**:其 `outcome === "corrupt"` 臂在统一语义下成为不可达的防御臂,重建路径落在它的默认臂(打印 `Created …` + `corruptReason`)。native CLI 的收口归 AC-331/AC-332。
- `plugin/scripts/quay-init.sh` 的 shell 升级路径(`reconcileConfigFile`)语义未改(仍报 NOT-EVALUATED,交给 `quay init` salvage),只把它提示里的 `quay init --reconcile` 改成 `quay init`(`--reconcile` 已 legacy/inert)。`plugin/test/quay-init.test.mjs`(18/18 绿)未改,断言(NOT-EVALUATED、字节不动)继续成立。
- `--force` / `--reconcile` 两个 flag 仍在(本任务不删;删除归在途的 gap-init-surface-unified…/AC-330)。
