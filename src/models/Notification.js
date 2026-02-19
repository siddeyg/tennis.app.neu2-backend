import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentPortalUser',
    required: true,
    index: true  // Index for efficient user-specific queries
  },
  type: {
    type: String,
    enum: [
      'schedule_change',
      'support_ticket_reply',
      'registration_approved',
      'announcement',
      'absence_reported',
      'course_cancelled',
      'payment_reminder'
    ],
    required: true,
    index: true  // Index for filtering by type
  },
  title: {
    type: String,
    required: true,
    maxlength: 100,
    trim: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 500,
    trim: true
  },
  actionUrl: {
    type: String,
    trim: true
    // Optional deep link (e.g., "/schedule", "/support-tickets/123")
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
    index: true  // Index for priority filtering
  },
  read: {
    type: Boolean,
    default: false,
    index: true  // Index for efficient unread queries
  },
  readAt: {
    type: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
    // Flexible field for additional context (e.g., ticketId, scheduleId, etc.)
  },
  expiresAt: {
    type: Date
    // TTL index created via schema-level .index() below
  }
}, {
  timestamps: true  // Adds createdAt and updatedAt
});

// Compound index for efficient user + read status queries (most common)
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// Compound index for user + type queries
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 });

// TTL index - automatically delete notifications after expiresAt date
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to set default expiration (90 days from now)
NotificationSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);
    this.expiresAt = ninetyDaysFromNow;
  }
  next();
});

// Method to mark notification as read
NotificationSchema.methods.markAsRead = async function() {
  if (!this.read) {
    this.read = true;
    this.readAt = new Date();
    return await this.save();
  }
  return this;
};

// Static method to get unread count for a user
NotificationSchema.statics.getUnreadCount = async function(userId) {
  return await this.countDocuments({ userId, read: false });
};

// Static method to mark all notifications as read for a user
NotificationSchema.statics.markAllAsRead = async function(userId) {
  const now = new Date();
  const result = await this.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: now } }
  );
  return result.modifiedCount;
};

const Notification = mongoose.model('Notification', NotificationSchema);
export default Notification;
