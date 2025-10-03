import mongoose from "mongoose";

const savedScheduleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String, // Clerk user ID
    required: true,
  },
  createdByEmail: {
    type: String,
    required: true,
  },
  // Snapshot of all students at time of save
  students: {
    type: Array,
    default: [],
  },
  // Snapshot of all coaches at time of save
  coaches: {
    type: Array,
    default: [],
  },
  // Snapshot of schedule at time of save
  schedule: {
    type: Array,
    default: [],
  },
  // List of students that were not assigned
  studentsNotSet: {
    type: Array,
    default: [],
  },
  // Metadata for quick display
  metadata: {
    studentCount: {
      type: Number,
      default: 0,
    },
    coachCount: {
      type: Number,
      default: 0,
    },
    courseCount: {
      type: Number,
      default: 0,
    },
    unassignedCount: {
      type: Number,
      default: 0,
    },
  },
});

const SavedSchedule = mongoose.model("SavedSchedule", savedScheduleSchema);

export default SavedSchedule;
