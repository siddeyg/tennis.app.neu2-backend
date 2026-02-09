import mongoose from 'mongoose';

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
    required: true
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
supportTicketSchema.index({ ticketNumber: 1 });

// Auto-increment ticket number
supportTicketSchema.pre('save', async function(next) {
  if (this.isNew) {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findOneAndUpdate(
      { _id: 'supportTicketNumber' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.ticketNumber = counter.seq;
  }
  next();
});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
export default SupportTicket;
