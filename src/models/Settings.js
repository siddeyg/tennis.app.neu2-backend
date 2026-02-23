import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema({
  // Singleton pattern - only one settings document
  singleton: {
    type: Boolean,
    default: true,
    unique: true
  },

  // Course Capacity Settings
  courseCapacity: {
    defaultMaxStudents: {
      type: Number,
      default: 4,
      min: 1,
      max: 10
    },
    capacityByGroup: {
      Kinderland: { type: Number, default: 6 },
      Rot: { type: Number, default: 4 },
      Orange: { type: Number, default: 4 },
      Grün: { type: Number, default: 4 },
      'Gelb Team': { type: Number, default: 3 },
      'Gelb Hobby': { type: Number, default: 4 },
      Erwachsene: { type: Number, default: 4 }
    },
    minStudentsToRun: {
      type: Number,
      default: 1,
      min: 1,
      max: 5
    }
  },

  // Time Range Settings
  timeRanges: {
    students: {
      startHour: {
        type: Number,
        default: 10,
        min: 6,
        max: 23
      },
      endHour: {
        type: Number,
        default: 21,
        min: 6,
        max: 23
      }
    },
    coaches: {
      startHour: {
        type: Number,
        default: 10,
        min: 6,
        max: 23
      },
      endHour: {
        type: Number,
        default: 21,
        min: 6,
        max: 23
      }
    }
  },

  // Portal Registration Settings
  portalRegistrationEnabled: {
    type: Boolean,
    default: true
  },

  // Registration Notification Emails (optional)
  notificationEmails: {
    email1: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Bitte geben Sie eine gültige E-Mail-Adresse ein']
    },
    email2: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Bitte geben Sie eine gültige E-Mail-Adresse ein']
    },
    email3: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Bitte geben Sie eine gültige E-Mail-Adresse ein']
    }
  },

  // Schedule Notification Tracking
  lastBulkScheduleNotification: {
    sentAt: { type: Date, default: null },
    sentCount: { type: Number, default: 0 },
    sentBy: { type: String, default: null }
  },

  // Support Ticket Reply Templates
  supportTicketTemplates: [
    {
      label: { type: String, required: true, maxlength: 20 },
      text:  { type: String, required: true, maxlength: 2000 }
    }
  ],

  lastModified: {
    type: Date,
    default: Date.now
  }
});

// Ensure only one settings document exists
settingsSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Settings').countDocuments();
    if (count > 0) {
      throw new Error('Settings document already exists');
    }
  }
  this.lastModified = new Date();
  next();
});

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
