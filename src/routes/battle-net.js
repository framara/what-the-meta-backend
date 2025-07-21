const express = require('express');
const { getAccessToken, getCachedTokenInfo } = require('../services/blizzard/auth');
const { getAllRegions } = require('../config/regions');
const validateRegion = require('../middleware/region');
const proxyService = require('../services/proxy');
const oauthClient = require('../services/blizzard/oauth-client');

const router = express.Router();

/**
 * POST /battle-net/oauth/token
 * Get OAuth token for a specific region (Application Authentication)
 */
router.post('/oauth/token', async (req, res, next) => {
  try {
    const { region } = req;
    const response = await oauthClient.getClientCredentialsToken(region);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /battle-net/oauth/token
 * Get OAuth token info (for debugging - returns our cached token)
 */
router.get('/oauth/token', validateRegion, async (req, res, next) => {
  try {
    const { region } = req;
    
    const token = await getAccessToken(region);
    const tokenInfo = getCachedTokenInfo(region);
    
    res.json({
      success: true,
      region: region,
      token: token,
      tokenInfo: tokenInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /battle-net/oauth/userinfo
 * Get user information for a specific region (User Authentication)
 */
router.get('/oauth/userinfo', async (req, res, next) => {
  try {
    const { region } = req;
    const { access_token } = req.query;
    
    if (!access_token) {
      return res.status(400).json({
        error: true,
        message: 'access_token parameter is required for user info endpoint'
      });
    }
    
    const response = await oauthClient.getUserInfo(access_token, region);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /battle-net/oauth/check_token
 * Validate OAuth token (Token Validation)
 */
router.post('/oauth/check_token', async (req, res, next) => {
  try {
    const { region } = req;
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        error: true,
        message: 'token parameter is required for token validation'
      });
    }
    
    const response = await oauthClient.checkToken(token, region);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /battle-net/oauth/check_token
 * Validate OAuth token (Token Validation)
 */
router.get('/oauth/check_token', async (req, res, next) => {
  try {
    const { region } = req;
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        error: true,
        message: 'token parameter is required for token validation'
      });
    }
    
    const response = await oauthClient.checkToken(token, region);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /battle-net/regions
 * Get all supported regions
 */
router.get('/regions', (req, res) => {
  const regions = getAllRegions();
  
  res.json({
    success: true,
    regions: regions,
    count: Object.keys(regions).length,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /battle-net/health
 * Health check for Battle.net services
 */
router.get('/health', async (req, res, next) => {
  try {
    // Test token generation for US region
    const token = await getAccessToken('us');
    
    res.json({
      status: 'OK',
      service: 'Battle.net OAuth',
      tokenAvailable: !!token,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      service: 'Battle.net OAuth',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 