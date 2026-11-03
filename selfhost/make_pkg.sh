#!/bin/sh
# 자체 설치형 패키지 만들기: 최신 화면 빌드 → /home/claude/pkg/gwfood/public, API 복사
set -e
G=/home/claude/gw; R=/home/claude/gangwon-food-hongcheon; P=/home/claude/pkg/gwfood
rm -rf "$P/public" "$P/api"; mkdir -p "$P/public/data" "$P/public/vendor/leaflet" "$P/public/downloads"
cp -r "$R/api" "$P/api"
cp "$R/login.html" "$R/robots.txt" "$P/public/"
cp -r "$R/img" "$P/public/img"
cp "$R/data/orders-demo.json" "$R/data/org.json" "$R/data/std-food.gz.b64.txt" "$P/public/data/"
cp "$R/downloads/"* "$P/public/downloads/" 2>/dev/null || true
cp "$G/package/dist/leaflet.js" "$P/public/vendor/leaflet/"; cp -r "$G/package/dist/images" "$P/public/vendor/leaflet/" 2>/dev/null || true
python3 - "$G/site/index.html" "$P/public/index.html" <<'PY'
import sys,re
s=open(sys.argv[1],encoding='utf-8').read()
s=s.replace('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js','/vendor/leaflet/leaflet.js')
s=re.sub(r'window\.VWORLD_KEY="[^"]*"','window.VWORLD_KEY="__VWORLD_KEY__"',s,count=1)
s=re.sub(r'\s(integrity|crossorigin)="[^"]*"(?=[^<]*vendor/leaflet)','',s)
open(sys.argv[2],'w',encoding='utf-8').write(s)
print('index', len(s), 'leaflet local', '/vendor/leaflet/leaflet.js' in s, 'key placeholder', '__VWORLD_KEY__' in s)
PY
echo "패키지 갱신: $P"
