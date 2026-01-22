# Dockerfile
#
# Goal:
# - Extend the official n8n image with tools our init job needs:
#   - curl (health checks)
#   - postgresql-client (psql / pg_isready)
# - Bake in:
#   - init script(s)
#   - workflow JSON(s)
#
# IMPORTANT:
# - We keep final USER as "node" (recommended by n8n image).
# - We install packages as root, then drop back to node.

FROM n8nio/n8n:latest

USER root

# Install curl + Postgres client (works on both Alpine and Debian variants)
RUN (command -v apk >/dev/null 2>&1 && apk add --no-cache curl ca-certificates postgresql-client) || \
    (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y curl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*) || \
    (echo "No supported package manager found" && exit 1)

# Copy init scripts + workflows into a stable location inside the image
COPY scripts/ /data/scripts/
COPY workflows/ /data/workflows/

# Ensure scripts are executable
RUN chmod -R a+rx /data/scripts

USER node
