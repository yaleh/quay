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
## AC
- [ ] AC-329 的(已改正的)判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-329 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`;其 corrupt 步骤与"不可解析 gate 值 ⇒ 非零且字节不变且点名该值"两个负例都必须真实执行到(完成记录里贴出判据逐步输出,证明不是在更早的步骤就退出)。
- [ ] 取假:把 corrupt 分支改回"拒绝"后 AC-329 判据在 corrupt 步骤变红;把重建后的校验去掉并故意写出非法默认后判据在 `rebuilt-config-fails-validate` 变红;把备份步骤去掉后判据在 `corrupt-config-no-backup` 变红(附三次实跑输出,每次 mutation 用 cp 备份还原,不用 git checkout)。
- [ ] 单元/集成测试(真 `.quay/config.yml` 的临时 workspace):①不可解析配置(重复键、未闭合括号两种)⇒ 退出 0、备份字节一致、重建配置校验通过、报告含备份路径与"丢失项目值"提示;②`--dry-run` 不写任何文件;③同一秒内重复运行不覆盖已有备份;④重建后再跑 init 字节不变(幂等);⑤可解析但校验不过的配置仍是"非零且字节不变且点名该值"(回归保护);`node --experimental-strip-types --test` 对相关测试文件退出 0。
- [ ] 既有测试同步:`packages/quay/test/init.test.mjs` 里因任务 gap-init-single-engine… 把 corrupt 实现成"拒绝"而改过的用例(其证据里记录了"corrupt 语义"一条)按议定语义改回,保留原意图,完成记录列出每个被改用例;`bash scripts/test.sh --for-task gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics` 退出 0 且执行了 ≥1 个测试文件。
## DoD
真实落地:用发布形态产物(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下 `claude plugin marketplace add`+`install --scope user`),对一个重复键的损坏配置运行 `bin/quay init`,得到退出 0、备份与原文字节相同、重建配置通过 `quay config validate` 与 MCP `config_validate`;原始输出贴进完成记录(⛔ 不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。
