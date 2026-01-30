# Seasonal Registration Quick Start Guide

**Get started with seasonal training registration in 5 minutes**

Created: 2026-01-22

---

## ⚡ Quick Start (5 Minutes)

### Prerequisites

- ✅ Backend running on port 5000
- ✅ Frontend (Admin Portal) running on port 3000
- ✅ Admin account credentials

### Step 1: Start Servers (If Not Running)

```bash
# Terminal 1: Backend
cd backend
node ./src/server.js

# Terminal 2: Admin Frontend
cd frontend
npm start
```

### Step 2: Access Admin Interface

1. Open browser: **http://localhost:3000/trainer/frontend**
2. Login with admin credentials (info@diemachtderworte.de)
3. Look for **"Anmeldezeiträume"** in the navigation menu

### Step 3: Create Your First Registration Period

Click the **"+ Neuer Zeitraum"** button and fill:

| Field | Example Value |
|-------|---------------|
| Name | "Sommertraining 2026" |
| Season | "Sommer" (Summer) |
| Training Start | 2026-04-15 |
| Training End | 2026-09-30 |
| Registration Deadline | 2026-04-01 |
| Status | "Draft" |

Click **"Erstellen"** to create.

### Step 4: Open Registration

1. Find your period in the list
2. Click **"Öffnen"** (Open) button
3. Confirm

✅ **Students can now register via Student Portal (port 3001)!**

---

## 📋 What You Can Configure

### Field Configuration (Kids Form)

You can choose which fields appear:

**Essential Fields (Always Keep):**
- ✅ Mitgliedsstatus (Member status)
- ✅ Trainingsart (Training type)
- ✅ Trainingshäufigkeit (Frequency)  
- ✅ Verfügbare Zeiten (Available times)
- ✅ Datenschutz (Privacy - REQUIRED by law)

**Optional Fields:**
- Team participation checkbox
- SEPA mandate (account holder, IBAN)
- Remarks/comments

### Field Configuration (Adults Form)

**Essential Fields:**
- ✅ Spielstärke (Skill level)
- ✅ Trainingsziele (Goals)
- ✅ Gruppengröße (Group size)
- ✅ Verfügbare Zeiten (Available times)

**Optional Fields:**
- SEPA mandate
- Remarks

---

## 🔄 Registration Status Flow

```
DRAFT → OPEN → CLOSED → ARCHIVED
```

| Status | Visible to Students? | Can Submit? | Can Edit? |
|--------|---------------------|-------------|-----------|
| Draft | ❌ | ❌ | ✅ |
| Open | ✅ | ✅ | ✅ |
| Closed | ❌ | ❌ | Limited |
| Archived | ❌ | ❌ | ❌ |

---

## 📊 Managing Submissions

### View All Submissions

1. Click **"Anmeldungen (X)"** on your period
2. See list of all registrations
3. Filter by: All / Pending / Processed / Rejected

### Process Submissions

**Individual Processing:**
1. Click on a submission
2. Review all data
3. Click **"Verarbeiten"** (Process)
4. ✅ Creates Student record

**Bulk Processing:**
1. Click **"Alle verarbeiten"** (Process All)
2. Select **"Dry Run"** (preview first)
3. Review what will happen
4. Run again to actually process

---

## 🧪 Quick Test

### Test the Full Flow:

1. **Create test period** (dates: today + 30 days)
2. **Open it**
3. **Open Student Portal** in new tab: http://localhost:3001
4. **Login** with a student account (or create one)
5. **Submit test registration**
6. **Return to admin** → View submissions
7. **Process the submission**
8. **Check Students page** → See new record

✅ **System working!**

---

## 📚 Documentation

- **This Guide** - Quick start (you are here)
- **SEASONAL_REGISTRATION_ADMIN_GUIDE.md** - Complete admin reference (60+ pages)
- **SEASONAL_REGISTRATION_SYSTEM.md** - Technical implementation
- **CLAUDE.md** - Project overview

---

## ❓ Common Questions

**Q: Students can't see the period?**  
A: Status must be "Open" and isActive must be true (automatic when you open).

**Q: Can I edit after opening?**  
A: Yes! Changes apply to NEW submissions only.

**Q: How do I customize fields?**  
A: Edit period → Look for "Formular-Konfiguration" sections.

**Q: Can I delete a period?**  
A: Only if it has ZERO submissions. Otherwise, archive it.

**Q: Where is IBAN data stored?**  
A: Encrypted with AES-256 in database. Only admins can view.

---

**Ready to create your first real registration period? Go to the admin interface!** 🎾

Last Updated: 2026-01-22
