---
id: gap-develop-deliver-asserts-http-200-but-root-now-302-redirects
title: 交付验证硬断言 / == 200，而产品 / 已改为 302→/dashboard ⇒ DIR-123 每次 merge
  后的跨主机交付验证全红，且在 B 上就中断、C 从未被验
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
---
## Proposal

**实测（2026-09-08 17:0xZ）**：`plugin/scripts/develop-deliver-tgz.sh --hosts "B C" --force`
在 B 上远端返回 `CODE=302` ⇒ 脚本 `[ "$code" = "200" ] || exit 1` ⇒ 整个交付验证 exit 1，
**且 stdout 上不打印任何原因**（远端 heredoc 的判据失败被 `out=CODE=302` 吞掉），
表现为「静默 exit 1」——要 `bash -x` 才看得见。

**产品侧是有意变更，不是故障（本地用同一 build 的产物直接实测）**：
```
GET /  → code=302  redirect=http://localhost:18099/dashboard
curl -L / → final=200
```
远端同形：`root: code=302 redir=…/dashboard` ; `follow: final=200`。
即 **服务是好的，判据过期了**：`curl -sf` 不带 `-L`，而 `/` 自
`01437b3e6`（git-graph 一批 webui 改动，含 `/git redirect`）之后不再直接返回 200。

**时间窗直接量**：主检出 `.quay/develop-deliver-state.json` 记录
`"lastDelivered":"78dc4dfe…","hosts":{"C":"200","B":"200"},"timestamp":"2026-09-08T13:47:52Z"`
⇒ 今天 13:47 还是 200，之后该范围内 133 个提交里的 webui 批次把 `/` 改成了重定向。

**第二个缺陷（同一次实测暴露，一并修）**：主机循环里 B 失败即 `exit 1`，
**C 根本没被验过**——「跨两机验证」在任一机失败时退化为「只验了一机且没说」。
`http_codes[C]` 无值，state.json 也不会记 C，**与「C 没跑过」和「C 跑过但没记」不可区分**（硬规则 3b）。

## Plan

1. 判据改为**跟随重定向后的终态**（`curl -sfL`），或显式接受 `{200,302}` 并断言
   跟随后的最终码为 200；⛔ 不要把 302 直接列进合格集而不看落点——那会把「重定向到 404」也放过。
2. 断言 `/dashboard` 的**内容**而不只是状态码（AC92 精神：端口活着 ≠ 面在服务），
   至少断言响应体非空且含一个稳定标记。
3. **主机循环不得因单机失败而中断**：逐机 continue，最后统一汇总；
   未跑到的主机在 state.json 里写 `not-evaluated`，**与 `verify-fail` 分开取值**（硬规则 3b）。
4. 远端判据失败必须把原因回传到本地 stdout（当前 `CODE=302` 被吞）。

## Acceptance Criteria

- [x] AC1 对当前 develop tip 的产物跑 `develop-deliver-tgz.sh --hosts "B C" --force` 退出码 0
- [x] AC2 `.quay/develop-deliver-state.json` 同时含 B 与 C 两个键，且值为最终码 200
- [x] AC3 负控制：把远端 serve 换成一个恒返回 404 的桩，脚本必须 exit 非 0（证明判据能取假）
- [x] AC4 负控制：让 B 故意失败，C 仍被验证并在 state.json 中留下自己的取值（不是缺键）
- [x] AC5 单机失败时本地 stdout 打印出该机的失败原因（含实际收到的 http code），不再静默 exit 1

## Definition of Done

AC1–AC5 全绿，且 state.json 中 B/C 两机的 `usage_verify` 与 `http` 两组值都不是
`fail`/缺键（`usage_verify` 的修复由 gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs
承担，本任务只需不掩盖它）。`scripts/test.sh` 全量绿。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/develop-deliver-tgz.test.mjs
- tasks/gap-develop-deliver-asserts-http-200-but-root-now-302-redirects.md