#!/usr/bin/env python3
"""manager-visual-check.py — manager 自己的视觉核查工具（非产品代码，个人凭证依赖）

## 为什么这是 manager 自己的工具，不是产品交付物（记账，见 plugin/skills/manager/SKILL.md §9）

plugin/skills/manager/SKILL.md §4/§9 明写：manager 若需要新的观测/判定能力，产出应是「转给外层的需求」，
不是自己写脚本——manager 手里出现 .sh/.ts 实现即越界信号（2026-08-06 违规后从散文硬化为强制检查）。

本工具是这条规则的一个【结构性例外】，不是绕过：它必须调用操作者个人的阿里云 Token Plan 订阅
（~/.local/etc/aliyun-api-key，只存在于本机，绑定个人付费额度）。产品代码必须对任何跑 quay 的人都能用，
不能依赖某一个人的私人付费 key——所以它在结构上不可能被 inner/outer 收进 scripts/test.sh 或
packages/quay/src/ 那类产品交付面。这与 SKILL.md §4「唯一例外：没有别的主人的机件」同一逻辑，
只是这次「没有别的主人」的原因是个人凭证依赖，不是跨项目共享。

⇒ 若哪天这个能力要变成产品级的机械化视觉回归检查（例如接进 scripts/test.sh 或某个 AC 的判据），
那必须走正常路径：manager 把需求转给 outer，由 inner 实现、走测试与 anti-drift，
用一把不依赖个人订阅的 key（项目自己的服务账号）——⛔ 不是把本文件原样搬过去。

## 用途

给 manager 在 tick 轮次里独立核实"截图证据是否真的像设计稿/是否有残留硬编码色值"这类视觉声称，
不再只能凭自己的印象判断，也不用等 outer/inner 转述。

## 用法
    python3 orchestration/manager-visual-check.py <image1> [image2] [--question "..."] [--model qwen3.6-flash]

    单图模式（只传 image1）：对该截图做视觉审计（配色/布局/是否有刺眼原色）
    双图模式（传 image1 + image2）：image1 视为参照（设计稿），image2 视为候选（实现截图），给出差异报告

    输出：stdout 是模型给出的 JSON 结构化结果；stderr 是 token 用量（成本可见，硬规则「别用总 token 判贵贱」）。
    退出码：0 = 调用成功（无论视觉判断内容如何）；1 = 传输/鉴权/解析失败（fail loud，不返回一个"看起来合格"的空值）。

## 维护

这是 manager 自己持续维护的工具（2026-08-17 建，人指示）。若阿里云 Token Plan 的 endpoint/模型清单/
key 格式变化，manager 应在下次使用前重新用 curl 核实（正是当晚建它之前做的那三次验证），
不要凭记忆里的 endpoint 硬编码后就不再核实。
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.request
import urllib.error

KEY_FILE = os.path.expanduser("~/.local/etc/aliyun-api-key")
ENDPOINT = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
DEFAULT_MODEL = "qwen3.6-flash"  # 实测含视觉理解能力的 flash 档模型，2026-08-17 核实（非 qwen3.7-flash——该模型不存在）

SINGLE_IMAGE_PROMPT = (
    "这是一个网页截图。请审计视觉一致性，只输出 JSON（不要输出思考过程、不要输出 JSON 外的任何文字），"
    "字段：colors_observed（数组，主要配色的简短描述）、"
    "jarring_hardcoded_hex（bool，是否有明显未经设计系统处理的刺眼原色，如纯红#ff0000这类）、"
    "layout_block_count（数字，主要布局区块估计数）、"
    "issues（数组，任何视觉问题的简短描述，没有则空数组）。"
)

COMPARE_PROMPT = (
    "第一张图是设计参照（reference），第二张图是实现截图（candidate）。"
    "比较两者的视觉一致性，只输出 JSON（不要输出思考过程、不要输出 JSON 外的任何文字），"
    "字段：color_scheme_match（bool，主色调是否一致）、"
    "layout_similarity（\"high\"|\"medium\"|\"low\"）、"
    "notable_differences（数组，具体差异点的简短描述）、"
    "verdict（\"consistent\"|\"inconsistent\"|\"partial\"）。"
)


def load_api_key():
    if not os.path.isfile(KEY_FILE):
        print(f"Error: Aliyun API key file not found: {KEY_FILE}", file=sys.stderr)
        print("This tool needs the operator's personal Aliyun Token Plan key (not a project credential).", file=sys.stderr)
        sys.exit(1)
    text = open(KEY_FILE, "r", encoding="utf-8").read()
    m = re.search(r'ALIYUN_API_KEY=["\']?([^"\'\n]+)', text)
    if not m or not m.group(1).strip():
        print(f"Error: ALIYUN_API_KEY not found/empty in {KEY_FILE}", file=sys.stderr)
        sys.exit(1)
    key = m.group(1).strip()
    if not key.startswith("sk-sp-"):
        print(f"Warning: key does not start with 'sk-sp-' (Token Plan format per docs) — proceeding anyway", file=sys.stderr)
    return key


def image_to_data_url(path):
    if not os.path.isfile(path):
        print(f"Error: image not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lstrip(".").lower() or "png"
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    return f"data:image/{mime};base64,{b64}"


def main():
    ap = argparse.ArgumentParser(description="manager 的视觉核查工具（个人凭证，非产品代码）")
    ap.add_argument("image1", help="单图模式：待审计截图；双图模式：设计参照图")
    ap.add_argument("image2", nargs="?", default=None, help="可选，双图模式的候选（实现）截图")
    ap.add_argument("--question", default=None, help="覆盖默认 prompt")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-tokens", type=int, default=800)
    args = ap.parse_args()

    api_key = load_api_key()
    content = []
    if args.question:
        prompt = args.question
    else:
        prompt = COMPARE_PROMPT if args.image2 else SINGLE_IMAGE_PROMPT
    content.append({"type": "text", "text": prompt})
    content.append({"type": "image_url", "image_url": {"url": image_to_data_url(args.image1)}})
    if args.image2:
        content.append({"type": "image_url", "image_url": {"url": image_to_data_url(args.image2)}})

    payload = {
        "model": args.model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": args.max_tokens,
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"Error: HTTP {e.code} from Token Plan endpoint", file=sys.stderr)
        print(err_body[:1000], file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: request failed — {e}", file=sys.stderr)
        sys.exit(1)

    try:
        msg = body["choices"][0]["message"]
        answer = msg.get("content") or ""
        usage = body.get("usage", {})
    except (KeyError, IndexError) as e:
        print(f"Error: unexpected response shape — {e}", file=sys.stderr)
        print(json.dumps(body, ensure_ascii=False)[:1000], file=sys.stderr)
        sys.exit(1)

    # 模型经常把 JSON 包在 ```json ... ``` 代码块里（实测 2026-08-17，尽管 prompt 明确要求纯 JSON）——
    # 剥掉围栏，让 stdout 对下游脚本真正可解析，⛔ 不是"提示词写了就该照做"。
    fenced = re.match(r"^\s*```(?:json)?\s*\n(.*?)\n```\s*$", answer, re.S)
    if fenced:
        answer = fenced.group(1)

    # 输出：stdout 只放模型的回答（尽量是纯 JSON，便于下游脚本解析）；用量信息走 stderr。
    print(answer)
    print(
        f"[usage] prompt_tokens={usage.get('prompt_tokens')} "
        f"completion_tokens={usage.get('completion_tokens')} "
        f"total_tokens={usage.get('total_tokens')} "
        f"model={args.model}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
