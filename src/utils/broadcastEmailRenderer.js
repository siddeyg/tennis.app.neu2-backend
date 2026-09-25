/**
 * Broadcast Email Renderer
 *
 * Provides responsive Mondo-branded HTML email templating,
 * automatic plain-text generation (Multipart MIME),
 * and dynamic recipient personalization ({Vorname}, {Nachname}, {PortalLink}).
 */

/**
 * Replace placeholders in a text/HTML string with recipient-specific values.
 *
 * Supported placeholders:
 * - {Vorname} / {firstName}
 * - {Nachname} / {lastName}
 * - {PortalLink}
 */
/**
 * Replace placeholders in a text/HTML string with recipient-specific values.
 *
 * Supported placeholders:
 * - {Vorname} / {firstName}
 * - {Nachname} / {lastName}
 * - {Anrede} / {salutation} (smart fallback: "Liebe Familie Müller", "Hallo Tim & Lisa", "Hallo Max", "Hallo Tennis-Freunde")
 * - {PortalLink}
 * - {Datum} / {date}
 * - {Saison} / {season}
 */
export function replacePlaceholders(template, user = {}, options = {}) {
  if (!template) return '';

  const firstName = user.firstName || '';
  const lastName = user.lastName || '';
  const portalUrl = process.env.PORTAL_URL || process.env.STUDENT_PORTAL_URL || process.env.FRONTEND_URL || 'https://www.mondo-tennis.de';

  // Smart Salutation Logic
  let salutation = user.salutation || '';
  if (!salutation) {
    if (user.isFamily && lastName) {
      salutation = firstName ? `Liebe Familie ${lastName} (${firstName})` : `Liebe Familie ${lastName}`;
    } else if (firstName) {
      salutation = `Hallo ${firstName}`;
    } else {
      salutation = 'Hallo Tennis-Freunde';
    }
  }

  // Formatted date (German format: 25.09.2026)
  const todayFormatted = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());

  const seasonName = user.seasonName || options.seasonName || 'Wintertraining 2026/2027';

  return template
    .replace(/\{Vorname\}|\{firstName\}/gi, firstName)
    .replace(/\{Nachname\}|\{lastName\}/gi, lastName)
    .replace(/\{Anrede\}|\{salutation\}/gi, salutation)
    .replace(/\{PortalLink\}/gi, portalUrl)
    .replace(/\{Datum\}|\{date\}/gi, todayFormatted)
    .replace(/\{Saison\}|\{season\}/gi, seasonName);
}

/**
 * Transform CTA buttons inside HTML to bulletproof table-based Outlook & Mobile buttons
 */
export function transformCtaButtons(html) {
  if (!html) return '';

  // Match links having class or data-type for buttons
  return html.replace(/<a\s+([^>]*?(?:class="(?:[^"]*?\b(?:email-button|btn-primary|button)\b[^"]*?)"|data-type="cta-button")[^>]*?)>(.*?)<\/a>/gi, (match, attrs, linkText) => {
    // Extract href
    const hrefMatch = attrs.match(/href="([^"]*)"/i);
    const href = hrefMatch ? hrefMatch[1] : '#';
    const cleanText = linkText.replace(/<[^>]+>/g, '').trim();

    return `
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 22px auto; text-align: center;">
  <tr>
    <td align="center" style="background-color: #00838f; border-radius: 6px; padding: 12px 28px;">
      <a href="${href}" target="_blank" style="color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: inline-block;">
        ${cleanText}
      </a>
    </td>
  </tr>
</table>`;
  });
}

/**
 * Ensure all image tags have alt attributes to prevent spam penalty
 */
export function ensureImageAltAttributes(html) {
  if (!html) return '';
  return html.replace(/<img\s+([^>]*?)>/gi, (match, attrs) => {
    if (!/alt=["'][^"']*["']/i.test(attrs)) {
      return `<img ${attrs} alt="Mondo Tennisschule Info">`;
    }
    return match;
  });
}

/**
 * Convert HTML to clean, readable plain text.
 */
export function htmlToPlainText(html) {
  if (!html) return '';

  let text = html;

  // Format CTA buttons and regular links
  text = text.replace(/<a\s+([^>]*?)>(.*?)<\/a>/gi, (match, attrs, linkText) => {
    const isCta = /(?:class=["'][^"']*?\b(?:email-button|btn-primary|button)\b|data-type=["']cta-button["'])/i.test(attrs);
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const href = hrefMatch ? hrefMatch[1] : '';
    const cleanText = linkText.replace(/<[^>]+>/g, '').trim();

    if (isCta) {
      return `\n\n👉 [${cleanText}]: ${href}\n\n`;
    }
    if (!cleanText || cleanText === href) return href;
    return `${cleanText} (${href})`;
  });

  // Replace line breaks and paragraph ends
  text = text.replace(/<br\s*[\/]?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<hr\s*[\/]?>/gi, '\n---\n');

  // Format list items
  text = text.replace(/<li[^>]*>/gi, '\n• ');
  text = text.replace(/<\/li>/gi, '');
  text = text.replace(/<\/(ul|ol)>/gi, '\n');

  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&euro;/gi, '€');

  // Normalize whitespace and multiple empty lines
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Wrap rich-text HTML into the responsive Mondo Tennisschule email frame.
 */
export function wrapInMondoEmailTemplate(innerHtml, { subject = 'Mondo Tennisschule', user = {} } = {}) {
  const portalUrl = process.env.STUDENT_PORTAL_URL || process.env.FRONTEND_URL || 'https://www.mondo-tennis.de';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: #333333;
    }
    .wrapper {
      width: 100%;
      background-color: #f5f5f5;
      padding: 30px 10px;
      box-sizing: border-box;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border: 1px solid #e0e0e0;
    }
    .header {
      background: linear-gradient(135deg, #00838f 0%, #00acc1 100%);
      color: #ffffff;
      padding: 30px 25px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 14px;
      opacity: 0.95;
    }
    .content {
      padding: 35px 30px;
      background-color: #ffffff;
      color: #333333;
    }
    .content h1, .content h2, .content h3 {
      color: #00838f;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    .content p {
      margin-top: 0;
      margin-bottom: 16px;
    }
    .content ul, .content ol {
      margin-top: 0;
      margin-bottom: 16px;
      padding-left: 24px;
    }
    .content li {
      margin-bottom: 6px;
    }
    .content img {
      max-width: 100% !important;
      height: auto !important;
      border-radius: 6px;
      margin: 15px 0;
    }
    .content blockquote {
      border-left: 4px solid #00acc1;
      padding: 10px 16px;
      margin: 16px 0;
      background-color: #f0fdf4;
      color: #155e75;
      border-radius: 0 4px 4px 0;
    }
    .content a {
      color: #00838f;
      text-decoration: underline;
      font-weight: 500;
    }
    .footer {
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 24px 20px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer a {
      color: #00838f;
      text-decoration: none;
    }
    .footer-note {
      margin-bottom: 12px;
      font-style: italic;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 25px 18px !important;
      }
      .header {
        padding: 24px 18px !important;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>🎾 Mondo Tennisschule</h1>
        <p>TC GW Am Kreuzberg e.V.</p>
      </div>

      <div class="content">
        ${innerHtml}
      </div>

      <div class="footer">
        <p class="footer-note">Sie erhalten diese E-Mail als registriertes Mitglied / Nutzer der Mondo Tennisschule.</p>
        <p style="margin: 6px 0;"><strong>Mondo Tennisschule</strong></p>
        <p style="margin: 4px 0;">Bei Fragen antworten Sie einfach auf diese E-Mail (<a href="mailto:info@mondo-tennisschule.de">info@mondo-tennisschule.de</a>).</p>
        <p style="margin: 4px 0;"><a href="http://mondo-tennisschule.de" target="_blank">http://mondo-tennisschule.de</a></p>
        <p style="margin-top: 6px;">Online-Portal: <a href="${portalUrl}" target="_blank">${portalUrl}</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render complete broadcast email (HTML + plain text) for a given recipient.
 */
export function renderBroadcastEmail(rawHtml, user = {}, { subject = '', seasonName = '' } = {}) {
  // 1. Personalize inner HTML
  const personalizedInnerHtml = replacePlaceholders(rawHtml, user, { seasonName });
  const personalizedSubject = replacePlaceholders(subject, user, { seasonName });

  // 2. Transform CTA buttons & ensure image alt attributes
  const withCtaButtons = transformCtaButtons(personalizedInnerHtml);
  const compliantHtml = ensureImageAltAttributes(withCtaButtons);

  // 3. Wrap into responsive Mondo template
  const fullHtml = wrapInMondoEmailTemplate(compliantHtml, {
    subject: personalizedSubject,
    user
  });

  // 4. Generate plain text fallback
  const plainText = htmlToPlainText(personalizedInnerHtml);
  const portalUrl = process.env.STUDENT_PORTAL_URL || process.env.PORTAL_URL || 'https://www.mondo-tennis.de';
  const fullText = `${plainText}\n\n---\nMondo Tennisschule\nBei Fragen antworten Sie einfach auf diese E-Mail (info@mondo-tennisschule.de).\nhttp://mondo-tennisschule.de\nOnline-Portal: ${portalUrl}`;

  return {
    subject: personalizedSubject,
    html: fullHtml,
    text: fullText
  };
}
