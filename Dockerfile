FROM heroiclabs/nakama:3.21.0

# Copy the compiled TypeScript runtime module
COPY build/index.js /nakama/data/modules/

# Copy both local and production configs
COPY config/local.yml /nakama/data/local.yml
COPY config/production.yml /nakama/data/production.yml

# Expose Nakama ports
# 7350 = HTTP API (main port for Render)
# 7349 = gRPC
# 7351 = Console
EXPOSE 7349 7350 7351

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:7350/healthcheck || exit 1

# Set entry point
ENTRYPOINT ["/nakama/nakama"]
CMD ["--config", "/nakama/data/production.yml"]
