require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const REGION = 'us';

const PVP_SEASON_ID = 34; // Usa un seasonId válido de tu API
const PVP_BRACKET = '3v3'; // Usa un bracket válido de tu API

const endpoints = [
  { name: 'WoW Achievements', url: `/wow/game-data/achievements?region=${REGION}` },
  { name: 'WoW Classes', url: `/wow/game-data/playable-classes?region=${REGION}` },
  { name: 'WoW Races', url: `/wow/game-data/playable-races?region=${REGION}` },
  { name: 'WoW Specializations', url: `/wow/game-data/playable-specializations?region=${REGION}` },
  { name: 'WoW Items', url: `/wow/game-data/item-classes?region=${REGION}` },
  { name: 'WoW Realms', url: `/wow/game-data/realms?region=${REGION}` },
  { name: 'WoW Mounts', url: `/wow/game-data/mounts?region=${REGION}` },
  { name: 'WoW Pets', url: `/wow/game-data/pets?region=${REGION}` },
  { name: 'WoW Professions', url: `/wow/game-data/professions?region=${REGION}` },
  { name: 'WoW Talents', url: `/wow/game-data/talents-index?region=${REGION}` },
  { name: 'WoW PvP Season', url: `/wow/game-data/pvp-season/${PVP_SEASON_ID}?region=${REGION}` },
  { name: 'WoW PvP Leaderboards Index', url: `/wow/game-data/pvp-season/${PVP_SEASON_ID}/pvp-leaderboard/index?region=${REGION}` },
  { name: 'WoW PvP Leaderboard', url: `/wow/game-data/pvp-season/${PVP_SEASON_ID}/pvp-leaderboard/${PVP_BRACKET}?region=${REGION}` },
  { name: 'WoW PvP Rewards Index', url: `/wow/game-data/pvp-season/${PVP_SEASON_ID}/pvp-reward/index?region=${REGION}` },
  { name: 'WoW Reputations', url: `/wow/game-data/reputation-faction/index?region=${REGION}` },
  { name: 'WoW Reputation Faction', url: `/wow/game-data/reputation-faction/21?region=${REGION}` },
  { name: 'WoW Reputation Tiers Index', url: `/wow/game-data/reputation-tiers/index?region=${REGION}` },
  { name: 'WoW Reputation Tiers', url: `/wow/game-data/reputation-tiers/1?region=${REGION}` },
  { name: 'WoW Achievement Categories', url: `/wow/game-data/achievement-categories?region=${REGION}` },
  { name: 'WoW Talent Trees', url: `/wow/game-data/talent-tree-index?region=${REGION}` },
  { name: 'WoW Token', url: `/wow/game-data/token/index?region=${REGION}` },
  { name: 'WoW Mythic Keystone Dungeons', url: `/wow/game-data/mythic-keystone-dungeons?region=${REGION}` },
  { name: 'WoW Mythic Keystone Affixes', url: `/wow/game-data/keystone-affixes?region=${REGION}` },
  { name: 'WoW Mythic Keystone Periods', url: `/wow/game-data/mythic-keystone-periods?region=${REGION}` },
  { name: 'WoW Mythic Keystone Seasons', url: `/wow/game-data/mythic-keystone-seasons?region=${REGION}` },
  { name: 'WoW Connected Realms', url: `/wow/game-data/connected-realms-index?region=${REGION}` },
  { name: 'WoW Regions', url: `/wow/game-data/regions?region=${REGION}` },
  { name: 'WoW Spells', url: `/wow/game-data/spell/196607?region=${REGION}` },
  { name: 'WoW Tech Talent Trees', url: `/wow/game-data/tech-talent-tree-index?region=${REGION}` },
  { name: 'WoW Tech Talents', url: `/wow/game-data/tech-talent-index?region=${REGION}` },
  { name: 'WoW Talents Index', url: `/wow/game-data/talents-index?region=${REGION}` },
  { name: 'WoW PvP Talents Index', url: `/wow/game-data/pvp-talents-index?region=${REGION}` },
  { name: 'WoW Media Search', url: `/wow/game-data/media-search?region=${REGION}&tags=item&_page=1` },
];

async function testEndpoints() {
  console.log('🔍 Testing main WoW Game Data endpoints...\n');
  let success = 0;
  let fail = 0;
  for (const ep of endpoints) {
    try {
      const res = await axios.get(BASE_URL + ep.url);
      console.log(`✅ ${ep.name}: SUCCESS (${res.status})`);
      if (res.data && typeof res.data === 'object') {
        const keys = Object.keys(res.data);
        console.log(`   Data keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
      }
      success++;
    } catch (error) {
      const status = error.response?.status || 'NO RESPONSE';
      const detail = error.response?.data?.message || error.message;
      console.log(`❌ ${ep.name}: FAILED (${status}) - ${detail}`);
      fail++;
    }
    console.log('---');
  }
  console.log(`\n📈 Results: ${success} successful, ${fail} failed, total: ${endpoints.length}`);
}

testEndpoints().catch(console.error); 