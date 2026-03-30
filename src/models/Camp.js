import mongoose from 'mongoose';

/**
 * Camp Model
 *
 * Represents tennis camps/workshops with fixed schedules and capacity limits.
 * Simpler than seasonal registration - direct confirmation, no algorithm-based assignment.
 */
const campSchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },
  campType: {
    type: String,
    required: true,
    enum: ['beginner-course', 'intensive-workshop', 'technique-camp', 'other'],
    default: 'other'
  },

  // Fixed Schedule (array of sessions)
  schedule: [{
    day: {
      type: String,
      required: true,
      enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
    },
    startTime: {
      type: String,
      required: true,
      trim: true
      // Format: "10:00"
    },
    endTime: {
      type: String,
      required: true,
      trim: true
      // Format: "13:00"
    }
  }],

  // Date Range
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  registrationOpenDate: {
    type: Date,
    required: true
  },
  registrationCloseDate: {
    type: Date,
    required: true
  },

  // Capacity Management
  maxParticipants: {
    type: Number,
    required: true,
    min: 1,
    default: 20
  },
  currentParticipants: {
    type: Number,
    default: 0,
    min: 0
  },
  waitlistEnabled: {
    type: Boolean,
    default: false
  },
  maxWaitlist: {
    type: Number,
    default: 0,
    min: 0
    // 0 = unlimited waitlist
  },

  // Target Audience
  targetAudience: {
    type: String,
    enum: ['all', 'adults', 'adults_60plus', 'youth', 'children', 'children_youth'],
    default: 'all'
  },
  minAge: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  maxAge: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  skillLevels: [{
    type: String,
    enum: ['beginner', 'intermediate']  // Removed 'advanced'
  }],

  // Player Type (Team vs Hobby)
  playerType: {
    type: String,
    enum: ['all', 'team-only', 'hobby-only'],
    default: 'all'
  },

  // Pricing
  memberPrice: {
    type: Number,
    min: 0,
    default: null
  },
  nonMemberPrice: {
    type: Number,
    min: 0,
    default: null
  },

  // Trainer
  trainerId: {
    type: String,  // String to match Coach _id format
    ref: 'Coach',
    default: null
  },
  trainerName: {
    type: String,
    trim: true,
    default: ''
    // Cached for display
  },

  // Status
  status: {
    type: String,
    required: true,
    enum: ['draft', 'open', 'full', 'closed', 'cancelled', 'completed'],
    default: 'draft'
  },
  cancellationEnabled: {
    type: Boolean,
    default: true
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deletedAt: {
    type: Date,
    default: null
    // Soft delete
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
campSchema.index({ status: 1, startDate: 1 });
campSchema.index({ deletedAt: 1 });
campSchema.index({ registrationOpenDate: 1, registrationCloseDate: 1 });

// Virtual: Check if registration is currently open
campSchema.virtual('isRegistrationOpen').get(function() {
  const now = new Date();
  return this.status === 'open' &&
         this.registrationOpenDate <= now &&
         this.registrationCloseDate >= now &&
         !this.deletedAt;
});

// Virtual: Check if camp is full
campSchema.virtual('isFull').get(function() {
  return this.currentParticipants >= this.maxParticipants;
});

// Virtual: Calculate available spots
campSchema.virtual('spotsRemaining').get(function() {
  const remaining = this.maxParticipants - this.currentParticipants;
  return remaining > 0 ? remaining : 0;
});

// Virtual: Count of confirmed registrations
campSchema.virtual('confirmedRegistrations', {
  ref: 'CampRegistration',
  localField: '_id',
  foreignField: 'campId',
  match: { status: 'confirmed' },
  count: true
});

// Virtual: Count of waitlist registrations
campSchema.virtual('waitlistRegistrations', {
  ref: 'CampRegistration',
  localField: '_id',
  foreignField: 'campId',
  match: { status: 'waitlist' },
  count: true
});

// Pre-save hook: Auto-update status when capacity reached
campSchema.pre('save', function(next) {
  if (this.isModified('currentParticipants')) {
    if (this.currentParticipants >= this.maxParticipants && this.status === 'open') {
      this.status = 'full';
    } else if (this.currentParticipants < this.maxParticipants && this.status === 'full') {
      this.status = 'open';
    }
  }
  next();
});

// Pre-save hook: Validate dates (only when date fields are modified)
campSchema.pre('save', function(next) {
  const datesModified = this.isModified('startDate') || this.isModified('endDate') ||
    this.isModified('registrationOpenDate') || this.isModified('registrationCloseDate');
  if (!datesModified) return next();

  if (this.endDate < this.startDate) {
    return next(new Error('Enddatum muss nach Startdatum liegen'));
  }
  if (this.registrationCloseDate > this.startDate) {
    return next(new Error('Anmeldeschluss muss vor Startdatum liegen'));
  }
  if (this.registrationCloseDate < this.registrationOpenDate) {
    return next(new Error('Anmeldeschluss muss nach Anmeldeöffnung liegen'));
  }
  next();
});

/**
 * Recount active registrations (pending + confirmed + waitlist) from the DB
 * and update currentParticipants. Triggers pre-save hook for open↔full status.
 */
campSchema.statics.refreshParticipantCount = async function(campId) {
  const CampRegistration = mongoose.model('CampRegistration');
  const count = await CampRegistration.countDocuments({
    campId: campId,
    status: { $in: ['pending', 'confirmed', 'waitlist'] }
  });
  const camp = await this.findById(campId);
  if (camp) {
    camp.currentParticipants = count;
    await camp.save();
  }
  return camp;
};

const Camp = mongoose.model('Camp', campSchema);
export default Camp;
