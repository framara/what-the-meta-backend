// Script to fetch keystone upgrade timers for all dungeons and print a JSON array for WOW_DUNGEONS
// Usage: node scripts/fetch-dungeon-timers.js


const proxyService = require('../src/services/proxy');
const { WOW_DUNGEONS } = require('../src/config/constants');

async function fetchAllDungeonTimers(region = 'us') {
  const resp = await proxyService.getGameData('mythic-keystone-dungeons', region, {});
  const dungeons = resp.data.dungeons || [];
  const result = [];
  for (const d of dungeons) {
    let keystone_upgrades = [];
    try {
      const dungeonResp = await proxyService.getGameData('mythic-keystone-dungeon', region, { id: d.id });
      keystone_upgrades = (dungeonResp.data.keystone_upgrades || []).map(u => ({
        upgrade_level: u.upgrade_level,
        qualifying_duration: u.qualifying_duration
      }));
    } catch (e) {
      console.warn(`Failed to fetch upgrades for dungeon ${d.id} (${d.name}): ${e.message}`);
    }
    // Try to get shortname from existing WOW_DUNGEONS
    let shortname = d.short_name || d.name;
    const existing = WOW_DUNGEONS.find(wd => wd.id === d.id);
    if (existing && existing.shortname) {
      shortname = existing.shortname;
    }
    result.push({
      id: d.id,
      name: d.name,
      shortname,
      keystone_upgrades
    });
  }
  return result;
}

(async () => {
  try {
    const dungeons = await fetchAllDungeonTimers('us');
    console.log(JSON.stringify(dungeons, null, 2));
  } catch (e) {
    console.error('Error fetching dungeon timers:', e);
    process.exit(1);
  }
})();
