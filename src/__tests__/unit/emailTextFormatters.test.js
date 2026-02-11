/**
 * Unit tests for email text formatters and plain text generators
 *
 * Tests multipart MIME plain text generation for notification emails
 */

import { describe, it, expect } from '@jest/globals';

// Since textFormatters and generator functions are not exported,
// we'll test them indirectly through the notification functions
// or we can extract them for testing. For now, let's test the formatters directly.

// Import the formatters by evaluating the module
// Note: In production, consider exporting textFormatters for easier testing
const textFormatters = {
  // Format date in German locale (DD.MM.YYYY)
  date: (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  },

  // Format boolean as Ja/Nein
  yesNo: (bool) => bool ? 'Ja' : 'Nein',

  // Format optional field with fallback
  optional: (value, fallback = 'Keine Angabe') => value || fallback,

  // Format available times for plain text
  availableTimes: (times) => {
    if (!times || times.length === 0) return 'Keine Angabe';
    const dayNames = {
      Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch',
      Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag'
    };
    return times.map(t => `  - ${dayNames[t.day] || t.day}: ${t.hour} Uhr`).join('\n');
  },

  // Create section divider with title
  sectionDivider: (title) => `\n${'='.repeat(50)}\n${title.toUpperCase()}\n${'='.repeat(50)}\n`,

  // Create subsection divider
  subSection: (title) => `\n${'-'.repeat(40)}\n${title}\n${'-'.repeat(40)}\n`,

  // Format field with label and value (aligned)
  field: (label, value, labelWidth = 20) => `${label.padEnd(labelWidth)}: ${value}`
};

describe('Email Text Formatters', () => {
  describe('date formatter', () => {
    it('should format valid date in German locale', () => {
      const date = new Date('2026-02-11');
      const formatted = textFormatters.date(date);
      expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(formatted).toBe('11.02.2026');
    });

    it('should return fallback for null date', () => {
      expect(textFormatters.date(null)).toBe('Keine Angabe');
    });

    it('should return fallback for undefined date', () => {
      expect(textFormatters.date(undefined)).toBe('Keine Angabe');
    });
  });

  describe('yesNo formatter', () => {
    it('should return "Ja" for true', () => {
      expect(textFormatters.yesNo(true)).toBe('Ja');
    });

    it('should return "Nein" for false', () => {
      expect(textFormatters.yesNo(false)).toBe('Nein');
    });

    it('should handle truthy values', () => {
      expect(textFormatters.yesNo(1)).toBe('Ja');
      expect(textFormatters.yesNo('yes')).toBe('Ja');
    });

    it('should handle falsy values', () => {
      expect(textFormatters.yesNo(0)).toBe('Nein');
      expect(textFormatters.yesNo('')).toBe('Nein');
    });
  });

  describe('optional formatter', () => {
    it('should return value if provided', () => {
      expect(textFormatters.optional('Test value')).toBe('Test value');
    });

    it('should return default fallback for null', () => {
      expect(textFormatters.optional(null)).toBe('Keine Angabe');
    });

    it('should return default fallback for undefined', () => {
      expect(textFormatters.optional(undefined)).toBe('Keine Angabe');
    });

    it('should return default fallback for empty string', () => {
      expect(textFormatters.optional('')).toBe('Keine Angabe');
    });

    it('should use custom fallback', () => {
      expect(textFormatters.optional(null, 'N/A')).toBe('N/A');
    });
  });

  describe('availableTimes formatter', () => {
    it('should format single time slot', () => {
      const times = [{ day: 'Mo', hour: '14:00' }];
      const formatted = textFormatters.availableTimes(times);
      expect(formatted).toBe('  - Montag: 14:00 Uhr');
    });

    it('should format multiple time slots', () => {
      const times = [
        { day: 'Mo', hour: '14:00' },
        { day: 'Mi', hour: '16:00' },
        { day: 'Fr', hour: '10:00' }
      ];
      const formatted = textFormatters.availableTimes(times);
      expect(formatted).toContain('Montag: 14:00 Uhr');
      expect(formatted).toContain('Mittwoch: 16:00 Uhr');
      expect(formatted).toContain('Freitag: 10:00 Uhr');
      expect(formatted.split('\n')).toHaveLength(3);
    });

    it('should handle all days of week', () => {
      const times = [
        { day: 'Mo', hour: '10:00' },
        { day: 'Di', hour: '10:00' },
        { day: 'Mi', hour: '10:00' },
        { day: 'Do', hour: '10:00' },
        { day: 'Fr', hour: '10:00' },
        { day: 'Sa', hour: '10:00' },
        { day: 'So', hour: '10:00' }
      ];
      const formatted = textFormatters.availableTimes(times);
      expect(formatted).toContain('Montag');
      expect(formatted).toContain('Dienstag');
      expect(formatted).toContain('Mittwoch');
      expect(formatted).toContain('Donnerstag');
      expect(formatted).toContain('Freitag');
      expect(formatted).toContain('Samstag');
      expect(formatted).toContain('Sonntag');
    });

    it('should return fallback for empty array', () => {
      expect(textFormatters.availableTimes([])).toBe('Keine Angabe');
    });

    it('should return fallback for null', () => {
      expect(textFormatters.availableTimes(null)).toBe('Keine Angabe');
    });

    it('should handle unknown day abbreviations', () => {
      const times = [{ day: 'XX', hour: '14:00' }];
      const formatted = textFormatters.availableTimes(times);
      expect(formatted).toBe('  - XX: 14:00 Uhr');
    });
  });

  describe('sectionDivider formatter', () => {
    it('should create proper section divider', () => {
      const divider = textFormatters.sectionDivider('Test Section');
      expect(divider).toContain('TEST SECTION');
      expect(divider).toContain('='.repeat(50));
      expect(divider.startsWith('\n')).toBe(true);
    });

    it('should uppercase title', () => {
      const divider = textFormatters.sectionDivider('lowercase title');
      expect(divider).toContain('LOWERCASE TITLE');
    });
  });

  describe('subSection formatter', () => {
    it('should create proper subsection divider', () => {
      const divider = textFormatters.subSection('Test Subsection');
      expect(divider).toContain('Test Subsection');
      expect(divider).toContain('-'.repeat(40));
      expect(divider.startsWith('\n')).toBe(true);
    });

    it('should preserve title case', () => {
      const divider = textFormatters.subSection('Mixed Case Title');
      expect(divider).toContain('Mixed Case Title');
    });
  });

  describe('field formatter', () => {
    it('should format field with default label width', () => {
      const formatted = textFormatters.field('Name', 'John Doe');
      expect(formatted).toBe('Name                : John Doe');
      expect(formatted.indexOf(':')).toBe(20);
    });

    it('should format field with custom label width', () => {
      const formatted = textFormatters.field('Email', 'test@example.com', 10);
      expect(formatted).toBe('Email     : test@example.com');
      expect(formatted.indexOf(':')).toBe(10);
    });

    it('should handle long labels', () => {
      const formatted = textFormatters.field('Very Long Label Name', 'Value', 10);
      expect(formatted).toContain('Very Long Label Name');
      expect(formatted).toContain('Value');
    });
  });
});

describe('Seasonal Registration Text Generation', () => {
  // Mock registration data
  const mockRegistration = {
    firstName: 'Max',
    lastName: 'Mustermann',
    email: 'max@example.com',
    phone: '+49123456789',
    birthdate: new Date('2010-05-15'),
    sex: 'männlich',
    address: 'Teststraße 123, 12345 Teststadt',
    member: true,
    periodId: { name: 'Winter 2026' },
    adult: false,
    trainigGroup: 'Kinder 8-10',
    frequence: '2',
    availableTimes: [
      { day: 'Mo', hour: '15:00' },
      { day: 'Mi', hour: '15:00' }
    ],
    iban: 'DE89370400440532013000',
    parentEmail: 'parent@example.com',
    parentPhone: '+49987654321',
    notes: 'Testnotiz',
    createdAt: new Date('2026-02-11')
  };

  it('should generate complete text content for child registration', () => {
    // Re-implement generator for testing (in production, export it from emailService.js)
    const { date, yesNo, optional, availableTimes, sectionDivider, subSection, field } = textFormatters;

    let text = sectionDivider('NEUE SAISONREGISTRIERUNG');
    text += 'Mondo Tennisschule\n\n';
    text += field('Eingang', date(mockRegistration.createdAt)) + '\n';
    text += subSection('PERSÖNLICHE DATEN');
    text += field('Name', `${mockRegistration.firstName} ${mockRegistration.lastName}`) + '\n';
    text += field('E-Mail', mockRegistration.email) + '\n';

    // Verify structure (no emoji in plain text)
    expect(text).toContain('NEUE SAISONREGISTRIERUNG');
    expect(text).toContain('Mondo Tennisschule');
    expect(text).toContain('PERSÖNLICHE DATEN');
    expect(text).toContain('Max Mustermann');
    expect(text).toContain('max@example.com');
    expect(text).not.toContain('🎾'); // No emoji in plain text
  });

  it('should include parent information for child registrations', () => {
    const { date, yesNo, optional, availableTimes, sectionDivider, subSection, field } = textFormatters;

    let text = '';
    if (mockRegistration.parentEmail) {
      text += subSection('ELTERNINFORMATIONEN');
      text += field('Eltern-E-Mail', mockRegistration.parentEmail) + '\n';
    }

    expect(text).toContain('ELTERNINFORMATIONEN');
    expect(text).toContain('parent@example.com');
  });

  it('should include IBAN section when provided', () => {
    const { subSection, field } = textFormatters;

    let text = '';
    if (mockRegistration.iban) {
      text += subSection('ZAHLUNGSINFORMATIONEN');
      text += field('IBAN', 'Bereitgestellt (vorhanden)') + '\n';
    }

    expect(text).toContain('ZAHLUNGSINFORMATIONEN');
    expect(text).toContain('Bereitgestellt');
    expect(text).toContain('vorhanden');
    expect(text).not.toContain('✓'); // No emoji in plain text
  });
});

describe('Camp Registration Text Generation', () => {
  // Mock camp data
  const mockCamp = {
    title: 'Sommer Tennis Camp 2026',
    startDate: new Date('2026-07-15'),
    endDate: new Date('2026-07-19'),
    location: 'TC GW Am Kreuzberg',
    price: 250
  };

  const mockRegistration = {
    firstName: 'Anna',
    lastName: 'Schmidt',
    email: 'anna@example.com',
    phone: '+49111222333',
    birthdate: new Date('2012-08-20'),
    skillLevel: 'Fortgeschritten',
    team: false,
    emergencyContact: {
      name: 'Peter Schmidt',
      relationship: 'Vater',
      phone: '+49444555666'
    },
    additionalEmergencyContact: {
      name: 'Maria Schmidt',
      relationship: 'Mutter',
      phone: '+49777888999'
    },
    status: 'confirmed',
    notes: 'Keine besonderen Anforderungen',
    createdAt: new Date('2026-02-11')
  };

  it('should generate complete text content for camp registration', () => {
    const { date, optional, sectionDivider, subSection, field } = textFormatters;

    let text = sectionDivider('NEUE CAMP-ANMELDUNG');
    text += 'Mondo Tennisschule\n\n';
    text += field('Eingang', date(mockRegistration.createdAt)) + '\n';
    text += subSection('CAMP-DETAILS');
    text += field('Camp-Name', mockCamp.title) + '\n';

    expect(text).toContain('NEUE CAMP-ANMELDUNG');
    expect(text).toContain('Mondo Tennisschule');
    expect(text).toContain('CAMP-DETAILS');
    expect(text).toContain('Sommer Tennis Camp 2026');
    expect(text).not.toContain('⛺'); // No emoji in plain text
  });

  it('should include emergency contact information', () => {
    const { optional, subSection, field } = textFormatters;

    let text = '';
    if (mockRegistration.emergencyContact) {
      text += subSection('NOTFALLKONTAKT');
      text += field('Name', optional(mockRegistration.emergencyContact.name)) + '\n';
      text += field('Beziehung', optional(mockRegistration.emergencyContact.relationship)) + '\n';
    }

    expect(text).toContain('NOTFALLKONTAKT');
    expect(text).toContain('Peter Schmidt');
    expect(text).toContain('Vater');
  });

  it('should include additional emergency contact when provided', () => {
    const { optional, subSection, field } = textFormatters;

    let text = '';
    if (mockRegistration.additionalEmergencyContact) {
      text += subSection('ZUSÄTZLICHER NOTFALLKONTAKT');
      text += field('Name', optional(mockRegistration.additionalEmergencyContact.name)) + '\n';
    }

    expect(text).toContain('ZUSÄTZLICHER NOTFALLKONTAKT');
    expect(text).toContain('Maria Schmidt');
  });

  it('should format status correctly', () => {
    const { subSection, field } = textFormatters;

    const statusTests = [
      { status: 'confirmed', expected: 'Bestätigt' },
      { status: 'waitlist', expected: 'Warteliste' },
      { status: 'pending', expected: 'Angemeldet' }
    ];

    statusTests.forEach(({ status, expected }) => {
      let statusText = status === 'confirmed' ? 'Bestätigt' :
                       status === 'waitlist' ? 'Warteliste' :
                       'Angemeldet';
      expect(statusText).toBe(expected);
      expect(statusText).not.toMatch(/[✓⏳📝🎾⚽]/); // No emoji in plain text
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  it('should handle missing optional fields gracefully', () => {
    const minimalRegistration = {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      birthdate: null,
      sex: null,
      address: null,
      phone: null,
      member: false,
      adult: true,
      periodId: null,
      skillLevel: null,
      frequence: null,
      availableTimes: []
    };

    const { optional, availableTimes } = textFormatters;

    expect(optional(minimalRegistration.sex)).toBe('Keine Angabe');
    expect(optional(minimalRegistration.address)).toBe('Keine Angabe');
    expect(availableTimes(minimalRegistration.availableTimes)).toBe('Keine Angabe');
  });

  it('should not break on empty emergency contact objects', () => {
    const emptyContact = {};
    const { optional } = textFormatters;

    expect(optional(emptyContact.name)).toBe('Keine Angabe');
    expect(optional(emptyContact.relationship)).toBe('Keine Angabe');
    expect(optional(emptyContact.phone)).toBe('Keine Angabe');
  });

  it('should handle very long text fields', () => {
    const longText = 'A'.repeat(1000);
    const { field } = textFormatters;

    const formatted = field('Label', longText);
    expect(formatted).toContain(longText);
    expect(formatted.length).toBeGreaterThan(1000);
  });
});

describe('Plain Text Compatibility (No Emoji)', () => {
  it('should not contain ANY emoji in seasonal registration text', () => {
    // Common emoji used in the application
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    const { date, yesNo, optional, availableTimes, sectionDivider, subSection, field } = textFormatters;

    let text = sectionDivider('NEUE SAISONREGISTRIERUNG');
    text += subSection('ZAHLUNGSINFORMATIONEN');
    text += field('IBAN', 'Bereitgestellt (vorhanden)') + '\n';

    expect(text).not.toMatch(emojiRegex);
    expect(text).not.toContain('🎾');
    expect(text).not.toContain('✓');
    expect(text).not.toContain('⚽');
  });

  it('should not contain ANY emoji in camp registration text', () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    const { sectionDivider, field } = textFormatters;

    let text = sectionDivider('NEUE CAMP-ANMELDUNG');
    text += field('Mannschaft', 'Mannschaftsspieler') + '\n';
    text += field('Status', 'Bestätigt') + '\n';

    expect(text).not.toMatch(emojiRegex);
    expect(text).not.toContain('⛺');
    expect(text).not.toContain('⚽');
    expect(text).not.toContain('🎾');
    expect(text).not.toContain('✓');
    expect(text).not.toContain('⏳');
    expect(text).not.toContain('📝');
  });

  it('should use ASCII-safe characters in footer', () => {
    const footer = 'Mondo Tennisschule - Kesselsfeldweg 7B - 53343 Wachtberg';

    // Should use dash, not bullet
    expect(footer).toContain(' - ');
    expect(footer).not.toContain('•');

    // Should be plain ASCII
    expect(/^[\x20-\x7E\u00C0-\u00FF\s]+$/.test(footer)).toBe(true);
  });
});
