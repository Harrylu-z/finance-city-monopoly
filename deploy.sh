#!/usr/bin/env bash
# =============================================================================
# GitHub Pages 一键部署脚本（Linux / macOS / Git Bash on Windows）
#
# 用法：
#   bash deploy.sh                     # 交互式：询问仓库名后推送
#   bash deploy.sh my-repo             # 指定仓库名
#   bash deploy.sh my-repo "大富翁"     # 指定仓库名 + 描述
#
# 前置条件：
#   1. 已安装 Git
#   2. 已安装 gh（GitHub CLI）并完成登录：gh auth login
#   3. 当前目录是项目根目录（含 index.html）
# =============================================================================
set -euo pipefail

REPO_NAME="${1:-}"
REPO_DESC="${2:-中国金融城 · 像素大富翁 — 零构建纯静态 ES Modules 大富翁}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[FAIL]${NC} $*" >&2; }

# ---------- 0. 环境检查 ----------
command -v git >/dev/null 2>&1 || { err "未找到 git，请先安装：https://git-scm.com/downloads"; exit 1; }
command -v gh  >/dev/null 2>&1 || { err "未找到 gh，请先安装：https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { err "gh 未登录，请先执行：gh auth login"; exit 1; }
[ -f index.html ] || { err "当前目录不是项目根目录（缺少 index.html）"; exit 1; }
ok "环境检查通过"

# ---------- 1. 确认仓库名 ----------
if [ -z "$REPO_NAME" ]; then
  read -rp "仓库名（建议用英文，如 finance-city-monopoly）: " REPO_NAME
fi
[ -z "$REPO_NAME" ] && { err "仓库名不能为空"; exit 1; }

GITHUB_USER="$(gh api user --jq .login)"
REPO_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}"
PAGES_URL="https://${GITHUB_USER}.github.io/${REPO_NAME}/"
info "仓库地址将设为：${REPO_URL}"

# ---------- 2. 确认 .nojekyll 与 .gitignore ----------
[ -f .nojekyll ] || { touch .nojekyll; ok "已创建 .nojekyll（防止 Pages 忽略下划线目录）"; }
[ -f .gitignore ] || cat > .gitignore <<'EOF'
__pycache__/
*.py[cod]
.venv/
node_modules/
.DS_Store
.vscode/
.idea/
_st.html
_ap.html
_zoom*.png
_patch_*.py
EOF
ok "部署配置文件就绪"

# ---------- 3. 初始化 Git 仓库 ----------
if [ ! -d .git ]; then
  git init -q
  ok "已初始化 Git 仓库"
fi
git add -A
if git diff --staged --quiet; then
  warn "没有待提交的变更"
else
  git -c user.name="$(gh api user --jq .name || echo 'Cursor')" \
      -c user.email="$(gh api user --jq .email || echo "${GITHUB_USER}@users.noreply.github.com")" \
      commit -q -m "feat: 中国金融城像素大富翁 — 63 格棋盘 / 四大监管机构 / 央行贷款 / 债券发行 / 集团 Buff"
  ok "已提交"
fi

# ---------- 4. 创建远端仓库并推送 ----------
if gh repo view "$GITHUB_USER/$REPO_NAME" >/dev/null 2>&1; then
  warn "远端仓库已存在，改为推送更新"
else
  gh repo create "$REPO_NAME" --public --description "$REPO_DESC" --source=. --remote=origin
  ok "已创建远端仓库"
fi

git branch -M main
git push -u origin main
ok "已推送到 main 分支"

# ---------- 5. 开启 Pages ----------
info "正在开启 GitHub Pages（source = main / root）…"
sleep 3
gh api -X POST "repos/${GITHUB_USER}/${REPO_NAME}/pages" \
  -f source[branch]=main -f source[path]=/ 2>/dev/null \
  || gh api -X PUT "repos/${GITHUB_USER}/${REPO_NAME}/pages" \
       -f source[branch]=main -f source[path]=/ 2>/dev/null \
  || warn "Pages API 调用返回非零，稍后可在仓库 Settings → Pages 手动开启"

ok "Pages 部署已触发"

# ---------- 6. 输出结果 ----------
cat <<EOF

${GREEN}════════════════════════════════════════════════════════${NC}
${GREEN}  部署完成！${NC}
${GREEN}════════════════════════════════════════════════════════${NC}

  ${BLUE}仓库地址${NC}   ${REPO_URL}
  ${BLUE}游戏地址${NC}   ${PAGES_URL}
  ${BLUE}分享链接${NC}   在游戏内按  ≡  →  分享战绩  →  复制链接

  ${YELLOW}首次访问${NC}   首次构建约需 1~2 分钟，之后直接输入网址即可。
  ${YELLOW}如未自动打开${NC} 请手动访问：Settings → Pages → 确认 Source 为 "Deploy from a branch"

  ${YELLOW}重要${NC}   游戏内的"复制链接"生成的是基于当前域名的深链接，
         ${YELLOW}部署后请在公网地址上重新复制一次。${NC}

EOF
