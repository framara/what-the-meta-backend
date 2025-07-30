# WoW Leaderboard Database Scripts

This directory contains SQL scripts for database maintenance and optimization of the WoW Leaderboard application.

## 📁 Script Files

### 🟢 **Essential Scripts**

#### `db_structure.sql`
- **Purpose**: Complete database schema with all optimizations
- **When to use**: Initial database setup or complete schema recreation
- **Contains**: Tables, materialized views, indexes, and foreign keys

#### `database_maintenance.sql`
- **Purpose**: Comprehensive maintenance operations
- **When to use**: Regular database maintenance and monitoring
- **Contains**: Monitoring queries, cleanup operations, optimization commands, refresh operations, and performance testing

#### `monitor_indexes.sql`
- **Purpose**: Monitor index usage and table sizes
- **When to use**: Regular monitoring and performance analysis
- **Features**: Index usage statistics and table bloat estimation

### 📊 **Documentation**

#### `wow-api.postman_collection.json`
- **Purpose**: API documentation and testing
- **Contains**: Complete API endpoint definitions for testing

## 🚀 **Quick Start Guide**

### For New Database Setup:
1. Run `db_structure.sql` to create the complete schema
2. Run the optimization sections in `database_maintenance.sql`

### For Regular Maintenance:
1. Use `database_maintenance.sql` for monitoring and refresh operations
2. Use `monitor_indexes.sql` for detailed performance analysis

### For Performance Optimization:
1. Use `cleanup_unused_indexes.sql` if space is needed
2. Use `final_refresh_test.sql` to measure refresh performance

## 📈 **Performance Improvements Achieved**

- **Materialized view refresh**: From 6 minutes to under 1 minute
- **Import performance**: Optimized batch processing with increased concurrency
- **Query performance**: Comprehensive indexing strategy
- **Space optimization**: Removed ~2.5GB of unused indexes

## 🔧 **Maintenance Schedule**

### Daily:
- Monitor index usage with `monitor_indexes.sql`

### Weekly:
- Refresh materialized views with CONCURRENTLY
- Run ANALYZE on tables

### Monthly:
- Run VACUUM on tables
- Check for unused indexes

## 📝 **Notes**

- All materialized views now support CONCURRENTLY refresh
- The `top_keys_per_group` view was optimized to use JOIN instead of subqueries
- Unique indexes ensure concurrent refresh operations work properly
- The database is ready for high-performance importing of 30k files with 500 runs each 