---
id: gap-webui-meter-limit-param-doubles-as-display-string
title: /system 的 bar() 把 limit 一参二用（既当分母又当显示文案），loadavg 传入 "nproc×2≈32" ⇒
  Number() 得 NaN 静默退化为 1 ⇒ 进度条恒满 100%，是一个结构上不可能取假的读数
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例 `/system` 实测 DOM，两次不同时刻各测一次）**：
`loadavg (1m)` 那条进度条**永远是满格**。页面同时显示的数值是 `23.69 / nproc×2≈32`（= 74%），
而实测填充条 `width / trackWidth = 640/640 = 100%`；同页的 `cpu_stall (avg300)` 显示 `51.65/60`（86%）
实测 71%~86%，随数值变化——即**只有 loadavg 这一条恒满**。

**根因（读代码确认，不是从像素推断）**：`packages/quay/src/serve-system.ts:18`

    const pct = val != null ? Math.min(100, Math.max(1, (val / (Number(limit) || 1)) * 100)) : 0;

`bar(label, val, limit)` 的第三参 `limit` **一参二用**——既当算百分比的分母，又当右侧显示的文案。
三个调用点（`:33`–`:35`）里：

- `bar("cpu_stall (avg10)", …, "60")` 与 `bar("cpu_stall (avg300)", …, "60")` 传的是可 `Number()` 的字符串 ⇒ 正常；
- `bar("loadavg (1m)", rg.loadAvg, \`nproc×${…}≈${rg.loadThreshold}\`)` 传的是**给人看的说明串**
  `"nproc×2≈32"` ⇒ `Number("nproc×2≈32")` = `NaN` ⇒ `NaN || 1` **静默退化为分母 1** ⇒
  `pct = min(100, loadAvg × 100)`，只要 loadavg ≥ 1 就恒等于 100。

**为什么这条值得单列而不是「改个参数就完」**：这是 CLAUDE.md 硬规则 4 的教科书实例——
**一个结构上不可能取假的量不是测量**。这条进度条在机器空闲、繁忙、爆表三种状态下**渲染完全一致**，
它携带的信息量为零，却与「负载已满」长得一模一样，比「没有这条进度条」更贵。
同时也是硬规则 3b：`Number(limit) || 1` 在**读不懂输入时返回了与合格同形的值**（一个合法分母），
而正确做法是给「无法评估」一个独立取值——分母解析不出时**不画进度条**（或画一个显式的 unknown 态），
不能默默按 1 算。

**修法方向**：把 `limit` 拆成两个参数 `numericLimit: number | null` 与 `displayLimit: string`；
`numericLimit == null` 时**不渲染填充条**、显示 `—` 或 `未知上限`，而不是退化成 1。
调用点 loadavg 传 `rg.loadThreshold`（数值）+ `nproc×N≈M`（文案）。

## Acceptance Criteria

- [x] AC1 生产载体读数（能取假）：对运行中的实例读 `/system`，取 loadavg 行的填充条宽度比与页面显示的
      `val / threshold`，断言两者相对误差 < 2%。取假：改动前实测显示 74% 而渲染 100%，跑同一脚本必须报红。
- [x] AC2 单调性（回答硬规则 4：让这个量真的能取假）：单测以 `val` = 阈值的 25% / 50% / 100% / 200% 四个输入
      调渲染函数，断言得到的 `pct` 为 **25 / 50 / 100 / 100** 四个**互不全等**的值。
      当前实现在这四个输入下全部返回 100 ⇒ 必须报红。
- [x] AC3 「无法评估」不与「合格」同形（硬规则 3b）：单测断言当 `numericLimit` 为 `null`/`NaN` 时，
      渲染结果里**不含填充条元素**（而不是含一个 100% 宽的填充条），且文案里出现一个可判定的未知标记。
- [x] AC4 枚举而非抽查：单测遍历 `/system` 页**全部**进度条调用点，断言每一处传入的分母都能 `Number()`
      成有限数或显式为 `null`；断言失败时打印违例调用点的清单与条数。
- [x] AC5 `bash scripts/test.sh --for-task gap-webui-meter-limit-param-doubles-as-display-string` 退出码 0。

## Definition of Done

在**真实运行的实例**上，于两个 loadavg 明显不同的时刻各截一次 `/system`，两张图里 loadavg 进度条的填充长度
**肉眼可见地不同**且与显示数值一致；把两次的 `(显示值, 阈值, 实测填充比)` 三元组贴进提交信息。
**「改了参数签名 + 单测绿」不算达成**——必须有这一次对生产载体的前后对照读数。

## Touches

- `packages/quay/src/serve-system.ts`
- `packages/quay/test/gap-webui-meter-limit-param-doubles-as-display-string.test.mjs`
- `tasks/gap-webui-meter-limit-param-doubles-as-display-string.md`
