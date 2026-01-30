import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.development') });

console.log('🔍 Finding Hidden Relations & Patterns\n');

async function analyzeHiddenRelations() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();

    const relations = {
      siblings: [],
      sameTimeSlot: [],
      ageGroups: {},
      memberVsNonMember: { member: [], nonMember: [] },
      emailDomains: {},
      teamVsHobby: { team: [], hobby: [], neither: [] },
      coordinatedPickup: [],
      addressClusters: {},
      frequencePatterns: {},
      availabilityPatterns: {}
    };

    // 1. SIBLING DETECTION (same last name)
    console.log('👨‍👩‍👧‍👦 Analyzing Potential Siblings...\n');
    const lastNames = {};
    for (const student of students) {
      const lastName = student.lastName;
      if (!lastNames[lastName]) {
        lastNames[lastName] = [];
      }
      lastNames[lastName].push({
        name: `${student.firstName} ${student.lastName}`,
        adult: student.adult,
        birthDate: student.birthDate,
        assignments: student.assignments || [],
        email: student.email,
        phone: student.phone
      });
    }

    for (const [lastName, group] of Object.entries(lastNames)) {
      if (group.length > 1) {
        // Check if they have different first names and similar ages (siblings likely)
        const children = group.filter(s => !s.adult);
        if (children.length > 1) {
          relations.siblings.push({
            lastName,
            count: children.length,
            children: children.map(s => s.name),
            assignments: children.map(s => s.assignments),
            sameEmail: children.every(s => s.email === children[0].email),
            samePhone: children.every(s => s.phone === children[0].phone)
          });
        }
      }
    }

    console.log(`Found ${relations.siblings.length} potential sibling groups`);
    relations.siblings.slice(0, 5).forEach(s => {
      console.log(`   ${s.lastName}: ${s.count} children`);
      s.children.forEach(name => console.log(`      - ${name}`));
      if (s.sameEmail || s.samePhone) {
        console.log(`      ✅ Confirmed (same contact info)`);
      }
    });
    console.log();

    // 2. SAME TIME SLOT ANALYSIS (friend groups, intentional grouping)
    console.log('👥 Analyzing Co-Assigned Students (Same Time Slots)...\n');
    const timeSlotGroups = {};
    for (const student of students) {
      if (!student.assignments || student.assignments.length === 0) continue;

      for (const assignment of student.assignments) {
        const key = `${assignment.day}_${assignment.hour}`;
        if (!timeSlotGroups[key]) {
          timeSlotGroups[key] = [];
        }
        timeSlotGroups[key].push({
          name: `${student.firstName} ${student.lastName}`,
          level: student.adult ? student.skillLevel : student.trainigGroup,
          adult: student.adult,
          lastName: student.lastName
        });
      }
    }

    for (const [slot, group] of Object.entries(timeSlotGroups)) {
      if (group.length >= 2) {
        const [day, hour] = slot.split('_');

        // Check for siblings in same slot
        const lastNames = group.map(s => s.lastName);
        const hasSiblings = lastNames.length !== new Set(lastNames).size;

        // Check for same level
        const levels = [...new Set(group.map(s => s.level))];
        const sameLevelGroup = levels.length === 1;

        relations.sameTimeSlot.push({
          slot: `${day} ${hour}`,
          count: group.length,
          students: group.map(s => s.name),
          levels,
          sameLevelGroup,
          hasSiblings,
          allAdults: group.every(s => s.adult),
          allChildren: group.every(s => !s.adult)
        });
      }
    }

    console.log(`Found ${relations.sameTimeSlot.length} time slots with 2+ students`);
    const withSiblings = relations.sameTimeSlot.filter(s => s.hasSiblings);
    console.log(`   ${withSiblings.length} slots contain siblings`);
    const mixedLevel = relations.sameTimeSlot.filter(s => !s.sameLevelGroup);
    console.log(`   ${mixedLevel.length} slots have mixed levels`);
    console.log();

    // 3. AGE-BASED GROUPING (children only, calculate age from birthDate)
    console.log('🎂 Analyzing Age Patterns...\n');
    for (const student of students) {
      if (student.adult || !student.birthDate) continue;

      const birthDate = new Date(student.birthDate);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();

      const ageGroup = Math.floor(age / 2) * 2; // Group by 2-year ranges
      const groupKey = `${ageGroup}-${ageGroup + 1}`;

      if (!relations.ageGroups[groupKey]) {
        relations.ageGroups[groupKey] = [];
      }

      relations.ageGroups[groupKey].push({
        name: `${student.firstName} ${student.lastName}`,
        age,
        trainigGroup: student.trainigGroup,
        assignments: student.assignments || []
      });
    }

    console.log('Age group distribution:');
    Object.keys(relations.ageGroups).sort().forEach(group => {
      const count = relations.ageGroups[group].length;
      console.log(`   ${group} years: ${count} students`);
    });
    console.log();

    // 4. MEMBER VS NON-MEMBER PATTERNS
    console.log('🏅 Analyzing Membership Status...\n');
    for (const student of students) {
      const data = {
        name: `${student.firstName} ${student.lastName}`,
        adult: student.adult,
        level: student.adult ? student.skillLevel : student.trainigGroup,
        assigned: (student.assignments && student.assignments.length > 0) ||
                  (student.day && student.hour !== null)
      };

      if (student.member) {
        relations.memberVsNonMember.member.push(data);
      } else {
        relations.memberVsNonMember.nonMember.push(data);
      }
    }

    const memberAssigned = relations.memberVsNonMember.member.filter(s => s.assigned).length;
    const nonMemberAssigned = relations.memberVsNonMember.nonMember.filter(s => s.assigned).length;

    console.log(`Members: ${relations.memberVsNonMember.member.length} total`);
    console.log(`   Assigned: ${memberAssigned} (${(memberAssigned/relations.memberVsNonMember.member.length*100).toFixed(1)}%)`);
    console.log(`Non-members: ${relations.memberVsNonMember.nonMember.length} total`);
    console.log(`   Assigned: ${nonMemberAssigned} (${(nonMemberAssigned/relations.memberVsNonMember.nonMember.length*100).toFixed(1)}%)`);
    console.log();

    // 5. EMAIL DOMAIN ANALYSIS (organizations, schools)
    console.log('📧 Analyzing Email Domain Patterns...\n');
    for (const student of students) {
      if (!student.email) continue;

      const domain = student.email.split('@')[1];
      if (!domain) continue;

      if (!relations.emailDomains[domain]) {
        relations.emailDomains[domain] = [];
      }

      relations.emailDomains[domain].push({
        name: `${student.firstName} ${student.lastName}`,
        email: student.email,
        adult: student.adult
      });
    }

    const domainCounts = Object.entries(relations.emailDomains)
      .map(([domain, students]) => ({ domain, count: students.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    console.log('Top email domains:');
    domainCounts.forEach(({ domain, count }) => {
      console.log(`   ${domain}: ${count} students`);
      if (count >= 3) {
        console.log(`      → Possible group registration (family/organization)`);
      }
    });
    console.log();

    // 6. TEAM VS HOBBY (children only)
    console.log('🏆 Analyzing Team vs Hobby Distribution...\n');
    for (const student of students) {
      if (student.adult) continue;

      const data = {
        name: `${student.firstName} ${student.lastName}`,
        trainigGroup: student.trainigGroup,
        team: student.team,
        assignments: student.assignments || []
      };

      if (student.trainigGroup && student.trainigGroup.includes('Team')) {
        relations.teamVsHobby.team.push(data);
      } else if (student.trainigGroup && student.trainigGroup.includes('Hobby')) {
        relations.teamVsHobby.hobby.push(data);
      } else {
        relations.teamVsHobby.neither.push(data);
      }
    }

    console.log(`Team players: ${relations.teamVsHobby.team.length}`);
    console.log(`Hobby players: ${relations.teamVsHobby.hobby.length}`);
    console.log(`Neither/Other: ${relations.teamVsHobby.neither.length}`);
    console.log();

    // 7. COORDINATED PICKUP (siblings in sequential time slots)
    console.log('🚗 Analyzing Coordinated Pickup Patterns...\n');
    for (const siblingGroup of relations.siblings) {
      const childrenWithAssignments = siblingGroup.assignments.filter(a => a && a.length > 0);
      if (childrenWithAssignments.length < 2) continue;

      // Check if siblings have same day but consecutive hours
      for (let i = 0; i < childrenWithAssignments.length; i++) {
        for (let j = i + 1; j < childrenWithAssignments.length; j++) {
          const child1Assignments = childrenWithAssignments[i];
          const child2Assignments = childrenWithAssignments[j];

          for (const a1 of child1Assignments) {
            for (const a2 of child2Assignments) {
              if (a1.day === a2.day && Math.abs(a1.hour - a2.hour) === 1) {
                relations.coordinatedPickup.push({
                  lastName: siblingGroup.lastName,
                  slot1: `${a1.day} ${a1.hour}`,
                  slot2: `${a2.day} ${a2.hour}`,
                  pattern: 'sequential_hours'
                });
              }
            }
          }
        }
      }
    }

    console.log(`Found ${relations.coordinatedPickup.length} coordinated pickup patterns`);
    relations.coordinatedPickup.slice(0, 5).forEach(p => {
      console.log(`   ${p.lastName}: ${p.slot1} + ${p.slot2} (${p.pattern})`);
    });
    console.log();

    // 8. ADDRESS CLUSTERING (geographic proximity)
    console.log('🏠 Analyzing Address Patterns...\n');
    for (const student of students) {
      if (!student.adress) continue;

      // Extract postal code or city (rough grouping)
      const addressParts = student.adress.split(',');
      const cityOrPostal = addressParts[addressParts.length - 1].trim();

      if (!relations.addressClusters[cityOrPostal]) {
        relations.addressClusters[cityOrPostal] = [];
      }

      relations.addressClusters[cityOrPostal].push({
        name: `${student.firstName} ${student.lastName}`,
        address: student.adress,
        adult: student.adult
      });
    }

    const addressGroups = Object.entries(relations.addressClusters)
      .map(([area, students]) => ({ area, count: students.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    console.log('Geographic distribution (top areas):');
    addressGroups.forEach(({ area, count }) => {
      console.log(`   ${area}: ${count} students`);
    });
    console.log();

    // 9. FREQUENCE PATTERNS
    console.log('📊 Analyzing Frequence Patterns...\n');
    for (const student of students) {
      const freq = student.frequence || '1';
      if (!relations.frequencePatterns[freq]) {
        relations.frequencePatterns[freq] = { total: 0, assigned: 0, multiAssigned: 0 };
      }

      relations.frequencePatterns[freq].total++;

      const assignmentCount = (student.assignments && student.assignments.length) || 0;
      if (assignmentCount > 0) {
        relations.frequencePatterns[freq].assigned++;
      }
      if (assignmentCount > 1) {
        relations.frequencePatterns[freq].multiAssigned++;
      }
    }

    console.log('Frequence distribution:');
    Object.keys(relations.frequencePatterns).sort().forEach(freq => {
      const data = relations.frequencePatterns[freq];
      console.log(`   Frequence ${freq}: ${data.total} students`);
      console.log(`      Assigned: ${data.assigned} (${(data.assigned/data.total*100).toFixed(1)}%)`);
      console.log(`      Multi-assigned: ${data.multiAssigned} (${(data.multiAssigned/data.total*100).toFixed(1)}%)`);
    });
    console.log();

    // 10. AVAILABILITY PATTERNS (common available times)
    console.log('⏰ Analyzing Availability Overlap Patterns...\n');
    const availabilityMap = {};
    for (const student of students) {
      if (!student.availableTimes || student.availableTimes.length === 0) continue;

      for (const time of student.availableTimes) {
        if (!availabilityMap[time]) {
          availabilityMap[time] = { adults: 0, children: 0, total: 0, levels: {} };
        }

        availabilityMap[time].total++;
        if (student.adult) {
          availabilityMap[time].adults++;
        } else {
          availabilityMap[time].children++;
        }

        const level = student.adult ? student.skillLevel : student.trainigGroup;
        if (!availabilityMap[time].levels[level]) {
          availabilityMap[time].levels[level] = 0;
        }
        availabilityMap[time].levels[level]++;
      }
    }

    const popularTimes = Object.entries(availabilityMap)
      .map(([time, data]) => ({
        time,
        total: data.total,
        adults: data.adults,
        children: data.children,
        levels: Object.keys(data.levels).length,
        topLevel: Object.entries(data.levels).sort((a, b) => b[1] - a[1])[0]
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    console.log('Most popular available times:');
    popularTimes.forEach(({ time, total, adults, children, levels, topLevel }) => {
      console.log(`   ${time}: ${total} students (${adults}A / ${children}C, ${levels} levels)`);
      if (topLevel) {
        console.log(`      Top level: ${topLevel[0]} (${topLevel[1]} students)`);
      }
    });
    console.log();

    // Save results
    const outputFile = 'hidden-relations-analysis.json';
    fs.writeFileSync(outputFile, JSON.stringify(relations, null, 2));
    console.log(`\n💾 Full analysis saved to: ${outputFile}`);

    // Summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY OF HIDDEN RELATIONS\n');
    console.log(`✅ ${relations.siblings.length} potential sibling groups found`);
    console.log(`✅ ${relations.coordinatedPickup.length} coordinated pickup patterns`);
    console.log(`✅ ${withSiblings.length} time slots contain siblings (may be intentional grouping)`);
    console.log(`✅ Member priority: ${(memberAssigned/relations.memberVsNonMember.member.length*100).toFixed(1)}% vs ${(nonMemberAssigned/relations.memberVsNonMember.nonMember.length*100).toFixed(1)}% assignment rate`);
    console.log(`✅ ${domainCounts.filter(d => d.count >= 3).length} email domains with 3+ students (group registrations)`);
    console.log(`✅ Geographic clusters in ${addressGroups.length} main areas`);
    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

analyzeHiddenRelations();
