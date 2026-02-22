FROM node:20-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm build
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/index.js"]
