const axios = require('axios');
const { getRegion } = require('../../config/regions');

/**
 * Battle.net OAuth client for OAuth-specific endpoints
 */
class BattleNetOAuthClient {
  constructor() {
    this.defaultTimeout = 10000; // 10 seconds
  }

  /**
   * Get OAuth base URL for region
   * @param {string} region - Region code
   * @returns {string} OAuth base URL
   */
  getOAuthBaseUrl(region) {
    if (region === 'cn') {
      return 'https://oauth.battlenet.com.cn';
    }
    return `https://oauth.battle.net`;
  }

  /**
   * Make an OAuth request to Battle.net
   * @param {string} endpoint - OAuth endpoint
   * @param {string} region - Region code
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, region = 'us', options = {}) {
    try {
      const baseUrl = this.getOAuthBaseUrl(region);
      const url = `${baseUrl}${endpoint}`;
      
      const config = {
        method: options.method || 'GET',
        url,
        timeout: options.timeout || this.defaultTimeout,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        params: options.params || {}
      };

      // Add request body for POST requests
      if (options.data && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
        config.data = options.data;
      }

      // Add Basic Auth for client credentials
      if (options.useClientAuth) {
        const credentials = Buffer.from(`${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`).toString('base64');
        config.headers['Authorization'] = `Basic ${credentials}`;
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
   * @param {string} endpoint - OAuth endpoint
   * @param {string} region - Region code
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async get(endpoint, region = 'us', params = {}, options = {}) {
    return this.request(endpoint, region, { params, ...options });
  }

  /**
   * Make a POST request
   * @param {string} endpoint - OAuth endpoint
   * @param {string} region - Region code
   * @param {Object} data - Request body
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async post(endpoint, region = 'us', data = {}, params = {}, options = {}) {
    return this.request(endpoint, region, {
      method: 'POST',
      data,
      params,
      ...options
    });
  }

  /**
   * Get client credentials token
   * @param {string} region - Region code
   * @returns {Promise<Object>} Token response
   */
  async getClientCredentialsToken(region = 'us') {
    // Client credentials grant requires form-encoded body and Basic auth
    return this.post(
      '/oauth/token',
      region,
      'grant_type=client_credentials',
      {},
      { useClientAuth: true }
    );
  }

  /**
   * Get user info
   * @param {string} accessToken - Access token
   * @param {string} region - Region code
   * @returns {Promise<Object>} User info response
   */
  async getUserInfo(accessToken, region = 'us') {
    return this.get(
      '/oauth/userinfo',
      region,
      {},
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
  }

  /**
   * Check token validity
   * @param {string} token - Token to check
   * @param {string} region - Region code
   * @returns {Promise<Object>} Token validation response
   */
  async checkToken(token, region = 'us') {
    // Token introspection requires client auth and form-encoded body
    return this.post(
      '/oauth/check_token',
      region,
      `token=${encodeURIComponent(token)}`,
      {},
      { useClientAuth: true }
    );
  }

  /**
   * Handle API errors
   * @param {Error} error - Axios error
   * @param {string} endpoint - OAuth endpoint
   * @param {string} region - Region code
   */
  handleError(error, endpoint, region) {
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          throw new Error(`Bad request for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Invalid request'}`);
        case 401:
          throw new Error(`Unauthorized for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Invalid credentials'}`);
        case 403:
          throw new Error(`Forbidden for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Access denied'}`);
        case 404:
          throw new Error(`Not found for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Resource not found'}`);
        case 429:
          throw new Error(`Rate limited for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Too many requests'}`);
        case 500:
          throw new Error(`Server error for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Internal server error'}`);
        case 503:
          throw new Error(`Service unavailable for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Service temporarily unavailable'}`);
        default:
          throw new Error(`HTTP ${status} error for OAuth endpoint ${endpoint} in region ${region}: ${data.detail || 'Unknown error'}`);
      }
    } else if (error.request) {
      // Request was made but no response received
      throw new Error(`No response received for OAuth endpoint ${endpoint} in region ${region}: ${error.message}`);
    } else {
      // Something else happened
      throw new Error(`Request failed for OAuth endpoint ${endpoint} in region ${region}: ${error.message}`);
    }
  }
}

module.exports = new BattleNetOAuthClient(); 