import {
  replacePlaceholders,
  htmlToPlainText,
  wrapInMondoEmailTemplate,
  renderBroadcastEmail
} from '../../utils/broadcastEmailRenderer.js';

describe('broadcastEmailRenderer Unit Tests', () => {
  describe('replacePlaceholders', () => {
    it('replaces {Vorname} and {Nachname} correctly', () => {
      const template = 'Hallo {Vorname} {Nachname}, willkommen im Portal!';
      const user = { firstName: 'Max', lastName: 'Mustermann' };
      expect(replacePlaceholders(template, user)).toBe('Hallo Max Mustermann, willkommen im Portal!');
    });

    it('handles {firstName} and {lastName} case-insensitively', () => {
      const template = 'Liebe/r {firstname} {LASTNAME},';
      const user = { firstName: 'Julia', lastName: 'Schmidt' };
      expect(replacePlaceholders(template, user)).toBe('Liebe/r Julia Schmidt,');
    });

    it('replaces {PortalLink} with portal URL', () => {
      const template = 'Zum Login: {PortalLink}';
      const user = { firstName: 'Tom' };
      const res = replacePlaceholders(template, user);
      expect(res).toContain('http');
    });

    it('handles missing user fields gracefully without throwing', () => {
      const template = 'Hallo {Vorname}!';
      expect(replacePlaceholders(template, {})).toBe('Hallo !');
      expect(replacePlaceholders('', {})).toBe('');
      expect(replacePlaceholders(null, {})).toBe('');
    });
  });

  describe('htmlToPlainText', () => {
    it('converts paragraphs and line breaks into clean newlines', () => {
      const html = '<p>Absatz 1</p><p>Absatz 2<br>Zweite Zeile</p>';
      const text = htmlToPlainText(html);
      expect(text).toContain('Absatz 1');
      expect(text).toContain('Absatz 2\nZweite Zeile');
    });

    it('converts unordered lists into bullet points', () => {
      const html = '<ul><li>Punkt A</li><li>Punkt B</li></ul>';
      const text = htmlToPlainText(html);
      expect(text).toContain('• Punkt A');
      expect(text).toContain('• Punkt B');
    });

    it('formats hyperlinks into text with URL in parentheses', () => {
      const html = '<p>Hier geht es zur <a href="https://www.mondo-tennis.de/anmeldung">Anmeldung</a>.</p>';
      const text = htmlToPlainText(html);
      expect(text).toContain('Anmeldung (https://www.mondo-tennis.de/anmeldung)');
    });

    it('decodes HTML entities properly', () => {
      const html = '<p>Sport &amp; Spiel für 10 &euro; &quot;Top&quot;</p>';
      const text = htmlToPlainText(html);
      expect(text).toBe('Sport & Spiel für 10 € "Top"');
    });
  });

  describe('wrapInMondoEmailTemplate', () => {
    it('wraps HTML content inside responsive Mondo layout with header and footer', () => {
      const innerHtml = '<p>Das Wintertraining startet bald.</p>';
      const fullHtml = wrapInMondoEmailTemplate(innerHtml, {
        subject: 'Wichtige Info',
        user: { firstName: 'Nicole' }
      });

      expect(fullHtml).toContain('<!DOCTYPE html>');
      expect(fullHtml).toContain('Mondo Tennisschule');
      expect(fullHtml).toContain('TC GW Am Kreuzberg e.V.');
      expect(fullHtml).toContain('Das Wintertraining startet bald.');
      expect(fullHtml).toContain('info@mondo-tennisschule.de');
    });
  });

  describe('renderBroadcastEmail', () => {
    it('returns both HTML and plain text with personalized placeholders and subject', () => {
      const rawHtml = '<p>Hallo {Vorname},</p><p>Dein Kurs startet.</p>';
      const user = { firstName: 'Alexander', lastName: 'Zverev' };
      const { subject, html, text } = renderBroadcastEmail(rawHtml, user, {
        subject: 'Training für {Vorname}'
      });

      expect(subject).toBe('Training für Alexander');
      expect(html).toContain('Hallo Alexander,');
      expect(html).toContain('<!DOCTYPE html>');
      expect(text).toContain('Hallo Alexander,');
      expect(text).toContain('Dein Kurs startet.');
      expect(text).toContain('info@mondo-tennisschule.de');
    });
  });
});
