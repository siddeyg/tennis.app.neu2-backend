import mongoose from 'mongoose';
import Counter from './Counter.js';

const messageSchema = new mongoose.Schema({
  senderType: {
    type: String,
    enum: ['admin', 'student'],
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
    // References either User (admin) or StudentPortalUser (student)
  },
  senderName: {
    type: String,
    required: true
    // Cached for display performance
  },
  content: {
    type: String,
    required: true,
    minlength: 1,
    maxlength: 5000
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: mongoose.Schema.Types.ObjectId
}, {
  timestamps: true  // createdAt, updatedAt
});

const supportTicketSchema = new mongoose.Schema({
  // Ticket identification
  ticketNumber: {
    type: Number,
    unique: true,
    required: false  // Set by pre-save hook, not required at validation time
    // Auto-increment: use counter collection
  },

  // Basic info
  subject: {
    type: String,
    required: true,
    trim: true,
    minlength: 5,
    maxlength: 200
  },

  category: {
    type: String,
    enum: ['bug', 'suggestion', 'question', 'technical', 'other'],
    default: 'question'
  },

  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  status: {
    type: String,
    enum: ['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'],
    default: 'open'
  },

  // Creator (student)
  createdBy: {
    studentPortalUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentPortalUser',
      required: true
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student'
      // Optional link to main Student record
    },
    email: String,
    name: String
    // Cached for display
  },

  // Assignment
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
    // Admin who's handling the ticket
  },
  assignedAt: Date,

  // Message thread
  messages: [messageSchema],

  // Message tracking
  lastMessageAt: Date,
  lastMessageFrom: {
    type: String,
    enum: ['admin', 'student']
  },

  // Unread counts
  unreadByAdmin: {
    type: Number,
    default: 0
  },
  unreadByStudent: {
    type: Number,
    default: 0
  },

  // Status history
  statusHistory: [{
    status: String,
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    note: String
  }],

  // Technical metadata
  userAgent: String,
  url: String,

  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }

}, {
  timestamps: true  // createdAt, updatedAt
});

// Indexes for performance
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ 'createdBy.studentPortalUserId': 1, status: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ updatedAt: -1 });
supportTicketSchema.index({ priority: 1, status: 1 });
// ticketNumber index created by `unique: true` constraint (no explicit index needed)

// Text index for search
supportTicketSchema.index({
  subject: 'text',
  'createdBy.name': 'text',
  'createdBy.email': 'text'
}, {
  name: 'ticket_search_text_index',
  weights: {
    subject: 10,
    'createdBy.name': 5,
    'createdBy.email': 5
  }
});

// Unread count indexes
supportTicketSchema.index({ unreadByAdmin: 1, isDeleted: 1 }, {
  name: 'unread_admin_index'
});

supportTicketSchema.index({ unreadByStudent: 1, isDeleted: 1 }, {
  name: 'unread_student_index'
});

// Compound index for student unread queries
supportTicketSchema.index({
  'createdBy.studentPortalUserId': 1,
  unreadByStudent: 1,
  isDeleted: 1
}, {
  name: 'student_unread_index'
});

// Auto-increment ticket number
supportTicketSchema.pre('save', async function(next) {
  // Only generate ticket number for new documents
  if (this.isNew && !this.ticketNumber) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'supportTicketNumber' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, runValidators: false }
      );

      if (!counter || typeof counter.seq !== 'number') {
        const error = new Error(`Counter returned invalid result: ${JSON.stringify(counter)}`);
        console.error('[SupportTicket pre-save] Error:', error);
        return next(error);
      }

      this.ticketNumber = counter.seq;
      next();
    } catch (error) {
      console.error('[SupportTicket pre-save] Error generating ticket number:', error);
      next(error);
    }
  } else {
    next();
  }
});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
export default SupportTicket;
