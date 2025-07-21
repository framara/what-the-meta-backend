require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const REGION = 'us';

async function testAdvancedMythicLeaderboard() {
  console.log('🔍 Testing /wow/advanced/mythic-leaderboard/index ...');
  try {
    const res = await axios.get(`${BASE_URL}/wow/advanced/mythic-leaderboard/index?region=${REGION}`);
    console.log(`✅ /wow/advanced/mythic-leaderboard/index: SUCCESS (${res.status})`);
    if (res.data && Array.isArray(res.data.results)) {
      console.log(`   Aggregated results: ${res.data.results.length}`);
      if (res.data.results.length > 0) {
        console.log('   Sample keys:', Object.keys(res.data.results[0]));
      }
    }
  } catch (error) {
    const status = error.response?.status || 'NO RESPONSE';
    const detail = error.response?.data?.message || error.message;
    console.log(`❌ /wow/advanced/mythic-leaderboard/index: FAILED (${status}) - ${detail}`);
  }

  // For the second endpoint, we need a valid dungeonId and periodId
  // We'll try to get them from the first result if possible
  try {
    const indexRes = await axios.get(`${BASE_URL}/wow/advanced/mythic-leaderboard/index?region=${REGION}`);
    const allLeaderboards = indexRes.data.results || [];
    let dungeonId, periodId;
    for (const lb of allLeaderboards) {
      if (lb.current_leaderboards && lb.current_leaderboards.length > 0) {
        dungeonId = lb.current_leaderboards[0].map?.dungeon?.id || lb.current_leaderboards[0].dungeon?.id;
        periodId = lb.current_leaderboards[0].period?.id;
        if (dungeonId && periodId) break;
      }
    }
    if (!dungeonId || !periodId) {
      console.log('❌ Could not find valid dungeonId and periodId for leaderboard test.');
      return;
    }
    console.log(`🔍 Testing /wow/advanced/mythic-leaderboard/${dungeonId}/period/${periodId} ...`);
    const res = await axios.get(`${BASE_URL}/wow/advanced/mythic-leaderboard/${dungeonId}/period/${periodId}?region=${REGION}`);
    console.log(`✅ /wow/advanced/mythic-leaderboard/${dungeonId}/period/${periodId}: SUCCESS (${res.status})`);
    if (res.data && Array.isArray(res.data.results)) {
      console.log(`   Aggregated results: ${res.data.results.length}`);
      if (res.data.results.length > 0) {
        console.log('   Sample keys:', Object.keys(res.data.results[0]));
      }
    }
  } catch (error) {
    const status = error.response?.status || 'NO RESPONSE';
    const detail = error.response?.data?.message || error.message;
    console.log(`❌ /wow/advanced/mythic-leaderboard/:dungeonId/period/:period: FAILED (${status}) - ${detail}`);
  }
}

testAdvancedMythicLeaderboard().catch(console.error); 