#!/bin/sh
# ============================================================
# Sauvegarde quotidienne de la base Geoplan
#
#   infra/deploy/sauvegarde.sh            (depuis la racine du dépôt)
#
# Un fichier compressé par jour, horodaté en UTC, gardé 14 jours. Le
# fichier n'apparaît sous son nom définitif qu'une fois complet : une
# sauvegarde interrompue ne peut pas passer pour bonne.
# Planifiée par cron sur le serveur (voir infra/deploy/README.md).
# ============================================================
set -eu

RACINE=$(cd "$(dirname "$0")/../.." && pwd)
DOSSIER=${DOSSIER:-$RACINE/sauvegardes}
GARDER_JOURS=${GARDER_JOURS:-14}
COMPOSE="docker compose -f $RACINE/infra/docker-compose.yml --env-file $RACINE/infra/.env"

mkdir -p "$DOSSIER"
FICHIER="$DOSSIER/geoplan-$(date -u +%Y-%m-%dT%H%M%SZ).sql.gz"

# --single-transaction : une photo cohérente sans bloquer l'application.
$COMPOSE exec -T mysql sh -c \
  'exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" geoplan' \
  | gzip -9 > "$FICHIER.partiel"

# Un vidage sans la dernière ligne de mysqldump est un vidage tronqué.
if ! gzip -dc "$FICHIER.partiel" | tail -n 1 | grep -q "Dump completed"; then
  echo "Sauvegarde incomplète : $FICHIER.partiel conservé pour examen" >&2
  exit 1
fi
mv "$FICHIER.partiel" "$FICHIER"
find "$DOSSIER" -name 'geoplan-*.sql.gz' -mtime +"$GARDER_JOURS" -delete
echo "$FICHIER"
