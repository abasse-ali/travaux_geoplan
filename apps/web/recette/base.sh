#!/bin/sh
# ============================================================
# La base de la recette, sur la pile Docker LOCALE.
#
#   recette/base.sh garder     après la préparation (RECETTE.md) : garde
#                              la base telle quelle, point de départ
#                              de chaque passage
#   recette/base.sh remettre   avant chaque passage : la remet dans cet
#                              état, et remet à zéro les compteurs du
#                              limiteur de connexion (la recette se
#                              connecte huit fois par passage, la limite
#                              est de dix par quart d'heure)
#
# Le vidage reste dans recette/.resultats/, jamais versionné.
# ============================================================
set -eu
ici=$(cd "$(dirname "$0")" && pwd)
racine=$(cd "$ici/../../.." && pwd)
compose="docker compose -f $racine/infra/docker-compose.yml"
vidage="$ici/.resultats/base-depart.sql"
mysql_root='mysql -u root -p"$MYSQL_ROOT_PASSWORD" geoplan'

case "${1:-}" in
  garder)
    mkdir -p "$ici/.resultats"
    $compose exec -T mysql sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --no-tablespaces geoplan 2>/dev/null' > "$vidage"
    echo "Base gardée : $vidage"
    ;;
  remettre)
    [ -s "$vidage" ] || { echo "Rien à remettre : lance d'abord « recette/base.sh garder »." >&2; exit 1; }
    $compose exec -T mysql sh -c "$mysql_root 2>/dev/null" < "$vidage"
    $compose exec -T redis sh -c 'redis-cli --scan --pattern "limite:*" | xargs -r redis-cli del' > /dev/null
    echo "Base remise dans son état de départ."
    ;;
  *)
    echo "Usage : recette/base.sh garder|remettre" >&2
    exit 1
    ;;
esac
