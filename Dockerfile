FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Only public configuration is baked into the browser bundle. Server keys are runtime-only.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV BACKEND_PROVIDER=supabase NEXT_PUBLIC_BACKEND_PROVIDER=supabase
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Next bundles this SDK into route chunks. The standalone operator scripts need
# its real packages too; copy only the existing locked SDK dependency closure.
COPY --from=build --chown=node:node /app/node_modules/@supabase ./node_modules/@supabase
COPY --from=build --chown=node:node /app/node_modules/iceberg-js ./node_modules/iceberg-js
COPY --from=build --chown=node:node /app/node_modules/tslib ./node_modules/tslib
COPY --chown=node:node scripts/prune-supabase.mjs scripts/cleanup-loop.mjs ./scripts/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
