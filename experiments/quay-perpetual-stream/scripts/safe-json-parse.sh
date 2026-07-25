#!/usr/bin/env bash
# safe-json-parse.sh — sourceable shell library for safe JSON parsing.
# Guards against empty/non-JSON input to prevent JSONDecodeError crashes
# in gate scripts (DIR-089, M151).
#
# Usage: source /path/to/safe-json-parse.sh
#
# Functions:
#   safe_json_parse <file>         — read, validate, and output JSON from a file
#   safe_json_parse_from_stdin     — read, validate, and output JSON from stdin
#
# Both functions:
#   - Output parsed JSON to stdout on success (exit 0)
#   - Output error message to stderr and return non-zero on failure
#
# Dependencies: python3

# safe_json_parse <file>
# Reads <file>, checks it exists and is non-empty, validates JSON.
# Outputs the parsed JSON to stdout. Returns 0 on success, non-zero on failure.
safe_json_parse() {
  local _file="${1:-}"
  if [ -z "$_file" ]; then
    echo "safe_json_parse: missing file argument" >&2
    return 1
  fi
  if [ ! -f "$_file" ]; then
    echo "safe_json_parse: file not found: $_file" >&2
    return 1
  fi
  if [ ! -s "$_file" ]; then
    echo "safe_json_parse: file is empty: $_file" >&2
    return 1
  fi
  python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    json.dump(data, sys.stdout)
except json.JSONDecodeError as e:
    print(f'safe_json_parse: invalid JSON in {sys.argv[1]}: {e}', file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f'safe_json_parse: error reading {sys.argv[1]}: {e}', file=sys.stderr)
    sys.exit(1)
" "$_file"
}

# safe_json_parse_from_stdin
# Reads stdin, checks non-empty, validates JSON.
# Outputs the parsed JSON to stdout. Returns 0 on success, non-zero on failure.
safe_json_parse_from_stdin() {
  python3 -c "
import json, sys
data = sys.stdin.read()
if not data.strip():
    print('safe_json_parse_from_stdin: stdin is empty', file=sys.stderr)
    sys.exit(1)
try:
    parsed = json.loads(data)
    json.dump(parsed, sys.stdout)
except json.JSONDecodeError as e:
    print(f'safe_json_parse_from_stdin: invalid JSON from stdin: {e}', file=sys.stderr)
    sys.exit(1)
"
}
