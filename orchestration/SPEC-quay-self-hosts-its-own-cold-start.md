# 规格:quay 应当能用自己的冷启动 skill 启动自己,且恢复场景要有等价的形式化程度

**人 2026-08-04**:「quay 自己也应可以使用它的产品化交付中的冷启动 skills 启动;
这些 skills 的确定性也应该尽量强,例如使用形式化表达、包括 AC 条款等。」

## 现状核实(不是印象,是实测)

**已有的形式化程度比预期高**:`quay:cold-start` 的 AC8c 六键判据(`MONITORS-MOUNTED` /
`MONITORS-DELIVERING` / `CRON-CREATED` / `INNER-DRIVEN` / `TELEMETRY-RECORD` / `FIRST-TASK`),
每个都有精确定义、必需证据、fail-closed 前置条件。这不是本任务要从零建的东西。

**但四个具体缺口,今晚的两次恢复逐一撞出来了**:

| # | 缺口 | 证据 |
|---|---|---|
| 1 | 从未对 quay 自己跑过 | `CronList` 为空;今晚两次恢复全程手工,零使用该 skill |
| 2 | `monitor-mount-check.sh:31` 硬编码检查已判定退役的 `inner-state.sh` | 今晚决定退役,自检脚本未同步 |
| 3 | `send-keys-verified.sh` 有真实未修的投递校验缺陷 | `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted`,
    今晚外层用它投递给内层时**实测复现**(报成功,目标晾了 20+ 秒未处理) |
| 4 | skill 只覆盖「全新冷启动」,不覆盖「崩溃后恢复」,也不覆盖「裸机建会话」这一步 | 见下 |

## 需要新增的形式化(而不是重写已有的)

### AC-SH1:skill 的前置条件必须区分「全新」与「恢复」两条分支

**全新分支**(现有逻辑不变):机制未铺 → 铺 → 挂载 → 建 cron → 驱动 → 证明。

**恢复分支**(新增,今晚两次实测出的真实需要):
- 检测「上次是否有中途状态」——worktree 是否有非 `master` 上未合并的分支且对应遥测有 `start` 无 `end`、
  `.workflow-events/` 是否有幽灵在飞记录、任务 `status` 字段与其对应代码的落地状态是否一致
- 这条分支的判据不是「重新走一遍全新流程」,是「先把上次的中途状态收敛成可信的起点,再进入正常 tick」
- **两条分支共用同一份 AC8c 六键**作为最终验收标准,不新造一套判据

### AC-SH2:「建会话」本身要有形式化的最小步骤,不必是 skill(受限于鸡生蛋),但要有脚本+AC

`quay:cold-start` 假设已经有一个外层会话在运行——这个假设本身合理(skill 需要 Claude Code 进程才能跑)。
**但从裸机到「有一个可以调用 skill 的会话」这一步,现在没有任何形式化产物**,今晚全靠手敲。

- 判据:一个脚本(不要求是 skill,可以是普通 shell 脚本 + 一份对应的 AC 清单)接受
  `<root>` 和 `<layout>`(如 `manager/inner/outer` 或 `inner/outer`),产出:
  tmux 窗口按约定命名建好、对应的 Claude Code 进程按约定的模型/环境变量启动、
  每个启动都有「进程存活」的验证(不是发了命令就当作起来了)
- 这条完成后,`quay:cold-start` 才是真正「一条命令」——现在它是「先手工建好会话,再一条命令」

### AC-SH3:先修 #2、#3 两个已知缺陷,再谈自举验证

**顺序理由**:在 `monitor-mount-check.sh` 还查着已退役机制、`send-keys-verified.sh`
还会报假成功的情况下,即使跑通了 AC-SH1/AC-SH2,六键判据里至少两键(`MONITORS-MOUNTED`、
`INNER-DRIVEN`)**验收的是一个已知不可靠的检查**——先修这两个,自举验证的结果才有意义。

### AC-SH4(可判收口):在 quay 自己的仓库上完整跑通 AC8c 六键,全部为 true

**用今晚的两次手工恢复做负对照**:跑通后,把这次自动化流程与今晚的手工时间线
(`docs/analysis/two-oom-recoveries-compared.md`)对比耗时与人工介入次数——
**判据不是「更快」,是「六键判据能不能不靠人工核实就自证」**。

## 明确不做

- 不要求这次就覆盖 archguard/meta-cc 的同等自举验证——quay 对自己是第一个证明点,
  证明了再推广,不要并行铺开
- 不新造一套判据体系——AC8c 已经是对的框架,本规格只是补上「恢复分支」与「建会话」这两个
  它没覆盖到的前置,以及修复两个已知会污染判据可信度的缺陷
