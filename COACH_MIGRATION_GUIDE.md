# Coach Data Migration Guide

## Problem

The application currently stores coach references in Student documents using mixed formats:
- Some students have coach as ObjectId (e.g., `"507f1f77bcf86cd799439011"`)
- Some students have coach as name string (e.g., `"Max Trainer"`)
- This inconsistency causes bugs in coach matching and assignment

## Solution

This migration script converts all coach references to use **ObjectIds only**.

---

## Before Running Migration

### 1. Backup Your Database

**IMPORTANT**: Always backup your database before running migrations!

```bash
# Export your database
mongodump --uri="mongodb://localhost:27017/tennis-coach" --out=backup-$(date +%Y%m%d)

# Or if using MongoDB Atlas
mongodump --uri="mongodb+srv://username:password@cluster.mongodb.net/tennis-coach" --out=backup-$(date +%Y%m%d)
```

### 2. Verify Environment

Make sure your `.env` file has the correct `MONGO_URI`:

```env
MONGO_URI=mongodb://localhost:27017/tennis-coach
```

### 3. Check Current State (Optional)

To see current coach data format:

```bash
# Connect to MongoDB
mongosh tennis-coach

# Check students with coach names (not ObjectIds)
db.students.find({ coach: { $exists: true, $type: "string" } }).limit(5)

# Count students by coach format
db.students.aggregate([
  { $group: { _id: { $type: "$coach" }, count: { $sum: 1 } } }
])
```

---

## Running the Migration

### Option 1: Using npm script (Recommended)

```bash
cd backend
npm run migrate:coaches
```

### Option 2: Direct execution

```bash
cd backend
node src/scripts/migrateCoachData.js
```

---

## What the Migration Does

### Step 1: Analysis
- Fetches all students and coaches from database
- Categorizes each student's coach field:
  - Already valid ObjectId ✓
  - Coach name (needs migration)
  - Null/empty (no action needed)

### Step 2: Migration
For each student with a coach name:

1. **Find matching coach** by name (firstName + lastName)
2. If found:
   - Replace name with coach's ObjectId
   - Save student
   - Log success
3. If NOT found:
   - Set coach to `null`
   - Add to orphaned coaches report
   - Log warning

### Step 3: Verification
- Re-checks all students to ensure no name-based coaches remain
- Confirms all coach fields are either valid ObjectIds or null

### Step 4: Report
- Prints summary statistics
- Lists any orphaned coach references
- Saves migration report (JSON)

---

## Example Output

### Successful Migration

```
🚀 Starting Coach Data Migration...

✅ Connected to MongoDB

📊 Found 45 students
📊 Found 6 coaches

✓ Migrated: Max Müller → Coach: Anna Schmidt → 507f1f77bcf86cd799439011
✓ Migrated: Lisa Weber → Coach: Tom Becker → 507f1f77bcf86cd799439012
⚠ Orphaned: Peter Klein had coach "John Doe" (not found) → set to null

============================================================
📋 MIGRATION SUMMARY
============================================================
Total Students:           45
Already Using ObjectIds:  30 ✅
Migrated from Name:       12 🔄
Set to Null (Orphaned):   1 ⚠️
No Coach Assigned:        2 -
============================================================

⚠️  ORPHANED COACH REFERENCES:
These students had coach names that don't match any existing coach:
------------------------------------------------------------
  • Peter Klein (507f1f77bcf86cd799439013)
    Coach name: "John Doe"
------------------------------------------------------------
Action: All set to null. You may want to manually assign coaches.

🔍 Verifying migration...
✅ Verification passed: All coach references are now valid ObjectIds or null

✅ Migration completed successfully!

🔌 Disconnected from MongoDB
```

---

## After Migration

### 1. Verify in Database

```bash
mongosh tennis-coach

# Should return 0 - all coaches should be ObjectIds or null
db.students.find({
  coach: { $exists: true, $ne: null, $type: "string" },
  $where: "!/^[0-9a-fA-F]{24}$/.test(this.coach)"
}).count()
```

### 2. Handle Orphaned Coaches

If the migration report shows orphaned coaches (students whose coach name didn't match any existing coach), you have two options:

**Option A**: Manually assign coaches in the UI
1. Go to Students page
2. Filter by unassigned students
3. Assign correct coaches

**Option B**: Update via MongoDB
```javascript
// Example: Assign coach to specific student
db.students.updateOne(
  { _id: ObjectId("507f1f77bcf86cd799439013") },
  { $set: { coach: ObjectId("507f1f77bcf86cd799439011") } }
)
```

### 3. Test the Application

1. Start the backend:
   ```bash
   npm start
   ```

2. Verify in UI:
   - View students - check coaches are displayed correctly
   - Edit student - assign/change coach
   - Run schedule reset algorithm
   - Check day view with coach columns

---

## Model Changes

The Student model has been updated with validation:

```javascript
coach: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Coach',
  default: null,
  validate: {
    validator: function(value) {
      if (!value) return true;  // Allow null
      return mongoose.Types.ObjectId.isValid(value);
    },
    message: 'Coach must be a valid ObjectId or null'
  }
}
```

This prevents future entries with coach names. From now on, only valid ObjectIds will be accepted.

---

## Backward Compatibility

The helper functions in `schedule/utils.js` have been **kept** for backward compatibility:

- `findCoachByIdOrName()` - Still works with both formats
- `coachMatchesStudent()` - Still handles both formats

These functions will continue to work even though the database now only stores ObjectIds. This provides a safety net during the transition period.

---

## Rollback (If Needed)

If you need to rollback the migration:

### 1. Restore from backup

```bash
# Restore entire database
mongorestore --uri="mongodb://localhost:27017" --drop backup-20250105

# Or restore just the students collection
mongorestore --uri="mongodb://localhost:27017/tennis-coach" --collection=students backup-20250105/tennis-coach/students.bson
```

### 2. Revert Student model

Change `backend/src/models/Student.js` back to:

```javascript
coach: String,
```

---

## Troubleshooting

### Migration fails to connect to database

**Error**: `MongoServerError: connect ECONNREFUSED`

**Solution**:
1. Make sure MongoDB is running
2. Check `MONGO_URI` in `.env` file
3. Verify connection string is correct

### Migration hangs

**Error**: Script runs but doesn't finish

**Solution**:
1. Press Ctrl+C to cancel
2. Check database connection
3. Try running with manual connection:
   ```bash
   mongosh tennis-coach
   # If this works, the migration should work
   ```

### "Coach must be a valid ObjectId" error after migration

**Error**: When creating/updating students

**Solution**:
This means the migration didn't complete successfully. Re-run the migration:
```bash
npm run migrate:coaches
```

### Some students still show coach names in UI

**Problem**: UI displays coach names instead of showing coach mismatch

**Solution**:
1. Check frontend code - it may be using `findCoachByIdOrName()` which masks the issue
2. Verify migration completed: `npm run migrate:coaches`
3. Check database directly with mongosh

---

## FAQ

**Q: Can I run this migration multiple times?**
A: Yes, the migration is idempotent. If coaches are already ObjectIds, it will skip them. Safe to re-run.

**Q: Will this affect my existing schedules?**
A: No, schedules reference students, not coaches directly. Your schedule data is safe.

**Q: What if I add a new coach after migration?**
A: The validation ensures all new coach assignments must use ObjectIds. The old string format is no longer accepted.

**Q: Do I need to run this on production?**
A: Yes, run on both development and production databases. Always backup production first!

**Q: How long does it take?**
A: Typically 1-5 seconds for most databases. Depends on number of students.

---

## Next Steps

After successful migration:

1. ✅ Verify all students have valid coach ObjectIds
2. ✅ Test coach assignment in UI
3. ✅ Test schedule generation
4. ✅ Monitor for any coach-related errors
5. ⭕ Consider removing backward compatibility code in 2-3 months

---

## Support

If you encounter issues:

1. Check the migration report output
2. Review troubleshooting section above
3. Verify database state with mongosh
4. Check application logs for errors

**Migration Script**: `backend/src/scripts/migrateCoachData.js`
**Student Model**: `backend/src/models/Student.js`

---

**Last Updated**: 2025-10-05
**Script Version**: 1.0.0
