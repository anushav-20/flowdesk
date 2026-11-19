# FlowDesk API — production image (runs as the unprivileged "node" user)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
USER node
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/api/health >/dev/null || exit 1
CMD ["node", "server/src/index.js"]
