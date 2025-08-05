# PostgreSQL Docker Performance Optimization Guide

## Quick Diagnostic Steps

### 1. Check Current Performance
```bash
# Run the monitoring script
node scripts/monitor-postgres.js

# Or monitor for 5 minutes
node scripts/monitor-postgres.js --monitor --duration=300
```

### 2. Check API Database Stats
```bash
curl http://localhost:3000/admin/db/stats
curl http://localhost:3000/admin/db/performance-test
```

## Key Bottleneck Indicators

### 🚨 High CPU Usage (>80%)
- **Cause**: PostgreSQL is CPU-bound
- **Solution**: Increase CPU cores or optimize queries

### 🚨 High Memory Usage (>90%)
- **Cause**: Insufficient RAM for PostgreSQL buffers
- **Solution**: Increase container memory limit

### 🚨 High I/O Wait
- **Cause**: Disk I/O bottleneck
- **Solution**: Use SSD storage or optimize disk access

### 🚨 Connection Pool Exhaustion
- **Cause**: Too many concurrent connections
- **Solution**: Increase max_connections or optimize connection usage

## Docker Resource Optimization

### 1. Memory Allocation
```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: wow_leaderboard
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: your_password
    deploy:
      resources:
        limits:
          memory: 4G  # Increase from default
        reservations:
          memory: 2G
    command: >
      postgres
      -c shared_buffers=1GB
      -c effective_cache_size=3GB
      -c work_mem=16MB
      -c maintenance_work_mem=256MB
      -c max_connections=200
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
```

### 2. CPU Allocation
```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2.0'  # 2 CPU cores
        reservations:
          cpus: '1.0'  # 1 CPU core reserved
```

### 3. Storage Optimization
```yaml
services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # Use named volume for better performance
    tmpfs:
      - /var/lib/postgresql/data/pg_wal  # WAL files in RAM
```

## PostgreSQL Configuration Tuning

### For Large Datasets (30k files × 500 runs = 15M records)

```sql
-- Run these in PostgreSQL to optimize for bulk operations
ALTER SYSTEM SET shared_buffers = '1GB';
ALTER SYSTEM SET effective_cache_size = '3GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET max_worker_processes = 8;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;
ALTER SYSTEM SET parallel_tuple_cost = 0.1;
ALTER SYSTEM SET parallel_setup_cost = 1000.0;

-- Reload configuration
SELECT pg_reload_conf();
```

## Performance Monitoring Commands

### Docker Commands
```bash
# Real-time container stats
docker stats postgres

# Container resource usage
docker exec postgres free -h
docker exec postgres df -h

# PostgreSQL processes
docker exec postgres ps aux | grep postgres

# Container logs
docker logs postgres --tail 100
```

### PostgreSQL Commands
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Check slow queries
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

## Recommended Resource Allocation

### For 15M+ Records:
- **Memory**: 4-8GB RAM
- **CPU**: 2-4 cores
- **Storage**: SSD with at least 50GB free space
- **Connections**: 200-500 max_connections

### For Development:
- **Memory**: 2-4GB RAM
- **CPU**: 1-2 cores
- **Storage**: Any with 20GB free space
- **Connections**: 100 max_connections

## Troubleshooting Common Issues

### 1. Out of Memory Errors
```bash
# Check if container is hitting memory limits
docker stats postgres

# Solution: Increase memory limit in docker-compose.yml
```

### 2. Slow Query Performance
```sql
-- Enable query logging
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();

-- Then check logs
docker logs postgres | grep "duration:"
```

### 3. Connection Timeouts
```sql
-- Check connection limits
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity;

-- Increase if needed
ALTER SYSTEM SET max_connections = 300;
SELECT pg_reload_conf();
```

### 4. Disk Space Issues
```bash
# Check disk usage
docker exec postgres df -h

# Clean up old WAL files
docker exec postgres pg_archivecleanup /var/lib/postgresql/data/pg_wal/ 000000010000000000000001
```

## Performance Testing

### Run Import Test
```bash
# Test the fast import endpoint
curl -X POST http://localhost:3000/admin/import-all-leaderboard-json-fast

# Monitor during import
node scripts/monitor-postgres.js --monitor --duration=600
```

### Check Database Performance
```bash
# Run performance tests
curl http://localhost:3000/admin/db/performance-test

# Check stats during heavy operations
curl http://localhost:3000/admin/db/stats
```

## Emergency Optimizations

### If Import is Too Slow:
1. **Increase batch size** in the fast import endpoint
2. **Reduce concurrent tasks** if memory is exhausted
3. **Use temporary tables** for intermediate results
4. **Disable indexes** during bulk import, rebuild after

### If Database is Unresponsive:
1. **Restart container** with more resources
2. **Check for long-running transactions**
3. **Kill idle connections**
4. **Increase work_mem** for complex queries

## Monitoring Dashboard

Create a simple monitoring script:
```bash
#!/bin/bash
while true; do
  echo "=== $(date) ==="
  docker stats postgres --no-stream
  echo "--- Database Stats ---"
  curl -s http://localhost:3000/admin/db/stats | jq '.connections, .pool'
  sleep 30
done
``` 