const express = require('express');
const proxyService = require('../services/proxy');
const validateRegion = require('../middleware/region');
const { SEASON_DUNGEONS, SEASON_NAMES, WOW_DUNGEONS, WOW_SPECIALIZATIONS, WOW_SPEC_ROLES } = require('../config/constants');

// Helper: get keystone_upgrades for a dungeonId from WOW_DUNGEONS
function getKeystoneUpgradesForDungeon(dungeonId) {
  const dungeon = WOW_DUNGEONS.find(d => d.id === Number(dungeonId));
  return dungeon && Array.isArray(dungeon.keystone_upgrades) ? dungeon.keystone_upgrades : null;
}

// Helper: fallback score calculation (Blizzard-like, using keystone level, duration, and keystone_upgrades)
function calculateFallbackScore(keystoneLevel, keystoneUpgrades, durationMs) {
  if (!keystoneLevel || !Array.isArray(keystoneUpgrades) || !durationMs) return null;
  // Sort upgrades by upgrade_level ascending
  const sorted = [...keystoneUpgrades].sort((a, b) => a.upgrade_level - b.upgrade_level);
  const timer1 = sorted.find(u => u.upgrade_level === 1)?.qualifying_duration;
  const timer2 = sorted.find(u => u.upgrade_level === 2)?.qualifying_duration;
  const timer3 = sorted.find(u => u.upgrade_level === 3)?.qualifying_duration;
  if (!timer1) return null;
  // Official base score
  const base = 60 + (Number(keystoneLevel) * 7.5);
  let score;
  // Timed run (under 1-chest)
  if (durationMs <= timer1) {
    // Bonus for being under timer, up to 1-chest
    if (timer2 && durationMs <= timer2) {
      // 2-chest or better
      if (timer3 && durationMs <= timer3) {
        // 3-chest or better: max bonus
        score = base + 15;
      } else {
        // Between 2-chest and 3-chest
        const bonus = ((timer2 - durationMs) / (timer2 - timer3)) * 7.5;
        score = base + 7.5 + Math.max(0, bonus);
      }
    } else {
      // Between 1-chest and 2-chest
      const bonus = ((timer1 - durationMs) / (timer1 - timer2)) * 7.5;
      score = base + Math.max(0, bonus);
    }
  } else {
    // Depleted run: scale score by timer1/durationMs
    score = base * (timer1 / durationMs);
  }
  // Clamp to minimum 0.01 and round to 5 decimals
  return Number(Math.max(0.01, score).toFixed(5));
}
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Apply region validation to all advanced routes
router.use(validateRegion);

// --- Helper functions ---
// Helper to map spec_id to class_id
function getClassIdFromSpecId(specId) {
    const spec = WOW_SPECIALIZATIONS.find(s => s.id === specId);
    return spec ? spec.classId : null;
}

// Helper to map spec_id to role
function getRoleFromSpecId(specId) {
    return WOW_SPEC_ROLES[specId] || null;
}

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
    // Check if region is specified in query params
    const specifiedRegion = req.query.region;
    const regionsToProcess = specifiedRegion ? [specifiedRegion.toLowerCase()] : ['us', 'eu', 'kr', 'tw'];
    
    const { seasonId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    const dungeons = SEASON_DUNGEONS[seasonNum];
    if (!dungeons || dungeons.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: `No dungeons found for season ${seasonId}` });
    }

    let allFiles = [];
    let totalFiles = 0;
    let fileCount = 0;
    let failedCount = 0;
    let failedReasons = [];

    // Process each region
    for (const region of regionsToProcess) {
      try {
        // Validate region
        if (!['us', 'eu', 'kr', 'tw'].includes(region)) {
          console.error(`[INVALID REGION] ${region} is not supported`);
          failedCount++;
          failedReasons.push(`Invalid region: ${region}`);
          continue;
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
          console.error(`[NO PERIODS] No periods found for season ${seasonId} in region ${region}`);
          failedCount++;
          failedReasons.push(`No periods found for season ${seasonId} in region ${region}`);
          continue;
        }
        const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
        const connectedRealms = realmsResp.data.connected_realms || [];
        const connectedRealmIds = connectedRealms.map(obj => {
          const match = obj.href.match(/connected-realm\/(\d+)/);
          return match ? match[1] : null;
        }).filter(Boolean);
        const limit = pLimit(10);
        const tasks = [];
        const regionTotalFiles = dungeons.length * periods.length * connectedRealmIds.length;
        totalFiles += regionTotalFiles;
        
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
                        score: (group.mythic_rating && group.mythic_rating.rating != null && group.mythic_rating.rating > 0)
                          ? group.mythic_rating.rating
                          : (() => {
                              const upgrades = getKeystoneUpgradesForDungeon(dungeonId);
                              return calculateFallbackScore(group.keystone_level, upgrades, group.duration);
                            })(),
                        rank: group.ranking,
                        run_guid,
                        members: group.members.map(member => {
                          const specId = member.specialization ? member.specialization.id : null;
                          return {
                            character_name: member.profile.name,
                            class_id: getClassIdFromSpecId(specId),
                            spec_id: specId,
                            role: getRoleFromSpecId(specId),
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
                  console.error(`[API ERROR] region=${region}, dungeonId=${dungeonId}, periodId=${periodId}, connectedRealmId=${connectedRealmId}:`, e.message);
                  failedCount++;
                  failedReasons.push(`API Error for ${region}-${dungeonId}-${periodId}-${connectedRealmId}: ${e.message}`);
                }
              }));
            }
          }
        }
        await Promise.allSettled(tasks);
      } catch (e) {
        console.error(`[REGION ERROR] Failed to process region ${region}:`, e.message);
        failedCount++;
        failedReasons.push(`Region ${region}: ${e.message}`);
      }
    }

    const succeeded = totalFiles - failedCount;
    res.json({
      status: failedCount === 0 ? 'OK' : 'PARTIAL',
      message: 'Data written to JSON files',
      filesWritten: succeeded,
      filesExpected: totalFiles,
      failedCount: failedCount,
      failedReasons: failedReasons,
      regionsProcessed: regionsToProcess,
      regionsCount: regionsToProcess.length
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// /advanced/mythic-leaderboard/:seasonId/:periodId
router.get('/mythic-leaderboard/:seasonId/:periodId', async (req, res, next) => {
  try {
    // Check if region is specified in query params
    const specifiedRegion = req.query.region;
    const regionsToProcess = specifiedRegion ? [specifiedRegion.toLowerCase()] : ['us', 'eu', 'kr', 'tw'];
    
    const { seasonId, periodId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    const dungeons = SEASON_DUNGEONS[seasonNum];
    if (!dungeons || dungeons.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: `No dungeons found for season ${seasonId}` });
    }

    let allFiles = [];
    let totalFiles = 0;
    let fileCount = 0;
    let failedCount = 0;
    let failedReasons = [];

    // Process each region
    for (const region of regionsToProcess) {
      try {
        // Validate region
        if (!['us', 'eu', 'kr', 'tw'].includes(region)) {
          console.error(`[INVALID REGION] ${region} is not supported`);
          failedCount++;
          failedReasons.push(`Invalid region: ${region}`);
          continue;
        }

        const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
        const connectedRealms = realmsResp.data.connected_realms || [];
        const connectedRealmIds = connectedRealms.map(obj => {
          const match = obj.href.match(/connected-realm\/(\d+)/);
          return match ? match[1] : null;
        }).filter(Boolean);
        const limit = pLimit(10);
        const tasks = [];
        const regionTotalFiles = dungeons.length * connectedRealmIds.length;
        totalFiles += regionTotalFiles;
        
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
                      score: (group.mythic_rating && group.mythic_rating.rating != null && group.mythic_rating.rating > 0)
                        ? group.mythic_rating.rating
                        : (() => {
                            const upgrades = getKeystoneUpgradesForDungeon(dungeonId);
                            return calculateFallbackScore(group.keystone_level, upgrades, group.duration);
                          })(),
                      rank: group.ranking,
                      run_guid,
                      members: group.members.map(member => {
                        const specId = member.specialization ? member.specialization.id : null;
                        return {
                          character_name: member.profile.name,
                          class_id: getClassIdFromSpecId(specId),
                          spec_id: specId,
                          role: getRoleFromSpecId(specId),
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
                console.error(`[API ERROR] region=${region}, dungeonId=${dungeonId}, periodId=${periodId}, connectedRealmId=${connectedRealmId}:`, e.message);
                failedCount++;
                failedReasons.push(`API Error for ${region}-${dungeonId}-${periodId}-${connectedRealmId}: ${e.message}`);
              }
            }));
          }
        }
        await Promise.allSettled(tasks);
      } catch (e) {
        console.error(`[REGION ERROR] Failed to process region ${region}:`, e.message);
        failedCount++;
        failedReasons.push(`Region ${region}: ${e.message}`);
      }
    }

    const succeeded = totalFiles - failedCount;
    res.json({
      status: failedCount === 0 ? 'OK' : 'PARTIAL',
      message: 'Data written to JSON files',
      filesWritten: succeeded,
      filesExpected: totalFiles,
      failedCount: failedCount,
      failedReasons: failedReasons,
      regionsProcessed: regionsToProcess,
      regionsCount: regionsToProcess.length
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
        return found ? { dungeon_id: found.id, dungeon_name: found.name, dungeon_shortname: found.shortname } : null;
      })
      .filter(Boolean);
    res.json({ periods, dungeons });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 