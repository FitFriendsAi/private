FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Copy source
COPY . .

# Build server only (mobile clients use the API; no Expo web build needed)
RUN npx esbuild server/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=dist/index.js \
  --external:pg-native \
  --external:dotenv \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

EXPOSE 5001

CMD ["node", "dist/index.js"]
