# TODO: PostgreSQL Leaderboard Setup and Integration

## 1. PostgreSQL Docker Setup

- [ ] **Create a persistent data directory for PostgreSQL container**
  - Example: `mkdir -p ./pgdata`
- [ ] **Run the PostgreSQL Docker container**
  - Use the official image: `postgres:16`
  - Example command:
    ```sh
    docker run --name wow-postgres \
      -e POSTGRES_PASSWORD=wowpassword \
      -e POSTGRES_USER=wowuser \
      -e POSTGRES_DB=wow_leaderboard \
      -p 5432:5432 \
      -v $(pwd)/pgdata:/var/lib/postgresql/data \
      -d postgres:16
    ```
- [ ] **Connect to the running PostgreSQL instance to verify access**
  - Use `psql`, pgAdmin, DBeaver, or TablePlus
  - Connection details:
    - Host: `localhost`
    - Port: `5432`
    - User: `wowuser`
    - Password: `wowpassword`
    - Database: `wow_leaderboard`

## 2. Database/Tables Creation

- [ ] **Create the leaderboard schema**
  - Tables:
    - `season` (id, name, start_date, end_date)
    - `dungeon` (id, name)
    - `period` (id, season_id, start_date, end_date)
    - `realm` (id, name, region)
    - `leaderboard_group` (id, name, faction)
    - `group_member` (id, group_id, character_name, class_id, spec_id, role)
    - `leaderboard_run` (id, dungeon_id, period_id, realm_id, season_id, region, group_id, completed_at, duration_ms, keystone_level, score, rank, affixes, data)
  - Indexes:
    - By dungeon, period, realm, season, region for fast queries
  - Example: Save the schema as `init_leaderboard.sql` and run:
    ```sh
    psql -d wow_leaderboard -f init_leaderboard.sql
    ```

- [ ] **(Optional) Create a script or migration to populate static tables**
  - Populate `season`, `dungeon`, etc. from your constants in the codebase
  - Example: Use a Node.js script or SQL insert statements

## 3. Node.js Integration

- [ ] **Install a PostgreSQL client for Node.js**
  - Example: `npm install pg`
- [ ] **Configure database connection in your app**
  - Store credentials in environment variables or a config file
- [ ] **Implement data ingestion logic**
  - Insert leaderboard data into `leaderboard_run` and related tables
- [ ] **Implement query logic**
  - Query by dungeon_id, period_id, realm_id, season_id, and region

## 4. (Optional) Advanced

- [ ] **Set up a migration tool (e.g., Knex, Sequelize, Prisma) for schema management**
- [ ] **Automate backups of your PostgreSQL data directory**
- [ ] **Set up monitoring and performance tuning for large datasets** 