# ============================================================
# Image de l'API Geoplan
#
# Pas d'étape de compilation : Node 24 exécute le TypeScript de
# src/ en retirant les types. L'image ne contient que les
# dépendances de production de l'API et le paquet du domaine.
# Contexte de construction : la racine du dépôt.
# ============================================================

FROM node:24-alpine AS dependances
WORKDIR /app
# Les manifestes de tous les espaces de travail : npm en a besoin pour
# relire le verrou, même s'il n'installe que ceux de l'API.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @geoplan/api --include-workspace-root=false --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=3000
WORKDIR /app
COPY --from=dependances /app/node_modules ./node_modules
COPY package.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY apps/api/package.json apps/api/
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/src apps/api/src
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/api/src/server.ts"]
