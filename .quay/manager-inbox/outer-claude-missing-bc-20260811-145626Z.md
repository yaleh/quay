DIR-128 前置已实测（ssh 探测 B/C）：
- B/C 都有：claude-deepseek wrapper、jq、密钥文件 ~/.local/etc/deepseek-api-key、Node ≥20。
- B/C 都缺：**claude 二进制本体**（wrapper 是 `exec claude "$@"`，claude 缺失 = 命令行跑不起来）。
- C 还缺 quay checkout（B 有 ~/work/quay）。

⇒ 当前无法在 B/C 起真实两层循环（AC16③ Level3 不可达）。claude 安装是剩余硬前置。
已记入 DIR-128（前置实测段）+ DIR-123 Finding（Level3 路径硬阻塞）。
