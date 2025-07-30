#!/bin/bash

# Wait for PostgreSQL to be ready
until pg_isready -h localhost -U wowuser -d wow_leaderboard; do
  echo "Waiting for PostgreSQL to be ready..."
  sleep 2
done

echo "Applying PostgreSQL settings..."

# Apply settings
psql -h localhost -U wowuser -d wow_leaderboard << EOF
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET work_mem = '128MB';
ALTER SYSTEM SET maintenance_work_mem = '768MB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET max_parallel_workers = 4;
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET max_worker_processes = 4;
SELECT pg_reload_conf();
EOF

echo "Settings applied successfully!"