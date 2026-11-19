# ---- Stage 1: build the static site ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional: point the /app workspace at the API (empty = in-browser demo mode)
ARG VITE_WORKSPACE_API_URL=""
ENV VITE_WORKSPACE_API_URL=$VITE_WORKSPACE_API_URL
RUN npm test && npm run build

# ---- Stage 2: serve it with a small, non-root nginx image ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/ >/dev/null || exit 1
