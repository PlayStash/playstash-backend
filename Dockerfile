# Keep compilers and package managers out of the published runtime image.
FROM node:lts-alpine AS base
ENV TZ="Etc/UTC" PUID=1000 PGID=1000 SERVER_PORT=8080 SERVER_HTTPS_PORT=8443
WORKDIR /app

FROM base AS archive-tool
ARG TARGETARCH
RUN apk add --no-cache tar xz \
    && case "$TARGETARCH" in \
       amd64) arch=x64; digest=fc0327ba27e89bd086cf426dff17d77de582953cdbbc10a6576540a06853ffcd ;; \
       arm64) arch=arm64; digest=5b0ac3aa91c1e3499f011d6af69d7f6b4de3ef2f011d9e2ff44c58ebd04aa388 ;; \
       *) echo "Unsupported 7-Zip architecture" >&2; exit 1 ;; esac \
    && wget -q "https://github.com/ip7z/7zip/releases/download/26.04/7z2604-linux-$arch.tar.xz" -O /tmp/7zip.tar.xz \
    && echo "$digest  /tmp/7zip.tar.xz" | sha256sum -c - \
    && mkdir /7zip && tar -xJf /tmp/7zip.tar.xz -C /7zip

FROM base AS runtime
ARG SECURITY_REFRESH=local
RUN test -n "$SECURITY_REFRESH" \
    && apk upgrade --no-cache && apk add --no-cache ca-certificates curl su-exec postgresql18-client postgresql16-client \
    && test -x /usr/libexec/postgresql16/pg_dump \
    && test -x /usr/libexec/postgresql16/pg_restore \
    && for tool in pg_dump pg_restore createdb dropdb psql pg_isready; do \
         test -x "/usr/libexec/postgresql18/$tool" \
           && ln -sf "/usr/libexec/postgresql18/$tool" "/usr/bin/$tool" || exit 1; \
       done \
    && mkdir -p /config /files /media /logs /db /plugins /savefiles \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=archive-tool /7zip/7zzs /usr/local/bin/7z
COPY --from=archive-tool /7zip/License.txt /usr/local/share/licenses/7zip/License.txt

FROM base AS builder-base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apk upgrade --no-cache && apk add --no-cache make g++ python3 \
    && npm install -g pnpm@11.7.0

FROM builder-base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build \
    && node --test scripts/init-postgres.test.mjs

FROM builder-base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM runtime AS release
ENV NODE_ENV=production \
    AUTH_SEED_PERSIST=true
COPY package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY scripts/init-postgres.mjs /opt/playstash/init-postgres.mjs
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chown -R node:node /app/dist /config /files /media /logs /db /plugins /savefiles \
    && mkdir -p /run/playstash-secrets \
    && chown node:node /run/playstash-secrets \
    && chmod 700 /run/playstash-secrets \
    && chmod -R u=rwX,go=rX /app/dist \
    && chmod 644 /opt/playstash/init-postgres.mjs \
    && chmod -R u=rwX,go= /config /files /media /logs /db /plugins /savefiles \
    && sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod 755 /usr/local/bin/entrypoint.sh \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
EXPOSE ${SERVER_PORT}/tcp ${SERVER_HTTPS_PORT}/tcp
HEALTHCHECK --start-period=300s CMD curl -fsS http://localhost:${SERVER_PORT}/api/status || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["dist/src/main.js"]
