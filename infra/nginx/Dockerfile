# ============================================================
# nginx de Geoplan : la configuration, et les pages servies.
#
# En W3, l'application parle encore à Supabase : on ne la sert pas ici,
# sous peine qu'un essai local écrive dans la vraie base. Une page
# d'attente dit ce qui tourne. W4 remplacera ce répertoire par la
# construction de l'application branchée sur l'API.
# Contexte de construction : la racine du dépôt.
# ============================================================

FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/securite.conf infra/nginx/emplacements.conf /etc/nginx/snippets/
COPY infra/nginx/journal.conf infra/nginx/adresse-client.conf infra/nginx/geoplan.conf /etc/nginx/conf.d/
COPY infra/nginx/attente/ /usr/share/nginx/html/
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
