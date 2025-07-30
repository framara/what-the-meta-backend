# WoW API Proxy & Leaderboard Importer

## 🎯 Overview

This project provides a comprehensive solution for World of Warcraft Mythic+ leaderboard data collection, processing, and analysis. It includes:

- **Blizzard API Proxy**: Direct access to all WoW Game Data endpoints with automatic OAuth handling
- **Advanced Data Aggregation**: Multi-region leaderboard data collection and processing
- **PostgreSQL Database**: Optimized schema with materialized views for high-performance queries
- **Admin Tools**: Import, cleanup, and maintenance operations
- **Meta Analysis**: Specialized endpoints for AI/ML data consumption
- **Automation**: Scheduled data collection and processing workflows

## 📚 Documentation

- **[API Documentation](API_README.md)** - Complete API reference with all endpoints, parameters, and examples
- **[Database Documentation](DB_README.md)** - Detailed database schema, relationships, and optimization guide
- **[Environment Configuration](#environment-configuration)** - Setup and configuration guide

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 15+ (or Docker)
- **Docker Desktop** (recommended for database)
  - 8GB RAM allocated
  - 4 CPU cores  
  - 50GB disk space

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd wow-api
npm install
```

2. **Configure environment:**
```bash
cp env.example .env
# Edit .env with your configuration (see Environment Configuration below)
```

3. **Start PostgreSQL (Docker recommended):**
```bash
docker-compose up -d
```

4. **Initialize database:**
```bash
# Run the database structure script
psql -h localhost -U wowuser -d wow_leaderboard -f utils/db_structure.sql
```

5. **Start the server:**
```bash
npm start
```

The API will be available at `http://localhost:3000`

## 🔧 Environment Configuration

Create a `.env` file in the project root with the following variables:

### Required Configuration

```env
# Blizzard API Credentials (Required)
BLIZZARD_CLIENT_ID=your_client_id_here
BLIZZARD_CLIENT_SECRET=your_client_secret_here

# Database Configuration (Required)
PGHOST=localhost
PGPORT=5432
PGUSER=wowuser
PGPASSWORD=your_secure_password
PGDATABASE=wow_leaderboard

# Admin Authentication (Required)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_admin_password
```

### Optional Configuration

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Database Pool Configuration
DB_POOL_MIN=2
DB_POOL_MAX=10

# Logging
LOG_LEVEL=info
```

### Getting Blizzard API Credentials

1. Go to [Blizzard Developer Portal](https://develop.battle.net/)
2. Create a new application
3. Note your Client ID and Client Secret
4. Add your redirect URI if needed

## 📊 API Endpoints Overview

### Public Endpoints
- **Game Data**: `GET /wow/game-data/*` - Proxies all Blizzard WoW Game Data endpoints
- **Health**: `GET /health` - Service health status
- **Meta Analysis**: `GET /meta/*` - Specialized endpoints for data analysis

### Advanced Aggregation
- **Season Data**: `GET /wow/advanced/mythic-leaderboard/:seasonId/` - Collects all season data
- **Period Data**: `GET /wow/advanced/mythic-leaderboard/:seasonId/:periodId` - Collects specific period data

### Admin Endpoints (Authentication Required)
- **Import**: `POST /admin/import-*` - Data import operations
- **Cleanup**: `POST /admin/cleanup-*` - Database maintenance
- **Automation**: `POST /admin/automation/*` - Automated workflows
- **Database**: `GET /admin/db/*` - Database statistics and management

## 🗄️ Database Schema

The system uses PostgreSQL with the following core tables:

- **`leaderboard_run`** - Main run data with scores and timing
- **`run_group_member`** - Group composition per run
- **`dungeon`** - Dungeon metadata
- **`period`** - Time period definitions
- **`realm`** - Realm information
- **`season`** - Season metadata

**Materialized Views** provide optimized queries for:
- Top keys per group/period/dungeon
- Global rankings
- Specialization evolution data

See [Database Documentation](DB_README.md) for complete schema details.

## 🔄 Data Pipeline

### 1. Data Collection
```bash
# Collect all season data
GET /wow/advanced/mythic-leaderboard/14/

# Collect specific period data  
GET /wow/advanced/mythic-leaderboard/14/1018
```

### 2. Data Import
```bash
# Import all collected files
POST /admin/import-all-leaderboard-json
```

### 3. Data Analysis
```bash
# Get top keys for analysis
GET /meta/top-keys?season_id=14

# Get specialization evolution
GET /meta/spec-evolution/14
```

## 🤖 Automation

The system includes automated workflows for daily data collection:

```bash
# Trigger full automation
POST /admin/automation/trigger

# Check automation status
GET /admin/automation/status
```

## 🛠️ Development

### Project Structure
```
wow-api/
├── src/
│   ├── routes/          # API endpoints
│   ├── middleware/      # Authentication, rate limiting
│   ├── config/          # Constants and configuration
│   └── utils/           # Helper functions
├── utils/               # Database scripts and documentation
├── output/              # Generated JSON files
└── docs/                # Additional documentation
```

### Key Features
- **Multi-region support** (US, EU, KR, TW)
- **Automatic OAuth handling** for Blizzard API
- **Optimized PostgreSQL queries** with materialized views
- **Comprehensive error handling** and logging
- **Rate limiting** and security headers
- **Admin authentication** for protected endpoints

## 📈 Performance

### Database Optimization
- **Strategic indexing** for fast leaderboard queries
- **Materialized views** for complex aggregations
- **Connection pooling** for efficient resource usage
- **Batch processing** for large data imports

### API Performance
- **Caching** for frequently accessed data
- **Parallel processing** for multi-region operations
- **Progress tracking** for long-running operations
- **Detailed error reporting** for troubleshooting

## 🔒 Security

- **Helmet.js** security headers
- **CORS** configuration for cross-origin requests
- **Input validation** on all endpoints
- **Rate limiting** to prevent abuse
- **Admin authentication** for sensitive operations

## 🆘 Support & Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Verify PostgreSQL is running
   - Check `.env` database configuration
   - Ensure database exists: `createdb wow_leaderboard`

2. **Blizzard API Errors**
   - Verify API credentials in `.env`
   - Check rate limits and quotas
   - Ensure proper OAuth setup

3. **Import Failures**
   - Check file permissions in `./output`
   - Verify database schema is up to date
   - Review server logs for detailed errors

### Monitoring

```bash
# Check database performance
GET /admin/db/stats

# Monitor automation status
GET /admin/automation/status

# View server health
GET /health
```

### Logs
- Application logs: Check console output
- Database logs: `docker logs wow-postgres`
- Error tracking: Check response `failedReasons` arrays

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues or questions:
1. Check the [API Documentation](API_README.md)
2. Review [Database Documentation](DB_README.md)
3. Check server logs for detailed error information
4. Create an issue in the repository

---

**Note**: This system is designed for educational and research purposes. Please respect Blizzard's API terms of service and rate limits. 