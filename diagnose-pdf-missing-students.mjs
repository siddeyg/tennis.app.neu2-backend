#!/usr/bin/env node

/**
 * Diagnostic script to find why students appear in Schedule UI but not in PDF export
 *
 * Compares the logic used by:
 * - Schedule UI (calculateStudentsInCells from utils.js)
 * - PDF Export (getStudentAssignmentAt from exportSchedulePDF.js)
 *
 * Reports which students are missing and why.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.development') });

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false, collection: 'students' }));

const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const hours = Array.from({ length: 12 }, (_, i) => 10 + i);

// Schedule UI logic (from utils.js calculateStudentsInCells)
function scheduleUILogic(student, day, hour) {
  if (!student) return false;

  // Check if student has assignments array (new format)
  if (Array.isArray(student.assignments) && student.assignments.length > 0) {
    return student.assignments.some((assignment) => {
      return (
        String(assignment.day).trim() === String(day).trim() &&
        Number(assignment.hour) === hour
      );
    });
  }

  // Fall back to legacy fields (old format) for backward compatibility
  if (String(student.day).trim() !== String(day).trim()) return false;
  const sHour = student.hour === null || student.hour === undefined ? null : Number(student.hour);
  return sHour === hour;
}

// PDF Export logic (from exportSchedulePDF.js getStudentAssignmentAt)
function pdfExportLogic(student, day, hour) {
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

async function diagnose() {
  try {
    console.log('🔍 Diagnosing PDF Export Missing Students Bug\n');
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected\n');

    const students = await Student.find().lean();
    console.log(`📊 Total students in DB: ${students.length}\n`);

    let totalUISlots = 0;
    let totalPDFSlots = 0;
    const missingStudents = [];
    const extraStudents = [];

    // Check every day/hour combination
    for (const day of days) {
      for (const hour of hours) {
        const uiStudents = [];
        const pdfStudents = [];

        for (const student of students) {
          const inUI = scheduleUILogic(student, day, hour);
          const inPDF = pdfExportLogic(student, day, hour).isAssigned;

          if (inUI) {
            uiStudents.push(student);
            totalUISlots++;
          }
          if (inPDF) {
            pdfStudents.push(student);
            totalPDFSlots++;
          }

          // Mismatch detection
          if (inUI && !inPDF) {
            missingStudents.push({
              student: `${student.firstName} ${student.lastName}`,
              day,
              hour,
              assignments: student.assignments,
              legacyDay: student.day,
              legacyHour: student.hour,
              legacyCoach: student.coach
            });
          }

          if (!inUI && inPDF) {
            extraStudents.push({
              student: `${student.firstName} ${student.lastName}`,
              day,
              hour,
              assignments: student.assignments,
              legacyDay: student.day,
              legacyHour: student.hour,
              legacyCoach: student.coach
            });
          }
        }
      }
    }

    console.log('📈 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total student slots in Schedule UI: ${totalUISlots}`);
    console.log(`Total student slots in PDF Export:  ${totalPDFSlots}`);
    console.log(`Difference: ${totalUISlots - totalPDFSlots}\n`);

    if (missingStudents.length > 0) {
      console.log('❌ STUDENTS MISSING FROM PDF (appear in UI but not PDF):');
      console.log('='.repeat(80));
      missingStudents.forEach((entry, idx) => {
        console.log(`\n${idx + 1}. ${entry.student} - ${entry.day} ${entry.hour}:00`);
        console.log(`   assignments array: ${JSON.stringify(entry.assignments)}`);
        console.log(`   legacy fields: day="${entry.legacyDay}", hour=${entry.legacyHour}, coach="${entry.legacyCoach}"`);

        // Diagnose WHY
        if (Array.isArray(entry.assignments) && entry.assignments.length > 0) {
          const hasMatchInArray = entry.assignments.some(a =>
            String(a.day).trim() === entry.day && Number(a.hour) === entry.hour
          );
          if (!hasMatchInArray && entry.legacyDay === entry.day && Number(entry.legacyHour) === entry.hour) {
            console.log(`   🔴 BUG: Has non-empty assignments array, but assignment is NOT in array.`);
            console.log(`   🔴 Legacy fields match this slot, but PDF skips legacy check!`);
          }
        }
      });
      console.log('\n');
    } else {
      console.log('✅ No students missing from PDF\n');
    }

    if (extraStudents.length > 0) {
      console.log('⚠️  STUDENTS EXTRA IN PDF (appear in PDF but not UI):');
      console.log('='.repeat(80));
      extraStudents.forEach((entry, idx) => {
        console.log(`\n${idx + 1}. ${entry.student} - ${entry.day} ${entry.hour}:00`);
        console.log(`   assignments array: ${JSON.stringify(entry.assignments)}`);
        console.log(`   legacy fields: day="${entry.legacyDay}", hour=${entry.legacyHour}, coach="${entry.legacyCoach}"`);
      });
      console.log('\n');
    } else {
      console.log('✅ No extra students in PDF\n');
    }

    if (missingStudents.length === 0 && extraStudents.length === 0) {
      console.log('🎉 PDF export and Schedule UI are 100% synchronized!\n');
    } else {
      console.log('⚠️  Found data integrity issue between PDF and UI\n');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

diagnose();
