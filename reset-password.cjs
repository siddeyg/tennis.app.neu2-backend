const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const newPassword = 'Mondo2026!';
const email = 'martin.vogel@yahoo.de';

mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/tennis-coach').then(async () => {
  const hash = await bcrypt.hash(newPassword, 10);
  const result = await mongoose.connection.db.collection('studentportalusers').updateOne(
    { email },
    { $set: { password: hash }, $unset: { passwordResetToken: '', passwordResetExpires: '' } }
  );
  console.log('Updated:', result.modifiedCount);
  console.log('New password:', newPassword);
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
