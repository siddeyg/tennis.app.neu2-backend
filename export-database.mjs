import mongoose from 'mongoose';
import fs from 'fs';

// Connect to local MongoDB
const MONGO_URI = 'mongodb://localhost:27017/tennis-coach';

console.log('🔄 Exporting database...');
console.log('Connecting to:', MONGO_URI);

try {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;

  const collections = ['students', 'coaches', 'schedules', 'savedschedules', 'settings'];
  const exportData = {};

  for (const collectionName of collections) {
    console.log(`📦 Exporting ${collectionName}...`);
    const data = await db.collection(collectionName).find({}).toArray();
    exportData[collectionName] = data;
    console.log(`   Found ${data.length} documents`);
  }

  // Write to JSON file
  const outputFile = 'database-export.json';
  fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));

  console.log('');
  console.log('✅ Export complete!');
  console.log(`📄 File: ${outputFile}`);
  console.log('');
  console.log('Summary:');
  console.log('  Students:', exportData.students.length);
  console.log('  Coaches:', exportData.coaches.length);
  console.log('  Schedules:', exportData.schedules.length);
  console.log('  Saved Schedules:', exportData.savedschedules.length);
  console.log('  Settings:', exportData.settings.length);
  console.log('');
  console.log('📤 Next step: Upload database-export.json to server');

  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
