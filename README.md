# WoW API Proxy

A robust and secure proxy for the World of Warcraft Game Data API by Blizzard. Only public game data endpoints are supported (no /profile/), using OAuth Client Credentials authentication and multi-region support.

## Features

- **Game Data Only**: No /profile/ endpoints or user logic are exposed.
- **OAuth Client Credentials**: Automatic retrieval and caching of the token for public endpoints.
- **Multi-region support**: Change the region with the `?region=us|eu|kr|tw|cn` parameter.
- **Clean, RESTful routes**: All routes follow Blizzard's official structure.
- **Rate Limiting & Security**: Helmet.js and built-in rate limiting.
- **Easy to extend**: Add new endpoints easily by following the current pattern.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and configure your Blizzard credentials:
   ```bash
   cp env.example .env
   ```
4. Get your credentials from [Battle.net Developer Portal](https://develop.battle.net/)
5. Start the server:
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── index.js                 # Main entry point
├── config/
│   ├── regions.js           # Region configuration
│   └── constants.js         # Supported routes and endpoints
├── services/
│   ├── blizzard/
│   │   ├── auth.js          # OAuth client credentials
│   │   ├── client.js        # Blizzard API client
│   │   └── regions.js       # Region utilities
│   └── proxy.js             # Proxy and routing logic
├── routes/
│   ├── battle-net.js        # Battle.net routes
│   └── wow.js               # WoW Game Data routes
└── middleware/
    ├── rate-limit.js        # Rate limiting
    └── error-handler.js     # Error handling
```

## Supported Endpoints (Game Data)

All endpoints use the client credentials token and support the `region` parameter.

### Main Examples:

- **Achievements**: `/wow/game-data/achievements?region=us`
- **Classes**: `/wow/game-data/playable-classes?region=us`
- **Races**: `/wow/game-data/playable-races?region=us`
- **Specializations**: `/wow/game-data/playable-specializations?region=us`
- **Items**: `/wow/game-data/item-classes?region=us`
- **Realms**: `/wow/game-data/realms?region=us`
- **Mounts**: `/wow/game-data/mounts?region=us`
- **Pets**: `/wow/game-data/pets?region=us`
- **Professions**: `/wow/game-data/professions?region=us`
- **Talents**: `/wow/game-data/talents-index?region=us`
- **PvP Seasons**: `/wow/game-data/pvp-season/index?region=us`
- **PvP Season**: `/wow/game-data/pvp-season/{seasonId}?region=us`
- **PvP Leaderboards**: `/wow/game-data/pvp-season/{seasonId}/pvp-leaderboard/index?region=us`
- **PvP Leaderboard**: `/wow/game-data/pvp-season/{seasonId}/pvp-leaderboard/{bracket}?region=us`
- **PvP Rewards**: `/wow/game-data/pvp-season/{seasonId}/pvp-reward/index?region=us`
- **Reputation Factions**: `/wow/game-data/reputation-faction/index?region=us`
- **Reputation Faction**: `/wow/game-data/reputation-faction/{id}?region=us`
- **Reputation Tiers**: `/wow/game-data/reputation-tiers/index?region=us`
- **Reputation Tier**: `/wow/game-data/reputation-tiers/{id}?region=us`
- **Token**: `/wow/game-data/token/index?region=us`
- **Mythic Keystone Dungeons**: `/wow/game-data/mythic-keystone-dungeons?region=us`
- **Tech Talents**: `/wow/game-data/tech-talent-index?region=us`
- **Media Search**: `/wow/game-data/media-search?region=us&tags=item&_page=1`

_(See the routes file for the full list and parameters)_

## How to Add a New Endpoint

1. **Add the constant** in `src/config/constants.js` following the pattern:
   ```js
   NEW_ENDPOINT: '/data/wow/whatever/{param}'
   ```
2. **Add the case** in `src/services/proxy.js`:
   ```js
   case 'new-endpoint':
     return endpoints.NEW_ENDPOINT.replace('{param}', params.param);
   ```
3. **Add the route** in `src/routes/wow.js`:
   ```js
   router.get('/game-data/whatever/:param', async (req, res, next) => { ... });
   ```
4. **Add the test** in your test file.

## Important Notes

- **No /profile/ endpoints**: If you need user data, you must implement OAuth Authorization Code flow and additional logic.
- **All endpoints use the client credentials token**.
- **The proxy is safe to expose publicly for game data endpoints only.**

## Environment Variables

- `BLIZZARD_CLIENT_ID`: Your Blizzard client ID
- `BLIZZARD_CLIENT_SECRET`: Your Blizzard client secret
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: development/production
- `RATE_LIMIT_WINDOW_MS`: Rate limit window
- `RATE_LIMIT_MAX_REQUESTS`: Max requests per window

## License

MIT 