---
id: gap-webui-a11y-focus-ring-and-token-contrast-unvalidated
title: 配色 token 从未被任何对比度判据钉过（全库任务 grep WCAG/对比度 = 0 命中）⇒ 主链接色实测 3.47:1 等 6 组低于
  AA；且全站链接 :focus 的 outline-style 为 none，纯键盘用户看不到光标位置
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-webui-detail-page-head-drops-pagestyles
---
**type:** execution

## Proposal

**现象 A —— 对比度（2026-09-08 对生产实例 `/dashboard` 遍历全部叶子文本节点，按 WCAG 相对亮度公式算，
去重后仅列不达标者）**：

| 实测比 | 前景 | 背景 | 字号/粗细 | 样本 | AA 要求 |
|---|---|---|---|---|---|
| **3.47** | `#ec3013` | `#eae9e9` | 12.8px | `查看 Live →` | 4.5 |
| **3.47** | `#ec3013` | `#eae9e9` | 12px | `view` / `download` | 4.5 |
| **3.76** | `#f3f2f2` | `#ec3013` | 9px | `NEW` 徽标 | 4.5 |
| **3.76** | `#ec3013` | `#f3f2f2` | 14.4px | `1h` 窗口档位 | 4.5 |
| **4.44** | `#157a45` | `#eae9e9` | 16px 粗 | `⇒ GO` | 4.5 |
| **4.44** | `#157a45` | `#eae9e9` | 12.48px 粗 | `fresh` | 4.5 |

前两行最要紧：`--color-accent` (`#ec3013`) 落在卡片面 `--color-surface` (`#eae9e9`) 上是
**全站主链接色**（每张卡的「查看 X →」、fan-in 的 `view`/`download` 全在这个组合下），实测 3.47。

**现象 B —— 焦点不可见**：对 `/dashboard` 第一个 `<a>` 调 `.focus()` 后读 computed style，
`outline-style` = **`none`**。全站没有任何 `:focus` / `:focus-visible` 规则，纯键盘操作时光标位置不可见。

**机制（这是为什么它是一条机制而不是「调几个色值」）**：**这套 token 从未被任何可取假的判据钉过**——
`grep -rlE "WCAG|对比度|contrast ratio" tasks/` 在全库**命中 0 个任务**；`grep -rlE "focus-visible|焦点轮廓" tasks/`
同样**命中 0**。相邻的 `gap-webui-accent-palette-no-success-color`（done）确实改过配色，但它的判据是
「pass/alive/GO 要有独立的绿色相，不要只靠红橙深浅区分」——**是色相区分度，不是对比度**；
`gap-ac100` 的判据是「详情页代码段 `grep -cE '#[0-9a-fA-F]{6}'` == 0」——**是有没有写死十六进制，
也不是对比度**。于是 token 可以在满足既有全部闸门的同时，把主链接色定在 3.47。
⇒ 本任务的核心产物不是新色值，而是**一条把「token 组合 × 使用场景」枚举出来算对比度的可执行判据**，
让下一次调色自动被挡住（硬规则 9：一条守与不守在记录上无法区分的规则只能靠意志，该给它造产物）。

**修法方向**：

1. 在 `serve-render.ts` / `webui-modernist.css` 补 `:focus-visible` 规则（2px outline + offset，
   颜色对两种主题都 ≥3:1）；
2. 调整不达标的 token 组合：accent 落在 surface 上的**文本**用途改用更深一档
   （`--color-accent-700` `#ae1800` 一类），accent 作**底色**时前景改用足够亮的值；
   绿色 `#157a45` 在 surface 上补到 ≥4.5；
3. 落一个**枚举式**判据：把「前景 token × 背景 token × 实际使用场景」列成表，逐条算比值，
   任何一条低于其场景阈值即报红，且报红时打印全部违例组合与条数。

## Acceptance Criteria

- [x] AC1 生产载体读数、枚举而非抽查：对 `/dashboard` `/tests` `/git-history` `/goal` `/task/<id>` 五页遍历
      **全部**可见叶子文本节点，按 WCAG 公式算前景/背景比值，断言**违例条数 == 0**（普通文本 ≥4.5、
      大号或粗体 ≥3.0）。失败时打印 `(比值, 前景, 背景, 字号, 样本文本)` 清单与条数。
      取假：改动前 `/dashboard` 单页去重后即有 **6** 组违例，最低 3.47。
- [x] AC2 判据挂在 token 上而非渲染结果上（防下次调色再犯）：单测枚举 `--color-*` 中**实际成对使用**的
      前景/背景组合表，逐条算比值并断言达标；表中任一条被改成不达标值时该测试必须报红（mutation 负控制，
      两侧都断言）。
- [x] AC3 焦点可见：对五页各自的第一个可聚焦元素调 `.focus()` 后断言 `outline-style != "none"` 且
      `outlineWidth >= 2px`，并断言 outline 颜色对其背景对比度 ≥3.0。取假：改动前实测 `none`。
- [x] AC4 键盘可达性不靠视觉以外的假设：断言五页上 `tabindex="-1"` 的可交互元素数 == 0，
      且每页存在一个跳到 `<main>` 的 skip-link（实测当前 15 页中仅 4 页有）。打印缺失页面清单与条数。
- [x] AC5 明暗两态都成立：AC1/AC2/AC3 在 `prefers-color-scheme: light` 与 `dark` 两种模拟下**各跑一遍**
      并均通过；打印两态各自的违例条数（应均为 0）。
- [x] AC6 `bash scripts/test.sh --for-task gap-webui-a11y-focus-ring-and-token-contrast-unvalidated` 退出码 0。

## Definition of Done

在**真实运行的实例**上，AC1 的违例清单从 6 条降到 0（前后两份清单并列贴进提交信息）；
录一段或截若干张连续 Tab 的图，焦点框在每一步都肉眼可见。
**「改了色值 + 单测绿」不算达成**——必须有这一次对五个生产页面的遍历读数，
以及那张能挡住下一次调色的 token 组合表。

## Touches

- `docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css`
- `packages/quay/src/serve-adr.ts`
- `packages/quay/src/serve-architecture.ts`
- `packages/quay/src/serve-board.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/serve-doc.ts`
- `packages/quay/src/serve-git.ts`
- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-live.ts`
- `packages/quay/src/serve-needs-human.ts`
- `packages/quay/src/serve-render.ts`
- `packages/quay/src/serve-send.ts`
- `packages/quay/src/serve-sessions.ts`
- `packages/quay/src/serve-system.ts`
- `packages/quay/src/serve-task.ts`
- `packages/quay/src/serve-tests.ts`
- `packages/quay/src/webui-modernist.css`
- `packages/quay/test/gap-webui-a11y-focus-ring-and-token-contrast-unvalidated.test.mjs`
- `packages/quay/test/serve-ac95-views.test.mjs`
- `packages/quay/test/web-ui-browser.test.mjs`
- `tasks/gap-webui-a11y-focus-ring-and-token-contrast-unvalidated.md`