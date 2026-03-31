import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
    // Index created via compound indexes below (no field-level index needed)
  },

  // User information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  userEmail: String,
  userRole: {
    type: String,
    enum: ['admin', 'supermod', 'trainer', 'viewer', 'student', 'system'],
    index: true
  },

  // Action details
  action: {
    type: String,
    enum: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS', 'BULK_OPERATION', 'IMPORT'],
    required: true,
    index: true
  },
  resource: {
    type: String,  // 'Student', 'Coach', 'Camp', etc.
    index: true
  },
  resourceId: String,  // ID of affected record

  // Request details
  method: String,  // 'POST', 'PUT', 'DELETE'
  endpoint: String,
  requestBody: mongoose.Schema.Types.Mixed,  // Sanitized

  // Change tracking
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },

  // Client info
  ipAddress: String,
  userAgent: String,

  // Result
  status: {
    type: String,
    enum: ['SUCCESS', 'ERROR', 'DENIED'],
    default: 'SUCCESS',
    index: true
  },
  errorMessage: String,

  // Additional context
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: false  // Using custom timestamp field
});

// Index for common queries
auditLogSchema.index({ timestamp: -1, userId: 1 });
auditLogSchema.index({ timestamp: -1, resource: 1 });
auditLogSchema.index({ timestamp: -1, action: 1 });

// TTL index - auto-delete logs after 2 years (GDPR compliance)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 });

export default mongoose.model('AuditLog', auditLogSchema);
