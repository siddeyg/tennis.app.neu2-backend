import logger from '../utils/logger.js';
import { sendAlert } from '../utils/alertService.js';

/**
 * Global error handler middleware
 * Sanitizes error messages to prevent information leakage in production
 * Logs full error details for debugging
 */
const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Log the full error with stack trace (server-side only)
  logger.error(`${err.message}\n${err.stack}`);
  logger.error(`Request: ${req.method} ${req.originalUrl}`);
  logger.error(`IP: ${req.ip}`);
  logger.error(`User: ${req.user ? req.user.id : 'unauthenticated'}`);

  // Alert on unexpected 500s (not on client errors like 400/401/403)
  if (statusCode >= 500) {
    sendAlert(
      `🚨 500 — ${req.method} ${req.path}`,
      err.message || 'Unexpected server error'
    );
  }

  // Prepare error response
  const errorResponse = {
    error: isProduction
      ? 'An error occurred. Please try again later.'
      : err.message,
    statusCode,
  };

  // In development, include stack trace
  if (!isProduction) {
    errorResponse.stack = err.stack;
    errorResponse.details = err;
  }

  // Send sanitized error to client
  res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper
 * Catches errors in async route handlers and passes to error handler
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default errorHandler;
