# BFrost — worker-first local AI operations platform.
#
# Build:  docker build -t bfrost .
# Run:    docker run -d --name bfrost -p 3030:3030 -v bfrost-data:/app/data bfrost
#
# The container binds the dashboard on 0.0.0.0:3030 *inside* the container;
# the -p mapping above publishes it on localhost only if you use
# `-p 127.0.0.1:3030:3030`. Set ADMIN_PASSWORD if you publish it any wider.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=3030
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY .env.example LICENSE ./
RUN mkdir -p /app/data /app/workers/local && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORT||3030)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
