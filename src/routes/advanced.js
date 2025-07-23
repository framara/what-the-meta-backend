const express = require('express');
const proxyService = require('../services/proxy');
const validateRegion = require('../middleware/region');
const { SEASON_DUNGEONS, SEASON_NAMES, WOW_DUNGEONS } = require('../config/constants');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Apply region validation to all advanced routes
router.use(validateRegion);

// --- Helper functions ---
function printProgress(current, total, context = '') {
  const percent = ((current / total) * 100).toFixed(2);
  const barLength = 20;
  const filled = Math.round((current / total) * barLength);
  const bar = '[' + '#'.repeat(filled) + '-'.repeat(barLength - filled) + ']';
  console.log(`[Progress] (${current}/${total}) ${bar} ${percent}% ${context}`);
}
function ensureOutputDir() {
  const dir = path.join(__dirname, '../output');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return dir;
}

// Helper: retry with exponential backoff on 429
async function fetchWithRetry(fn, maxRetries = 5, delayMs = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (e) {
      if (e.response && e.response.status === 429) {
        await new Promise(res => setTimeout(res, delayMs * Math.pow(2, attempt)));
        attempt++;
      } else {
        throw e;
      }
    }
  }
  throw new Error('Max retries reached for rate-limited request');
}

// --- /advanced/ endpoints ---

// /advanced/mythic-leaderboard/index
router.get('/mythic-leaderboard/index', async (req, res, next) => {
  try {
    const { region } = req;
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const ids = connectedRealms
      .map(obj => {
        const match = obj.href.match(/connected-realm\/(\d+)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    const results = await Promise.allSettled(
      ids.map(id => proxyService.getGameData('mythic-leaderboard-index', region, { ...req.query, connectedRealmId: id }))
    );
    const data = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.data);
    res.json({ connectedRealmCount: ids.length, results: data });
  } catch (error) {
    next(error);
  }
});

// /advanced/mythic-leaderboard/:dungeonId/period/:period
router.get('/mythic-leaderboard/:dungeonId/period/:period', async (req, res, next) => {
  try {
    const { region } = req;
    const { dungeonId, period } = req.params;
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const ids = connectedRealms
      .map(obj => {
        const match = obj.href.match(/connected-realm\/(\d+)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    const results = await Promise.allSettled(
      ids.map(id => proxyService.getGameData('mythic-leaderboard', region, { ...req.query, connectedRealmId: id, dungeonId, periodId: period }))
    );
    const data = results
      .filter(r => r.status === 'fulfilled')
      .map(r => {
        const d = r.value.data;
        if (d && Array.isArray(d.leading_groups)) {
          d.leading_groups = d.leading_groups.slice(0, 50);
        }
        return d;
      });
    res.json({ connectedRealmCount: ids.length, results: data });
  } catch (error) {
    next(error);
  }
});

// /advanced/mythic-keystone-season/:seasonId/dungeons
router.get('/mythic-keystone-season/:seasonId/dungeons', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    if (SEASON_DUNGEONS[seasonNum]) {
      return res.json({ seasonId, dungeons: SEASON_DUNGEONS[seasonNum], cached: true });
    }
    const seasonResp = await proxyService.getGameData('mythic-keystone-season', region, { ...req.query, id: seasonId });
    const periodsRaw = seasonResp.data.periods || [];
    const periods = periodsRaw.map(p => {
      const href = p && p.key && p.key.href;
      if (href) {
        const match = href.match(/period\/(\d+)/);
        return match ? match[1] : null;
      }
      return null;
    }).filter(Boolean);
    if (periods.length === 0) {
      console.warn('No valid periods found for season', seasonId, 'periodsRaw:', JSON.stringify(periodsRaw));
      return res.json({ dungeons: [], debug: { periodsRaw } });
    }
    const dungeonsResp = await proxyService.getGameData('mythic-keystone-dungeons', region, req.query);
    const dungeonIds = (dungeonsResp.data.dungeons || []).map(d => d.id);
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const connectedRealmId = connectedRealms.length > 0 ? (connectedRealms[0].href.match(/connected-realm\/(\d+)/) || [])[1] : null;
    if (!connectedRealmId) {
      return res.json({ dungeons: [], debug: { periods, dungeonIds, connectedRealms } });
    }
    const foundDungeons = [];
    for (const dungeonId of dungeonIds) {
      let found = false;
      for (const periodId of periods) {
        try {
          const lb = await proxyService.getGameData('mythic-leaderboard', region, { connectedRealmId, dungeonId, periodId });
          if (lb.data && lb.data.leading_groups && lb.data.leading_groups.length > 0) {
            found = true;
            break;
          }
        } catch (e) {
          // Ignore 404s
        }
      }
      if (found) foundDungeons.push(dungeonId);
    }
    if (foundDungeons.length > 0 && seasonNum >= 1 && seasonNum <= 100) {
      SEASON_DUNGEONS[seasonNum] = foundDungeons;
      const constantsPath = path.join(__dirname, '../config/constants.js');
      let constantsSrc = fs.readFileSync(constantsPath, 'utf8');
      constantsSrc = constantsSrc.replace(/const SEASON_DUNGEONS = \{[\s\S]*?\};/,
        `const SEASON_DUNGEONS = ${JSON.stringify(SEASON_DUNGEONS, null, 2)};`);
      fs.writeFileSync(constantsPath, constantsSrc, 'utf8');
    }
    res.json({ seasonId, dungeons: foundDungeons, cached: false });
  } catch (error) {
    next(error);
  }
});

// /advanced/mythic-keystone-season/:seasonId/name
router.get('/mythic-keystone-season/:seasonId/name', async (req, res) => {
  const { seasonId } = req.params;
  const name = SEASON_NAMES[seasonId] || null;
  if (name) {
    res.json({ seasonId, name });
  } else {
    res.status(404).json({ error: true, message: `No name found for seasonId ${seasonId}` });
  }
});

// /advanced/mythic-leaderboard/:seasonId/
router.get('/mythic-leaderboard/:seasonId/', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    const dungeons = SEASON_DUNGEONS[seasonNum];
    if (!dungeons || dungeons.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: `No dungeons found for season ${seasonId}` });
    }
    const seasonResp = await proxyService.getGameData('mythic-keystone-season', region, { ...req.query, id: seasonId });
    const periodsRaw = seasonResp.data.periods || [];
    const periods = periodsRaw.map(p => {
      const href = p && p.key && p.key.href;
      if (href) {
        const match = href.match(/period\/(\d+)/);
        return match ? match[1] : null;
      }
      return null;
    }).filter(Boolean);
    if (periods.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: `No periods found for season ${seasonId}` });
    }
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const connectedRealmIds = connectedRealms.map(obj => {
      const match = obj.href.match(/connected-realm\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    const limit = pLimit(10);
    const tasks = [];
    let allFiles = [];
    let fileCount = 0;
    const totalFiles = dungeons.length * periods.length * connectedRealmIds.length;
    for (const dungeonId of dungeons) {
      for (const periodId of periods) {
        for (const connectedRealmId of connectedRealmIds) {
          tasks.push(limit(async () => {
            try {
              const lb = await proxyService.getGameData('mythic-leaderboard', region, { connectedRealmId, dungeonId, periodId });
              if (lb.data && Array.isArray(lb.data.leading_groups)) {
                const runs = [];
                for (const group of lb.data.leading_groups) {
                  const memberIds = group.members.map(m => m.profile.id).sort((a, b) => a - b);
                  const groupKey = memberIds.join('-');
                  const run_guid = uuidv4();
                  runs.push({
                    dungeon_id: parseInt(dungeonId, 10),
                    period_id: parseInt(periodId, 10),
                    realm_id: parseInt(connectedRealmId, 10),
                    season_id: seasonNum,
                    region,
                    completed_at: group.completed_timestamp ? new Date(group.completed_timestamp) : null,
                    duration_ms: group.duration,
                    keystone_level: group.keystone_level,
                    score: group.mythic_rating ? group.mythic_rating.rating : null,
                    rank: group.ranking,
                    run_guid,
                    members: group.members.map(member => {
                      const specId = member.specialization ? member.specialization.id : null;
                      return {
                        character_name: member.profile.name,
                        class_id: null, // getClassIdFromSpecId(specId),
                        spec_id: specId,
                        role: null, // getRoleFromSpecId(specId),
                        run_guid
                      };
                    })
                  });
                }
                const outputDir = ensureOutputDir();
                const fileName = `${region}-s${seasonId}-p${periodId}-d${dungeonId}-r${connectedRealmId}.json`;
                const filePath = path.join(outputDir, fileName);
                fs.writeFileSync(filePath, JSON.stringify(runs, null, 2));
                allFiles.push(fileName);
                fileCount++;
                printProgress(fileCount, totalFiles, `File: ${fileName}`);
              }
            } catch (e) {
              console.error(`[API ERROR] dungeonId=${dungeonId}, periodId=${periodId}, connectedRealmId=${connectedRealmId}:`, e.message);
            }
          }));
        }
      }
    }
    await Promise.allSettled(tasks);
    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');
    const succeeded = results.filter(r => r.status === 'fulfilled');
    res.json({
      status: failed.length === 0 ? 'OK' : 'PARTIAL',
      message: 'Data written to JSON files',
      filesWritten: succeeded.length,
      filesExpected: totalFiles,
      failedCount: failed.length,
      failedReasons: failed.map(f => f.reason ? f.reason.message : f)
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// /advanced/mythic-leaderboard/:seasonId/:periodId
router.get('/mythic-leaderboard/:seasonId/:periodId', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId, periodId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    const dungeons = SEASON_DUNGEONS[seasonNum];
    if (!dungeons || dungeons.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: `No dungeons found for season ${seasonId}` });
    }
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const connectedRealmIds = connectedRealms.map(obj => {
      const match = obj.href.match(/connected-realm\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    const limit = pLimit(10);
    const tasks = [];
    let allFiles = [];
    let fileCount = 0;
    const totalFiles = dungeons.length * connectedRealmIds.length;
    for (const dungeonId of dungeons) {
      for (const connectedRealmId of connectedRealmIds) {
        tasks.push(limit(async () => {
          try {
            const lb = await fetchWithRetry(
              () => proxyService.getGameData('mythic-leaderboard', region, { connectedRealmId, dungeonId, periodId })
            );
            if (lb.data && Array.isArray(lb.data.leading_groups)) {
              const runs = [];
              for (const group of lb.data.leading_groups) {
                const memberIds = group.members.map(m => m.profile.id).sort((a, b) => a - b);
                const groupKey = memberIds.join('-');
                const run_guid = uuidv4();
                runs.push({
                  dungeon_id: parseInt(dungeonId, 10),
                  period_id: parseInt(periodId, 10),
                  realm_id: parseInt(connectedRealmId, 10),
                  season_id: seasonNum,
                  region,
                  completed_at: group.completed_timestamp ? new Date(group.completed_timestamp) : null,
                  duration_ms: group.duration,
                  keystone_level: group.keystone_level,
                  score: group.mythic_rating ? group.mythic_rating.rating : null,
                  rank: group.ranking,
                  run_guid,
                  members: group.members.map(member => {
                    const specId = member.specialization ? member.specialization.id : null;
                    return {
                      character_name: member.profile.name,
                      class_id: null, // getClassIdFromSpecId(specId),
                      spec_id: specId,
                      role: null, // getRoleFromSpecId(specId),
                      run_guid
                    };
                  })
                });
              }
              const outputDir = ensureOutputDir();
              const fileName = `${region}-s${seasonId}-p${periodId}-d${dungeonId}-r${connectedRealmId}.json`;
              const filePath = path.join(outputDir, fileName);
              fs.writeFileSync(filePath, JSON.stringify(runs, null, 2));
              allFiles.push(fileName);
              fileCount++;
              printProgress(fileCount, totalFiles, `File: ${fileName}`);
            }
          } catch (e) {
            console.error(`[API ERROR] dungeonId=${dungeonId}, periodId=${periodId}, connectedRealmId=${connectedRealmId}:`, e.message);
          }
        }));
      }
    }
    await Promise.allSettled(tasks);
    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');
    const succeeded = results.filter(r => r.status === 'fulfilled');
    res.json({
      status: failed.length === 0 ? 'OK' : 'PARTIAL',
      message: 'Data written to JSON files',
      filesWritten: succeeded.length,
      filesExpected: totalFiles,
      failedCount: failed.length,
      failedReasons: failed.map(f => f.reason ? f.reason.message : f)
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- New endpoints for filter population ---

// /advanced/seasons
router.get('/seasons', (req, res) => {
  // SEASON_NAMES is an object: { [seasonId]: seasonName }
  const seasons = Object.entries(SEASON_NAMES).map(([season_id, season_name]) => ({
    season_id: Number(season_id),
    season_name
  }));
  res.json(seasons);
});

// /advanced/season-info/:seasonId
router.get('/season-info/:seasonId', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    // Get periods for the season
    const seasonResp = await proxyService.getGameData('mythic-keystone-season', region, { ...req.query, id: seasonId });
    const periodsRaw = seasonResp.data.periods || [];
    const periods = periodsRaw.map((p, idx) => {
      const href = p && p.key && p.key.href;
      let period_id = null;
      if (href) {
        const match = href.match(/period\/(\d+)/);
        period_id = match ? Number(match[1]) : null;
      }
      return period_id ? { period_id, period_name: `Week ${idx + 1}` } : null;
    }).filter(Boolean);
    // Get dungeons for the season
    const seasonDungeonIds = SEASON_DUNGEONS[seasonId] || [];
    const dungeons = seasonDungeonIds
      .map(id => {
        const found = WOW_DUNGEONS.find(d => d.id === id);
        return found ? { dungeon_id: found.id, dungeon_name: found.name } : null;
      })
      .filter(Boolean);
    res.json({ periods, dungeons });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 