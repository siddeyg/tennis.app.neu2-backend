import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { setSocketIO } from '../utils/notificationHelpers.js';

/**
 * Initialize Socket.io server for real-time notifications
 *
 * @param {Object} httpServer - HTTP server instance
 * @param {Object} corsOptions - CORS configuration (reuse from Express)
 * @returns {Object} Socket.io server instance
 */
export function initializeNotificationSocket(httpServer, corsOptions) {
  // Check if notifications are enabled via environment variable
  if (process.env.ENABLE_NOTIFICATIONS !== 'true') {
    logger.info('⏸️  Real-time notifications disabled (ENABLE_NOTIFICATIONS=false)');
    return null;
  }

  logger.info('🔌 Initializing Socket.io for real-time notifications...');

  const io = new Server(httpServer, {
    cors: {
      origin: corsOptions.origin,
      credentials: true,
      methods: ['GET', 'POST']
    },
    // Connection settings
    pingTimeout: 60000,  // 60 seconds
    pingInterval: 25000, // 25 seconds
    // Namespace for notifications
    path: '/socket.io'
  });

  // JWT authentication middleware for Socket.io
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        logger.warn(`Socket connection rejected: No token provided (socket ID: ${socket.id})`);
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if this is a student portal user (not admin/coach)
      if (decoded.role !== 'student') {
        logger.warn(`Socket connection rejected: Invalid role ${decoded.role} (socket ID: ${socket.id})`);
        return next(new Error('Authentication error: Invalid user role'));
      }

      // Attach user info to socket
      socket.userId = decoded.id;
      socket.userRole = decoded.role;

      logger.debug(`Socket authenticated for user ${socket.userId} (socket ID: ${socket.id})`);
      next();
    } catch (error) {
      logger.error(`Socket authentication failed: ${error.message} (socket ID: ${socket.id})`);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Connection event handler
  io.on('connection', (socket) => {
    logger.info(`✅ Socket connected: User ${socket.userId} (socket ID: ${socket.id})`);

    // Join user-specific room for targeted notifications
    const userRoom = `user:${socket.userId}`;
    socket.join(userRoom);
    logger.debug(`User ${socket.userId} joined room: ${userRoom}`);

    // Emit connection success
    socket.emit('connection:success', {
      message: 'Connected to notification server',
      userId: socket.userId
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`❌ Socket disconnected: User ${socket.userId} (reason: ${reason})`);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${socket.userId}: ${error.message}`);
    });

    // Optional: Handle client-side ping for connection monitoring
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
  });

  // Set the Socket.io instance in notification helpers
  setSocketIO(io);

  logger.info('✅ Socket.io server initialized successfully');

  return io;
}

/**
 * Gracefully close Socket.io server
 *
 * @param {Object} io - Socket.io server instance
 */
export function closeNotificationSocket(io) {
  if (io) {
    logger.info('Closing Socket.io server...');
    io.close(() => {
      logger.info('Socket.io server closed');
    });
  }
}
