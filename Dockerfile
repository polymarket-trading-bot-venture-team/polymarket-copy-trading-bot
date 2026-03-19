FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/run.js"]
