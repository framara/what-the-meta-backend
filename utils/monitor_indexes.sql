-- Index usage statistics
SELECT 
    schemaname,
    relname as tablename,
    indexrelname as indexname,
    idx_scan as number_of_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(schemaname || '.' || indexrelname::text)) as index_size,
    CASE WHEN idx_scan > 0 
         THEN pg_size_pretty((pg_relation_size(schemaname || '.' || indexrelname::text) / idx_scan)::bigint)
         ELSE 'Infinity'
    END as size_per_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Table bloat estimation
SELECT
    schemaname,
    relname as tablename,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as total_size,
    pg_size_pretty(pg_table_size(schemaname || '.' || relname)) as table_size,
    pg_size_pretty(pg_indexes_size(schemaname || '.' || relname)) as index_size,
    CASE 
        WHEN pg_total_relation_size(schemaname || '.' || relname) > 0 
        THEN round(100 * pg_table_size(schemaname || '.' || relname)::numeric / pg_total_relation_size(schemaname || '.' || relname), 2)
        ELSE 0
    END as table_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC;