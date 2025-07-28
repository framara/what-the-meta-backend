# Render One-Off Jobs for WoW Leaderboard Automation

This guide explains how to use [Render's One-Off Jobs](https://render.com/docs/one-off-jobs) for daily automation, which is the **recommended approach** for Render.com deployments.

## Why One-Off Jobs Are Better

✅ **Native Render.com solution** - No external dependencies  
✅ **Uses your service's build** - Same environment as your API  
✅ **Access to environment variables** - All your secrets and config  
✅ **Proper logging** - Integrated with Render's logging system  
✅ **Cost-effective** - Only billed while running  
✅ **No timeout issues** - Can run for hours if needed  
✅ **Easy scheduling** - Can be triggered via Render API  

## Setup Instructions

### Step 1: Deploy Your API Service

1. **Deploy your API** to Render.com as a Web Service
2. **Configure environment variables:**
   ```bash
   DATABASE_URL=your_postgresql_connection_string
   BLIZZARD_CLIENT_ID=your_blizzard_client_id
   BLIZZARD_CLIENT_SECRET=your_blizzard_client_secret
   API_BASE_URL=https://your-app-name.onrender.com
   ```

### Step 2: Create One-Off Job via Render API

Use the Render API to create a one-off job that runs daily:

```bash
curl --request POST 'https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs' \
     --header 'Authorization: Bearer YOUR_API_KEY' \
     --header 'Content-Type: application/json' \
     --data-raw '{
        "startCommand": "npm run one-off"
     }'
```

**To find your Service ID:**
- Go to your service dashboard in Render
- Copy the ID from the URL (starts with `srv-`)

**To create an API Key:**
- Go to your Render account settings
- Navigate to API Keys section
- Create a new API key

### Step 3: Set Up Daily Scheduling

You can schedule the one-off job to run daily using a simple script or external service:

#### Option A: Using Render API with Cron (Recommended)

Create a simple script that triggers the one-off job:

```bash
#!/bin/bash
# daily-automation-trigger.sh

SERVICE_ID="srv-your-service-id"
API_KEY="your-render-api-key"

curl --request POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
     --header "Authorization: Bearer $API_KEY" \
     --header "Content-Type: application/json" \
     --data-raw '{
        "startCommand": "npm run one-off"
     }'
```

Then use cron-job.org or similar to run this script daily:

```bash
# Run daily at 2:00 AM
0 2 * * * /path/to/daily-automation-trigger.sh
```

#### Option B: Using Render's Built-in Cron Jobs

If you have a Render Pro plan, you can create a separate Cron Job service:

1. **Create a new Cron Job service** in Render
2. **Set the command:** `curl -X POST https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"startCommand": "npm run one-off"}'`
3. **Set the schedule:** `0 2 * * *` (daily at 2 AM)

## One-Off Job Configuration

### Command to Run

The one-off job runs this command:
```bash
npm run one-off
```

Which executes:
```bash
node scripts/job-daily-current-period.js
```

### Environment Variables

The one-off job automatically gets all environment variables from your base service:
- `DATABASE_URL`
- `BLIZZARD_CLIENT_ID`
- `BLIZZARD_CLIENT_SECRET`
- `API_BASE_URL`
- Any other environment variables you've configured

### Instance Type

By default, the one-off job uses the same instance type as your base service. You can specify a different instance type if needed:

```bash
curl --request POST 'https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs' \
     --header 'Authorization: Bearer YOUR_API_KEY' \
     --header 'Content-Type: application/json' \
     --data-raw '{
        "startCommand": "npm run one-off",
        "planId": "plan-srv-006"
     }'
```

**Available Instance Types:**
- `plan-srv-006` - Starter (512 MB RAM, 0.5 CPU)
- `plan-srv-008` - Standard (2 GB RAM, 1 CPU)
- `plan-srv-010` - Pro (4 GB RAM, 2 CPU)
- `plan-srv-011` - Pro Plus (8 GB RAM, 4 CPU)
- `plan-srv-013` - Pro Max (16 GB RAM, 4 CPU)
- `plan-srv-014` - Pro Ultra (32 GB RAM, 8 CPU)

## Monitoring and Logs

### View Job Logs

1. **In Render Dashboard:**
   - Go to your service
   - Click on "Jobs" tab
   - View logs for each job run

2. **Via Render API:**
   ```bash
   curl --request GET 'https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs/YOUR_JOB_ID' \
        --header 'Authorization: Bearer YOUR_API_KEY'
   ```

### Job Status Tracking

The API returns job status:
```json
{
  "id": "job-c3rfdgg6n88pa7t3a6ag",
  "serviceId": "srv-your-service-id",
  "startCommand": "npm run one-off",
  "status": "succeeded",
  "createdAt": "2025-03-20T07:20:05.777035-07:00",
  "startedAt": "2025-03-20T07:24:12.987032-07:00",
  "finishedAt": "2025-03-20T07:27:14.234587-07:00"
}
```

## Manual Execution

### Run One-Off Job Manually

```bash
# Via Render Dashboard
# 1. Go to your service
# 2. Click "Jobs" tab
# 3. Click "Create Job"
# 4. Enter: npm run one-off
# 5. Click "Create Job"

# Via Render API
curl --request POST 'https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs' \
     --header 'Authorization: Bearer YOUR_API_KEY' \
     --header 'Content-Type: application/json' \
     --data-raw '{
        "startCommand": "npm run one-off"
     }'
```

### Test Locally

```bash
# Test the one-off job script locally
cd wow-api
npm run one-off
```

## Error Handling

### Job Termination

- **Automatic termination:** Job exits when the script completes
- **Manual termination:** Cancel via Render Dashboard or API
- **Auto-cleanup:** Jobs are automatically terminated after 30 days
- **Service redeploy:** Doesn't affect running jobs

### Retry Logic

The one-off job includes comprehensive retry logic:
- **Exponential backoff** for failed requests
- **Graceful degradation** if some regions fail
- **Detailed logging** for troubleshooting
- **Proper exit codes** for monitoring

## Cost Optimization

### Instance Type Selection

Choose the appropriate instance type based on your needs:

- **Starter (plan-srv-006):** Good for basic automation
- **Standard (plan-srv-008):** Recommended for most use cases
- **Pro (plan-srv-010):** For heavy data processing
- **Pro Plus (plan-srv-011):** For very large datasets

### Billing

- **Per-second billing** while job is running
- **No charges** when job is not running
- **Same pricing** as your base service instance type

## Advanced Configuration

### Custom Scheduling

For more complex scheduling needs:

```bash
# Run every 6 hours
0 */6 * * * /path/to/daily-automation-trigger.sh

# Run on specific days
0 2 * * 1-5 /path/to/daily-automation-trigger.sh  # Weekdays only

# Run multiple times per day
0 2,14 * * * /path/to/daily-automation-trigger.sh  # 2 AM and 2 PM
```

### Conditional Execution

You can modify the one-off job script to check conditions:

```javascript
// Check if automation is needed
const lastRun = await checkLastRunTime();
if (shouldSkipRun(lastRun)) {
  console.log('[ONE-OFF] Skipping run - too soon since last execution');
  process.exit(0);
}
```

### Multiple Jobs

You can create different one-off jobs for different purposes:

```bash
# Full automation
npm run one-off

# Just data fetching
node scripts/job-daily-current-period.js --fetch-only

# Just cleanup
node scripts/job-daily-current-period.js --cleanup-only
```

## Automation Steps

The one-off job performs the following steps in order:

### Step 1: Fetch Leaderboard Data
- **Purpose:** Retrieves the latest mythic leaderboard data from Blizzard API
- **Action:** Calls `/wow/advanced/mythic-leaderboard/{seasonId}/{periodId}?region={region}` for all 4 regions (us, eu, kr, tw)
- **Output:** JSON files saved to `./output` directory
- **Duration:** 5-15 minutes depending on data size

### Step 2: Import Leaderboard Data
- **Purpose:** Imports all JSON files from `./output` into the PostgreSQL database
- **Action:** Calls `POST /admin/import-all-leaderboard-json`
- **Output:** Data stored in `leaderboard_run` and `group_member` tables
- **Duration:** 10-30 minutes depending on data volume

### Step 3: Clear Output Directory
- **Purpose:** Removes temporary JSON files to free up disk space
- **Action:** Calls `POST /admin/clear-output`
- **Output:** `./output` directory cleaned
- **Duration:** 1-2 minutes

### Step 4: Cleanup Leaderboard Data
- **Purpose:** Removes duplicate and old data, keeping only top 1000 runs per dungeon/period/season
- **Action:** Calls `POST /admin/cleanup-leaderboard` with season_id
- **Output:** Database optimized for performance
- **Duration:** 5-15 minutes

### Step 5: Perform VACUUM FULL
- **Purpose:** Reclaims storage space and defragments database tables
- **Action:** Calls `POST /admin/vacuum-full`
- **Output:** Database storage optimized
- **Duration:** 10-60 minutes (depends on database size)

### Step 6: Refresh Materialized Views
- **Purpose:** Updates all materialized views with latest data
- **Action:** Calls `POST /admin/refresh-views`
- **Output:** Meta endpoints updated with fresh data
- **Duration:** 5-15 minutes

### Total Duration
- **Typical:** 30-120 minutes
- **Peak times:** May take longer due to Blizzard API rate limits
- **Large datasets:** Can take 2-3 hours for very large imports

### Error Handling
- Each step includes retry logic with exponential backoff
- Failed steps are logged with detailed error information
- The job continues to the next step even if some regions fail
- Database operations are wrapped in transactions for data integrity

## Troubleshooting

### Common Issues

1. **Job fails to start**
   - Check your service ID and API key
   - Verify the `startCommand` is correct
   - Check environment variables

2. **Job times out**
   - One-off jobs can run for hours
   - Check if your script has infinite loops
   - Monitor memory usage

3. **Database connection issues**
   - Verify `DATABASE_URL` is correct
   - Check if database is accessible
   - Ensure connection pooling is configured

4. **API rate limits**
   - The script includes retry logic
   - Consider running during off-peak hours
   - Monitor Blizzard API usage

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
LOG_LEVEL=debug

# Or modify the script
console.log('[DEBUG]', 'Additional debug info');
```

## Migration from External Scheduling

If you're currently using external scheduling services:

1. **Replace external triggers** with Render API calls
2. **Update monitoring** to use Render's job logs
3. **Test the one-off job** manually first
4. **Set up proper scheduling** using the methods above
5. **Monitor costs** and adjust instance type if needed

## Security Considerations

1. **API Key Security**
   - Store API keys securely
   - Use environment variables
   - Rotate keys regularly

2. **Database Security**
   - Use connection pooling
   - Set appropriate permissions
   - Monitor database usage

3. **Job Access**
   - Limit who can create jobs
   - Monitor job execution
   - Set up alerts for failures

## Best Practices

1. **Test thoroughly** before setting up scheduling
2. **Monitor job logs** regularly
3. **Set up alerts** for job failures
4. **Use appropriate instance types** for your workload
5. **Keep job duration reasonable** (under 2 hours for daily jobs)
6. **Document your automation** process
7. **Have a backup plan** for critical automation

## Example Implementation

Here's a complete example of setting up daily automation:

```bash
# 1. Deploy your API to Render.com
# 2. Get your service ID and API key
# 3. Create a trigger script

#!/bin/bash
# trigger-daily-automation.sh

SERVICE_ID="srv-your-service-id"
API_KEY="your-render-api-key"

echo "Triggering daily automation at $(date)"

curl --request POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
     --header "Authorization: Bearer $API_KEY" \
     --header "Content-Type: application/json" \
     --data-raw '{
        "startCommand": "npm run one-off"
     }' \
     --silent \
     --show-error

if [ $? -eq 0 ]; then
    echo "Job triggered successfully"
else
    echo "Failed to trigger job"
    exit 1
fi
```

Then set up cron to run this script daily:

```bash
# Add to crontab (crontab -e)
0 2 * * * /path/to/trigger-daily-automation.sh >> /var/log/automation.log 2>&1
```

This approach gives you the best of both worlds: native Render.com integration with flexible scheduling options! 