FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE ${PORT:-2567}

CMD ["npx", "tsx", "src/index.ts"]
