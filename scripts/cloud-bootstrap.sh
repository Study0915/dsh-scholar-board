#!/usr/bin/env bash
# cloud-bootstrap.sh — 在 QoderWake 的 Ubuntu/Debian 云电脑上准备 dsh-scholar-board。
#
# 安装 Node 24、依赖、pnpm 与 dsh 0.2.1-rc.1、Chrome 或 Playwright Chromium、中文字体；
# 设置仓库局部 Git 身份和隐私 pre-push；运行隐私自测试与快速检查。需要完整验证时用
# RUN_VERIFY=1。本脚本不改全局 Git/npm 配置，不写入任何秘密。
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
DEBUG="$ROOT/.debug"
ENV_FILE="$DEBUG/cloud-env.sh"
mkdir -p "$DEBUG"

say() { printf '\n[cloud] %s\n' "$*"; }
warn() { printf '\n[cloud] 警告：%s\n' "$*" >&2; }
die() { printf '\n[cloud] 失败：%s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
trap 'printf "\n[cloud] 命令在第 %s 行退出：%s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

[ "$(uname -s)" = Linux ] || die "只支持 Linux 云电脑（Ubuntu/Debian）"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) warn "检测到 ${ID:-未知}，按 Ubuntu/Debian 的 apt 流程继续；不匹配时请手工安装依赖" ;;
  esac
fi

SUDO=""
if [ "$(id -u)" -ne 0 ] && have sudo && sudo -n true 2>/dev/null; then SUDO="sudo"; fi
can_apt() { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }
apt_install() {
  can_apt || die "安装 $* 需要 root 或免密 sudo"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -y
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

say "检查基础工具"
if ! have git || ! have curl || ! have tar || ! have xz; then
  apt_install git curl ca-certificates tar xz-utils
fi
have git && have curl || die "git/curl 不可用"

say "检查 Node"
NODE_MAJOR=0
if have node; then NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0); fi
if [ "$NODE_MAJOR" -lt 24 ]; then
  NODE_MIRROR=${NODE_MIRROR:-https://nodejs.org/dist}
  case "$(uname -m)" in
    x86_64) NODE_ARCH=x64 ;;
    aarch64|arm64) NODE_ARCH=arm64 ;;
    *) die "不支持的架构：$(uname -m)" ;;
  esac
  say "安装用户级 Node 24 到 $HOME/.local/node"
  mkdir -p "$HOME/.local/node"
  TARBALL=$(curl -fsSL "$NODE_MIRROR/latest-v24.x/" | grep -oE "node-v24\\.[0-9]+\\.[0-9]+-linux-${NODE_ARCH}\\.tar\\.xz" | head -n 1)
  [ -n "$TARBALL" ] || die "取不到 Node 24 包；可设置 NODE_MIRROR 为镜像地址"
  curl -fsSL "$NODE_MIRROR/latest-v24.x/$TARBALL" -o "$DEBUG/node.tar.xz"
  tar -xJf "$DEBUG/node.tar.xz" -C "$HOME/.local/node" --strip-components=1
  rm -f "$DEBUG/node.tar.xz"
  export PATH="$HOME/.local/node/bin:$PATH"
fi
node -v
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 24 ] || die "Node 版本仍低于 24"

say "安装依赖（npm ci）"
if [ -n "${NPM_REGISTRY:-}" ]; then
  export npm_config_registry="$NPM_REGISTRY"
  export npm_config_replace_registry_host=always
  say "使用 NPM_REGISTRY=$NPM_REGISTRY"
fi
npm ci --no-audit --no-fund

say "安装用户级 pnpm 与 DSH"
NPM_GLOBAL="$HOME/.npm-global"
mkdir -p "$NPM_GLOBAL"
export npm_config_prefix="$NPM_GLOBAL"
export PATH="$NPM_GLOBAL/bin:$PATH"
npm install --global --no-audit --no-fund pnpm@11 @deepseek-ai/dsh@0.2.1-rc.1
pnpm --version
dsh --version || die "dsh 不可用"
[ "$(pnpm --version | cut -d. -f1)" -ge 11 ] || die "pnpm 版本低于 11"

say "检查中文字体"
if ! have fc-list || [ -z "$(fc-list :lang=zh 2>/dev/null | head -n 1)" ]; then
  apt_install fonts-noto-cjk fontconfig
fi
[ -n "$(fc-list :lang=zh 2>/dev/null | head -n 1)" ] || die "没有中文字体，冒烟与矩阵会不稳定；请安装 fonts-noto-cjk"

say "检查 Chrome/Chromium"
find_chrome() {
  local candidate
  for candidate in "${CHROME_PATH:-}" "$(command -v google-chrome 2>/dev/null || true)" "$(command -v google-chrome-stable 2>/dev/null || true)" "$(command -v chromium 2>/dev/null || true)" "$(command -v chromium-browser 2>/dev/null || true)" /usr/bin/google-chrome /usr/bin/chromium; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done
  return 1
}
CHROME=$(find_chrome || true)
if [ -z "$CHROME" ] && [ "$(uname -m)" = x86_64 ] && can_apt; then
  say "安装 Google Chrome stable"
  DEB="$DEBUG/google-chrome.deb"
  if curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$DEB"; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$DEB" || warn "Google Chrome deb 安装失败"
    rm -f "$DEB"
    CHROME=$(find_chrome || true)
  else
    warn "下载 Google Chrome 失败"
  fi
fi
if [ -z "$CHROME" ]; then
  say "回退到 Playwright Chromium"
  [ -x node_modules/.bin/playwright ] || die "找不到 Playwright；先完成 npm ci"
  node_modules/.bin/playwright install --with-deps chromium || die "Playwright Chromium 安装失败；可设置 CHROME_PATH 指向已有 Chrome"
  CHROME=$(node -e 'console.log(require("playwright").chromium.executablePath())' 2>/dev/null || true)
fi
[ -n "$CHROME" ] && [ -x "$CHROME" ] || die "没有可用的 Chrome/Chromium；请设置 CHROME_PATH"
"$CHROME" --version 2>/dev/null || true

say "检查 GitHub CLI"
if ! have gh; then
  if can_apt; then $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y gh || warn "gh 安装失败"; fi
fi
if have gh; then gh --version | head -n 1; else warn "未安装 gh；创建 PR 前需要安装并用 gh auth login 认证"; fi

say "核对仓库与远端"
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
case "$REMOTE_URL" in
  *Study0915/dsh-scholar-board*) ;;
  *) die "origin 不是 Study0915/dsh-scholar-board；请克隆产品仓库后再运行" ;;
esac
if git remote -v 2>/dev/null | grep -q 'Study0915/dsh-widget-board'; then
  warn "仓库里还有 dsh-widget-board 远端；Waker 只应推 Study0915/dsh-scholar-board"
fi
if git rev-parse --is-shallow-repository 2>/dev/null | grep -q true; then
  say "补全浅克隆历史"
  git fetch --unshallow --tags || warn "unshallow 失败；推送前先手动 git fetch --unshallow"
fi
git fetch --prune --tags || warn "git fetch 失败；联网后先 fetch 再推送"

say "设置仓库局部 Git 身份与隐私钩子"
git config --local user.name "Study0915"
git config --local user.email "${GIT_EMAIL:-191421556+Study0915@users.noreply.github.com}"
chmod +x scripts/githooks/pre-push
git config --local core.hooksPath scripts/githooks
git config --local --get user.name
git config --local --get user.email
git config --local --get core.hooksPath

say "写入云电脑环境文件"
{
  printf 'export DSH_HOME=%q\n' "$DEBUG/dsh-home"
  printf 'export CHROME_PATH=%q\n' "$CHROME"
  printf 'export PATH=%q\n' "$HOME/.local/node/bin:$NPM_GLOBAL/bin:$PATH"
  if [ -n "${NPM_REGISTRY:-}" ]; then printf 'export NPM_REGISTRY=%q\n' "$NPM_REGISTRY"; fi
} > "$ENV_FILE"
mkdir -p "$DEBUG/dsh-home"
say "后续 shell 先执行：source .debug/cloud-env.sh"

say "隐私检查自测试"
node scripts/privacy-check.mjs --self-test

say "快速检查"
npm run lint
npm run docs:check
npm run changelog:check
npm run agents:check
npm run build
npm test

if [ "${RUN_VERIFY:-0}" = 1 ]; then
  say "完整 verify"
  npm run verify
else
  say "跳过完整 verify；首个任务请运行 npm run verify（或 RUN_VERIFY=1 bash scripts/cloud-bootstrap.sh）"
fi

say "完成"
printf 'Node: %s\nChrome: %s\nDSH: %s\n' "$(node -v)" "$CHROME" "$(dsh --version 2>/dev/null | head -n 1)"
printf '下一步：source .debug/cloud-env.sh；gh auth login（或配置 GH_TOKEN）；npm run verify。\n'
