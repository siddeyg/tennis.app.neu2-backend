#!/usr/bin/env node

/**
 * Diagnostic script to check if coach-specific PDF pages are missing students
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.development') });

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false, collection: 'students' }));
const Coach = mongoose.model('Coach', new mongoose.Schema({}, { strict: false, collection: 'coaches' }));

const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const hours = Array.from({ length: 12 }, (_, i) => 10 + i);

// Helper to find coach by ID or name
function findCoachByIdOrName(coaches, val) {
  if (!val) return null;
  const v = String(val).trim();
  const byId = coaches.find((c) => String(c._id) === v);
  if (byId) return byId;
  return coaches.find((c) => `${c.firstName} ${c.lastName}` === v) || null;
}

// PDF Export logic for coach filtering (from exportSchedulePDF.js lines 434-447)
function pdfCoachFilter(student, coach, coaches) {
  // Check assignments array (new multi-assignment format)
  if (Array.isArray(student.assignments) && student.assignments.length > 0) {
    return student.assignments.some((assignment) => {
      const assignmentCoach = findCoachByIdOrName(coaches, assignment.coach);
      return assignmentCoach && String(assignmentCoach._id) === String(coach._id);
    });
  }

  // Fall back to legacy single assignment field
  if (!student.coach) return false;
  const studentCoach = findCoachByIdOrName(coaches, student.coach);
  return studentCoach && String(studentCoach._id) === String(coach._id);
}

// Get student assignment at specific day/hour
function getStudentAssignmentAt(student, day, hour) {
  // Check assignments array (new multi-assignment format)
  if (Array.isArray(student.assignments) && student.assignments.length > 0) {
    const assignment = student.assignments.find((a) =>
      String(a.day).trim() === String(day).trim() &&
      Number(a.hour) === hour
    );
    if (assignment) {
      return { isAssigned: true, coach: assignment.coach };
    }
    return { isAssigned: false, coach: null };
  }

  // Fall back to legacy single assignment fields
  if (student.day === day && parseInt(student.hour, 10) === hour) {
    return { isAssigned: true, coach: student.coach };
  }

  return { isAssigned: false, coach: null };
}

// UI logic - get coach for student at specific day/hour
function getStudentCoachAtSlot(student, day, hour) {
  // Check assignments array
  if (Array.isArray(student.assignments) && student.assignments.length > 0) {
    const assignment = student.assignments.find((a) =>
      String(a.day).trim() === String(day).trim() &&
      Number(a.hour) === hour
    );
    if (assignment) {
      return assignment.coach;
    }
  }

  // Fall back to legacy
  if (student.day === day && parseInt(student.hour, 10) === hour) {
    return student.coach;
  }

  return null;
}

async function diagnose() {
  try {
    console.log('🔍 Diagnosing Coach-Specific PDF Pages\n');
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected\n');

    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();

    console.log(`📊 Total students: ${students.length}`);
    console.log(`👨‍🏫 Total coaches: ${coaches.length}\n`);

    let totalMissingSlots = 0;

    // Check each coach
    for (const coach of coaches) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Coach: ${coach.firstName} ${coach.lastName}`);
      console.log(`${'='.repeat(80)}`);

      // Filter students for this coach (PDF logic)
      const pdfCoachStudents = students.filter(s => pdfCoachFilter(s, coach, coaches));
      console.log(`Students on coach's PDF page: ${pdfCoachStudents.length}`);

      // Find all slots where students have THIS coach in UI
      let uiCoachSlots = 0;
      let pdfCoachSlots = 0;
      const missingSlots = [];

      for (const day of days) {
        for (const hour of hours) {
          // Find students assigned to this coach at this slot in UI
          const uiStudentsAtSlot = students.filter(s => {
            const assignmentInfo = getStudentAssignmentAt(s, day, hour);
            if (!assignmentInfo.isAssigned) return false;

            const slotCoach = findCoachByIdOrName(coaches, assignmentInfo.coach);
            return slotCoach && String(slotCoach._id) === String(coach._id);
          });

          // Find students at this slot in PDF for this coach
          const pdfStudentsAtSlot = pdfCoachStudents.filter(s => {
            return getStudentAssignmentAt(s, day, hour).isAssigned;
          });

          uiCoachSlots += uiStudentsAtSlot.length;
          pdfCoachSlots += pdfStudentsAtSlot.length;

          // Check for mismatches
          if (uiStudentsAtSlot.length !== pdfStudentsAtSlot.length) {
            const uiNames = uiStudentsAtSlot.map(s => `${s.firstName} ${s.lastName}`);
            const pdfNames = pdfStudentsAtSlot.map(s => `${s.firstName} ${s.lastName}`);
            const missing = uiNames.filter(n => !pdfNames.includes(n));
            const extra = pdfNames.filter(n => !uiNames.includes(n));

            if (missing.length > 0 || extra.length > 0) {
              missingSlots.push({
                day,
                hour,
                uiCount: uiStudentsAtSlot.length,
                pdfCount: pdfStudentsAtSlot.length,
                missing,
                extra
              });
            }
          }
        }
      }

      console.log(`UI shows ${uiCoachSlots} student slots for this coach`);
      console.log(`PDF shows ${pdfCoachSlots} student slots for this coach`);
      console.log(`Difference: ${uiCoachSlots - pdfCoachSlots}`);

      if (missingSlots.length > 0) {
        console.log(`\n❌ MISMATCHES FOUND AT ${missingSlots.length} SLOTS:`);
        missingSlots.forEach((slot, idx) => {
          console.log(`\n  ${idx + 1}. ${slot.day} ${slot.hour}:00`);
          console.log(`     UI: ${slot.uiCount} students, PDF: ${slot.pdfCount} students`);
          if (slot.missing.length > 0) {
            console.log(`     Missing from PDF: ${slot.missing.join(', ')}`);
          }
          if (slot.extra.length > 0) {
            console.log(`     Extra in PDF: ${slot.extra.join(', ')}`);
          }
        });
        totalMissingSlots += missingSlots.length;
      } else {
        console.log(`✅ No mismatches for this coach`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`OVERALL SUMMARY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Total slots with mismatches: ${totalMissingSlots}`);

    if (totalMissingSlots === 0) {
      console.log(`\n🎉 All coach-specific PDF pages are 100% accurate!\n`);
    } else {
      console.log(`\n⚠️  Found data integrity issues in coach-specific PDF pages\n`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

diagnose();
