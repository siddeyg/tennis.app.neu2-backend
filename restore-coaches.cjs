const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/tennis-coach').then(async () => {
  // Get coaches from the latest winter plan
  const plan = await mongoose.connection.db.collection('savedschedules').findOne(
    { name: /Plan vom 12\.01\.2026/ },
    { projection: { coaches: 1 } }
  );

  if (!plan || !plan.coaches || plan.coaches.length === 0) {
    console.log('No plan or coaches found');
    process.exit(1);
  }

  console.log('Found', plan.coaches.length, 'coaches in winter plan:');
  for (const c of plan.coaches) {
    console.log(' -', c.firstName, c.lastName, String(c._id));
  }

  // Check if coaches collection is empty
  const existing = await mongoose.connection.db.collection('coaches').countDocuments({});
  if (existing > 0) {
    console.log('\nCoach collection already has', existing, 'coaches. Aborting.');
    process.exit(1);
  }

  // Insert coaches back into collection
  const result = await mongoose.connection.db.collection('coaches').insertMany(plan.coaches);
  console.log('\nRestored', result.insertedCount, 'coaches to collection');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
