const { HTTP_STATUS } = require('../config/constants');

/**
 * Error handling middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Default error response
  let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = HTTP_STATUS.UNAUTHORIZED;
    message = 'Unauthorized access';
  } else if (err.message && err.message.includes('region')) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    message = err.message;
  } else if (err.message && err.message.includes('endpoint')) {
    statusCode = HTTP_STATUS.NOT_FOUND;
    message = err.message;
  } else if (err.message && err.message.includes('rate limited')) {
    statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;
    message = err.message;
  } else if (err.message && err.message.includes('service unavailable')) {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    message = err.message;
  }

  // Send error response
  res.status(statusCode).json({
    error: true,
    message: message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = errorHandler; 