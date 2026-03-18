import mongoose from 'mongoose';

/**
 * Attendance Model
 *
 * Tracks student attendance for training sessions.
 * Used by coaches to mark who attended each session.
 * Students can view their attendance history.
 */

const AttendanceSchema = new mongoose.Schema(
  {
    // Date of the training session
    courseDate: {
      type: Date,
      required: true
    },

    // Day and time of the session
    day: {
      type: String,
      enum: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
      required: true
    },

    hour: {
      type: Number,
      min: 10,
      max: 21.5,  // Allow .5 for half-hour start times (e.g., 17.5 = 17:30)
      required: true
    },

    // Session duration in minutes
    duration: {
      type: Number,
      default: 60,
      enum: [60, 90]
    },

    // Coach who led the session
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // References User model (role: 'trainer')
      required: true
    },

    // Student attendance records for this session
    students: [{
      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
      },
      status: {
        type: String,
        enum: ['present', 'absent', 'absent_notified', 'excused'],
        required: true
      },
      notes: {
        type: String,
        maxlength: 200
      }
    }],

    // Who marked the attendance (coach or admin)
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    markedAt: {
      type: Date,
      default: Date.now
    },

    // Last edit tracking
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    editedAt: {
      type: Date
    },

    // Session notes (weather, special events, etc.)
    sessionNotes: {
      type: String,
      maxlength: 500
    }
  },
  {
    timestamps: true
  }
);

// Compound index for unique session identification
AttendanceSchema.index({ courseDate: 1, day: 1, hour: 1, coach: 1 }, { unique: true });

// Index for student queries
AttendanceSchema.index({ 'students.studentId': 1, courseDate: -1 });

// Index for coach queries
AttendanceSchema.index({ coach: 1, courseDate: -1 });

// Virtual to get attendance statistics for the session
AttendanceSchema.virtual('statistics').get(function() {
  const total = this.students.length;
  const present = this.students.filter(s => s.status === 'present').length;
  const absent = this.students.filter(s => s.status === 'absent').length;
  const absentNotified = this.students.filter(s => s.status === 'absent_notified').length;
  const excused = this.students.filter(s => s.status === 'excused').length;

  return {
    total,
    present,
    absent,
    absentNotified,
    excused,
    presentPercentage: total > 0 ? Math.round((present / total) * 100) : 0
  };
});

/**
 * Check if attendance can be edited by coach (within 2 hours of course end)
 * @param {Date} currentTime - Current timestamp (defaults to now)
 * @returns {Boolean} Whether coach can still edit this attendance
 */
AttendanceSchema.methods.canEditByCoach = function(currentTime = new Date()) {
  const courseDateTime = new Date(this.courseDate);
  courseDateTime.setHours(this.hour, 0, 0, 0);

  // Add course duration + 2 hours for edit window
  const courseDurationHours = (this.duration || 60) / 60;
  const editDeadline = new Date(courseDateTime);
  editDeadline.setHours(editDeadline.getHours() + courseDurationHours + 2);

  return currentTime <= editDeadline;
};

// Static method to get attendance history for a student
AttendanceSchema.statics.getStudentHistory = function(studentId, limit = 50) {
  return this.find({
    'students.studentId': studentId
  })
    .populate('coach', 'firstName lastName')
    .populate('markedBy', 'firstName lastName')
    .sort({ courseDate: -1 })
    .limit(limit)
    .lean()
    .then(sessions => {
      // Extract only this student's status from each session
      return sessions.map(session => {
        const studentRecord = session.students.find(
          s => s.studentId.toString() === studentId.toString()
        );

        return {
          _id: session._id,
          courseDate: session.courseDate,
          day: session.day,
          hour: session.hour,
          coach: session.coach,
          status: studentRecord.status,
          notes: studentRecord.notes,
          markedBy: session.markedBy,
          markedAt: session.markedAt,
          sessionNotes: session.sessionNotes
        };
      });
    });
};

// Static method to get attendance statistics for a student
AttendanceSchema.statics.getStudentStatistics = async function(studentId) {
  const sessions = await this.find({
    'students.studentId': studentId
  }).lean();

  const total = sessions.length;
  const present = sessions.filter(s =>
    s.students.some(st => st.studentId.toString() === studentId.toString() && st.status === 'present')
  ).length;
  const absent = sessions.filter(s =>
    s.students.some(st => st.studentId.toString() === studentId.toString() && st.status === 'absent')
  ).length;
  const excused = sessions.filter(s =>
    s.students.some(st => st.studentId.toString() === studentId.toString() && st.status === 'excused')
  ).length;

  return {
    total,
    present,
    absent,
    excused,
    attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0
  };
};

// Static method to get recent sessions for coach (next/today's sessions)
AttendanceSchema.statics.getTodaySessionsForCoach = function(coachId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return this.find({
    coach: coachId,
    courseDate: {
      $gte: today,
      $lt: tomorrow
    }
  })
    .populate('students.studentId', 'firstName lastName')
    .sort({ hour: 1 })
    .lean();
};

const Attendance = mongoose.model('Attendance', AttendanceSchema);

export default Attendance;
