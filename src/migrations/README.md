# Database Migrations

This directory contains database migration scripts for schema changes and data transformations.

## Running Migrations

### Migration 001: Link Periods to Plans

**Purpose**: Assign all existing SavedSchedules to the Winter 2025/26 registration period.

**Run**:
```bash
cd backend
node src/migrations/001_link_periods_to_plans.js
```

**What it does**:
1. Finds or creates "Winter 2025/26" RegistrationPeriod
2. Assigns all unlinked SavedSchedules to this period
3. Sets version numbers (1, 2, 3, ...) based on creation date
4. Sets the most recent plan as currentPlanId
5. Verifies all schedules are linked

**Rollback**: If needed, you can manually set `periodId: null` on SavedSchedules:
```javascript
db.savedschedules.updateMany({}, { $unset: { periodId: "" } })
```

## Creating New Migrations

1. Create a new file: `00X_description.js`
2. Follow the pattern from existing migrations:
   - Import models and dotenv
   - Export an async `migrate()` function
   - Add CLI execution block at bottom
   - Include detailed logging
3. Test on backup database first!
4. Document in this README

## Migration History

| # | Date | Description | Status |
|---|------|-------------|--------|
| 001 | 2026-01-28 | Link SavedSchedules to RegistrationPeriods | ✅ Ready |

## Notes

- Always backup database before running migrations
- Test on development database first
- Migrations should be idempotent (safe to run multiple times)
- Use transactions where possible for atomicity
