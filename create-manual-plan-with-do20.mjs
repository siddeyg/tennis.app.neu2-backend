import { MongoClient } from 'mongodb';
import fs from 'fs';

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'tennis-coach';

async function createManualPlanWithDo20() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   CREATING MANUAL OPTIMAL PLAN WITH DONNERSTAG 20          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const db = client.db(DB_NAME);
    const students = await db.collection('students').find({}).toArray();
    const coaches = await db.collection('coaches').find({}).toArray();

    console.log(`📊 Loaded: ${students.length} students, ${coaches.length} coaches\n`);

    // Load existing manual plan as base
    const basePlan = JSON.parse(fs.readFileSync('manual-optimal-plan.json', 'utf8'));

    // Create new manual plan with Donnerstag 20
    const newPlan = {
      metadata: {
        title: "Manual Optimal Plan (With Donnerstag 20:00)",
        created: new Date().toISOString(),
        createdBy: "Manual Planning",
        description: "Hand-crafted optimal schedule with Donnerstag 20:00 for adults who have Do 18/19"
      },
      statistics: {
        totalCourses: 0,
        course4: 0,
        course3: 0,
        course2: 0,
        course1: 0,
        assigned: 0,
        unassigned: 0,
        adultCourses: 0,
        childCourses: 0
      },
      courses: []
    };

    // Helper to find student by ID
    const findStudent = (id) => students.find(s => String(s._id) === String(id));

    // Copy all courses from base plan EXCEPT course 13 (Montag 19 - weiblich-Fortgeschritten)
    // and modify courses 6, 7, 8 to remove the 4 students going to Donnerstag 20

    let courseId = 1;

    basePlan.courses.forEach(course => {
      if (course.id === 13) {
        // SKIP course 13 (Montag 19 - weiblich-Fortgeschritten)
        // These 4 students will go to Donnerstag 20 instead
        console.log(`⏭️  Skipping course ${course.id} (${course.day} ${course.hour}) - moving to Do 20`);
        return;
      }

      if (course.id === 6) {
        // Samstag 11 - Remove Marie Köhler
        console.log(`✂️  Modifying course ${course.id} (${course.day} ${course.hour}) - remove Marie Köhler`);
        const newStudents = course.students.filter(s => s.name !== 'Marie Köhler');
        if (newStudents.length > 0) {
          newPlan.courses.push({
            ...course,
            id: courseId++,
            students: newStudents
          });
        }
        return;
      }

      if (course.id === 7) {
        // Freitag 18 - Remove Kristina Müller and Silke Hoesch
        console.log(`✂️  Modifying course ${course.id} (${course.day} ${course.hour}) - remove Kristina Müller, Silke Hoesch`);
        const newStudents = course.students.filter(s =>
          s.name !== 'Kristina Müller' && s.name !== 'Silke Hoesch'
        );
        if (newStudents.length > 0) {
          newPlan.courses.push({
            ...course,
            id: courseId++,
            students: newStudents
          });
        }
        return;
      }

      if (course.id === 8) {
        // Donnerstag 16 - Remove Friederike Förster
        console.log(`✂️  Modifying course ${course.id} (${course.day} ${course.hour}) - remove Friederike Förster`);
        const newStudents = course.students.filter(s => s.name !== 'Friederike Förster');
        if (newStudents.length > 0) {
          newPlan.courses.push({
            ...course,
            id: courseId++,
            students: newStudents
          });
        }
        return;
      }

      // Copy all other courses as-is
      newPlan.courses.push({
        ...course,
        id: courseId++
      });
    });

    // ADD TWO NEW COURSES at Donnerstag 20:00

    console.log(`\n✨ Creating NEW course at Donnerstag 20 (weiblich-Anfänger mit Grundkenntnissen)`);
    const course1Students = [
      findStudent('68ef85667031d46332aa62f9'), // Friederike Förster
      findStudent('68ef85667031d46332aa62fa'), // Kristina Müller
      findStudent('68ef85667031d46332aa62fc'), // Marie Köhler
      findStudent('68ef85667031d46332aa6305')  // Silke Hoesch
    ].filter(s => s).map(s => ({
      id: String(s._id),
      name: `${s.firstName} ${s.lastName}`,
      gender: s.sex || 'unknown',
      level: s.skillLevel || s.trainigGroup
    }));

    newPlan.courses.push({
      id: courseId++,
      day: "Donnerstag",
      hour: 20,
      groupLabel: "adult_weiblich_Anfänger mit Grundkenntnissen",
      coach: "Helge Padberg",
      students: course1Students
    });

    console.log(`   Students: ${course1Students.map(s => s.name).join(', ')}`);

    console.log(`\n✨ Creating NEW course at Donnerstag 20 (weiblich-Fortgeschritten)`);
    const course2Students = [
      findStudent('68ef85667031d46332aa6303'), // Rebecca Mau
      findStudent('68ef8db8c8b2bc8c5f35f6be'), // Anneke Malinowski
      findStudent('68ef9afac8b2bc8c5f35f8fc'), // Nicole Berg
      findStudent('68ef9b7ec8b2bc8c5f35f937')  // Svenja Gloger
    ].filter(s => s).map(s => ({
      id: String(s._id),
      name: `${s.firstName} ${s.lastName}`,
      gender: s.sex || 'unknown',
      level: s.skillLevel || s.trainigGroup
    }));

    newPlan.courses.push({
      id: courseId++,
      day: "Donnerstag",
      hour: 20,
      groupLabel: "adult_weiblich_Fortgeschritten",
      coach: "Helge Padberg",
      students: course2Students
    });

    console.log(`   Students: ${course2Students.map(s => s.name).join(', ')}`);

    // Calculate statistics
    newPlan.courses.forEach(course => {
      const size = course.students.length;
      newPlan.statistics.totalCourses++;
      newPlan.statistics.assigned += size;

      if (size === 4) newPlan.statistics.course4++;
      else if (size === 3) newPlan.statistics.course3++;
      else if (size === 2) newPlan.statistics.course2++;
      else if (size === 1) newPlan.statistics.course1++;

      if (course.groupLabel.startsWith('adult_')) newPlan.statistics.adultCourses++;
      else newPlan.statistics.childCourses++;
    });

    newPlan.statistics.unassigned = students.length - newPlan.statistics.assigned;

    // Save to file
    fs.writeFileSync('manual-optimal-plan-do20.json', JSON.stringify(newPlan, null, 2));

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   MANUAL PLAN WITH DONNERSTAG 20 - RESULTS                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('📊 STATISTICS:\n');
    console.log(`   Total Students: ${students.length}`);
    console.log(`   Assigned: ${newPlan.statistics.assigned}`);
    console.log(`   Unassigned: ${newPlan.statistics.unassigned}\n`);

    console.log(`   Total Courses: ${newPlan.statistics.totalCourses}\n`);
    console.log(`   4 students: ${newPlan.statistics.course4} courses (${(newPlan.statistics.course4 / newPlan.statistics.totalCourses * 100).toFixed(1)}%) ⭐`);
    console.log(`   3 students: ${newPlan.statistics.course3} courses (${(newPlan.statistics.course3 / newPlan.statistics.totalCourses * 100).toFixed(1)}%)`);
    console.log(`   2 students: ${newPlan.statistics.course2} courses (${(newPlan.statistics.course2 / newPlan.statistics.totalCourses * 100).toFixed(1)}%)`);
    console.log(`   1 student:  ${newPlan.statistics.course1} courses (${(newPlan.statistics.course1 / newPlan.statistics.totalCourses * 100).toFixed(1)}%)\n`);

    const efficiency = ((newPlan.statistics.course3 + newPlan.statistics.course4) / newPlan.statistics.totalCourses * 100).toFixed(1);
    console.log(`   Efficiency: ${efficiency}% courses are 3-4 students\n`);

    console.log(`✅ Saved to: manual-optimal-plan-do20.json\n`);

    // Show Donnerstag 20 courses
    const do20Courses = newPlan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
    console.log('📅 DONNERSTAG 20:00 COURSES:\n');
    do20Courses.forEach(c => {
      console.log(`   ${c.groupLabel}:`);
      c.students.forEach(s => console.log(`      - ${s.name}`));
      console.log();
    });

    // Compare with base plan
    console.log('📊 COMPARISON: Manual Do20 vs Original Manual\n');
    console.log(`                        WITH DO 20    ORIGINAL`);
    console.log(`   Total Courses:            ${String(newPlan.statistics.totalCourses).padStart(2)}        ${String(basePlan.statistics.totalCourses).padStart(2)}`);
    console.log(`   4-student courses:        ${String(newPlan.statistics.course4).padStart(2)}        ${String(basePlan.statistics.course4).padStart(2)}`);
    console.log(`   3-student courses:        ${String(newPlan.statistics.course3).padStart(2)}        ${String(basePlan.statistics.course3).padStart(2)}`);
    console.log(`   2-student courses:        ${String(newPlan.statistics.course2).padStart(2)}        ${String(basePlan.statistics.course2).padStart(2)}`);
    console.log(`   1-student courses:        ${String(newPlan.statistics.course1).padStart(2)}        ${String(basePlan.statistics.course1).padStart(2)}`);
    console.log(`   Efficiency (3-4):     ${efficiency}%     ${((basePlan.statistics.course3 + basePlan.statistics.course4) / basePlan.statistics.totalCourses * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

createManualPlanWithDo20();
