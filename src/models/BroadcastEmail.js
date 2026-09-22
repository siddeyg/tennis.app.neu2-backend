import mongoose from 'mongoose';

/**
 * BroadcastEmail Model
 *
 * Represents bulk emails / newsletters sent to student portal users.
 * Supports granular recipient delivery tracking, attachments, and crash recovery.
 */
const recipientSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentPortalUser',
    required: false
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },
  error: {
    type: String,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  }
}, { _id: true });

const broadcastAttachmentSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    default: 'application/pdf'
  },
  size: {
    type: Number,
    default: 0
  },
  path: {
    type: String,
    required: false
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: false
  },
  source: {
    type: String,
    enum: ['upload', 'document'],
    default: 'upload'
  }
}, { _id: true });

const broadcastEmailSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  contentHtml: {
    type: String,
    required: true
  },
  contentText: {
    type: String,
    required: true
  },
  targetAudience: {
    type: String,
    enum: ['all', 'adults', 'children'],
    default: 'all'
  },
  recipients: [recipientSchema],
  attachments: [broadcastAttachmentSchema],
  senderAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  sentCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'sending', 'cancelled', 'interrupted', 'completed', 'failed'],
    default: 'draft'
  },
  testSentAt: {
    type: Date,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for listing history efficiently
broadcastEmailSchema.index({ createdAt: -1 });
broadcastEmailSchema.index({ status: 1 });

const BroadcastEmail = mongoose.model('BroadcastEmail', broadcastEmailSchema);

export default BroadcastEmail;
