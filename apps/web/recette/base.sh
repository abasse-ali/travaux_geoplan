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
compte="${RECETTE_EMAIL:-geoffrey@recette.test}"

# La garde : Docker peut viser une autre machine (DOCKER_HOST, un
# contexte), et sur le VPS, ce même fichier de compose est la production.
# On ne touche qu'à une pile qui se sert en local (APP_ORIGIN de l'API),
# et dont le seul compte est celui de la recette.
origine=$($compose exec -T api printenv APP_ORIGIN 2>/dev/null || true)
case "$origine" in
  http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*) ;;
  *) echo "Refusé : l'API de cette pile sert « ${origine:-?} », pas une adresse locale. La recette ne touche qu'à une pile locale." >&2; exit 1 ;;
esac
comptes=$($compose exec -T mysql sh -c "$mysql_root -N -e 'SELECT COUNT(*), MIN(email) FROM users' 2>/dev/null" | tr '\t' ' ')
if [ "$comptes" != "1 $compte" ]; then
  echo "Refusé : la base n'a pas pour seul compte $compte (elle a : ${comptes:-?})." >&2
  exit 1
fi

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
