#!/usr/bin/env bash
# Create StreamZW buckets in the local S3-compatible store (RustFS / MinIO).
# Idempotent — safe to re-run.

set -euo pipefail

ENDPOINT="${S3_ENDPOINT_URL:-${MINIO_ENDPOINT:-http://localhost:9000}}"
ACCESS_KEY="${S3_ACCESS_KEY:-${MINIO_ACCESS_KEY:-admin}}"
SECRET_KEY="${S3_SECRET_KEY:-${MINIO_SECRET_KEY:-admin1234}}"
BUCKET_VIDEOS="${MINIO_BUCKET_VIDEOS:-streamzw-videos}"
BUCKET_THUMBS="${MINIO_BUCKET_THUMBS:-streamzw-thumbs}"

if [[ "${RUNNING_FROM_DOCKER:-false}" == "true" ]]; then
	# From Docker, localhost points to the current container, so use host.docker.internal.
	HOST_ENDPOINT="$(echo "$ENDPOINT" | sed 's|localhost|host.docker.internal|')"
else
	HOST_ENDPOINT="$ENDPOINT"
fi

echo "Creating buckets at $HOST_ENDPOINT ..."

docker run --rm --entrypoint /bin/sh minio/mc:latest -c "
mc alias set local '$HOST_ENDPOINT' '$ACCESS_KEY' '$SECRET_KEY' &&
mc mb --ignore-existing local/$BUCKET_VIDEOS &&
mc mb --ignore-existing local/$BUCKET_THUMBS &&
mc ls local
"
