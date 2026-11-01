---
id: gap-task-efficiency-baseline-attribution-semantics
title: E1 统计口径修正：尝试/suite/落地证据关联、指标定义与 E5 缺失语义
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-11-02 在进展核查后明确授权「先修 E1 统计口径，创建任务」。当前 E1 的测试虽绿，报告仍把受测 commit 当落地、跨尝试回填 suite、复用费用缩写表示墙钟比例，并用缺事件和空 ready 池推导分类失败及持续队列，导致成功落地分母、CPU 合计和 E5 判词不可直接用于优化决策。本任务只修 E1 只读统计工具及报告，交付可信的身份关联、指标定义、缺失语义和真实窗口重算，不推进 E5、不改变验证门。
<!-- dedup-ref -->
原任务 gap-task-efficiency-baseline 已 done；本任务是其落地后发现的统计缺陷修复，保留原任务生命周期记录，不重复建设基线。与 gap-fan-in-delta-shadow-evaluation 的候选裁决独立，不放宽其 fail-closed 或修改影子规则。单独立案：合并建议仪器 peers=[]，但该仪器会排除文件名含 baseline 的输入（substantiveInputs=[]）；补充 provider 全文搜索 task-efficiency-baseline 仅命中已 done 的原任务，未发现开放同文件任务。

直接代码证据（核查时的 scripts/task-efficiency-baseline.mjs）：attachSuite 在窗口不匹配时使用全部 recs，缺 startedAt 也纳入；attachLanding 将 verification-round.commit/terminalCommit 非空直接当 landed；summarize 将阶段墙钟比例命名为 ITE，并把没有 suite 结束/跳过事件的 trace 记入 unclassified，渲染为「分类失败」；e5Evidence 将 pool-empty 与 resource-gate-wait 相加作为持续队列证据，并用未获依据的 p50>60s 阈值输出显著性。

## Plan

1. 先用独立反例重现错误关联：相同 task 多次重派、共用 run_id、窗口外或缺时间的 suite、多对多候选、同一 suite 重复记录，以及有受测 SHA 却未成功 ff 的验证轮。区分 task 最终落地与某次 attempt 的落地事件，不能把后一次成功回填给前一次失败。
2. 定义显式关联结果：已证明关联、无法唯一关联、数据缺失。仅有 taskId 或时间接近不构成唯一归属；无可靠尝试身份时不回填其它尝试记录。唯一 suite 身份只能在 CPU/时长总计中计一次，无法可靠确定身份时单列覆盖率。区分真实成功落地、明确失败、未知；suite 绿或受测 commit 本身不是目标 ref 已更新的证明。实际落地证据需能核对任务、尝试、目标分支、SHA 与成功更新事件；可用载体不足时保持未知。
3. 将墙钟归属比例改为独立、含单位与公式的指标，明确它衡量可观测性覆盖；移除 ITE=Idle Time Efficiency 的误定义。不自行发明原费用 ITE 的换算公式，缺定义或输入就标未评估。阶段区间重叠不得靠截断到 1 隐藏，缺失不能渲染为 0。缺费用 CSV 继续诚实未评估。
4. 分类失败只使用分类器明确失败证据；suite 未执行、前序拒绝、缺结束事件、日志不足和分类失败分别计量。pool-empty 仅代表供给状态，resource-gate-wait 仅代表资源拒绝；持续队列须有待处理量/等待区间的直接证据。撤销 p50>60s 的无依据自动判词，保留描述性分位数和覆盖率，证据不足时 E5 判断未知。
5. 用原报告相同的固定窗口与输入快照重算，对比旧/新分母、落地/未知任务数、关联/未归属验证轮、CPU 唯一计量及分类计数；记录源文件指纹、版本和完整复跑命令。不能因旧报告已有数值而保留错误结论。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/task-efficiency-baseline.test.mjs` exit 0；新增反例在旧实现上能失败、修后通过，覆盖同 task 多尝试、复用 run_id、窗口外 suite、缺 startedAt、歧义关联和重复 suite。窗口内没有唯一证据时，不使用同 task 的全部历史 recs 兜底。
- [ ] AC2 同一测试命令含落地正负控制：只有受测 commit、suite green 或 final_state=completed 的记录不算成功落地；真实成功目标 ref 更新能识别；后一次落地不污染前一次失败。无法确认的样本显式 unknown/not-evaluated，不并入成功分母，不把未知说成已失败。
- [ ] AC3 同一测试命令验证 CPU/验证时长身份去重：一条真实 suite 被重复记录或被多次尝试候选命中不使总量翻倍；歧义记录单列且不参与确定归属聚合。CPU 只取真实计量，报告同时给唯一 suite 数、关联覆盖率与未归属记录，不用 wall-time 换算 CPU。
- [ ] AC4 `node scripts/task-efficiency-baseline.mjs --help` exit 0，JSON/Markdown 输出均不再把墙钟比例称作 ITE/Idle Time Efficiency；费用 ITE 无确认公式时未评估。墙钟覆盖指标有独立名称、公式、缺失和重叠处理测试，不用 Math.min(1, ...) 掩盖重复累计。
- [ ] AC5 同一测试命令区分明确分类器失败、前序中止、suite 未完成与缺日志；无 suite-end/skip 不能自动判分类失败。pool-empty 不构成持续积压，resource-gate-wait 不单独证明持续队列；没有直接队列证据时 E5 输出未知，不采用未获依据的 p50>60s 自动启动结论。
- [ ] AC6 对 docs/analysis/task-efficiency-baseline.md 中原窗口 2026-08-23T07:18:06.081Z 至 2026-11-01T12:16:58.513Z 真跑，报告保留完整复跑命令、代码版本/输入指纹、旧新统计差异、覆盖率与未知项，并至少下钻一个历史重派任务、一条误关联验证轮和一条受测但未证实落地记录；若某类真实样本不存在则给出可复跑检索及缺席读数。
- [ ] AC7 `git diff --check` exit 0，变更只在声明 Touches 内；CSV 缺失保持费用未评估，不修改 E2 放行、锁范围、资源调度、AC/DoD 或 G3，不启动 E5。

## Definition of Done

- [ ] 修正工具对真实工作区固定窗口运行并更新报告，读者能从 task/attempt/suite/目标 SHA 下钻复核关键关联与拒绝关联原因；只有新增 fixture、测试通过或换名不算交付。
- [ ] 报告显式撤回受错误口径影响的旧成功落地数、CPU 合计、分类失败数与 E5 判词，逐项给修正值或未评估及原因；不得声称本任务已经完成费用优化或证明锁是吞吐瓶颈。
- [ ] 相关检查通过且变更实际进入约定落地流程；本次立案保持所有 AC/DoD 未勾选，执行验收由有明确授权的流程处理。

## Touches
- scripts/task-efficiency-baseline.mjs
- scripts/task-efficiency-baseline.test.mjs
- docs/analysis/task-efficiency-baseline.md
- tasks/gap-task-efficiency-baseline-attribution-semantics.md
