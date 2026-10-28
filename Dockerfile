# Сайт приёма дат рождения — образ для любого хостинга
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# сюда можно смонтировать постоянный диск хостинга:
ENV DATA_DIR=/app/data

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY config.json ./

RUN mkdir -p /app/data/inbox

EXPOSE 3000
CMD ["node", "server.js"]
