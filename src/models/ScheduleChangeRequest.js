import mongoose from 'mongoose';

/**
 * ScheduleChangeRequest Model
 *
 * Allows students to request changes to their training schedule.
 * Admins review and approve/reject requests.
 *
 * Request Types:
 * - add: Request to add a new training slot
 * - remove: Request to remove an existing training slot
 * - change: Request to change an existing slot to different day/time
 */

const ScheduleChangeRequestSchema = new mongoose.Schema(
  {
    // Student who made the request
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },

    // Portal user who submitted the request
    portalUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentPortalUser',
      required: true
    },

    // Request type
    requestType: {
      type: String,
      enum: ['add', 'remove', 'change'],
      required: true
    },

    // Current slot (for remove/change requests)
    currentSlot: {
      day: {
        type: String,
        enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
      },
      hour: {
        type: Number,
        min: 10,
        max: 21
      },
      coach: String
    },

    // Requested new slot (for add/change requests)
    requestedSlot: {
      day: {
        type: String,
        enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
      },
      hour: {
        type: Number,
        min: 10,
        max: 21
      },
      preferredCoach: String // Optional: student can request specific coach
    },

    // Reason for request
    reason: {
      type: String,
      required: true,
      maxlength: 500
    },

    // Request status
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },

    // Admin response
    adminResponse: {
      type: String,
      maxlength: 500
    },

    // Admin who reviewed the request
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    // Review date
    reviewedAt: {
      type: Date
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// Index for efficient queries
ScheduleChangeRequestSchema.index({ studentId: 1, status: 1 });
ScheduleChangeRequestSchema.index({ status: 1, createdAt: -1 });

// Virtual to check if request is still pending
ScheduleChangeRequestSchema.virtual('isPending').get(function() {
  return this.status === 'pending';
});

// Virtual to format request type in German
ScheduleChangeRequestSchema.virtual('requestTypeGerman').get(function() {
  const types = {
    add: 'Neue Trainingszeit hinzufügen',
    remove: 'Trainingszeit entfernen',
    change: 'Trainingszeit ändern'
  };
  return types[this.requestType] || this.requestType;
});

// Validate that currentSlot is provided for remove/change requests
ScheduleChangeRequestSchema.pre('validate', function(next) {
  if (this.requestType === 'remove' || this.requestType === 'change') {
    if (!this.currentSlot || !this.currentSlot.day || this.currentSlot.hour === undefined) {
      return next(new Error('Aktueller Trainingsslot ist erforderlich für Entfernen/Ändern'));
    }
  }
  next();
});

// Validate that requestedSlot is provided for add/change requests
ScheduleChangeRequestSchema.pre('validate', function(next) {
  if (this.requestType === 'add' || this.requestType === 'change') {
    if (!this.requestedSlot || !this.requestedSlot.day || this.requestedSlot.hour === undefined) {
      return next(new Error('Gewünschter Trainingsslot ist erforderlich für Hinzufügen/Ändern'));
    }
  }
  next();
});

// Method to approve request
ScheduleChangeRequestSchema.methods.approve = async function(adminId, response) {
  this.status = 'approved';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminResponse = response;
  return this.save();
};

// Method to reject request
ScheduleChangeRequestSchema.methods.reject = async function(adminId, response) {
  this.status = 'rejected';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminResponse = response;
  return this.save();
};

const ScheduleChangeRequest = mongoose.model('ScheduleChangeRequest', ScheduleChangeRequestSchema);

export default ScheduleChangeRequest;
