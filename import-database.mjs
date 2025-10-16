import mongoose from 'mongoose';
import fs from 'fs';

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://172.17.0.1:27017/tennis-coach';

console.log('🔄 Importing database...');
console.log('Connecting to:', MONGO_URI);

try {
  // Read the export file
  const exportFile = 'database-export.json';
  if (!fs.existsSync(exportFile)) {
    console.error('❌ Error: database-export.json not found!');
    console.log('Please upload the export file to the same directory as this script.');
    process.exit(1);
  }

  const exportData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;

  // Import each collection (skip users and settings to keep existing ones)
  const collectionsToImport = ['students', 'coaches', 'schedules', 'savedschedules'];

  for (const collectionName of collectionsToImport) {
    if (!exportData[collectionName]) {
      console.log(`⏭️  Skipping ${collectionName} (not in export)`);
      continue;
    }

    console.log(`📦 Importing ${collectionName}...`);
    const data = exportData[collectionName];

    if (data.length === 0) {
      console.log(`   No documents to import`);
      continue;
    }

    // Delete existing documents
    const deleteResult = await db.collection(collectionName).deleteMany({});
    console.log(`   Deleted ${deleteResult.deletedCount} existing documents`);

    // Insert new documents
    const insertResult = await db.collection(collectionName).insertMany(data);
    console.log(`   Inserted ${insertResult.insertedCount} documents`);
  }

  // Verify import
  console.log('');
  console.log('✅ Import complete!');
  console.log('');
  console.log('Verification:');
  for (const collectionName of collectionsToImport) {
    const count = await db.collection(collectionName).countDocuments();
    console.log(`  ${collectionName}:`, count);
  }

  console.log('');
  console.log('🎉 Database import successful!');
  console.log('');
  console.log('📋 Next step: Run migration script');
  console.log('   sudo docker compose exec mondo-backend node migrate-to-assignments.mjs');

  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
  process.exit(1);
}
