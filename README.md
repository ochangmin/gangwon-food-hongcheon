# 강원 먹거리 이음 · 홍천 학교급식 스마트 배송

홍천 45개 학교 급식 식자재의 배송·온도·위치를 한 화면에서 관리하는 시연용 관제 웹앱입니다.

- `index.html` — 광역 대시보드, 학교급식 배송, GIS 배송 코스(30분 원칙), 냉장차 관제, 기사 앱(`#driver`)
- `img/` — Sentinel-2 cloudless 2024 위성 영상 (EOX IT Services GmbH, CC BY 4.0)
- `data/std-food.gz.b64.txt` — 홍천 표준식재료 목록

정적 사이트로, Vercel 등에 그대로 배포됩니다. 독립 웹사이트에서는 공유 DB 없이 시연 모드로 동작합니다.
