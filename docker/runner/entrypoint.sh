#!/bin/sh
# ghcr.io/good7ob/runner entrypoint (g7b #3634, design runner-onboarding 7.6).
#
#   1. The `runner` profile on the /data volume has no key yet and G7B_ENROLL is set:
#        good7ob agent enroll "$G7B_ENROLL" --profile runner --api-url "${G7B_API_URL:-https://api.good7ob.com}"
#      Already enrolled: skipped, so a spent or expired G7B_ENROLL on a restart does no harm. A *different* token on
#      an enrolled volume (container rebuilt after the key was revoked) is redeemed again; if that fails the existing
#      key is kept.
#   2. Model credentials: the profile's env file (organisation model key handed out by the redeem) or, for a token
#      generated with "hosting machine brings its own model credentials", ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN
#      from `docker run -e`. None of them: exit 2 with instructions.
#   3. `good7ob --profile runner agent listen`, signals forwarded. listen exit 6 = key revoked: say so, keep 6.
#
# Exit codes: listen's own (0 clean stop, 6 key invalid, 1 other), enroll's (non-zero) when the redeem fails,
# 2 for a missing setting. No key, token or model credential is ever printed: this script only tests for presence.

set -eu

PROFILE=runner
DEFAULT_API_URL=https://api.good7ob.com
PROFILE_DIR="$HOME/.good7ob-profiles/$PROFILE"
CONFIG_FILE="$PROFILE_DIR/config.json"
ENV_FILE="$PROFILE_DIR/env"
# sha256 of the token this volume was enrolled with (not the token): tells a restart from a re-enrollment
TOKEN_MARK="$PROFILE_DIR/enroll-token.sha256"
EXIT_CONFIG=2
EXIT_KEY_INVALID=6

say() { printf '[g7b-runner] %s\n' "$1"; }
warn() { printf '[g7b-runner] ! %s\n' "$1" >&2; }
# die <code> <first line> [more lines...]
die() {
  code=$1
  shift
  printf '[g7b-runner] ✗ %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '[g7b-runner]   %s\n' "$line" >&2; done
  exit "$code"
}

# The profile's config.json holds a non-empty apiKey (checked in node; the value is never written out).
has_key() {
  [ -f "$CONFIG_FILE" ] || return 1
  node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.exit(typeof c.apiKey === "string" && c.apiKey.trim() ? 0 : 1);' "$CONFIG_FILE" 2>/dev/null
}

token_hash() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# A Claude Code credential reachable by the forwarded `claude -p`: docker -e, the profile's env file (passed to the
# forward command by listen), or a login stored on the volume (`claude` run inside this container).
has_model_credential() {
  [ -n "${ANTHROPIC_API_KEY:-}" ] && return 0
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && return 0
  if [ -f "$ENV_FILE" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then
    return 0
  fi
  [ -s "$HOME/.claude/.credentials.json" ] && return 0
  return 1
}

# good7ob agent enroll; returns its exit code. The token goes to the CLI as an argument only, never echoed.
enroll() {
  api_url=${G7B_API_URL:-$DEFAULT_API_URL}
  say "用接入令牌兑换 Key（API $api_url，配置档 $PROFILE）"
  rc=0
  good7ob agent enroll "$G7B_ENROLL" --profile "$PROFILE" --api-url "$api_url" || rc=$?
  if [ "$rc" -eq 0 ]; then
    if has_key; then
      (umask 077 && token_hash "$G7B_ENROLL" > "$TOKEN_MARK") || warn "无法写入 $TOKEN_MARK（不影响运行）"
    else
      rc=1
      warn "兑换命令成功，但配置档 $CONFIG_FILE 里没有 Key"
    fi
  fi
  return "$rc"
}

# ---- 0. the volume ----
mkdir -p "$HOME" 2>/dev/null || true
if [ ! -w "$HOME" ]; then
  die "$EXIT_CONFIG" "$HOME 不可写（当前用户 uid $(id -u)）" \
    "请用 Docker 命名卷挂载 /data（-v g7b-<组织>-<员工>:/data）；用宿主机目录时，先把它的属主改为 uid $(id -u)"
fi

# ---- 1. enrollment ----
if has_key; then
  if [ -n "${G7B_ENROLL:-}" ] && [ -f "$TOKEN_MARK" ] && [ "$(token_hash "$G7B_ENROLL")" = "$(cat "$TOKEN_MARK" 2>/dev/null)" ]; then
    say "配置档 $PROFILE 已接入，跳过兑换（G7B_ENROLL 是接入时用过的令牌，已忽略）"
  elif [ -n "${G7B_ENROLL:-}" ]; then
    say "配置档 $PROFILE 已接入，但 G7B_ENROLL 是新的接入令牌：重新兑换"
    if ! enroll; then
      warn "重新兑换失败（原因见上），继续使用配置档里原有的 Key"
    fi
  else
    say "配置档 $PROFILE 已接入，跳过兑换"
  fi
elif [ -n "${G7B_ENROLL:-}" ]; then
  rc=0
  enroll || rc=$?
  if [ "$rc" -ne 0 ]; then
    die "$rc" "兑换失败，原因见上方 good7ob 的输出（退出码 $rc）" \
      "接入令牌只能用一次、24 小时内有效。请在后台重新生成接入令牌，然后用新令牌重建容器（docker rm -f 后再 docker run，卷可以保留）"
  fi
else
  die "$EXIT_CONFIG" "配置档 $PROFILE 还没有接入，也没有设置 G7B_ENROLL" \
    "首次启动需要传入接入令牌，在后台对应的托管申请里点「生成接入令牌」获取：" \
    "docker run -d --name g7b-<组织>-<员工> --restart on-failure -v g7b-<组织>-<员工>:/data \\" \
    "  -e G7B_ENROLL=<接入令牌> -e G7B_API_URL=<API 地址> ghcr.io/good7ob/runner"
fi

# ---- 2. model credentials ----
if ! has_model_credential; then
  die "$EXIT_CONFIG" "没有模型凭证：这个接入令牌没有下发组织模型 Key（生成时勾选了「托管机器自备模型凭证」）" \
    "请用 -e ANTHROPIC_API_KEY=<key> 或 -e CLAUDE_CODE_OAUTH_TOKEN=<claude setup-token 生成的令牌> 重建容器；" \
    "已接入的 Key 保存在卷里，保留同一个卷即可，不需要新的接入令牌"
fi

# ---- 3. git credentials for the tasks (optional) ----
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || warn "gh auth setup-git 失败：git clone / push 私有仓库可能失败"
fi

# ---- 4. listen ----
child=
# shellcheck disable=SC2329 # invoked by the trap below
forward_signal() {
  # SIGINT is ignored by background jobs of a non-interactive shell: always ask listen to stop with SIGTERM
  if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; fi
}
trap forward_signal INT TERM

say "启动 good7ob --profile $PROFILE agent listen"
good7ob --profile "$PROFILE" agent listen &
child=$!

# `wait` returns >128 when a trapped signal interrupts it while listen keeps running (graceful stop): wait again.
code=0
while :; do
  code=0
  wait "$child" || code=$?
  [ "$code" -gt 128 ] || break
  if kill -0 "$child" 2>/dev/null; then continue; fi
  # listen has exited: its status may still be pending (127 = already collected above, keep that one)
  again=0
  wait "$child" 2>/dev/null || again=$?
  [ "$again" -ne 127 ] && code=$again
  break
done

if [ "$code" -eq "$EXIT_KEY_INVALID" ]; then
  printf '[g7b-runner] ✗ %s\n' "Key 已失效，请重新生成接入令牌并重建容器" >&2
  printf '[g7b-runner]   %s\n' "重建时传入新的 G7B_ENROLL，卷可以保留：新令牌会自动重新兑换" >&2
fi
exit "$code"
