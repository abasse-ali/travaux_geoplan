# ============================================================
# nginx de Geoplan : la configuration, et l'application qu'il sert.
#
# L'application est construite ici, pour l'API (VITE_GEOPLAN_SOURCE=api) :
# elle et l'API partagent ainsi une seule origine, ce qui garde le cookie
# de session « premier parti » sur l'iPhone (ADR-002). Jusqu'en W8, ce
# répertoire servait une page d'attente : W4 devait la remplacer, et
# l'application n'avait jamais été servie derrière ce nginx ni sous sa
# politique de sécurité (constat P6).
# Contexte de construction : la racine du dépôt.
# ============================================================

FROM node:24-alpine AS application
WORKDIR /app
# Les manifestes de tous les espaces de travail : npm en a besoin pour
# relire le verrou. L'outillage de la racine (TypeScript) sert au
# contrôle des types que fait la construction.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @geoplan/web --include-workspace-root --no-audit --no-fund
COPY packages/domain/src packages/domain/src
COPY apps/web apps/web
ENV VITE_GEOPLAN_SOURCE=api
RUN npm run build -w @geoplan/web

FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/securite.conf infra/nginx/emplacements.conf /etc/nginx/snippets/
COPY infra/nginx/journal.conf infra/nginx/adresse-client.conf infra/nginx/geoplan.conf /etc/nginx/conf.d/
COPY --from=application /app/apps/web/dist/ /usr/share/nginx/html/
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
