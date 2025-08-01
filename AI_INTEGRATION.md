# AI Integration for Meta Predictions

This document describes the AI integration feature that uses OpenAI GPT-4 to provide real AI-powered meta predictions for World of Warcraft Mythic+ dungeons.

## Overview

The AI integration replaces the previous statistical analysis with real AI reasoning using OpenAI's GPT-4 model. The system analyzes comprehensive season data, spec evolution trends, and temporal patterns to provide intelligent predictions about which specializations are rising or declining in the meta.

## Features

### 🤖 Real AI Analysis
- Uses OpenAI GPT-4 for intelligent meta trend analysis
- Analyzes temporal data patterns across multiple periods
- Provides detailed reasoning for each prediction
- Cross-validates with official spec evolution data

### 📊 Comprehensive Data Processing
- Processes all dungeon runs for a season
- Analyzes spec appearances, success rates, and trends
- Considers keystone levels and performance metrics
- Validates data quality and consistency

### 💾 Intelligent Caching
- Caches AI analysis results to avoid repeated API calls
- 24-hour cache validity for cost optimization
- Automatic cache invalidation and refresh
- Fallback to statistical analysis if AI is unavailable

## API Endpoints

### POST /ai/predictions
Generates new AI analysis for a season.

**Request Body:**
```json
{
  "seasonData": {
    "season_id": 123,
    "total_periods": 8,
    "total_keys": 5000,
    "periods": [...]
  },
  "specEvolution": {
    "season_id": 123,
    "evolution": [...]
  },
  "dungeons": [...],
  "seasonId": 123
}
```

**Response:**
```json
{
  "predictions": [
    {
      "specId": 250,
      "specName": "Blood Death Knight",
      "className": "Death Knight",
      "classColor": "#C41F3B",
      "currentUsage": 15.2,
      "predictedChange": 8.5,
      "confidence": 85,
      "successRate": 72.3,
      "reasoning": "Detailed AI reasoning...",
      "temporalData": {...}
    }
  ],
  "analysis": {
    "metaTrends": ["Trend 1", "Trend 2"],
    "keyInsights": ["Insight 1", "Insight 2"],
    "confidence": 82,
    "dataQuality": "Excellent"
  }
}
```

### GET /ai/analysis/:season_id
Retrieves cached AI analysis for a season.

## Database Schema

### ai_analysis Table
```sql
CREATE TABLE ai_analysis (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    analysis_type VARCHAR(50) DEFAULT 'meta_predictions',
    confidence_score DECIMAL(5,2),
    data_quality VARCHAR(20) DEFAULT 'good'
);
```

## Environment Variables

Add the following to your `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

## Setup Instructions

1. **Install Dependencies:**
   ```bash
   npm install axios
   ```

2. **Set up Database:**
   ```bash
   psql -d your_database -f utils/ai_analysis_cache.sql
   ```

3. **Test Database Migration:**
   ```bash
   node scripts/test-db-migration.js
   ```

4. **Configure Environment:**
   - Add your OpenAI API key to `.env`
   - Ensure the API key has access to GPT-4

5. **Test the Integration:**
   ```bash
   node scripts/test-ai-integration.js
   ```

## AI Prompt Engineering

The system uses carefully crafted prompts to ensure consistent, high-quality analysis:

### System Prompt
- Defines the AI's role as a WoW Mythic+ meta analyst
- Sets clear analysis requirements and response format
- Emphasizes the importance of data-driven reasoning

### User Prompt
- Provides comprehensive season data
- Includes temporal analysis and cross-validation scores
- Requests specific JSON format for consistency

## Error Handling

- **AI Service Unavailable:** Falls back to statistical analysis
- **Invalid Response:** Retries with error logging
- **Cache Failures:** Continues without caching
- **Rate Limits:** Implements exponential backoff

## Cost Optimization

- **Caching:** 24-hour cache reduces API calls
- **Batch Processing:** Processes multiple seasons efficiently
- **Error Recovery:** Prevents unnecessary API calls on failures
- **Data Validation:** Ensures quality data before AI analysis

## Monitoring

The system includes comprehensive logging:
- API call success/failure rates
- Response time monitoring
- Cache hit/miss statistics
- Error tracking and alerting

## Future Enhancements

- **Multi-Model Support:** Integration with other AI providers
- **Real-time Updates:** WebSocket-based live analysis
- **Advanced Caching:** Redis-based distributed caching
- **Custom Models:** Fine-tuned models for WoW meta analysis

## Troubleshooting

### Common Issues

1. **OpenAI API Errors:**
   - Check API key validity
   - Verify account has GPT-4 access
   - Monitor rate limits

2. **Database Connection:**
   - Ensure PostgreSQL is running
   - Check connection string
   - Verify table exists

3. **Cache Issues:**
   - Check database permissions
   - Verify JSON serialization
   - Monitor disk space

### Debug Mode

Enable debug logging by setting:
```env
DEBUG=ai:*
```

This will provide detailed logs of AI requests, responses, and processing steps. 