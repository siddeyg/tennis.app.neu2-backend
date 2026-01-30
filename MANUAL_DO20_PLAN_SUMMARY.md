# Manual Optimal Plan with Donnerstag 20:00 - Summary

**Date**: 2025-10-17
**Task**: Create manual optimal plan that USES Donnerstag 20:00 for adults who have Do 18/19

---

## What Was Done

✅ **Created manual optimal plan** with Donnerstag 20:00 constraint
✅ **Exported to all formats** (HTML, CSV, JSON) for full/adults/children
✅ **Compared with algorithmic plan** to show trade-offs

---

## Manual Plan Results

### Statistics:
- **Total Courses**: 44
- **Full Courses (4)**: 17 (38.6%)
- **Three (3)**: 5 (11.4%)
- **Pairs (2)**: 8 (18.2%)
- **Singles (1)**: 14 (31.8%)
- **Assigned**: 113 students
- **Unassigned**: 0 students
- **Efficiency (3-4)**: 50.0%

### Donnerstag 20:00 Courses:

**Course 1**: adult_weiblich_Anfänger mit Grundkenntnissen (4 students)
- Friederike Förster
- Kristina Müller
- Marie Köhler
- Silke Hoesch

**Course 2**: adult_weiblich_Fortgeschritten (4 students)
- Rebecca Mau
- Anneke Malinowski
- Nicole Berg
- Svenja Gloger

**Total at Do 20**: 2 full courses, 8 students ✅

---

## How It Was Created

### Modifications to Original Manual Plan:

1. **Removed from Samstag 11** (course 6):
   - Marie Köhler → moved to Do 20

2. **Removed from Freitag 18** (course 7):
   - Kristina Müller → moved to Do 20
   - Silke Hoesch → moved to Do 20

3. **Removed from Donnerstag 16** (course 8):
   - Friederike Förster → moved to Do 20

4. **Removed Montag 19** (course 13):
   - Rebecca Mau, Anneke Malinowski, Nicole Berg, Svenja Gloger → moved to Do 20

5. **Created 2 NEW courses at Donnerstag 20:00**:
   - weiblich-Anfänger mit Grundkenntnissen: 4 students
   - weiblich-Fortgeschritten: 4 students

---

## Comparison: Manual (Do 20) vs Algorithmic Plan

| Metric | MANUAL (DO 20) | ALGORITHMIC | Winner |
|--------|----------------|-------------|--------|
| **Total Courses** | 44 | 40 | ⭐ Algorithmic (-4) |
| **Full Courses (4)** | 17 | 18 | ⭐ Algorithmic (+1) |
| **Three (3)** | 5 | 6 | ⭐ Algorithmic (+1) |
| **Pairs (2)** | 8 | 7 | ⭐ Algorithmic (-1) |
| **Singles (1)** | 14 | 9 | ⭐ Algorithmic (-5) |
| **Assigned** | 113 | 112 | ⭐ Manual (+1) |
| **Efficiency (3-4)** | 50.0% | 60.0% | ⭐ Algorithmic (+10%) |
| **Uses Do 20** | ✅ Yes (2 courses) | ❌ No (0 courses) | ⭐ Manual |

---

## Key Findings

### Manual Plan Advantages:
1. ✅ **USES Donnerstag 20:00** (2 full courses, 8 students)
2. ✅ **All 113 students assigned** (algorithmic left 1 unassigned)
3. ✅ **Implements the constraint** as requested

### Manual Plan Disadvantages:
1. ❌ **4 more courses needed** (44 vs 40) - less efficient
2. ❌ **1 fewer full course** (17 vs 18)
3. ❌ **10% lower efficiency** (50% vs 60%)
4. ❌ **5 more singles** (14 vs 9) - worst course type

### Why the Difference?

The algorithmic plan found BETTER placements for the 8 key students at:
- Montag 19 (4 students in full course)
- Freitag 18 (3 students in full course)
- Samstag 11 (1 student in full course)

By forcing these students to Donnerstag 20, we:
- Create gaps in other courses (making them smaller)
- Increase number of single-student courses
- Reduce overall efficiency

**This is the COST of the Donnerstag 20 constraint.**

---

## Trade-Off Analysis

### If Donnerstag 20:00 is REQUIRED:
- ✅ Use **Manual Plan (Do 20)**
- Accepts 10% efficiency loss to meet constraint
- All students assigned
- 2 full courses at Do 20 as intended

### If Efficiency is PRIORITY:
- ✅ Use **Algorithmic Plan**
- Maximizes full courses (18 vs 17)
- Minimizes total courses (40 vs 44)
- Best efficiency (60% vs 50%)
- BUT skips Donnerstag 20 entirely

---

## Files Generated

### Full Plan (All Students):
- `manual-optimal-plan-do20.json` - Data file
- `manual-optimal-plan-do20-full.html` - Visual schedule
- `manual-optimal-plan-do20-full.csv` - Data export

### Adults Only (18+):
- `manual-optimal-plan-do20-adults.json` - 37 students, 18 courses
- `manual-optimal-plan-do20-adults.html` - Visual schedule
- `manual-optimal-plan-do20-adults.csv` - Data export

### Children Only (Under 18):
- `manual-optimal-plan-do20-children.json` - 76 students, 26 courses
- `manual-optimal-plan-do20-children.html` - Visual schedule
- `manual-optimal-plan-do20-children.csv` - Data export

---

## Recommendation

### ✅ USE MANUAL PLAN (WITH DO 20) IF:
1. Donnerstag 20:00 is a **REQUIRED** time slot
2. Coach Helge Padberg needs that slot filled
3. You want those specific 8 students at Do 20
4. Willing to accept 10% efficiency loss

### ✅ USE ALGORITHMIC PLAN IF:
1. Maximizing efficiency is the priority
2. Donnerstag 20:00 is NOT required
3. Coach availability/cost is a concern (4 fewer courses = less cost)
4. Want to minimize singles (9 vs 14)

---

## Question for You

**Do you REQUIRE Donnerstag 20:00 to be used, or was this just a simulation?**

- If REQUIRED → Deploy manual plan (Do 20)
- If OPTIONAL → Deploy algorithmic plan (better efficiency)

---

**Status**: ✅ COMPLETE
**Manual Plan Created**: Yes (44 courses, 17 full, uses Do 20)
**Exported**: Yes (HTML/CSV/JSON for full/adults/children)
**Compared**: Yes (manual vs algorithmic analysis complete)
