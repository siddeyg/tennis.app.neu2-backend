import mongoose from 'mongoose';

/**
 * AuditLog Schema - GDPR Compliance
 *
 * Tracks sensitive operations for audit trail:
 * - User data access (view, edit, delete)
 * - Authentication events (login, logout, password change)
 * - Authorization changes (role changes, permission grants)
 * - Data exports (PDF, CSV)
 * - Admin actions
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Action type
    action: {
      type: String,
      required: true,
      enum: [
        // Authentication
        'LOGIN',
        'LOGOUT',
        'LOGIN_FAILED',
        'PASSWORD_RESET',
        'PASSWORD_CHANGED',
        'EMAIL_VERIFIED',

        // User Management
        'USER_CREATED',
        'USER_UPDATED',
        'USER_DELETED',
        'USER_ACTIVATED',
        'USER_DEACTIVATED',
        'ROLE_CHANGED',

        // Data Access (GDPR)
        'DATA_VIEWED',
        'DATA_EXPORTED',
        'DATA_DELETED',

        // Student Portal
        'STUDENT_REGISTERED',
        'STUDENT_UPDATED',
        'STUDENT_DELETED',
        'SCHEDULE_CHANGED',
        'ABSENCE_CREATED',

        // Coach Portal
        'ATTENDANCE_MARKED',
        'ATTENDANCE_UPDATED',

        // Admin Actions
        'SETTINGS_CHANGED',
        'ANNOUNCEMENT_CREATED',
        'SCHEDULE_REQUEST_APPROVED',
        'SCHEDULE_REQUEST_REJECTED',
      ],
    },

    // Who performed the action
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // User role at time of action
    userRole: {
      type: String,
      required: true,
    },

    // Target of the action (if applicable)
    targetType: {
      type: String,
      enum: ['User', 'Student', 'Coach', 'Attendance', 'Announcement', 'Schedule', 'Settings', null],
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
    },

    // Details of the action
    details: {
      type: mongoose.Schema.Types.Mixed, // Flexible object for action-specific data
      default: {},
    },

    // Request metadata
    ipAddress: {
      type: String,
      required: true,
    },

    userAgent: {
      type: String,
    },

    // Result
    success: {
      type: Boolean,
      default: true,
    },

    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

// Indexes for efficient querying
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ createdAt: -1 }); // For date range queries

// Automatically delete audit logs older than 2 years (GDPR retention limit)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 }); // 2 years in seconds

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
