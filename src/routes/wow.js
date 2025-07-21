const express = require('express');
const proxyService = require('../services/proxy');
const validateRegion = require('../middleware/region');
const axios = require('axios');
const { SEASON_DUNGEONS, SEASON_NAMES } = require('../config/constants');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Apply region validation to all WoW routes
router.use(validateRegion);

/**
 * Game Data Routes
 */

// GET /wow/game-data/achievements
router.get('/game-data/achievements', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('achievements', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add WoW Token endpoint that we know works
router.get('/game-data/token', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('token', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add missing endpoints
router.get('/game-data/professions', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('professions', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talents', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('talents', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/pvp-seasons', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('pvp-seasons', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/reputations', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('reputations', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/achievement-categories', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('achievement-categories', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talent-trees', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('talent-trees', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/reputation-tiers', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('reputation-tiers', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add corrected item endpoints
router.get('/game-data/item-classes', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('item-classes', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/item-sets', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('item-sets', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Mythic Keystone Affix endpoints
router.get('/game-data/keystone-affixes', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('keystone-affixes', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Mythic Keystone Dungeon endpoints
router.get('/game-data/mythic-keystone', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mythic-keystone', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/mythic-keystone-dungeons', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mythic-keystone-dungeons', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/mythic-keystone-periods', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mythic-keystone-periods', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/mythic-keystone-seasons', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mythic-keystone-seasons', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Mythic Keystone Leaderboard endpoints
router.get('/game-data/mythic-leaderboard-index/:connectedRealmId', async (req, res, next) => {
  try {
    const { region } = req;
    const { connectedRealmId } = req.params;
    const response = await proxyService.getGameData('mythic-leaderboard-index', region, {
      ...req.query,
      connectedRealmId
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/mythic-leaderboard/:connectedRealmId/:dungeonId/:periodId', async (req, res, next) => {
  try {
    const { region } = req;
    const { connectedRealmId, dungeonId, periodId } = req.params;
    const response = await proxyService.getGameData('mythic-leaderboard', region, {
      ...req.query,
      connectedRealmId,
      dungeonId,
      periodId
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Playable Class endpoints
router.get('/game-data/playable-classes', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('playable-classes', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-class/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-class', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-class-media/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-class-media', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-class/:id/pvp-talent-slots', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-class-pvp-talent-slots', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Playable Race endpoints
router.get('/game-data/playable-races', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('playable-races', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-race/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-race', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Playable Specialization endpoints
router.get('/game-data/playable-specializations', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('playable-specializations', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-specialization/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-specialization', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/playable-specialization-media/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('playable-specialization-media', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Realm endpoints
router.get('/game-data/realms', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('realms', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/realm/:slug', async (req, res, next) => {
  try {
    const { region } = req;
    const { slug } = req.params;
    const response = await proxyService.getGameData('realm', region, {
      ...req.query,
      slug
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/realm-search', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('realm-search', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Region endpoints
router.get('/game-data/regions', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('regions', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/region/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('region', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Spell endpoints
router.get('/game-data/spell/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('spell', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/spell-media/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('spell-media', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/spell-search', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('spell-search', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Talent API endpoints
router.get('/game-data/talent-tree-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('talent-tree-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talent-tree/:treeId/playable-specialization/:specId', async (req, res, next) => {
  try {
    const { region } = req;
    const { treeId, specId } = req.params;
    const response = await proxyService.getGameData('talent-tree', region, {
      ...req.query,
      treeId,
      specId
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talent-tree-nodes/:treeId', async (req, res, next) => {
  try {
    const { region } = req;
    const { treeId } = req.params;
    const response = await proxyService.getGameData('talent-tree-nodes', region, {
      ...req.query,
      treeId
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talents-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('talents-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/talent/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('talent', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/pvp-talents-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('pvp-talents-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/pvp-talent/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('pvp-talent', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Tech Talent API endpoints
router.get('/game-data/tech-talent-tree-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('tech-talent-tree-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/tech-talent-tree/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('tech-talent-tree', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/tech-talent-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('tech-talent-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/tech-talent/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('tech-talent', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/tech-talent-media/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('tech-talent-media', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Connected Realm API endpoints
router.get('/game-data/connected-realms-index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('connected-realms-index', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/connected-realm/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('connected-realm', region, {
      ...req.query,
      id
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

router.get('/game-data/connected-realm-search', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('connected-realm-search', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Add Media Search endpoint
router.get('/game-data/media-search', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('media-search', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/achievements/:id
router.get('/game-data/achievements/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('achievement', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/classes
router.get('/game-data/classes', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('classes', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/classes/:id
router.get('/game-data/classes/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('class', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/races
router.get('/game-data/races', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('races', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/races/:id
router.get('/game-data/races/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('race', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/specializations
router.get('/game-data/specializations', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('specializations', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/specializations/:id
router.get('/game-data/specializations/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('specialization', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/items
router.get('/game-data/items', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('items', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/items/:id
router.get('/game-data/items/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('item', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/mounts
router.get('/game-data/mounts', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mounts', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/mounts/:id
router.get('/game-data/mounts/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('mount', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/pets
router.get('/game-data/pets', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('pets', region, req.query);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /wow/game-data/pets/:id
router.get('/game-data/pets/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('pet', region, { id: req.params.id, ...req.query });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * Health check for WoW services
 */
router.get('/health', async (req, res, next) => {
  try {
    const { region } = req;
    const isWorking = await proxyService.testProxy(region);
    
    res.json({
      status: isWorking ? 'OK' : 'ERROR',
      service: 'World of Warcraft API',
      region: region,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      service: 'World of Warcraft API',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// PvP Season Index
router.get('/game-data/pvp-season/index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('pvp-seasons-index', region, {
      ...req.query,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Reputation Factions Index
router.get('/game-data/reputation-faction/index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('reputation-factions-index', region, {
      ...req.query,
      namespace: `static-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Reputation Faction (individual)
router.get('/game-data/reputation-faction/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('reputation-faction', region, {
      ...req.query,
      id,
      namespace: `static-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Reputation Tiers Index
router.get('/game-data/reputation-tiers/index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('reputation-tiers-index', region, {
      ...req.query,
      namespace: `static-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// Reputation Tiers (individual)
router.get('/game-data/reputation-tiers/:id', async (req, res, next) => {
  try {
    const { region } = req;
    const { id } = req.params;
    const response = await proxyService.getGameData('reputation-tiers', region, {
      ...req.query,
      id,
      namespace: `static-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// WoW Token Index
router.get('/game-data/token/index', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await proxyService.getGameData('wow-token-index', region, {
      ...req.query,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// PvP Season (individual)
router.get('/game-data/pvp-season/:seasonId', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const response = await proxyService.getGameData('pvp-season', region, {
      ...req.query,
      seasonId,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// PvP Leaderboards Index
router.get('/game-data/pvp-season/:seasonId/pvp-leaderboard/index', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const response = await proxyService.getGameData('pvp-leaderboards-index', region, {
      ...req.query,
      seasonId,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// PvP Leaderboard (individual)
router.get('/game-data/pvp-season/:seasonId/pvp-leaderboard/:bracket', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId, bracket } = req.params;
    const response = await proxyService.getGameData('pvp-leaderboard', region, {
      ...req.query,
      seasonId,
      bracket,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// PvP Rewards Index
router.get('/game-data/pvp-season/:seasonId/pvp-reward/index', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const response = await proxyService.getGameData('pvp-rewards-index', region, {
      ...req.query,
      seasonId,
      namespace: `dynamic-${region}`,
      locale: req.query.locale || 'en_US'
    });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// /advanced/mythic-leaderboard/index
router.get('/advanced/mythic-leaderboard/index', async (req, res, next) => {
  try {
    const { region } = req;
    // 1. Get all connected realm IDs
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const ids = connectedRealms
      .map(obj => {
        const match = obj.href.match(/connected-realm\/(\d+)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    // 2. Fetch all leaderboards in parallel
    const results = await Promise.allSettled(
      ids.map(id => proxyService.getGameData('mythic-leaderboard-index', region, { ...req.query, connectedRealmId: id }))
    );
    // 3. Aggregate raw results
    const data = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.data);
    res.json({ connectedRealmCount: ids.length, results: data });
  } catch (error) {
    next(error);
  }
});

// /advanced/mythic-leaderboard/:dungeonId/period/:period
router.get('/advanced/mythic-leaderboard/:dungeonId/period/:period', async (req, res, next) => {
  try {
    const { region } = req;
    const { dungeonId, period } = req.params;
    // 1. Get all connected realm IDs
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const ids = connectedRealms
      .map(obj => {
        const match = obj.href.match(/connected-realm\/(\d+)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    // 2. Fetch all leaderboards for the dungeon/period in parallel
    const results = await Promise.allSettled(
      ids.map(id => proxyService.getGameData('mythic-leaderboard', region, { ...req.query, connectedRealmId: id, dungeonId, periodId: period }))
    );
    // 3. Aggregate raw results, limit to top 50 per leaderboard
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

// /wow/advanced/mythic-keystone-season/:seasonId/dungeons
router.get('/advanced/mythic-keystone-season/:seasonId/dungeons', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    // 1. Check if we have a cached mapping
    if (SEASON_DUNGEONS[seasonNum]) {
      return res.json({ seasonId, dungeons: SEASON_DUNGEONS[seasonNum], cached: true });
    }
    // 1. Get all periods for the season
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
    // 2. Get all dungeon IDs
    const dungeonsResp = await proxyService.getGameData('mythic-keystone-dungeons', region, req.query);
    const dungeonIds = (dungeonsResp.data.dungeons || []).map(d => d.id);
    // 3. Get all connected realm IDs (use just one for efficiency)
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const connectedRealmId = connectedRealms.length > 0 ? (connectedRealms[0].href.match(/connected-realm\/(\d+)/) || [])[1] : null;
    if (!connectedRealmId) {
      return res.json({ dungeons: [], debug: { periods, dungeonIds, connectedRealms } });
    }
    // 4. For each dungeon, check if any period has leaderboard data
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
    // 2. Update the mapping and persist to constants.js
    if (foundDungeons.length > 0 && seasonNum >= 1 && seasonNum <= 100) {
      SEASON_DUNGEONS[seasonNum] = foundDungeons;
      // Persist to constants.js
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

// /wow/advanced/mythic-keystone-season/:seasonId/name
router.get('/advanced/mythic-keystone-season/:seasonId/name', async (req, res) => {
  const { seasonId } = req.params;
  const name = SEASON_NAMES[seasonId] || null;
  if (name) {
    res.json({ seasonId, name });
  } else {
    res.status(404).json({ error: true, message: `No name found for seasonId ${seasonId}` });
  }
});

// /wow/advanced/mythic-leaderboard/:seasonId/
router.get('/advanced/mythic-leaderboard/:seasonId/', async (req, res, next) => {
  try {
    const { region } = req;
    const { seasonId } = req.params;
    const seasonNum = parseInt(seasonId, 10);
    // Get dungeons for the season
    const dungeons = SEASON_DUNGEONS[seasonNum];
    if (!dungeons || dungeons.length === 0) {
      return res.status(404).json({ error: true, message: `No dungeons found for season ${seasonId}` });
    }
    // Get periods for the season
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
      return res.status(404).json({ error: true, message: `No periods found for season ${seasonId}` });
    }
    // Get all connected realm IDs (use all for full aggregation)
    const realmsResp = await proxyService.getGameData('connected-realms-index', region, req.query);
    const connectedRealms = realmsResp.data.connected_realms || [];
    const connectedRealmIds = connectedRealms.map(obj => {
      const match = obj.href.match(/connected-realm\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    // Aggregate all leaderboard data
    const allResults = [];
    const totalCalls = dungeons.length * periods.length * connectedRealmIds.length;
    let callCount = 0;
    for (const dungeonId of dungeons) {
      console.log(`[Leaderboard] Processing dungeonId ${dungeonId}`);
      for (const periodId of periods) {
        console.log(`[Leaderboard]  Processing periodId ${periodId} for dungeonId ${dungeonId}`);
        for (const connectedRealmId of connectedRealmIds) {
          callCount++;
          const percent = ((callCount / totalCalls) * 100).toFixed(2);
          const barLength = 20;
          const filled = Math.round((callCount / totalCalls) * barLength);
          const bar = '[' + '#'.repeat(filled) + '-'.repeat(barLength - filled) + ']';
          console.log(`[Leaderboard]   (${callCount}/${totalCalls}) ${bar} ${percent}% Data: dungeonId ${dungeonId}, periodId ${periodId}, connectedRealmId ${connectedRealmId}`);
          try {
            const lb = await proxyService.getGameData('mythic-leaderboard', region, { connectedRealmId, dungeonId, periodId });
            if (lb.data) {
              allResults.push({ dungeonId, periodId, connectedRealmId, data: lb.data });
            }
          } catch (e) {
            // Ignore 404s and continue
            console.warn(`[Leaderboard]   No data for dungeonId ${dungeonId}, periodId ${periodId}, connectedRealmId ${connectedRealmId}`);
          }
        }
      }
    }
    res.json({ seasonId, dungeons, periods, results: allResults });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 