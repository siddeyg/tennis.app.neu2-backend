import mongoose from 'mongoose';

/**
 * SeasonalRegistration Schema
 *
 * Stores student seasonal training registrations (Winter/Summer).
 * Students submit preferences for training type, available times, and payment info.
 * Separate fields for kids vs adults forms.
 */
const seasonalRegistrationSchema = new mongoose.Schema(
  {
    // Links
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegistrationPeriod',
      required: true,
    },

    studentPortalUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentPortalUser',
      required: true,
    },

    // Optional: Links to specific child in parent's familyMembers array
    // If null, registration is for the portal user themselves
    familyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },

    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      // May be null if student not yet in main system
    },

    // Form type
    formType: {
      type: String,
      required: true,
      enum: ['kids', 'adults'],
    },

    // Basic info (auto-filled from Student Portal)
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    birthdate: {
      type: Date,
      required: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: false,
      trim: true,
    },

    address: {
      type: String,
      required: false,
      trim: true,
    },

    // ========================================
    // KIDS-SPECIFIC FIELDS
    // ========================================

    mitgliedsstatus: {
      type: String,
      enum: ['Mitglied', 'Nicht-Mitglied/Schnupperkind', null],
    },

    trainingsart: {
      type: String,
      enum: [
        'Kindergarten (ca. 4-6 Jahre)',
        'KIDS-ROT (ca. 6-8 Jahre)',
        'KIDS-ORANGE (ca. 8-10 Jahre)',
        'KIDS-GRÜN (ca. 10-12 Jahre)',
        'Jugend HOBBY (Gelb)',
        'Jugend TEAM (Gelb)',
        null,
      ],
    },

    trainingshäufigkeit: {
      type: String,
      enum: ['1x pro Woche', '2x pro Woche', null],
    },

    teamParticipation: {
      type: String,
      // Dropdown value: Team name or "-"
    },

    // Available times for kids (checkboxes per day)
    availableTimesKids: [
      {
        day: {
          type: String,
          enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        },
        hour: {
          type: Number, // 14, 15, 16, 17, 18, 19, 20
        },
        venue: {
          type: String, // "BTHV", "Brüser Berg", "Röttgen"
        },
      },
    ],

    // ========================================
    // ADULTS-SPECIFIC FIELDS
    // ========================================

    spielstärke: {
      type: String,
      enum: [
        'Anfänger',
        'Anfänger mit Grundkenntnissen',
        'Fortgeschrittene',
        'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
        'Leistungsspieler:innen / Turnierspieler:innen',
        null,
      ],
    },

    // Multi-select checkboxes
    trainingGoals: {
      type: [String],
      enum: ['Freizeit', 'Fitness', 'Turniere', 'Mannschaft'],
    },

    // Multi-select checkboxes
    groupSize: {
      type: [String],
      enum: ['Einzeltraining', 'zu zweit', 'zu dritt', 'zu viert', 'Mannschaftstraining'],
    },

    // Available times for adults (more complex than kids)
    availableTimesAdults: [
      {
        day: {
          type: String,
          enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        },
        hour: {
          type: String, // "10:00", "11:00", "15:00 - 16:30 (Duisdorf)", etc.
        },
        venue: {
          type: String, // "BTHV (Teppich)", "BTHV (Traglufthalle)", "BB", "Duisdorf", "Röttgen"
        },
      },
    ],

    // ========================================
    // SEPA PAYMENT (for kids, optional for adults)
    // ========================================

    sepaMandate: {
      type: Boolean,
      default: false,
    },

    accountHolder: {
      type: String,
      trim: true,
    },

    iban: {
      type: String,
      // Stored encrypted (AES-256)
      trim: true,
    },

    // ========================================
    // PRIVACY & REMARKS
    // ========================================

    privacyConsent: {
      type: Boolean,
      required: true,
      // Must be true to submit
    },

    remarks: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    // ========================================
    // STATUS TRACKING
    // ========================================

    status: {
      type: String,
      required: true,
      enum: ['pending', 'processed'],
      default: 'pending',
    },

    processedAt: {
      type: Date,
    },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Indexes
seasonalRegistrationSchema.index({ periodId: 1, status: 1 });
seasonalRegistrationSchema.index({ email: 1, periodId: 1 });
seasonalRegistrationSchema.index({ formType: 1, status: 1 });

// Ensure only one active registration per student per period
// Includes familyMemberId to allow multiple children per parent per period
seasonalRegistrationSchema.index(
  { studentPortalUserId: 1, periodId: 1, familyMemberId: 1 },
  { unique: true, sparse: true }
);

// Virtual: Full name
seasonalRegistrationSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual: Available times count
seasonalRegistrationSchema.virtual('availableTimesCount').get(function () {
  if (this.formType === 'kids') {
    return this.availableTimesKids ? this.availableTimesKids.length : 0;
  } else {
    return this.availableTimesAdults ? this.availableTimesAdults.length : 0;
  }
});

// Method: Check if minimum available times requirement met (5 times)
seasonalRegistrationSchema.methods.hasMinimumAvailableTimes = function () {
  return this.availableTimesCount >= 5;
};

const SeasonalRegistration = mongoose.model('SeasonalRegistration', seasonalRegistrationSchema);

export default SeasonalRegistration;
