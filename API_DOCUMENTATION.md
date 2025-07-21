# WoW API Proxy - API Documentation

## Overview

This API proxy abstracts the Blizzard OAuth flow and regional endpoint handling for World of Warcraft API calls. It forwards responses from the Blizzard API as-is to consumers.

## Base URL

```
http://localhost:3000
```

## Authentication

The proxy handles Blizzard OAuth automatically. No authentication is required from API consumers.

## Regional Support

All endpoints support regional routing via the `region` query parameter:

- `us` - Americas (default)
- `eu` - Europe
- `kr` - Korea
- `tw` - Taiwan
- `cn` - China

## Endpoints

### Health Check

#### GET /health
Returns the overall health status of the API proxy.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "WoW API Proxy"
}
```

### Battle.net OAuth

#### GET /battle-net/oauth/token?region=us
Get OAuth token for a specific region.

**Parameters:**
- `region` (optional): Region code (default: us)

**Response:**
```json
{
  "success": true,
  "region": "us",
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenInfo": {
    "hasToken": true,
    "expiresAt": 1704067200000,
    "isExpired": false,
    "timeUntilExpiry": 3600000
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /battle-net/regions
Get all supported regions.

**Response:**
```json
{
  "success": true,
  "regions": {
    "us": {
      "name": "Americas",
      "locale": "en_US",
      "oauthUrl": "https://us.battle.net/oauth/token",
      "apiUrl": "https://us.api.blizzard.com"
    },
    "eu": {
      "name": "Europe",
      "locale": "en_GB",
      "oauthUrl": "https://eu.battle.net/oauth/token",
      "apiUrl": "https://eu.api.blizzard.com"
    }
  },
  "count": 5,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### World of Warcraft Game Data

#### GET /wow/game-data/achievements?region=us
Get all achievements.

**Parameters:**
- `region` (optional): Region code (default: us)

**Response:** Raw Blizzard API response

#### GET /wow/game-data/achievements/:id?region=us
Get specific achievement by ID.

**Parameters:**
- `id`: Achievement ID
- `region` (optional): Region code (default: us)

#### GET /wow/game-data/classes?region=us
Get all playable classes.

#### GET /wow/game-data/classes/:id?region=us
Get specific class by ID.

#### GET /wow/game-data/races?region=us
Get all playable races.

#### GET /wow/game-data/races/:id?region=us
Get specific race by ID.

#### GET /wow/game-data/specializations?region=us
Get all specializations.

#### GET /wow/game-data/specializations/:id?region=us
Get specific specialization by ID.

#### GET /wow/game-data/items?region=us
Get all items.

#### GET /wow/game-data/items/:id?region=us
Get specific item by ID.

#### GET /wow/game-data/realms?region=us
Get all realms.

#### GET /wow/game-data/realms/:slug?region=us
Get specific realm by slug.

#### GET /wow/game-data/mounts?region=us
Get all mounts.

#### GET /wow/game-data/mounts/:id?region=us
Get specific mount by ID.

#### GET /wow/game-data/pets?region=us
Get all pets.

#### GET /wow/game-data/pets/:id?region=us
Get specific pet by ID.

### World of Warcraft Profile

#### GET /wow/profile/user?region=us
Get user profile (requires user token).

#### GET /wow/profile/character/:realmSlug/:characterName?region=us
Get character profile.

**Parameters:**
- `realmSlug`: Realm slug (e.g., "ragnaros")
- `characterName`: Character name (e.g., "charactername")
- `region` (optional): Region code (default: us)

#### GET /wow/profile/character/:realmSlug/:characterName/achievements?region=us
Get character achievements.

#### GET /wow/profile/character/:realmSlug/:characterName/equipment?region=us
Get character equipment.

#### GET /wow/profile/character/:realmSlug/:characterName/specializations?region=us
Get character specializations.

#### GET /wow/profile/character/:realmSlug/:characterName/talents?region=us
Get character talents.

## Usage Examples

### cURL Examples

```bash
# Get achievements for US region
curl "http://localhost:3000/wow/game-data/achievements?region=us"

# Get character profile for EU region
curl "http://localhost:3000/wow/profile/character/ragnaros/charactername?region=eu"

# Get item details for Korea region
curl "http://localhost:3000/wow/game-data/items/19019?region=kr"

# Get OAuth token for Taiwan region
curl "http://localhost:3000/battle-net/oauth/token?region=tw"
```

### JavaScript Examples

```javascript
// Using fetch
const response = await fetch('http://localhost:3000/wow/game-data/achievements?region=us');
const data = await response.json();

// Using axios
const axios = require('axios');
const response = await axios.get('http://localhost:3000/wow/game-data/classes?region=eu');
const data = response.data;
```

### Python Examples

```python
import requests

# Get achievements
response = requests.get('http://localhost:3000/wow/game-data/achievements?region=us')
data = response.json()

# Get character profile
response = requests.get('http://localhost:3000/wow/profile/character/ragnaros/charactername?region=eu')
data = response.json()
```

## Error Handling

The API returns standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (invalid region, missing parameters)
- `401` - Unauthorized (OAuth issues)
- `404` - Not Found (invalid endpoint)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `503` - Service Unavailable (Blizzard API issues)

### Error Response Format

```json
{
  "error": true,
  "message": "Error description",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/wow/game-data/achievements",
  "method": "GET"
}
```

## Rate Limiting

The API implements rate limiting to protect against abuse:

- **Window**: 15 minutes
- **Max Requests**: 100 requests per window
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Caching

- **OAuth Tokens**: Cached for 1 hour with automatic refresh
- **API Responses**: Forwarded as-is from Blizzard API

## Security

- **Helmet.js**: Security headers
- **CORS**: Cross-origin resource sharing enabled
- **Rate Limiting**: Protection against abuse
- **Input Validation**: Region and parameter validation

## Development

### Starting the Server

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

### Environment Variables

Create a `.env` file based on `env.example`:

```env
BLIZZARD_CLIENT_ID=your_client_id_here
BLIZZARD_CLIENT_SECRET=your_client_secret_here
PORT=3000
NODE_ENV=development
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Testing

```bash
# Run the test script
node test.js

# Test specific endpoints
curl "http://localhost:3000/health"
curl "http://localhost:3000/battle-net/regions"
```

## Support

For issues or questions, check the project README or create an issue in the repository. 