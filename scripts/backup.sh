#!/bin/sh
# Backup diário do Postgres do JT Dashboard.
# Roda dentro do container `jt-backup` (postgres:16-alpine).
#
# Variáveis esperadas (vêm do docker-compose.prod.yml):
#   POSTGRES_PASSWORD
#   BACKUP_RETENTION_DAYS (default 14)

set -eu

DB_HOST="${DB_HOST:-postgres}"
DB_USER="${DB_USER:-jt}"
DB_NAME="${DB_NAME:-jt_dashboard}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/jt_dashboard_$TIMESTAMP.sql.gz"

echo "[$(date -u +%H:%M:%S)] Iniciando backup → $BACKUP_FILE"

# pg_dump → gzip → arquivo
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-acl \
  --format=plain \
  --verbose 2>/dev/null | gzip -9 > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date -u +%H:%M:%S)] Backup concluído: $SIZE"

# Limpa backups antigos
echo "[$(date -u +%H:%M:%S)] Removendo backups com mais de $RETENTION_DAYS dias"
find "$BACKUP_DIR" -name 'jt_dashboard_*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete -print || true

# Lista backups remanescentes
COUNT=$(find "$BACKUP_DIR" -name 'jt_dashboard_*.sql.gz' -type f | wc -l)
echo "[$(date -u +%H:%M:%S)] Total de backups retidos: $COUNT"
