// This is the fix for the /assignments/replace route
// Replace lines 146-181 in students.js with this code:

    // Handle both ObjectId and string IDs by trying both
    console.log(`[assignments/replace] Trying string ID first...`);

    let result = await Student.collection.findOneAndUpdate(
      { _id: req.params.id }, // Try as string
      {
        $set: {
          assignments: [{ day, hour, coach: coach || null }],
          day,
          hour,
          coach: coach || null
        }
      },
      { returnDocument: 'after' }
    );

    let student = result?.value || result;

    // If not found, try as ObjectId
    if (!student) {
      console.log(`[assignments/replace] Not found as string, trying ObjectId...`);
      try {
        result = await Student.collection.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(req.params.id) },
          {
            $set: {
              assignments: [{ day, hour, coach: coach || null }],
              day,
              hour,
              coach: coach || null
            }
          },
          { returnDocument: 'after' }
        );
        student = result?.value || result;
        if (student) {
          console.log(`[assignments/replace] Found as ObjectId!`);
        }
      } catch (err) {
        console.log(`[assignments/replace] ObjectId attempt failed:`, err.message);
      }
    } else {
      console.log(`[assignments/replace] Found as string!`);
    }

    if (!student) {
      console.log(`[assignments/replace] ERROR: Student ${req.params.id} NOT FOUND (tried both)`);
      const samples = await Student.find({}, { _id: 1, firstName: 1, lastName: 1 }).limit(3);
      console.log(`[assignments/replace] First 3 IDs in database:`);
      samples.forEach(s => console.log(`  ${s._id} - ${s.firstName} ${s.lastName}`));
      return res.status(404).json({ error: "Schüler nicht gefunden", searchedId: req.params.id });
    }
