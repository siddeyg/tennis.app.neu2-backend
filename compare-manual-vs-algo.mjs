import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';

async function analyzeAlgorithmPotential() {
  try {
    await mongoose.connect('mongodb://localhost:27017/tennis-coach');
    console.log('Connected to MongoDB');

    const students = await Student.find({});
    const coaches = await Coach.find({});

    console.log('\n=== ALGORITHM POTENTIAL ANALYSIS ===\n');

    // Group students by category
    const categories = {};

    students.forEach(student => {
      const key = student.adult
        ? `Adult_${student.skillLevel}`
        : `Child_${student.trainigGroup}`;

      if (!categories[key]) {
        categories[key] = [];
      }
      categories[key].push(student);
    });

    console.log('Student Categories:');
    Object.keys(categories).sort().forEach(key => {
      const students = categories[key];
      const count = students.length;
      const full4 = Math.floor(count / 4);
      const remainder = count % 4;

      console.log(`\n${key}: ${count} students`);
      console.log(`  → Can make ${full4} full 4-student courses`);
      if (remainder > 0) {
        console.log(`  → ${remainder} students left over (need ${4 - remainder} more or smaller course)`);
      }

      // Find best time slot for this group
      const timeSlots = {};
      students.forEach(student => {
        student.availableTimes.forEach(time => {
          if (!timeSlots[time]) timeSlots[time] = 0;
          timeSlots[time]++;
        });
      });

      const sorted = Object.entries(timeSlots)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      console.log('  Best time slots:');
      sorted.forEach(([time, count]) => {
        const canMake = Math.floor(count / 4);
        console.log(`    ${time}: ${count} students (${canMake} full courses possible)`);
      });
    });

    console.log('\n=== THEORETICAL MAXIMUM ===\n');

    let totalFull4 = 0;
    let totalRemainder = 0;

    Object.entries(categories).forEach(([key, students]) => {
      const full4 = Math.floor(students.length / 4);
      const remainder = students.length % 4;
      totalFull4 += full4;
      totalRemainder += remainder;
    });

    console.log(`Maximum possible 4-student courses: ${totalFull4}`);
    console.log(`Students requiring smaller courses: ${totalRemainder}`);
    console.log(`Best case scenario: ${totalFull4} x 4-student + ${Math.ceil(totalRemainder / 3)} x 3-student + ${totalRemainder % 3} x smaller`);

    console.log('\n=== COACH CAPACITY CONSTRAINT ===\n');

    coaches.forEach(coach => {
      const slots = coach.availableTimes.length;
      const canTeach = coach.isCoachingChildren ? 'Children' : '';
      const canTeachAdult = coach.isCoachingAdult ? 'Adults' : '';
      console.log(`${coach.firstName} ${coach.lastName}:`);
      console.log(`  Available slots: ${slots}`);
      console.log(`  Can teach: ${canTeachAdult} ${canTeach}`);
      console.log(`  Max students (if all 4-student courses): ${slots * 4}`);
    });

    const totalCoachSlots = coaches.reduce((sum, c) => sum + c.availableTimes.length, 0);
    console.log(`\nTotal coach slots: ${totalCoachSlots}`);
    console.log(`Total students: ${students.length}`);
    console.log(`Coach capacity for 4-student courses: ${totalCoachSlots * 4} students`);
    console.log(`Utilization needed: ${(students.length / (totalCoachSlots * 4) * 100).toFixed(1)}%`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyzeAlgorithmPotential();
