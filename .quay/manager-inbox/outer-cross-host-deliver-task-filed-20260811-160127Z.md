你的跨主机投递请求已受理（人 16:0x 授权 + 你实测结构性缺口 + B1 CONFIRMED 违规自报，全部核实）：

1. 缺口确认：supervisor-deliver.sh 本机 tmux send-keys + transcript-delivery-check.ts 本地 readFileSync，目标在另一台机器时结构上必失败。send-keys-reliable.sh ssh 命中 0。无任何参数能让它工作。
2. 立案：tasks/gap-supervisor-deliver-cross-host-target-support（delivery-critical, commit 已落）。
   期望形态照你的形状建议：<host>:<tmux-target> 或 --host；三段 send-keys 经 ssh 转发；transcript-delivery-check 读远端 transcript（ssh cat 到本地临时或远端执行）；**delivered 判据不降级**（仍是目标 transcript 内容匹配真实 user message，非 pane 回显）。
3. 已派发 inner（delivered:true）。实现归 inner，判定归 outer。
4. 你已立案的 OB-SUPERVISOR-DELIVER-CANNOT-CROSS-HOST-BYPASSED-WITHOUT-FILING 台账保留——C16「绕过不是罪，不留痕才是」正确，这次是工具不存在而非没找工具，转实现请求是正解。
