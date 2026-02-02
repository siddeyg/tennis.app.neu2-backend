import mongoose from 'mongoose';

/**
 * CampRegistration Model
 *
 * Stores camp registrations for students/parents.
 * Links to Camp, StudentPortalUser, and optionally familyMembers.
 */
const campRegistrationSchema = new mongoose.Schema({
  // Links
  campId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Camp',
    required: true,
    index: true
  },
  studentPortalUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentPortalUser',
    required: true,
    index: true
  },
  // Optional: Links to specific child in parent's familyMembers array
  // If null, registration is for the portal user themselves
  familyMemberId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    default: null
  },
  // Optional: Link to Student record (if exists in main system)
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    default: null
  },

  // Participant Information (cached for reporting)
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  birthdate: {
    type: Date,
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },

  // Camp-Specific
  skillLevel: {
    type: String,
    required: true,
    enum: ['beginner', 'intermediate', 'advanced']
  },

  // Emergency Contact (required for children under 18)
  emergencyContactName: {
    type: String,
    trim: true,
    default: ''
  },
  emergencyContactPhone: {
    type: String,
    trim: true,
    default: ''
  },

  // Additional Emergency Contact (optional)
  additionalEmergencyContactName: {
    type: String,
    trim: true,
    default: ''
  },
  additionalEmergencyContactPhone: {
    type: String,
    trim: true,
    default: ''
  },

  // Medical Information (optional)
  medicalNotes: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: ''
  },

  // Status
  status: {
    type: String,
    required: true,
    enum: ['confirmed', 'waitlist', 'cancelled'],
    default: 'confirmed'
  },

  // Metadata
  registeredAt: {
    type: Date,
    default: Date.now
  },
  cancelledAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes
campRegistrationSchema.index({ campId: 1, status: 1 });
campRegistrationSchema.index({ studentPortalUserId: 1, status: 1 });
campRegistrationSchema.index({ campId: 1, registeredAt: 1 }); // For waitlist FIFO

// Unique compound index: Prevents duplicate registrations
// Same person (or child) can't register twice for same camp
campRegistrationSchema.index(
  { campId: 1, studentPortalUserId: 1, familyMemberId: 1 },
  { unique: true }
);

// Virtual: Full name
campRegistrationSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual: Age at time of camp
campRegistrationSchema.virtual('age').get(function() {
  const today = new Date();
  const birthDate = new Date(this.birthdate);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

// Virtual: Check if participant is a child (under 18)
campRegistrationSchema.virtual('isChild').get(function() {
  return this.age < 18;
});

// Pre-save validation: Emergency contact required for children
campRegistrationSchema.pre('save', function(next) {
  if (this.age < 18 && this.status !== 'cancelled') {
    if (!this.emergencyContactName || !this.emergencyContactPhone) {
      return next(new Error('Notfallkontakt ist für Kinder unter 18 Jahren erforderlich'));
    }
  }
  next();
});

// Ensure virtuals are included when converting to JSON
campRegistrationSchema.set('toJSON', { virtuals: true });
campRegistrationSchema.set('toObject', { virtuals: true });

const CampRegistration = mongoose.model('CampRegistration', campRegistrationSchema);
export default CampRegistration;
