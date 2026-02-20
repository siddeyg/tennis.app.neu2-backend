/**
 * NRW Holiday Utilities
 *
 * Provides NRW public holidays (computed via Easter/Gregorian algorithm) and
 * NRW school holidays (fetched from ferien-api.de) for training session counting.
 *
 * Usage:
 *   const holidays = await getHolidaysInRange(startDate, endDate);
 *   const count = isHolidayDate(someDate, holidays);
 *   const name = getHolidayName(someDate, holidays);
 *   const dates = getDatesInRangeForDay(start, end, 1); // all Mondays
 */

import logger from './logger.js';

// In-memory cache by year (avoids repeat network calls within one process session)
const schoolHolidayCache = new Map();

/**
 * Easter Sunday via Anonymous Gregorian algorithm.
 * @param {number} year
 * @returns {Date}
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Add days to a date, returns new Date. */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format a Date as YYYY-MM-DD for stable key comparisons.
 * Always uses local date (not UTC) to match calendar days.
 */
function toDateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * NRW Public Holidays (11 per year: 9 Germany-wide + 2 NRW-specific).
 * @param {number} year
 * @returns {Array<{name: string, date: Date}>}
 */
function getPublicHolidays(year) {
  const easter = easterSunday(year);
  return [
    { name: 'Neujahr',             date: new Date(year, 0, 1)  },
    { name: 'Karfreitag',          date: addDays(easter, -2)   },
    { name: 'Ostermontag',         date: addDays(easter, 1)    },
    { name: 'Tag der Arbeit',      date: new Date(year, 4, 1)  },
    { name: 'Christi Himmelfahrt', date: addDays(easter, 39)   },
    { name: 'Pfingstmontag',       date: addDays(easter, 50)   },
    { name: 'Fronleichnam',        date: addDays(easter, 60)   }, // NRW
    { name: 'Tag der deutschen Einheit', date: new Date(year, 9, 3)  },
    { name: 'Allerheiligen',       date: new Date(year, 10, 1) }, // NRW
    { name: '1. Weihnachtstag',    date: new Date(year, 11, 25) },
    { name: '2. Weihnachtstag',    date: new Date(year, 11, 26) },
  ];
}

/**
 * Fetch NRW school holidays for a given year from ferien-api.de.
 * Cached in-memory per year.
 * @param {number} year
 * @returns {Promise<Array<{name: string, start: string, end: string}>>}
 */
async function fetchSchoolHolidays(year) {
  if (schoolHolidayCache.has(year)) return schoolHolidayCache.get(year);

  const res = await fetch(`https://ferien-api.de/api/v1/holidays/NW/${year}`);
  if (!res.ok) throw new Error(`ferien-api.de failed: ${res.status}`);
  const data = await res.json();
  schoolHolidayCache.set(year, data);
  return data; // [{name, start, end, stateCode, year}, ...]
}

/**
 * Get all holidays (public + school) in a date range.
 * Returns one entry per calendar date that is a holiday.
 * School holiday periods are expanded to individual dates.
 * If ferien-api.de is unreachable, gracefully returns only public holidays.
 *
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {Promise<Array<{name: string, date: Date}>>}
 */
export async function getHolidaysInRange(startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Collect all years in range
  const years = new Set();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    years.add(y);
  }

  // Build a map: dateKey -> holiday name
  // Public holidays are added first, school holidays fill remaining days
  const holidayMap = new Map();

  for (const year of years) {
    for (const { name, date } of getPublicHolidays(year)) {
      if (date >= start && date <= end) {
        holidayMap.set(toDateKey(date), name);
      }
    }
  }

  // Fetch school holidays — graceful degradation if API fails
  try {
    for (const year of years) {
      const schoolHolidays = await fetchSchoolHolidays(year);
      for (const period of schoolHolidays) {
        const periodStart = new Date(period.start);
        const periodEnd = new Date(period.end);
        // Clamp to our range
        const cur = new Date(Math.max(periodStart.getTime(), start.getTime()));
        cur.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(Math.min(periodEnd.getTime(), end.getTime()));
        while (cur <= rangeEnd) {
          const key = toDateKey(cur);
          if (!holidayMap.has(key)) {
            holidayMap.set(key, period.name || 'Schulferien');
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
  } catch (err) {
    logger.warn('Could not fetch NRW school holidays from ferien-api.de — using public holidays only', {
      error: err.message,
    });
  }

  // Convert map back to array sorted by date
  return Array.from(holidayMap.entries())
    .map(([key, name]) => ({ name, date: new Date(key) }))
    .sort((a, b) => a.date - b.date);
}

/**
 * Check if a date is a holiday.
 * @param {Date} date
 * @param {Array<{name: string, date: Date}>} holidays
 * @returns {boolean}
 */
export function isHolidayDate(date, holidays) {
  const key = toDateKey(date);
  return holidays.some(h => toDateKey(h.date) === key);
}

/**
 * Get the holiday name for a date, or null if not a holiday.
 * @param {Date} date
 * @param {Array<{name: string, date: Date}>} holidays
 * @returns {string|null}
 */
export function getHolidayName(date, holidays) {
  const key = toDateKey(date);
  const found = holidays.find(h => toDateKey(h.date) === key);
  return found ? found.name : null;
}

/**
 * Get all dates in [startDate, endDate] whose weekday matches dayNum.
 * dayNum: 0=Sunday, 1=Monday, ..., 6=Saturday
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @param {number} dayNum
 * @returns {Date[]}
 */
export function getDatesInRangeForDay(startDate, endDate, dayNum) {
  const dates = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Find the first occurrence of dayNum on or after start
  const current = new Date(start);
  let daysUntil = dayNum - current.getDay();
  if (daysUntil < 0) daysUntil += 7;
  current.setDate(current.getDate() + daysUntil);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}
