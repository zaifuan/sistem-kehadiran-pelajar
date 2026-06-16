# ── Sistem Pantau Kehadiran Pelajar — imej aplikasi Node ──
FROM node:22-alpine

WORKDIR /app

# Pasang dependencies dahulu (cache layer)
COPY package*.json ./
RUN npm install --omit=dev

# Salin kod
COPY . .

# Port aplikasi (boleh ditindih oleh APP_PORT)
EXPOSE 3000

CMD ["node", "src/index.js"]
