// This is the fix for the /assignments/replace route
// Replace lines 146-181 in students.js with this code:

    // Handle both ObjectId and string IDs by trying both
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
      } catch (err) {
        // ObjectId conversion failed — ID was not a valid ObjectId format
      }
    }

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden", searchedId: req.params.id });
    }

