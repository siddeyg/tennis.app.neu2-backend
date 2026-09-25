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

const targetCriteriaSchema = new mongoose.Schema({
  // Saisontraining
  periodId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RegistrationPeriod',
    default: null
  },
  formType: {
    type: String,
    enum: ['kids', 'adults', 'all'],
    default: 'all'
  },
  talentinosGroup: {
    type: String,
    enum: ['all', 'kindergarten_rot', 'orange_gruen', 'gelb', 'team_gelb_u15', null],
    default: null
  },
  // Camps & Events
  campId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Camp',
    default: null
  },
  // Wochentag & Halle (Zuweisungen)
  day: {
    type: String,
    enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag', null],
    default: null
  },
  venue: {
    type: String,
    trim: true,
    default: null
  },
  // Direktansprache spezifischer Nutzer oder Schüler
  specificUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentPortalUser'
  }],
  specificStudentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }]
}, { _id: false });

const broadcastEmailSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: function() { return this.status !== 'draft'; },
    trim: true,
    maxlength: 300,
    default: ''
  },
  contentHtml: {
    type: String,
    required: function() { return this.status !== 'draft'; },
    default: ''
  },
  contentText: {
    type: String,
    required: function() { return this.status !== 'draft'; },
    default: ''
  },
  // Legacy / Basic Audience Filter (used when targetingType === 'global')
  targetAudience: {
    type: String,
    enum: ['all', 'adults', 'children'],
    default: 'all'
  },
  // 5 Granular Targeting Modes
  targetingType: {
    type: String,
    enum: ['global', 'seasonal', 'camp', 'day_venue', 'custom'],
    default: 'global'
  },
  targetCriteria: {
    type: targetCriteriaSchema,
    default: () => ({})
  },
  // Cross-Channel: Zeitgleich Pinnwand-Ankündigung im Schüler-Portal erstellen
  publishToNoticeboard: {
    type: Boolean,
    default: false
  },
  createdAnnouncementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Announcement',
    default: null
  },
  // Vorlagen-Unterstützung (Templates)
  isTemplate: {
    type: Boolean,
    default: false
  },
  templateTitle: {
    type: String,
    trim: true,
    default: null
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

// Index for listing history & filtering efficiently
broadcastEmailSchema.index({ createdAt: -1 });
broadcastEmailSchema.index({ status: 1 });
broadcastEmailSchema.index({ isTemplate: 1 });
broadcastEmailSchema.index({ targetingType: 1 });

const BroadcastEmail = mongoose.model('BroadcastEmail', broadcastEmailSchema);

export default BroadcastEmail;
