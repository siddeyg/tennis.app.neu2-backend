const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/tennis-coach').then(async () => {
  const db = mongoose.connection.db;
  const camps = await db.collection('camps').find({deletedAt: null}, {projection: {title:1, currentParticipants:1, maxParticipants:1}}).toArray();
  let total = 0;
  for (const c of camps) {
    const actual = await db.collection('campregistrations').countDocuments({campId: c._id, status: {$in: ['pending','confirmed','waitlist']}});
    const cancelled = await db.collection('campregistrations').countDocuments({campId: c._id, status: {$in: ['cancelled','rejected']}});
    total += c.currentParticipants || 0;
    if ((c.currentParticipants||0) !== actual) {
      console.log(c.title + ': counter=' + (c.currentParticipants||0) + ' actual=' + actual + ' cancelled=' + cancelled + ' MISMATCH');
    } else {
      console.log(c.title + ': ' + actual + '/' + (c.maxParticipants||0) + ' (ok)');
    }
  }
  console.log('Total from counters: ' + total);
  process.exit(0);
});
