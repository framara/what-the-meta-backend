# What the Meta? - WoW API Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Website](https://img.shields.io/badge/Website-whatthemeta.io-blue.svg)](https://whatthemeta.io)

A comprehensive World of Warcraft Mythic+ API backend that provides real-time data collection, processing, and analysis for the What the Meta? platform.

## 🌟 Features

- **Blizzard API Proxy**: Direct access to all WoW Game Data endpoints with automatic OAuth handling
- **Advanced Data Aggregation**: Multi-region leaderboard data collection and processing
- **PostgreSQL Database**: Optimized schema with materialized views for high-performance queries
- **Admin Tools**: Import, cleanup, and maintenance operations
- **Meta Analysis**: Specialized endpoints for AI/ML data consumption
- **Automation**: Scheduled data collection and processing workflows

## 🚀 Live Demo

Visit [whatthemeta.io](https://whatthemeta.io) to see the application in action.

## 🛠️ Tech Stack

- **Backend**: Node.js 18+, Express.js
- **Database**: PostgreSQL 15+ with optimized schema
- **API**: Blizzard Game Data API integration
- **Authentication**: OAuth 2.0 for Blizzard API
- **Deployment**: Docker, Docker Compose
- **Monitoring**: Health checks, performance metrics

## 📋 Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 15+ (or Docker)
- **Docker Desktop** (recommended for database)
  - 8GB RAM allocated
  - 4 CPU cores  
  - 50GB disk space

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd wow-api
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
```

Edit `.env` with your configuration:

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

# Server Configuration (Optional)
PORT=3000
NODE_ENV=development
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Start PostgreSQL

```bash
docker-compose up -d
```

### 4. Initialize Database

```bash
# Run the database structure script
psql -h localhost -U wowuser -d wow_leaderboard -f utils/db_structure.sql
```

### 5. Start the Server

```bash
npm start
```

The API will be available at `http://localhost:3000`

## 📁 Project Structure

```
wow-api/
├── src/
│   ├── routes/          # API endpoints
│   │   ├── admin.js     # Admin operations
│   │   ├── advanced.js  # Advanced aggregation
│   │   ├── auth.js      # Authentication
│   │   ├── battle-net.js # Blizzard API proxy
│   │   ├── meta.js      # Meta analysis
│   │   └── wow.js       # WoW game data
│   ├── middleware/      # Authentication, rate limiting
│   ├── config/          # Constants and configuration
│   └── services/        # Business logic
├── utils/               # Database scripts and documentation
├── output/              # Generated JSON files (gitignored)
└── scripts/             # Automation and maintenance scripts
```

## 🔧 Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run test` - Run test suite
- `npm run lint` - Run ESLint

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

## 🔄 Data Pipeline

### 1. Data Collection
```bash
# Collect all season data
GET /wow/advanced/mythic-leaderboard/14/

# Collect season data with period filtering
GET /wow/advanced/mythic-leaderboard/14/?fromPeriod=1018&toPeriod=1020

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

## 📊 Data Sources

All data is sourced from the official Blizzard World of Warcraft API. We do not claim ownership of game data and acknowledge that it belongs to Blizzard Entertainment.

## 🤝 Contributing

We welcome contributions! Please read our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Important Notice

- **Code Ownership**: All code in this repository is owned by What the Meta? and is protected by copyright law.
- **Game Data**: World of Warcraft data belongs to Blizzard Entertainment. We only display publicly available information.
- **Commercial Use**: This code is provided for educational and personal use. Commercial use requires explicit permission.
- **Attribution**: If you use this code, you must include proper attribution to What the Meta?.

## 🆘 Support

- **Website**: [whatthemeta.io](https://whatthemeta.io)
- **Email**: contact@whatthemeta.io
- **GitHub Issues**: [Report bugs or request features](https://github.com/framara/wow-api/issues)

## 📚 Documentation

- **[API Documentation](API_README.md)** - Complete API reference with all endpoints, parameters, and examples
- **[Database Documentation](DB_README.md)** - Detailed database schema, relationships, and optimization guide
- **[Security Documentation](SECURITY.md)** - Security policies and vulnerability reporting

## 🛠️ Development

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

## 🆘 Troubleshooting

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

## 📞 Getting Blizzard API Credentials

1. Go to [Blizzard Developer Portal](https://develop.battle.net/)
2. Create a new application
3. Note your Client ID and Client Secret
4. Add your redirect URI if needed

## 🎉 Acknowledgments

- Blizzard Entertainment for providing the WoW API
- The WoW Mythic+ community for inspiration and feedback
- Open source contributors who have helped improve this project

## 📈 Roadmap

- [ ] Enhanced caching strategies
- [ ] Real-time data streaming
- [ ] Advanced analytics endpoints
- [ ] GraphQL API support
- [ ] Microservices architecture

---

**Made with ❤️ for the WoW community**

*Not affiliated with Blizzard Entertainment* 