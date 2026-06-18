# ── Sistem Pantau Kehadiran Pelajar — imej aplikasi Node ──
FROM node:22-alpine

WORKDIR /app

# Pasang dependencies dahulu (cache layer).
# argon2 (Fasa 8) ialah modul native — sediakan toolchain build sebagai
# fallback jika binari prebuilt musl tiada, kemudian buang supaya imej kekal kecil.
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev \
 && apk del .build-deps

# Salin kod
COPY . .

# Port aplikasi (boleh ditindih oleh APP_PORT)
EXPOSE 3000

CMD ["node", "src/index.js"]
