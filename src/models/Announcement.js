import mongoose from 'mongoose';

/**
 * Announcement Model
 *
 * Represents announcements/news that can be broadcast to students and parents
 * via the student portal. Admins create announcements that students can view
 * in their dashboard.
 */
const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true,
    maxlength: 5000
  },
  targetAudience: {
    type: String,
    enum: ['all', 'adults', 'children'],
    default: 'all'
  },
  priority: {
    type: String,
    enum: ['normal', 'important', 'urgent'],
    default: 'normal'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  publishDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient querying
announcementSchema.index({ isActive: 1, publishDate: -1 });
announcementSchema.index({ expiryDate: 1 });

// Virtual for checking if announcement is currently valid
announcementSchema.virtual('isValid').get(function() {
  const now = new Date();
  return this.isActive &&
         this.publishDate <= now &&
         (!this.expiryDate || this.expiryDate > now);
});

// Ensure virtuals are included when converting to JSON
announcementSchema.set('toJSON', { virtuals: true });
announcementSchema.set('toObject', { virtuals: true });

const Announcement = mongoose.model('Announcement', announcementSchema);
export default Announcement;
