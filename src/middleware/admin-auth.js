const { HTTP_STATUS } = require('../config/constants');

/**
 * Middleware to protect admin routes with API key authentication
 * Validates the presence and correctness of an admin API key
 */
function adminAuthMiddleware(req, res, next) {
  const apiKey = req.headers['x-admin-api-key'];
  
  // Check if API key is present
  if (!apiKey) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: true,
      message: 'Admin API key is required'
    });
  }

  // Validate API key
  const validApiKey = process.env.ADMIN_API_KEY;
  if (!validApiKey) {
    console.error('ADMIN_API_KEY environment variable is not set');
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: 'Server configuration error'
    });
  }

  // Compare API keys using constant-time comparison to prevent timing attacks
  const crypto = require('crypto');
  const isValid = crypto.timingSafeEqual(
    Buffer.from(apiKey),
    Buffer.from(validApiKey)
  );

  if (!isValid) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      error: true,
      message: 'Invalid admin API key'
    });
  }

  next();
}

module.exports = adminAuthMiddleware; 