const { isValidRegion, DEFAULT_REGION } = require('../config/regions');

/**
 * Middleware to validate and extract region parameter
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function validateRegion(req, res, next) {
  const region = req.query.region || DEFAULT_REGION;
  
  if (!isValidRegion(region)) {
    return res.status(400).json({
      error: 'Invalid region',
      message: `Region '${region}' is not supported. Supported regions: us, eu, kr, tw`,
      supportedRegions: ['us', 'eu', 'kr', 'tw']
    });
  }
  
  // Normalize region to lowercase and add to request
  req.region = region.toLowerCase();
  next();
}

module.exports = validateRegion; 