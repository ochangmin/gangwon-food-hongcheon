# 강원 먹거리 이음 — 자체 설치형 서버
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN rm -rf storage && mkdir -p /app/storage && chown -R node:node /app
USER node
ENV PORT=8080 STORAGE_DIR=/app/storage
EXPOSE 8080
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/robots.txt >/dev/null || exit 1
CMD ["node", "server/server.js"]
