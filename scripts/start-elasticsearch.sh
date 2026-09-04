#!/usr/bin/env bash
set -euo pipefail

VERSION="8.17.1"
DIRECTORY=".data/elasticsearch-${VERSION}"
ARCHIVE_URL="https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-${VERSION}-linux-x86_64.tar.gz"

mkdir -p .data

if [ ! -x "${DIRECTORY}/bin/elasticsearch" ]; then
  curl --fail --silent --show-error --location "${ARCHIVE_URL}" | tar -xz -C .data
fi

exec "${DIRECTORY}/bin/elasticsearch" \
  -E discovery.type=single-node \
  -E xpack.security.enabled=false \
  -E http.port=9200 \
  -E network.host=127.0.0.1