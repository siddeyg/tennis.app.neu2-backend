import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const StudentPortalUserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  // Personal info (required for registration, used to create Student record)
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
  sex: {
    type: String,
    enum: ['männlich', 'weiblich'],
    required: false  // Allow existing users without this field
  },
  member: {
    type: Boolean,
    required: false,  // Allow existing users without this field
    default: false
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  iban: {
    type: String,
    // Stored encrypted (AES-256-CBC)
    // Required for camp and seasonal training registrations
    trim: true
  },
  // Parent/guardian contact (required for children under 18)
  parentName: {
    type: String,
    trim: true
  },
  parentEmail: {
    type: String,
    lowercase: true,
    trim: true
  },
  parentPhone: {
    type: String,
    trim: true
  },
  profileCompleted: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    default: 'student',
    immutable: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: false  // Will be linked when first seasonal registration is submitted
  },
  familyMembers: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student'
    },
    relationship: {
      type: String,
      enum: ['child', 'spouse', 'self']
    },
    name: String,  // Keep for backward compatibility
    firstName: {
      type: String,
      trim: true
    },
    lastName: {
      type: String,
      trim: true
    },
    birthdate: Date,
    sex: {
      type: String,
      enum: ['männlich', 'weiblich']
    },
    member: {
      type: Boolean,
      default: false
    },
    mitgliedsstatus: {
      type: String,
      enum: ['Mitglied', 'Nicht-Mitglied', 'Schnupperkind', null],
      default: null
    },
    phone: {
      type: String,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  verificationTokenExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  // Pending email change (Option A: verify before activating)
  pendingEmail: {
    type: String,
    lowercase: true,
    trim: true,
    default: null
  },
  emailChangeToken: String,
  emailChangeTokenExpires: Date,
  lastLogin: Date,
  lastActivity: {
    type: Date,
    index: true  // Index for efficient queries in monitoring
  },
  preferences: {
    emailNotifications: {
      type: Boolean,
      default: true
    },
    pushNotifications: {
      type: Boolean,
      default: false
    },
    language: {
      type: String,
      default: 'de'
    }
  }
}, {
  timestamps: true
});

// Password hashing middleware
StudentPortalUserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Password comparison method
StudentPortalUserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if user is a child (under 18 years old)
StudentPortalUserSchema.methods.isChild = function() {
  if (!this.birthdate) return false;
  const today = new Date();
  const birthDate = new Date(this.birthdate);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age < 18;
};

// Strip sensitive fields from JSON responses
StudentPortalUserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.verificationToken;
  delete user.verificationTokenExpires;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.emailChangeToken;
  return user;
};

// Email index created by `unique: true` constraint (no explicit index needed)

// Token lookup indexes (queried on every verification/reset/email-change link click)
StudentPortalUserSchema.index({ verificationToken: 1 });
StudentPortalUserSchema.index({ passwordResetToken: 1 });
StudentPortalUserSchema.index({ emailChangeToken: 1 });
// Family member studentId lookup (used when linking child registrations to Student records)
StudentPortalUserSchema.index({ 'familyMembers.studentId': 1 });

const StudentPortalUser = mongoose.model('StudentPortalUser', StudentPortalUserSchema);
export default StudentPortalUser;
