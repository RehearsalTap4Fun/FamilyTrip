#!/usr/bin/env bash
# 部署到与饮食日记、叠叠中国同一台服务器：跑测试 → 构建 → rsync dist/ → 回读远端 index.html 确认
# 变量写在 .deploy.env（已 gitignore）：TRIP_SSH / TRIP_PATH / TRIP_URL
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .deploy.env ] && set -a && . ./.deploy.env && set +a
: "${TRIP_SSH:?需要 TRIP_SSH，例如 admin@1.2.3.4}"
: "${TRIP_PATH:=/var/www/trip}"

echo "▶ 测试"
npm test --silent >/dev/null
echo "▶ 构建"
npm run build >/dev/null
echo "▶ 同步到 $TRIP_SSH:$TRIP_PATH"
ssh "$TRIP_SSH" "mkdir -p '$TRIP_PATH'"
# assets/ 里的旧哈希文件不删：还开着旧页面的人按需加载 AI/SDK 分包时不会 404
rsync -az --exclude assets/ --delete dist/ "$TRIP_SSH:$TRIP_PATH/"
rsync -az dist/assets/ "$TRIP_SSH:$TRIP_PATH/assets/"
# systemd 单元有变化就装上（改了环境变量文件之类）
restart=0
if ! ssh "$TRIP_SSH" "cmp -s /etc/systemd/system/trip-api.service -" < scripts/trip-api.service; then
  echo "▶ 更新 systemd 单元"
  ssh "$TRIP_SSH" "sudo -n tee /etc/systemd/system/trip-api.service >/dev/null && sudo -n systemctl daemon-reload" < scripts/trip-api.service
  restart=1
fi
# 服务端（攻略代取 + 云同步 + 国外地图转发）：文件有变化才重启
if ! ssh "$TRIP_SSH" "cmp -s /opt/trip/api-server.mjs -" < server/api-server.mjs || [ "$restart" = 1 ]; then
  echo "▶ 更新服务端"
  rsync -az server/api-server.mjs "$TRIP_SSH:/opt/trip/api-server.mjs"
  ssh "$TRIP_SSH" "sudo -n systemctl restart trip-api"
fi
echo "✓ 已同步"
if [ -n "${TRIP_URL:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$TRIP_URL/")
  echo "▶ 远端 $TRIP_URL/ → HTTP $code"
fi
