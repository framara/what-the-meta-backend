const rateLimit = require('express-rate-limit');
const { RATE_LIMIT_CONFIG } = require('../config/constants');

// Create rate limiter middleware
const limiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.WINDOW_MS,
  max: RATE_LIMIT_CONFIG.MAX_REQUESTS,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: Math.ceil(RATE_LIMIT_CONFIG.WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(RATE_LIMIT_CONFIG.WINDOW_MS / 1000)
    });
  }
});

module.exports = limiter; 