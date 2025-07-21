const axios = require('axios');
const { getRegion } = require('../../config/regions');
const { getAccessToken } = require('./auth');

/**
 * Blizzard API client for making authenticated requests
 */
class BlizzardClient {
  constructor() {
    this.defaultTimeout = 10000; // 10 seconds
  }

  /**
   * Get the correct namespace for an endpoint
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   * @returns {string} Namespace
   */
  getNamespace(endpoint, region) {
    // Static data endpoints (game data that doesn't change often)
    const staticEndpoints = [
      '/data/wow/achievement/index',
      '/data/wow/playable-class/index',
      '/data/wow/playable-race/index',
      '/data/wow/playable-specialization/index',
      '/data/wow/item-class/index',
      '/data/wow/item-set/index',
      '/data/wow/mount/index',
      '/data/wow/pet/index',
      '/data/wow/profession/index',
      '/data/wow/talent/index',
      '/data/wow/reputation-faction/index',
      '/data/wow/achievement-category/index',
      '/data/wow/talent-tree/index',
      '/data/wow/reputation-tiers/index',
      '/data/wow/keystone-affix/index'
    ];
    
    // Dynamic data endpoints (data that changes frequently)
    const dynamicEndpoints = [
      '/data/wow/token/index',
      '/data/wow/realm/index',
      '/data/wow/pvp-season/index',
      '/data/wow/mythic-keystone/index',
      '/data/wow/mythic-keystone/dungeon/index',
      '/data/wow/mythic-keystone/period/index',
      '/data/wow/mythic-keystone/season/index',
      '/data/wow/connected-realm/11/mythic-leaderboard/index'
    ];
    
    // Check for exact matches first
    if (staticEndpoints.includes(endpoint)) {
      return `static-${region}`;
    } else if (dynamicEndpoints.includes(endpoint)) {
      return `dynamic-${region}`;
    }
    
    if (endpoint.startsWith('/profile/wow/character/')) {
      return `profile-${region}`;
    }
    if (endpoint.startsWith('/data/wow/search/media')) {
      return `static-${region}`;
    }
    if (endpoint.startsWith('/data/wow/connected-realm/')) {
      return `dynamic-${region}`;
    }
    if (endpoint.startsWith('/data/wow/search/connected-realm')) {
      return `dynamic-${region}`;
    }
    if (endpoint.startsWith('/data/wow/playable-class/') || 
        endpoint.startsWith('/data/wow/media/playable-class/') ||
        endpoint.startsWith('/data/wow/playable-race/') ||
        endpoint.startsWith('/data/wow/playable-specialization/') ||
        endpoint.startsWith('/data/wow/media/playable-specialization/') ||
        endpoint.startsWith('/data/wow/spell/') ||
        endpoint.startsWith('/data/wow/media/spell/') ||
        endpoint.startsWith('/data/wow/search/spell') ||
        endpoint.startsWith('/data/wow/talent-tree/') ||
        endpoint.startsWith('/data/wow/talent-tree/index') ||
        endpoint.startsWith('/data/wow/talent/') ||
        endpoint.startsWith('/data/wow/pvp-talent/') ||
        endpoint.startsWith('/data/wow/tech-talent-tree/') ||
        endpoint.startsWith('/data/wow/tech-talent-tree/index') ||
        endpoint.startsWith('/data/wow/tech-talent/') ||
        endpoint.startsWith('/data/wow/media/tech-talent/')) {
      return `static-${region}`;
    }
    
    // Default to dynamic for unknown endpoints
    return `dynamic-${region}`;
  }

  /**
   * Make an authenticated request to Blizzard API
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, region = 'us', options = {}) {
    try {
      const regionConfig = getRegion(region);
      let accessToken;
      // Use user access token for /profile/ endpoints
      if (endpoint.startsWith('/profile/')) {
        accessToken = global.LAST_USER_ACCESS_TOKEN || process.env.BLIZZARD_USER_ACCESS_TOKEN;
        if (!accessToken) throw new Error('No user access token set. Please login via /auth/blizzard/login');
      } else {
        accessToken = await getAccessToken(region);
      }
      
      const url = `${regionConfig.apiUrl}${endpoint}`;
      
      const config = {
        method: options.method || 'GET',
        url,
        timeout: options.timeout || this.defaultTimeout,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        },
        params: {
          locale: regionConfig.locale,
          namespace: this.getNamespace(endpoint, region), // Use correct namespace
          ...options.params
        }
      };

      // Add request body for POST/PUT requests
      if (options.data && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
        config.data = options.data;
      }

      const response = await axios(config);
      
      return {
        data: response.data,
        status: response.status,
        headers: response.headers,
        region: region,
        endpoint: endpoint
      };
    } catch (error) {
      this.handleError(error, endpoint, region);
    }
  }

  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async get(endpoint, region = 'us', params = {}) {
    return this.request(endpoint, region, { params });
  }

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   * @param {Object} data - Request body
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async post(endpoint, region = 'us', data = {}, params = {}) {
    return this.request(endpoint, region, {
      method: 'POST',
      data,
      params
    });
  }

  /**
   * Handle API errors
   * @param {Error} error - Axios error
   * @param {string} endpoint - API endpoint
   * @param {string} region - Region code
   */
  handleError(error, endpoint, region) {
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          throw new Error(`Bad request for endpoint ${endpoint} in region ${region}: ${data.detail || 'Invalid request'}`);
        case 401:
          throw new Error(`Unauthorized for endpoint ${endpoint} in region ${region}: ${data.detail || 'Invalid credentials'}`);
        case 403:
          throw new Error(`Forbidden for endpoint ${endpoint} in region ${region}: ${data.detail || 'Access denied'}`);
        case 404:
          throw new Error(`Not found for endpoint ${endpoint} in region ${region}: ${data.detail || 'Resource not found'}`);
        case 429:
          throw new Error(`Rate limited for endpoint ${endpoint} in region ${region}: ${data.detail || 'Too many requests'}`);
        case 500:
          throw new Error(`Server error for endpoint ${endpoint} in region ${region}: ${data.detail || 'Internal server error'}`);
        case 503:
          throw new Error(`Service unavailable for endpoint ${endpoint} in region ${region}: ${data.detail || 'Service temporarily unavailable'}`);
        default:
          throw new Error(`HTTP ${status} error for endpoint ${endpoint} in region ${region}: ${data.detail || 'Unknown error'}`);
      }
    } else if (error.request) {
      // Request was made but no response received
      throw new Error(`No response received for endpoint ${endpoint} in region ${region}: ${error.message}`);
    } else {
      // Something else happened
      throw new Error(`Request failed for endpoint ${endpoint} in region ${region}: ${error.message}`);
    }
  }

  /**
   * Test the API connection
   * @param {string} region - Region code
   * @returns {Promise<boolean>} True if connection is successful
   */
  async testConnection(region = 'us') {
    try {
      await this.get('/data/wow/achievement/index', region);
      return true;
    } catch (error) {
      console.error(`Connection test failed for region ${region}:`, error.message);
      return false;
    }
  }
}

module.exports = new BlizzardClient();