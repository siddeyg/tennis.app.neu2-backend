import mongoose from 'mongoose';

/**
 * Absence Model
 *
 * Allows students to notify the club when they cannot attend a training session.
 * This helps coaches plan sessions and track attendance patterns.
 */

const AbsenceSchema = new mongoose.Schema(
  {
    // Student who will be absent
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },

    // Portal user who submitted the absence (parent or student)
    portalUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentPortalUser',
      required: true
    },

    // Training session details
    absenceDate: {
      type: Date,
      required: true
    },

    day: {
      type: String,
      enum: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
      required: true
    },

    hour: {
      type: Number,
      min: 10,
      max: 21,
      required: true
    },

    // Coach for this session (optional, for reference)
    coach: {
      type: String
    },

    // Absence type
    absenceType: {
      type: String,
      enum: ['illness', 'vacation', 'school', 'other'],
      required: true
    },

    // Optional reason/notes
    reason: {
      type: String,
      maxlength: 500
    },

    // Status - for future coach confirmation
    status: {
      type: String,
      enum: ['pending', 'acknowledged', 'cancelled'],
      default: 'pending'
    },

    // Coach acknowledgement
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    acknowledgedAt: {
      type: Date
    },

    // Notes from coach/admin
    adminNotes: {
      type: String,
      maxlength: 500
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// Index for efficient queries
AbsenceSchema.index({ studentId: 1, absenceDate: -1 });
AbsenceSchema.index({ absenceDate: 1, status: 1 });
AbsenceSchema.index({ studentId: 1, status: 1 });

// Virtual to check if absence is in the future
AbsenceSchema.virtual('isFuture').get(function() {
  return this.absenceDate > new Date();
});

// Virtual to check if absence is today
AbsenceSchema.virtual('isToday').get(function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const absDate = new Date(this.absenceDate);
  absDate.setHours(0, 0, 0, 0);
  return absDate.getTime() === today.getTime();
});

// Virtual to format absence type in German
AbsenceSchema.virtual('absenceTypeGerman').get(function() {
  const types = {
    illness: 'Krankheit',
    vacation: 'Urlaub',
    school: 'Schule',
    other: 'Sonstiges'
  };
  return types[this.absenceType] || this.absenceType;
});

// Validate that absence date is not in the past (when creating)
AbsenceSchema.pre('validate', function(next) {
  if (this.isNew) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const absDate = new Date(this.absenceDate);
    absDate.setHours(0, 0, 0, 0);

    if (absDate < now) {
      return next(new Error('Abwesenheit kann nicht für vergangene Termine gemeldet werden'));
    }
  }
  next();
});

// Method to acknowledge absence (coach/admin)
AbsenceSchema.methods.acknowledge = async function(userId, notes) {
  this.status = 'acknowledged';
  this.acknowledgedBy = userId;
  this.acknowledgedAt = new Date();
  if (notes) {
    this.adminNotes = notes;
  }
  return this.save();
};

// Method to cancel absence (if student can attend after all)
AbsenceSchema.methods.cancel = async function() {
  this.status = 'cancelled';
  return this.save();
};

// Static method to get upcoming absences for a student
AbsenceSchema.statics.getUpcomingForStudent = function(studentId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return this.find({
    studentId,
    absenceDate: { $gte: today },
    status: { $in: ['pending', 'acknowledged'] }
  })
    .sort({ absenceDate: 1 })
    .limit(10);
};

// Static method to get absences for a specific date (coach view)
AbsenceSchema.statics.getForDate = function(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    absenceDate: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ['pending', 'acknowledged'] }
  })
    .populate('studentId', 'firstName lastName')
    .sort({ hour: 1 });
};

const Absence = mongoose.model('Absence', AbsenceSchema);

export default Absence;
