const REGIONS = {
  us: {
    name: 'Americas',
    locale: 'en_US',
    oauthUrl: 'https://oauth.battle.net/token',
    apiUrl: 'https://us.api.blizzard.com'
  },
  eu: {
    name: 'Europe',
    locale: 'en_GB',
    oauthUrl: 'https://oauth.battle.net/token',
    apiUrl: 'https://eu.api.blizzard.com'
  },
  kr: {
    name: 'Korea',
    locale: 'ko_KR',
    oauthUrl: 'https://oauth.battle.net/token',
    apiUrl: 'https://kr.api.blizzard.com'
  },
  tw: {
    name: 'Taiwan',
    locale: 'zh_TW',
    oauthUrl: 'https://oauth.battle.net/token',
    apiUrl: 'https://tw.api.blizzard.com'
  }
  // (CN omitted)
};

const DEFAULT_REGION = 'us';

/**
 * Get region configuration
 * @param {string} region - Region code (us, eu, apac)
 * @returns {Object} Region configuration
 */
function getRegion(region = DEFAULT_REGION) {
  const normalizedRegion = region.toLowerCase();
  
  if (!REGIONS[normalizedRegion]) {
    throw new Error(`Unsupported region: ${region}. Supported regions: ${Object.keys(REGIONS).join(', ')}`);
  }
  
  return REGIONS[normalizedRegion];
}

/**
 * Get all supported regions
 * @returns {Object} All region configurations
 */
function getAllRegions() {
  return REGIONS;
}

/**
 * Validate if a region is supported
 * @param {string} region - Region code
 * @returns {boolean} True if region is supported
 */
function isValidRegion(region) {
  return REGIONS[region.toLowerCase()] !== undefined;
}

module.exports = {
  REGIONS,
  DEFAULT_REGION,
  getRegion,
  getAllRegions,
  isValidRegion
}; 