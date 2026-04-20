const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/tennis-coach').then(async () => {
  const u = await mongoose.connection.db.collection('studentportalusers').findOne({ email: 'martin.vogel@yahoo.de' });
  if (!u) { console.log('NOT FOUND'); process.exit(0); }
  console.log('Found:', u.firstName, u.lastName);
  console.log('emailVerified:', u.emailVerified);
  console.log('isActive:', u.isActive);
  console.log('password set:', !!u.password);
  console.log('passwordResetToken:', u.passwordResetToken || 'none');
  console.log('passwordResetExpires:', u.passwordResetExpires || 'none');
  console.log('createdAt:', u.createdAt);
  console.log('updatedAt:', u.updatedAt);
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
