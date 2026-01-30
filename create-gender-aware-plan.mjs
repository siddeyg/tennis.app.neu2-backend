import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';
import SavedSchedule from './src/models/SavedSchedule.js';
import fs from 'fs';

async function createGenderAwareOptimalPlan() {
  try {
    await mongoose.connect('mongodb://localhost:27017/tennis-coach');
    console.log('Connected to MongoDB');

    const students = await Student.find({});
    const coaches = await Coach.find({});

    console.log('\n=== Creating Gender-Aware Optimal Plan ===\n');
    console.log(`Total Students: ${students.length}`);
    console.log(`Adults: ${students.filter(s => s.adult).length}`);
    console.log(`Children: ${students.filter(s => !s.adult).length}\n`);

    // Group students by category AND gender for adults
    const categories = {};

    students.forEach(student => {
      let key;
      if (student.adult) {
        // For adults: category includes gender
        const gender = student.sex || 'unknown';
        key = `Adult_${gender}_${student.skillLevel}`;
      } else {
        // For children: no gender separation
        key = `Child_${student.trainigGroup}`;
      }

      if (!categories[key]) {
        categories[key] = [];
      }
      categories[key].push(student);
    });

    console.log('=== Student Categories (with gender for adults) ===\n');

    let totalPossibleFullCourses = 0;
    let totalRemainder = 0;

    Object.keys(categories).sort().forEach(key => {
      const students = categories[key];
      const count = students.length;
      const full4 = Math.floor(count / 4);
      const remainder = count % 4;

      totalPossibleFullCourses += full4;
      totalRemainder += remainder;

      console.log(`${key}: ${count} students`);
      console.log(`  → ${full4} full 4-student courses possible`);
      if (remainder > 0) {
        console.log(`  → ${remainder} students remainder`);
      }

      // Find best time slot for this group
      const timeSlots = {};
      students.forEach(student => {
        (student.availableTimes || []).forEach(time => {
          if (!timeSlots[time]) timeSlots[time] = 0;
          timeSlots[time]++;
        });
      });

      const sorted = Object.entries(timeSlots)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);

      if (sorted.length > 0) {
        console.log('  Best time slots:');
        sorted.forEach(([time, count]) => {
          const canMake = Math.floor(count / 4);
          console.log(`    ${time}: ${count} students (${canMake} full courses)`);
        });
      }
      console.log('');
    });

    console.log(`\n=== THEORETICAL MAXIMUM (with gender matching) ===`);
    console.log(`Maximum possible 4-student courses: ${totalPossibleFullCourses}`);
    console.log(`Students requiring smaller courses: ${totalRemainder}`);
    console.log(`Comparison: WITHOUT gender: 24 courses | WITH gender: ${totalPossibleFullCourses} courses\n`);

    // Run the actual algorithm from create-optimal-plan.mjs
    // (This will use the existing Fill-First algorithm which may NOT respect gender yet)

    console.log('=== Running Current Algorithm ===\n');
    console.log('⚠️  NOTE: Current algorithm may NOT respect gender matching for adults\n');

    await mongoose.disconnect();

    // Return analysis data
    return {
      totalStudents: students.length,
      adults: students.filter(s => s.adult).length,
      children: students.filter(s => !s.adult).length,
      theoreticalMaxWithGender: totalPossibleFullCourses,
      theoreticalMaxWithoutGender: 24,
      categories: categories
    };

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

const analysis = await createGenderAwareOptimalPlan();

console.log('\n✅ Gender-aware analysis complete!');
console.log('\nNext steps:');
console.log('1. Run current algorithm: node create-optimal-plan.mjs');
console.log('2. Check for gender violations in output');
console.log('3. Implement gender matching in resetScheduleOptimized.js if needed');

process.exit(0);
