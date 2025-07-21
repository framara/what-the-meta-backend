const axios = require('axios');
const { getRegion } = require('../../config/regions');
const { CACHE_CONFIG } = require('../../config/constants');

// Simple in-memory cache for tokens
const tokenCache = new Map();

/**
 * Get OAuth token for a specific region
 * @param {string} region - Region code
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(region = 'us') {
  try {
    const regionConfig = getRegion(region);
    const cacheKey = `token_${region}`;
    
    // Check if we have a cached token that's still valid
    const cachedToken = tokenCache.get(cacheKey);
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.token;
    }
    
    // Get new token from Blizzard using client_credentials (no scope)
    const response = await axios.post(regionConfig.oauthUrl, 'grant_type=client_credentials', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`).toString('base64')}`
      }
    });
    
    const { access_token, expires_in } = response.data;
    
    // Cache the token with expiration
    const expiresAt = Date.now() + (expires_in * 1000) - 60000; // Subtract 1 minute for safety
    tokenCache.set(cacheKey, {
      token: access_token,
      expiresAt
    });
    
    // Clean up old cache entries if cache is too large
    if (tokenCache.size > CACHE_CONFIG.MAX_CACHE_SIZE) {
      const oldestKey = tokenCache.keys().next().value;
      tokenCache.delete(oldestKey);
    }
    
    return access_token;
  } catch (error) {
    console.error('Error getting access token:', error.message);
    throw new Error(`Failed to get access token for region ${region}: ${error.message}`);
  }
}

/**
 * Clear token cache for a specific region or all regions
 * @param {string} region - Region code (optional, clears all if not specified)
 */
function clearTokenCache(region = null) {
  if (region) {
    const cacheKey = `token_${region}`;
    tokenCache.delete(cacheKey);
  } else {
    tokenCache.clear();
  }
}

/**
 * Get cached token info for debugging
 * @param {string} region - Region code
 * @returns {Object|null} Token info or null if not cached
 */
function getCachedTokenInfo(region = 'us') {
  const cacheKey = `token_${region}`;
  const cached = tokenCache.get(cacheKey);
  
  if (!cached) {
    return null;
  }
  
  return {
    hasToken: true,
    expiresAt: cached.expiresAt,
    isExpired: cached.expiresAt <= Date.now(),
    timeUntilExpiry: cached.expiresAt - Date.now()
  };
}

function getUserAccessToken() {
  // For now, just return the env variable (in real app, use session or DB)
  const token = process.env.BLIZZARD_USER_ACCESS_TOKEN;
  if (!token) throw new Error('No user access token set in BLIZZARD_USER_ACCESS_TOKEN');
  return token;
}

module.exports = {
  getAccessToken,
  clearTokenCache,
  getCachedTokenInfo,
  getUserAccessToken
}; 