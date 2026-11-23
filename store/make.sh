#!/bin/sh
# 生成商店截图和宣传图（虚构数据）。需要：本地 test/shim.js、Google Chrome、
# 在仓库根目录起一个静态服务器：python3 -m http.server 8766
set -e
cd "$(dirname "$0")/.."
python3 store/preview.py
python3 jobs/build.py >/dev/null 2>&1 || true
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE=$(mktemp -d)
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" --force-device-scale-factor=1 --blink-settings=preferredColorScheme=1 \
  --window-size="$3" --virtual-time-budget=25000 --run-all-compositor-stages-before-draw --screenshot="store/$2" "http://127.0.0.1:8766/store/shots/$1" 2>/dev/null; echo "store/$2"; }
for p in 1-fill 2-jobs 3-tracker 4-documents 5-profile; do
  [ -f "store/shots/$p.html" ] && shot "$p.html" "screenshot-$p.png" 1280,800
done
shot promo.html promo-440x280.png 440,280
rm -rf "$PROFILE"
