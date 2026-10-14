# استوديو تصاميم بوابة المستثمر — Node + Chromium (+ بايثون rembg اختياري لقص الخلفية)
FROM node:22-bookworm-slim

ARG WITH_CUTOUT=0
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-color-emoji \
 && if [ "$WITH_CUTOUT" = "1" ]; then \
      apt-get install -y --no-install-recommends python3 python3-venv && python3 -m venv /opt/py && \
      /opt/py/bin/pip install --no-cache-dir "rembg[cpu]" pillow numpy opencv-python-headless ; \
    fi \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data CHROME_PATH=/usr/bin/chromium \
    PYTHON_BIN=/opt/py/bin/python U2NET_HOME=/app/data/.models FONTS_DIR=/app/fonts-private

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p /app/data /app/fonts-private

VOLUME ["/app/data"]
EXPOSE 8787
CMD ["npm", "start"]
