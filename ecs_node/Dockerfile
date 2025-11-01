FROM node:18-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm i --only=production

COPY bot.js ./

CMD ["node", "bot.js"]


