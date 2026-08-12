import mongoose from 'mongoose';

/**
 * RegistrationPeriod Schema
 *
 * Manages seasonal training registration periods (Winter/Summer).
 * Admins create periods with flexible dates and form configurations.
 * Only one period can be active at a time.
 */
const registrationPeriodSchema = new mongoose.Schema(
  {
    // Period identification
    name: {
      type: String,
      required: true,
      trim: true,
      // Example: "Wintertraining 2025/26"
    },

    season: {
      type: String,
      required: true,
      enum: ['winter', 'summer'],
    },

    // Important dates
    trainingStartDate: {
      type: Date,
      required: true,
      // Example: 2025-10-27
    },

    trainingEndDate: {
      type: Date,
      required: true,
      // Example: 2026-03-28
    },

    registrationDeadline: {
      type: Date,
      required: true,
      // Example: 2025-10-10
    },

    // Registration status
    status: {
      type: String,
      required: true,
      enum: ['draft', 'open', 'closed', 'archived'],
      default: 'draft',
    },

    // Only one period can be active at a time
    isActive: {
      type: Boolean,
      default: false,
    },

    cancellationEnabled: {
      type: Boolean,
      default: true,
    },

    // Whether the final training plan has been published to students
    schedulePublished: {
      type: Boolean,
      default: false,
    },

    // Link to current training plan
    currentPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedSchedule',
      required: false,  // Nullable until plan is created
      index: true,
    },

    // Training schedule: which hours/venues are offered each day
    // Used by the student portal registration form (AvailableTimesSelector)
    trainingSlots: [
      {
        day: {
          type: String,
          enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        },
        hour: {
          type: Number, // integer, e.g. 10, 14, 15, 16
        },
        venues: [
          {
            type: String, // e.g. 'BTHV', 'Brüser Berg', 'Röttgen' — empty array for summer
          },
        ],
      },
    ],

    // Training schedule for adults (supports string-based hours like "15:00 - 16:30")
    trainingSlotsAdults: [
      {
        day: {
          type: String,
          enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        },
        hour: {
          type: String, // e.g. "15:00 - 16:30" or "10:00"
        },
        venues: [
          {
            type: String, 
          },
        ],
      },
    ],

    // Pre-computed holidays (set once by admin via POST /:id/compute-holidays)
    computedHolidays: [{
      date: { type: Date, required: true },
      name: { type: String, required: true },
    }],
    holidaysComputedAt: { type: Date, default: null },

    // Admin-defined custom non-training days (tournaments, court maintenance, etc.)
    trainingExclusions: [{
      date:   { type: Date,   required: true },
      reason: { type: String, required: true, trim: true, maxlength: 100 },
      affectedSlots: [{
        day:  { type: String, enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] },
        hour: { type: Number },
      }],
    }],

    // Form configuration for kids
    kidsFormConfig: {
      enabledFields: {
        type: [String],
        default: [
          'mitgliedsstatus',
          'trainingsart',
          'trainingshäufigkeit',
          'sessionDuration',
          'teamParticipation',
          'availableTimes',
          'sepaMandate',
          'accountHolder',
          'iban',
          'privacyConsent',
          'remarks',
        ],
      },
      requiredFields: {
        type: [String],
        default: [
          'mitgliedsstatus',
          'trainingsart',
          'trainingshäufigkeit',
          'availableTimes',
          'privacyConsent',
        ],
      },
    },

    // Form configuration for adults
    adultsFormConfig: {
      enabledFields: {
        type: [String],
        default: [
          'spielstärke',
          'trainingGoals',
          'groupSize',
          'sessionDuration',
          'availableTimes',
          'sepaMandate',
          'accountHolder',
          'iban',
          'privacyConsent',
          'remarks',
        ],
      },
      requiredFields: {
        type: [String],
        default: [
          'spielstärke',
          'availableTimes',
          'privacyConsent',
        ],
      },
    },

    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    toJSON: { virtuals: true }, // Include virtual fields when converting to JSON
    toObject: { virtuals: true }, // Include virtual fields when converting to object
  }
);

// Indexes
registrationPeriodSchema.index({ status: 1, isActive: 1 });
registrationPeriodSchema.index({ season: 1, trainingStartDate: -1 });

// Virtual: Count of submissions (excludes cancelled)
registrationPeriodSchema.virtual('submissionsCount', {
  ref: 'SeasonalRegistration',
  localField: '_id',
  foreignField: 'periodId',
  match: { status: { $ne: 'cancelled' } },
  count: true,
});

// Virtual: Count of pending submissions
registrationPeriodSchema.virtual('pendingSubmissionsCount', {
  ref: 'SeasonalRegistration',
  localField: '_id',
  foreignField: 'periodId',
  match: { status: 'pending' },
  count: true,
});

// Virtual: Count of kids submissions (excludes cancelled)
registrationPeriodSchema.virtual('kidsSubmissionsCount', {
  ref: 'SeasonalRegistration',
  localField: '_id',
  foreignField: 'periodId',
  match: { formType: 'kids', status: { $ne: 'cancelled' } },
  count: true,
});

// Virtual: Count of adults submissions (excludes cancelled)
registrationPeriodSchema.virtual('adultsSubmissionsCount', {
  ref: 'SeasonalRegistration',
  localField: '_id',
  foreignField: 'periodId',
  match: { formType: 'adults', status: { $ne: 'cancelled' } },
  count: true,
});

// Virtual: Current training plan
registrationPeriodSchema.virtual('currentPlan', {
  ref: 'SavedSchedule',
  localField: 'currentPlanId',
  foreignField: '_id',
  justOne: true,
});

// Ensure only one active period at a time
registrationPeriodSchema.pre('save', async function (next) {
  if (this.isActive && this.isModified('isActive')) {
    // Deactivate all other periods
    await mongoose.model('RegistrationPeriod').updateMany(
      { _id: { $ne: this._id }, isActive: true },
      { isActive: false }
    );
  }
  next();
});

// Auto-open registration when status changes to 'open' + validate plan exists
registrationPeriodSchema.pre('save', function (next) {
  if (this.status === 'open' && this.isModified('status')) {
    // Validation: Cannot open registration without linked training plan
    if (!this.currentPlanId) {
      const error = new Error('Cannot open registration period without a linked training plan. Please create a plan first.');
      return next(error);
    }
    this.isActive = true;
  }
  next();
});

const RegistrationPeriod = mongoose.model('RegistrationPeriod', registrationPeriodSchema);

export default RegistrationPeriod;
