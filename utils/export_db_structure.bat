@echo off
set CONTAINER_NAME=wow-postgres
set OUTPUT_FILE=db_structure.sql

echo Exporting database structure from container %CONTAINER_NAME%...

docker exec -e PGPASSWORD=wowpassword %CONTAINER_NAME% pg_dump -U wowuser --schema-only -d wow_leaderboard > %OUTPUT_FILE%

echo Database structure exported to %OUTPUT_FILE%
pause
