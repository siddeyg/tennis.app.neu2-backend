import mongoose from 'mongoose';

/**
 * EmailLog Model
 *
 * Immutable audit trail for all outgoing notification emails sent to students and parents.
 * Preserves proof of delivery, recipient address, assignments snapshot, and admin attribution.
 */
const emailLogSchema = new mongoose.Schema(
  {
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      index: true
    },
    studentName: {
      type: String,
      required: true,
      trim: true
    },
    portalUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentPortalUser',
      index: true
    },
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegistrationPeriod',
      index: true
    },
    periodName: {
      type: String,
      default: ''
    },

    subject: {
      type: String,
      required: true
    },
    templateType: {
      type: String,
      default: 'schedule_notification',
      index: true
    },
    category: {
      type: String,
      enum: ['notification', 'auth', 'broadcast'],
      default: 'notification'
    },

    status: {
      type: String,
      enum: ['sent', 'failed', 'simulated'],
      required: true,
      index: true
    },
    messageId: {
      type: String,
      default: null
    },
    errorMessage: {
      type: String,
      default: null
    },

    sentAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    sentBy: {
      type: String,
      default: 'admin'
    },
    triggerType: {
      type: String,
      enum: ['single', 'slot', 'bulk'],
      required: true
    },

    assignmentsSummary: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for performant audit queries and student histories
emailLogSchema.index({ periodId: 1, sentAt: -1 });
emailLogSchema.index({ studentId: 1, sentAt: -1 });
emailLogSchema.index({ recipientEmail: 1, sentAt: -1 });

const EmailLog = mongoose.model('EmailLog', emailLogSchema);

export default EmailLog;
