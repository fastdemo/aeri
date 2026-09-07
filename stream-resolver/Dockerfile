FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server.js ./
ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "server.js"]
