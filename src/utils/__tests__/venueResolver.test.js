import { resolveVenueForAssignment } from '../venueResolver.js';

describe('Venue Resolver Utility', () => {
  it('returns assignment.venue immediately if already set', () => {
    const student = { availableTimes: [{ day: 'Montag', hour: 14, venue: 'Available Venue' }] };
    const assignment = { day: 'Montag', hour: 14, venue: 'Existing Venue' };
    expect(resolveVenueForAssignment(student, assignment)).toBe('Existing Venue');
  });

  it('resolves venue from student.availableTimes if assignment.venue is empty', () => {
    const student = {
      availableTimes: [
        { day: 'Dienstag', hour: 16, venue: 'BTHV Teppich' },
        { day: 'Montag', hour: 14, venue: 'Brüser Berg' }
      ]
    };
    const assignment = { day: 'Montag', hour: 14, venue: '' };
    expect(resolveVenueForAssignment(student, assignment)).toBe('Brüser Berg');
  });

  it('resolves venue from student.availableTimes matching string hour and float hour', () => {
    const student = {
      availableTimes: [
        { day: 'Mittwoch', hour: '17', venue: 'BTHV Traglufthalle' }
      ]
    };
    const assignment = { day: 'Mittwoch', hour: 17.5, venue: '' };
    expect(resolveVenueForAssignment(student, assignment)).toBe('BTHV Traglufthalle');
  });

  it('resolves venue from student.priorityTime if availableTimes does not match', () => {
    const student = {
      availableTimes: [],
      priorityTime: { day: 'Donnerstag', hour: 18, venue: 'Robinson Club (Teppich)' }
    };
    const assignment = { day: 'Donnerstag', hour: 18, venue: '' };
    expect(resolveVenueForAssignment(student, assignment)).toBe('Robinson Club (Teppich)');
  });

  it('resolves venue from period.trainingSlots / trainingSlotsAdults if student times are empty', () => {
    const adultStudent = {
      adult: true,
      availableTimes: []
    };
    const period = {
      season: 'winter',
      trainingSlotsAdults: [
        { day: 'Freitag', hour: '15', venues: ['TC Brüser Berg (Sand)'] }
      ]
    };
    const assignment = { day: 'Freitag', hour: 15, venue: '' };
    expect(resolveVenueForAssignment(adultStudent, assignment, period)).toBe('TC Brüser Berg (Sand)');
  });

  it('resolves venue from period.trainingSlots (kids)', () => {
    const kidStudent = {
      adult: false,
      availableTimes: []
    };
    const period = {
      season: 'winter',
      trainingSlots: [
        { day: 'Samstag', hour: 10, venues: ['BonnerTHV – Traglufthalle'] }
      ]
    };
    const assignment = { day: 'Samstag', hour: 10, venue: '' };
    expect(resolveVenueForAssignment(kidStudent, assignment, period)).toBe('BonnerTHV – Traglufthalle');
  });

  it('falls back to TC GW Am Kreuzberg for summer period if nothing matches', () => {
    const student = { availableTimes: [] };
    const period = { season: 'summer' };
    const assignment = { day: 'Montag', hour: 10, venue: '' };
    expect(resolveVenueForAssignment(student, assignment, period)).toBe('TC GW Am Kreuzberg');
  });

  it('returns empty string if nothing matches and period is winter without slot info', () => {
    const student = { availableTimes: [] };
    const period = { season: 'winter', trainingSlots: [] };
    const assignment = { day: 'Sonntag', hour: 8, venue: '' };
    expect(resolveVenueForAssignment(student, assignment, period)).toBe('');
  });
});
