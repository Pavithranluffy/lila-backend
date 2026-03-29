FROM heroiclabs/nakama:3.21.0

# Copy the compiled TypeScript runtime module
COPY build/index.js /nakama/data/modules/

# Copy both local and production configs
COPY config/local.yml /nakama/data/local.yml
COPY config/production.yml /nakama/data/production.yml

# Copy and make executable the entrypoint script
COPY docker-entrypoint.sh /nakama/docker-entrypoint.sh
RUN chmod +x /nakama/docker-entrypoint.sh

# Expose Nakama ports
# 7350 = HTTP API (main port for Render)
# 7349 = gRPC
# 7351 = Console
EXPOSE 7349 7350 7351

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:7350/healthcheck || exit 1

# Use entrypoint script to pass env vars as CLI flags to Nakama
ENTRYPOINT ["/nakama/docker-entrypoint.sh"]
