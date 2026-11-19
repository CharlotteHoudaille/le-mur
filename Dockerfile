FROM node:22-alpine

WORKDIR /app

# Dépendances d'abord (mise en cache des couches Docker)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
USER node

# La clé API n'est PAS dans l'image : elle arrive au démarrage via .env
CMD ["node", "server/index.js"]
