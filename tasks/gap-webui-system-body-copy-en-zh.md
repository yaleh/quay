---
id: gap-webui-system-body-copy-en-zh
title: /system 正文文案在 lang=en 下仍是硬编码中文（含 <title>/<h1> 的中文后缀）—— 正文本地化系列，照
  /dashboard 已定 pattern
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /system`，去掉 `<style>/<script>`/标签后含中文的文本行，剔除切换控件的 endonym「中文」）**：**7 行**，全部是界面文案而非数据：

| en 下可见的中文 | 备注 |
|---|---|
| `quay — System — 系统状态`（`<title>`）、`System — 系统状态`（`<h1>`） | 名称 `System` 已英文，**后缀「— 系统状态」是硬编码**；AC-293 只接了 nav 当前项与页名，没接这段后缀 |
| `数据源：` / `（稳定机读 JSON 输出）` | 页内说明 |
| `：资源充足，可以跑` / `阈值按…动态计算显示，不写死当前机器上的数字。` | 资源判定句 |

源码位置：`packages/quay/src/serve-system.ts`（**非注释中文行 17 条**；该文件同时承载 `/manager`，见下）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/system` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability，不构成依赖）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern：`serve-i18n.ts` ROW 5~9 的 `DASHBOARD_KEYS/DASHBOARD_LABELS/dashboardLabelsFor`、`fillLabel` 模板、`CHROME_LABELS`）；本任务**照抄其「决定记录」①~⑨，不重新设计**。`/manager` 也在 `serve-system.ts` 里，由 `gap-webui-manager-body-copy-en-zh` 单独处理——两条在该文件与 `serve-i18n.ts` 上 Touches 重叠，由驱动串行，互不越界（本条只动 `handleSystem` 及其独占的渲染串）。

## Plan

1. **红基线**：自起 `startServer({port:0})`（⛔ 不探询常驻实例），`Cookie: lang=en` GET `/system`，去 `<style>/<script>`/标签后逐行列出含 CJK 的行（剔除 `中文` endonym），贴完整清单——即「待清零集合」。同一谓词先对 `lang=zh` 干跑，确认能命中（零计数必须先对已知真样本验证谓词）。
2. **字典**：`serve-i18n.ts` 新增一行 `SYSTEM_KEYS` + `SYSTEM_LABELS: Record<SystemKey,{en,zh}>`（形同 `DASHBOARD_LABELS`：闭合键集、缺列编译期报错、**zh 列逐字等于现有字面量**）与 `systemLabelsFor(lang)`；带插值的行用两列都含 `{name}` 的模板 + 既有 `fillLabel`，⛔ 不在调用点拼「中文 + 数据」。
3. **改 `serve-system.ts` 的 `/system` 路径**：全部走字典；`<title>`/`<h1>` 的后缀一并处理（页名 `System` 走既有 `pageNameFor`，后缀走本页字典，两者是并列关系，不要合并）。
4. **该页若有局部刷新/异步替换端点**：必须带语言（dashboard 决定记录 ⑥：退回默认语言会让 zh 页几秒后变英文，而页面自身 HTML 是对的，单次抓取的探针看不见）；客户端脚本里的串没有字典，走参数传入（⑦）。
5. **既有测试迁移**：默认 en ⇒ 钉中文的断言改为显式 `lang:"zh"` / `?lang=zh`；负向断言必须显式 zh（en 下变恒真空转）。先**实跑**找红清单，⛔ 不靠 grep 猜；红的文件不在 Touches 里就**先补 Touches 再改**。
6. **新测试** `packages/quay/test/serve-system-body-i18n.test.mjs`（`// @test-group product`）：字典完备性 + 取词两条 throw 路径 + 黑盒 en/zh 两态（en 下界面 CJK = 0，同一谓词对 zh 干跑必须命中）。
7. **因果对照**：临时把 `systemLabelsFor` 钳成恒 zh，en 黑盒变红；恢复复绿。
8. **收口**：`scripts/test.sh --for-task gap-webui-system-body-copy-en-zh` 绿 + `node --test packages/quay/test/serve-*.test.mjs` 绿 + `tsc --noEmit` 绿；落地后**重启常驻 serve**（不会自动重载）并 headless Chrome 截图核对。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/system` 界面文案中文行的**完整清单与条数**；⛔ 不得只报总数；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：改后同一判据界面中文行 = 0；剩余含中文的行逐条列出并归类为用户数据（若无剩余，写明「无」）。
- [ ] **AC3（zh 零变化）**：改前 commit 与改后各抓一次 `lang=zh` 响应，去动态数据后 diff 为空（或差异逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；测试断言两列非空、`en` 列无 CJK；删任一列 `tsc --noEmit` 报错（贴一次删列红读数，再恢复）。
- [ ] **AC5（所有渲染路径与刷新端点带语言）**：列出该页全部渲染入口/局部刷新端点，逐个在 `?lang=zh` 下抓取并断言仍是 zh。
- [ ] **AC6（因果对照）**：`systemLabelsFor` 钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴**实跑变红的清单**；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 全绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve 后 headless Chrome 截图 `/system?lang=en` 与 `?lang=zh`，贴路径；en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/system` 的界面文案（含标题后缀）全为英文，选中文后与改前一致。
1. 落地对象：AC2/AC3 读数来自 HTTP 响应体，⛔ 不读渲染函数返回值当「响应」。
2. 可被打红：AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/manager` 与其余页正文一字不动。
4. 生效核对：重启 serve + 截图（AC8），⛔ 不以「代码已落地」代替「页面已变」。
5. 可回滚：还原取词调用、删 `SYSTEM_*`，纯本地代码。

## Touches

- tasks/gap-webui-system-body-copy-en-zh.md
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-system-body-i18n.test.mjs (new)
- packages/quay/test/serve-system.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/gap-webui-meter-limit-param-doubles-as-display-string.test.mjs
