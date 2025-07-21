const blizzardClient = require('./blizzard/client');
const { API_ENDPOINTS } = require('../config/constants');

/**
 * Proxy service for handling Blizzard API requests
 */
class ProxyService {
  /**
   * Forward a request to Blizzard API
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   * @param {Object} options - Request options (method, data, params)
   * @returns {Promise<Object>} Blizzard API response
   */
  async forwardRequest(endpoint, region = 'us', options = {}) {
    try {
      const { method = 'GET', data, params = {} } = options;
      
      if (method === 'POST') {
        const response = await blizzardClient.post(endpoint, region, data, params);
        return response;
      } else {
        const response = await blizzardClient.get(endpoint, region, params);
        return response;
      }
    } catch (error) {
      console.error(`Proxy error for endpoint ${endpoint} in region ${region}:`, error.message);
      throw error;
    }
  }

  /**
   * Get game data from WoW API
   * @param {string} dataType - Type of game data
   * @param {string} region - Region code
   * @param {Object} params - Additional parameters
   * @returns {Promise<Object>} Game data response
   */
  async getGameData(dataType, region = 'us', params = {}) {
    const endpoint = this.buildGameDataEndpoint(dataType, params);
    return this.forwardRequest(endpoint, region, { params });
  }

  /**
   * Get profile data from WoW API
   * @param {string} profileType - Type of profile data
   * @param {string} region - Region code
   * @param {Object} params - Additional parameters
   * @returns {Promise<Object>} Profile data response
   */
  async getProfileData(profileType, region = 'us', params = {}) {
    const endpoint = this.buildProfileEndpoint(profileType, params);
    return this.forwardRequest(endpoint, region, { params });
  }

  /**
   * Build game data endpoint URL
   * @param {string} dataType - Type of game data
   * @param {Object} params - Parameters for endpoint building
   * @returns {string} Endpoint URL
   */
  buildGameDataEndpoint(dataType, params = {}) {
    const endpoints = API_ENDPOINTS.WOW_GAME_DATA;
    
    switch (dataType) {
      case 'token':
        return endpoints.TOKEN;
      case 'achievements':
        return endpoints.ACHIEVEMENTS;
      case 'achievement':
        return endpoints.ACHIEVEMENT.replace('{id}', params.id);
      case 'achievement-categories':
        return endpoints.ACHIEVEMENT_CATEGORIES;
      case 'achievement-category':
        return endpoints.ACHIEVEMENT_CATEGORY.replace('{id}', params.id);
      case 'achievement-media':
        return endpoints.ACHIEVEMENT_MEDIA.replace('{id}', params.id);
      case 'classes':
        return endpoints.CLASSES;
      case 'class':
        return endpoints.CLASS.replace('{id}', params.id);
      case 'class-media':
        return endpoints.CLASS_MEDIA.replace('{id}', params.id);
      case 'races':
        return endpoints.RACES;
      case 'race':
        return endpoints.RACE.replace('{id}', params.id);
      case 'specializations':
        return endpoints.SPECIALIZATIONS;
      case 'specialization':
        return endpoints.SPECIALIZATION.replace('{id}', params.id);
      case 'specialization-media':
        return endpoints.SPECIALIZATION_MEDIA.replace('{id}', params.id);
      case 'items':
        // Items don't have an index endpoint, redirect to item classes
        return endpoints.ITEM_CLASSES;
      case 'item':
        return endpoints.ITEM.replace('{id}', params.id);
      case 'item-media':
        return endpoints.ITEM_MEDIA.replace('{id}', params.id);
      case 'item-classes':
        return endpoints.ITEM_CLASSES;
      case 'item-class':
        return endpoints.ITEM_CLASS.replace('{id}', params.id);
      case 'item-sets':
        return endpoints.ITEM_SETS;
      case 'item-set':
        return endpoints.ITEM_SET.replace('{id}', params.id);
      case 'realms':
        return endpoints.REALMS;
      case 'realm':
        return endpoints.REALM.replace('{slug}', params.slug);
      case 'realm-search':
        return endpoints.REALM_SEARCH;
      case 'regions':
        return endpoints.REGIONS;
      case 'region':
        return endpoints.REGION.replace('{id}', params.id);
      case 'spell':
        return endpoints.SPELL.replace('{id}', params.id);
      case 'spell-media':
        return endpoints.SPELL_MEDIA.replace('{id}', params.id);
      case 'spell-search':
        return endpoints.SPELL_SEARCH;
      case 'talent-tree-index':
        return endpoints.TALENT_TREE_INDEX;
      case 'talent-tree':
        return endpoints.TALENT_TREE.replace('{treeId}', params.treeId).replace('{specId}', params.specId);
      case 'talent-tree-nodes':
        return endpoints.TALENT_TREE_NODES.replace('{treeId}', params.treeId);
      case 'talents-index':
        return endpoints.TALENTS_INDEX;
      case 'talent':
        return endpoints.TALENT.replace('{id}', params.id);
      case 'pvp-talents-index':
        return endpoints.PVP_TALENTS_INDEX;
      case 'pvp-talent':
        return endpoints.PVP_TALENT.replace('{id}', params.id);
      case 'tech-talent-tree-index':
        return endpoints.TECH_TALENT_TREE_INDEX;
      case 'tech-talent-tree':
        return endpoints.TECH_TALENT_TREE.replace('{id}', params.id);
      case 'tech-talent-index':
        return endpoints.TECH_TALENT_INDEX;
      case 'tech-talent':
        return endpoints.TECH_TALENT.replace('{id}', params.id);
      case 'tech-talent-media':
        return endpoints.TECH_TALENT_MEDIA.replace('{id}', params.id);
      case 'connected-realms-index':
        return endpoints.CONNECTED_REALMS_INDEX;
      case 'connected-realm':
        return endpoints.CONNECTED_REALM.replace('{id}', params.id);
      case 'connected-realm-search':
        return endpoints.CONNECTED_REALM_SEARCH;
      case 'media-search':
        return endpoints.MEDIA_SEARCH;
      case 'character-mythic-keystone-profile':
        return endpoints.CHARACTER_MYTHIC_KEYSTONE_PROFILE
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-mythic-keystone-profile-season':
        return endpoints.CHARACTER_MYTHIC_KEYSTONE_PROFILE_SEASON
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName)
          .replace('{seasonId}', params.seasonId);
      case 'character-profile-summary':
        return endpoints.CHARACTER_PROFILE_SUMMARY
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-profile-status':
        return endpoints.CHARACTER_PROFILE_STATUS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-specializations-summary':
        return endpoints.CHARACTER_SPECIALIZATIONS_SUMMARY
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'mounts':
        return endpoints.MOUNTS;
      case 'mount':
        return endpoints.MOUNT.replace('{id}', params.id);
      case 'pets':
        return endpoints.PETS;
      case 'pet':
        return endpoints.PET.replace('{id}', params.id);
      case 'pet-media':
        return endpoints.PET_MEDIA.replace('{id}', params.id);
      case 'professions':
        return endpoints.PROFESSIONS;
      case 'profession':
        return endpoints.PROFESSION.replace('{id}', params.id);
      case 'profession-skill-tier':
        return endpoints.PROFESSION_SKILL_TIER
          .replace('{id}', params.id)
          .replace('{skillTierId}', params.skillTierId);
      case 'profession-recipe':
        return endpoints.PROFESSION_RECIPE.replace('{id}', params.id);
      case 'profession-media':
        return endpoints.PROFESSION_MEDIA.replace('{id}', params.id);
      case 'talents':
        return endpoints.TALENTS;
      case 'talent':
        return endpoints.TALENT.replace('{id}', params.id);
      case 'talent-trees':
        return endpoints.TALENT_TREES;
      case 'talent-tree':
        return endpoints.TALENT_TREE.replace('{id}', params.id);
      case 'talent-tree-nodes':
        return endpoints.TALENT_TREE_NODES
          .replace('{id}', params.id)
          .replace('{specId}', params.specId);
      case 'pvp-seasons':
        return endpoints.PVP_SEASONS;
      case 'pvp-season':
        return endpoints.PVP_SEASON.replace('{seasonId}', params.seasonId);
      case 'pvp-leaderboards-index':
        return endpoints.PVP_LEADERBOARDS_INDEX.replace('{seasonId}', params.seasonId);
      case 'pvp-leaderboard':
        return endpoints.PVP_LEADERBOARD.replace('{seasonId}', params.seasonId).replace('{bracket}', params.bracket);
      case 'pvp-rewards-index':
        return endpoints.PVP_REWARDS_INDEX.replace('{seasonId}', params.seasonId);
      case 'mythic-raid-leaderboard':
        return endpoints.MYTHIC_RAID_LEADERBOARD
          .replace('{raid}', params.raid)
          .replace('{faction}', params.faction);
      case 'mythic-dungeon-leaderboard':
        return endpoints.MYTHIC_DUNGEON_LEADERBOARD
          .replace('{dungeon}', params.dungeon)
          .replace('{period}', params.period);
      case 'reputations':
        return endpoints.REPUTATIONS;
      case 'reputation-faction':
        return endpoints.REPUTATION_FACTION.replace('{id}', params.id);
      case 'reputation-tiers-index':
        return endpoints.REPUTATION_TIERS_INDEX;
      case 'reputation-tiers':
        return endpoints.REPUTATION_TIERS.replace('{id}', params.id);
      case 'keystone-affixes':
        return endpoints.KEYSTONE_AFFIXES;
      case 'keystone-affix':
        return endpoints.KEYSTONE_AFFIX.replace('{id}', params.id);
      case 'keystone-affix-media':
        return endpoints.KEYSTONE_AFFIX_MEDIA.replace('{id}', params.id);
      case 'mythic-keystone':
        return endpoints.MYTHIC_KEYSTONE;
      case 'mythic-keystone-dungeons':
        return endpoints.MYTHIC_KEYSTONE_DUNGEONS;
      case 'mythic-keystone-dungeon':
        return endpoints.MYTHIC_KEYSTONE_DUNGEON.replace('{id}', params.id);
      case 'mythic-keystone-periods':
        return endpoints.MYTHIC_KEYSTONE_PERIODS;
      case 'mythic-keystone-period':
        return endpoints.MYTHIC_KEYSTONE_PERIOD.replace('{id}', params.id);
      case 'mythic-keystone-seasons':
        return endpoints.MYTHIC_KEYSTONE_SEASONS;
      case 'mythic-keystone-season':
        return endpoints.MYTHIC_KEYSTONE_SEASON.replace('{id}', params.id);
      case 'mythic-leaderboard-index':
        return endpoints.MYTHIC_LEADERBOARD_INDEX.replace('{connectedRealmId}', params.connectedRealmId);
      case 'mythic-leaderboard':
        return endpoints.MYTHIC_LEADERBOARD
          .replace('{connectedRealmId}', params.connectedRealmId)
          .replace('{dungeonId}', params.dungeonId)
          .replace('{periodId}', params.periodId);
      case 'playable-classes':
        return endpoints.PLAYABLE_CLASSES;
      case 'playable-class':
        return endpoints.PLAYABLE_CLASS.replace('{id}', params.id);
      case 'playable-class-media':
        return endpoints.PLAYABLE_CLASS_MEDIA.replace('{id}', params.id);
      case 'playable-class-pvp-talent-slots':
        return endpoints.PLAYABLE_CLASS_PVP_TALENT_SLOTS.replace('{id}', params.id);
      case 'playable-races':
        return endpoints.PLAYABLE_RACES;
      case 'playable-race':
        return endpoints.PLAYABLE_RACE.replace('{id}', params.id);
      case 'playable-specializations':
        return endpoints.PLAYABLE_SPECIALIZATIONS;
      case 'playable-specialization':
        return endpoints.PLAYABLE_SPECIALIZATION.replace('{id}', params.id);
      case 'playable-specialization-media':
        return endpoints.PLAYABLE_SPECIALIZATION_MEDIA.replace('{id}', params.id);
      case 'pvp-seasons-index':
        return endpoints.PVP_SEASONS_INDEX;
      case 'reputation-factions-index':
        return endpoints.REPUTATION_FACTIONS_INDEX;
      case 'wow-token-index':
        return endpoints.WOW_TOKEN_INDEX;
      default:
        throw new Error(`Unknown game data type: ${dataType}`);
    }
  }

  /**
   * Build profile endpoint URL
   * @param {string} profileType - Type of profile data
   * @param {Object} params - Parameters for endpoint building
   * @returns {string} Endpoint URL
   */
  buildProfileEndpoint(profileType, params = {}) {
    const endpoints = API_ENDPOINTS.WOW_PROFILE;
    
    switch (profileType) {
      case 'user':
        return endpoints.USER_PROFILE;
      case 'protected-profile':
        return endpoints.PROTECTED_PROFILE
          .replace('{realmId}', params.realmId)
          .replace('{characterId}', params.characterId);
      case 'character':
        return endpoints.CHARACTER_PROFILE
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-achievements':
        return endpoints.CHARACTER_ACHIEVEMENTS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-appearance':
        return endpoints.CHARACTER_APPEARANCE
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-collections':
        return endpoints.CHARACTER_COLLECTIONS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-collections-mounts':
        return endpoints.CHARACTER_COLLECTIONS_MOUNTS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-collections-pets':
        return endpoints.CHARACTER_COLLECTIONS_PETS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-dungeons':
        return endpoints.CHARACTER_DUNGEONS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-dungeon-season':
        return endpoints.CHARACTER_DUNGEON_SEASON
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName)
          .replace('{seasonId}', params.seasonId);
      case 'character-equipment':
        return endpoints.CHARACTER_EQUIPMENT
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-hunter-pets':
        return endpoints.CHARACTER_HUNTER_PETS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-media':
        return endpoints.CHARACTER_MEDIA
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-professions':
        return endpoints.CHARACTER_PROFESSIONS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-profile-status':
        return endpoints.CHARACTER_PROFILE_STATUS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-pvp-summary':
        return endpoints.CHARACTER_PVP_SUMMARY
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-raids':
        return endpoints.CHARACTER_RAIDS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-reputations':
        return endpoints.CHARACTER_REPUTATIONS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-soulbinds':
        return endpoints.CHARACTER_SOULBINDS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-specializations':
        return endpoints.CHARACTER_SPECIALIZATIONS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-statistics':
        return endpoints.CHARACTER_STATISTICS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-talents':
        return endpoints.CHARACTER_TALENTS
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      case 'character-titles':
        return endpoints.CHARACTER_TITLES
          .replace('{realmSlug}', params.realmSlug)
          .replace('{characterName}', params.characterName);
      default:
        throw new Error(`Unknown profile type: ${profileType}`);
    }
  }

  /**
   * Test the proxy service
   * @param {string} region - Region code
   * @returns {Promise<boolean>} True if proxy is working
   */
  async testProxy(region = 'us') {
    try {
      await this.getGameData('achievements', region);
      return true;
    } catch (error) {
      console.error(`Proxy test failed for region ${region}:`, error.message);
      return false;
    }
  }
}

module.exports = new ProxyService(); 