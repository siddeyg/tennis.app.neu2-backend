/**
 * Venue Resolver Utility
 *
 * Resolves the training venue/hall for a student assignment using a multi-stage fallback:
 * 1. assignment.venue (if non-empty)
 * 2. student.availableTimes (matching day and hour)
 * 3. student.priorityTime (matching day and hour)
 * 4. period.trainingSlots / period.trainingSlotsAdults (matching day and hour)
 * 5. student.venue (legacy single-venue field)
 * 6. Default season fallback (e.g. TC GW Am Kreuzberg for summer)
 */

export function resolveVenueForAssignment(student, assignment, period = null) {
  if (!assignment) return '';

  if (assignment.venue && typeof assignment.venue === 'string' && assignment.venue.trim().length > 0) {
    return assignment.venue.trim();
  }

  const dayStr = String(assignment.day || '').trim().toLowerCase();
  if (!dayStr) return '';

  const assignHour = Number(assignment.hour);
  const floorHour = Math.floor(assignHour);

  // 1. Check student availableTimes
  if (student && Array.isArray(student.availableTimes)) {
    const at = student.availableTimes.find(t => {
      if (!t || !t.day) return false;
      const tDay = String(t.day).trim().toLowerCase();
      if (tDay !== dayStr) return false;
      const tHour = typeof t.hour === 'number' ? t.hour : parseInt(t.hour, 10);
      return tHour === assignHour || tHour === floorHour;
    });
    if (at && typeof at.venue === 'string' && at.venue.trim().length > 0) {
      return at.venue.trim();
    }
  }

  // 2. Check student priorityTime
  if (student?.priorityTime && student.priorityTime.day) {
    const ptDay = String(student.priorityTime.day).trim().toLowerCase();
    if (ptDay === dayStr) {
      const ptHour = typeof student.priorityTime.hour === 'number'
        ? student.priorityTime.hour
        : parseInt(student.priorityTime.hour, 10);
      if ((ptHour === assignHour || ptHour === floorHour) &&
          typeof student.priorityTime.venue === 'string' &&
          student.priorityTime.venue.trim().length > 0) {
        return student.priorityTime.venue.trim();
      }
    }
  }

  // 3. Check period training slots
  if (period) {
    const primarySlots = student?.adult ? (period.trainingSlotsAdults || []) : (period.trainingSlots || []);
    const fallbackSlots = student?.adult ? (period.trainingSlots || []) : (period.trainingSlotsAdults || []);
    const allSlots = [...primarySlots, ...fallbackSlots];

    const slot = allSlots.find(s => {
      if (!s || !s.day) return false;
      const sDay = String(s.day).trim().toLowerCase();
      if (sDay !== dayStr) return false;
      const sHourNum = typeof s.hour === 'number' ? s.hour : parseInt(s.hour, 10);
      return sHourNum === assignHour || sHourNum === floorHour || String(s.hour).startsWith(String(floorHour));
    });

    if (slot && Array.isArray(slot.venues) && slot.venues.length > 0) {
      const validVenues = slot.venues.filter(v => v && typeof v === 'string' && v.trim().length > 0);
      if (validVenues.length > 0) {
        return validVenues.join(' / ');
      }
    }
  }

  // 4. Legacy student.venue
  if (student?.venue && typeof student.venue === 'string' && student.venue.trim().length > 0) {
    return student.venue.trim();
  }

  // 5. Season fallback
  if (period?.season === 'summer') {
    return 'TC GW Am Kreuzberg';
  }

  return '';
}
