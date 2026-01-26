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
  phone: {
    type: String,
    trim: true
  },
  address: {
    type: String,
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
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student'
    },
    relationship: {
      type: String,
      enum: ['child', 'spouse', 'self']
    },
    name: String
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
  lastLogin: Date,
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

const StudentPortalUser = mongoose.model('StudentPortalUser', StudentPortalUserSchema);
export default StudentPortalUser;
