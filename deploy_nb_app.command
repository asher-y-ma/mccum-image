#!/bin/bash
# NB Nano Banana — 一键部署到 113.31.115.47
set -e

HOST="113.31.115.47"
USER="ubuntu"
PASS="xajh1111"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/nb-app"
REMOTE_DIR="/opt/nb-app"
WEBROOT="/var/www/nb-app"
BUN_PATH="/home/ubuntu/.bun/bin/bun"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    NB Nano Banana — 自动部署开始              ║"
echo "║    目标: http://$HOST/       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 检查 sshpass ──
if ! command -v sshpass &>/dev/null; then
    echo "→ 安装 sshpass..."
    if command -v brew &>/dev/null; then
        brew install hudochenkov/sshpass/sshpass -q
    else
        echo "  ✗ 请先安装 Homebrew: https://brew.sh"
        exit 1
    fi
fi
echo "  ✓ sshpass 就绪"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=30 -o ServerAliveInterval=60"
SSHPASS="sshpass -p $PASS"

ssh_run() {
    $SSHPASS ssh $SSH_OPTS $USER@$HOST "$1"
}

# ── 1. 测试连接 ──
echo ""
echo "[1/6] 测试 SSH 连接..."
if ! ssh_run "echo 'SSH OK'"; then
    echo "  ✗ 无法连接，请检查服务器 IP 和密码"
    exit 1
fi
echo "  ✓ SSH 连接成功"

# ── 2. 安装 nginx ──
echo ""
echo "[2/6] 安装 nginx..."
ssh_run "sudo apt-get update -qq && sudo apt-get install -y nginx curl unzip 2>&1 | tail -3"
ssh_run "sudo systemctl enable nginx && sudo systemctl start nginx"
echo "  ✓ nginx 就绪"

# ── 3. 安装 Bun ──
echo ""
echo "[3/6] 检查/安装 Bun..."
if ! ssh_run "test -f $BUN_PATH"; then
    echo "  → 安装 Bun..."
    ssh_run "curl -fsSL https://bun.sh/install | bash 2>&1"
fi
BUN_VER=$(ssh_run "$BUN_PATH --version")
echo "  ✓ Bun v$BUN_VER 就绪"

# ── 4. 上传源码 ──
echo ""
echo "[4/6] 打包并上传项目源码..."
TAR_FILE="/tmp/nb-app-deploy.tar.gz"
tar -czf "$TAR_FILE" \
    --exclude="$PROJECT_DIR/node_modules" \
    --exclude="$PROJECT_DIR/.git" \
    --exclude="$PROJECT_DIR/dist" \
    -C "$(dirname "$PROJECT_DIR")" \
    "$(basename "$PROJECT_DIR")"

echo "  → 上传中... ($(du -sh "$TAR_FILE" | cut -f1))"
$SSHPASS scp $SSH_OPTS "$TAR_FILE" $USER@$HOST:/tmp/nb-app.tar.gz
echo "  ✓ 上传完成"

ssh_run "sudo rm -rf $REMOTE_DIR && sudo mkdir -p /opt && sudo tar -xzf /tmp/nb-app.tar.gz -C /opt/"
ssh_run "sudo chown -R ubuntu:ubuntu $REMOTE_DIR"

# ── 5. 构建 ──
echo ""
echo "[5/6] 安装依赖并构建（约 2-3 分钟）..."
echo "  → bun install..."
ssh_run "cd $REMOTE_DIR && $BUN_PATH install 2>&1"
echo "  → bun build..."
ssh_run "cd $REMOTE_DIR && $BUN_PATH run build 2>&1"
echo "  ✓ 构建成功"

# ── 6. 配置 nginx ──
echo ""
echo "[6/6] 配置 nginx..."
ssh_run "sudo mkdir -p $WEBROOT && sudo cp -r $REMOTE_DIR/dist/. $WEBROOT/"

ssh_run "sudo tee /etc/nginx/sites-available/nb-app > /dev/null << 'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root $WEBROOT;
    index index.html;
    server_name _;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \.(css|js|woff2?|png|jpg|jpeg|gif|ico|svg|webp)$ {
        expires 30d;
        add_header Cache-Control \"public, immutable\";
    }
}
NGINX"

ssh_run "sudo ln -sf /etc/nginx/sites-available/nb-app /etc/nginx/sites-enabled/nb-app"
ssh_run "sudo rm -f /etc/nginx/sites-enabled/default"
ssh_run "sudo nginx -t && sudo systemctl reload nginx"
echo "  ✓ nginx 配置完成"

# ── 验证 ──
sleep 2
echo ""
ssh_run "curl -sI http://localhost/ | head -3"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║          🎉  部署成功！                       ║"
echo "║   访问地址: http://$HOST/       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "按任意键关闭..."
read -n 1
