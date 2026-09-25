import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import BroadcastEmail from '../models/BroadcastEmail.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import User from '../models/User.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import Camp from '../models/Camp.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import CampRegistration from '../models/CampRegistration.js';
import Student from '../models/Student.js';
import Announcement from '../models/Announcement.js';
import logger from '../utils/logger.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';
import { sendEmail } from '../utils/emailService.js';
import { renderBroadcastEmail, htmlToPlainText } from '../utils/broadcastEmailRenderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All broadcast routes require admin or supermod privileges
router.use(requireAuth, requireAdminOrSupermod);

// Ensure upload directories exist
const imagesUploadDir = path.join(__dirname, '../../uploads/broadcasts/images');
const attachmentsUploadDir = path.join(__dirname, '../../uploads/broadcasts/attachments');
const documentsUploadDir = path.join(__dirname, '../../uploads/documents');
const announcementsUploadDir = path.join(__dirname, '../../uploads/announcements');

if (!fs.existsSync(imagesUploadDir)) {
  fs.mkdirSync(imagesUploadDir, { recursive: true });
}
if (!fs.existsSync(attachmentsUploadDir)) {
  fs.mkdirSync(attachmentsUploadDir, { recursive: true });
}
if (!fs.existsSync(documentsUploadDir)) {
  fs.mkdirSync(documentsUploadDir, { recursive: true });
}
if (!fs.existsSync(announcementsUploadDir)) {
  fs.mkdirSync(announcementsUploadDir, { recursive: true });
}

/**
 * Safely resolves on-disk file path for attachments (either uploaded or from Documents library)
 */
function resolveAttachment(att) {
  let resolvedPath = att.path;
  if (att.documentId) {
    resolvedPath = path.join(documentsUploadDir, path.basename(att.filename));
  } else if (att.filename) {
    resolvedPath = path.join(attachmentsUploadDir, path.basename(att.filename));
  }
  if (!fs.existsSync(resolvedPath) && att.path && fs.existsSync(att.path)) {
    resolvedPath = att.path;
  }
  return {
    filename: att.originalName || att.filename,
    path: resolvedPath
  };
}

/**
 * Copies a broadcast attachment to the announcements folder for student portal dashboard downloads
 */
function copyAttachmentToAnnouncements(att) {
  const resolved = resolveAttachment(att);
  if (!resolved.path || !fs.existsSync(resolved.path)) return null;

  const targetFilename = `${crypto.randomUUID()}-${path.basename(resolved.filename)}`;
  const targetPath = path.join(announcementsUploadDir, targetFilename);

  try {
    fs.copyFileSync(resolved.path, targetPath);
    return {
      filename: targetFilename,
      originalName: att.originalName || path.basename(resolved.filename),
      mimeType: att.mimeType || 'application/pdf',
      size: att.size || fs.statSync(targetPath).size
    };
  } catch (err) {
    logger.error('Failed to copy attachment to announcements folder:', err);
    return null;
  }
}

// System-wide newsletter presets
export const SYSTEM_TEMPLATES = [
  {
    id: 'system_saisonstart',
    title: 'Saison-Start & Trainingsanmeldung',
    category: 'Saison',
    subject: 'Anmeldung freigeschaltet: {Saison} | Mondo Tennisschule',
    contentHtml: `<p>{Anrede},</p><p>die Vorbereitungen für die kommende Spielzeit laufen auf Hochtouren! Ab sofort ist das Anmeldefenster für das <strong>{Saison}</strong> im Online-Portal offiziell eröffnet.</p><h3>Wichtige Eckdaten:</h3><ul><li><strong>Trainingszeitraum:</strong> Beginn nach den Ferien</li><li><strong>Standorte:</strong> Brüser Berg, BTHV, Duisdorf &amp; Robinson Club</li><li><strong>Anmeldeschluss:</strong> Bitte rechtzeitig eintragen</li></ul><p>Über den folgenden Button gelangst du direkt zur Anmeldung:</p><p><a href="{PortalLink}" class="email-button" data-type="cta-button">Jetzt zur Trainingsanmeldung</a></p><p>Wir freuen uns auf eine erfolgreiche und sportliche Saison mit dir!</p><p>Herzliche Grüße,<br><strong>Nicole &amp; das Team der Mondo Tennisschule</strong></p>`
  },
  {
    id: 'system_halleninfo',
    title: 'Hallen-Info & Platzsperre / Verlegung',
    category: 'Organisation',
    subject: 'Wichtige Information zu deinem Training am {Datum}',
    contentHtml: `<p>{Anrede},</p><p>wir möchten dich über eine kurzfristige organisatorische Änderung für dein Training informieren:</p><blockquote><p><strong>Hinweis zum Spielort / Platz:</strong> Aufgrund von Wartungsarbeiten / Hallenbelegung findet das Training an einem Ausweichstandort bzw. zu leicht angepassten Zeiten statt.</p></blockquote><p>Bitte prüfe deinen aktuellen Zeitplan im Online-Portal:</p><p><a href="{PortalLink}" class="email-button" data-type="cta-button">Aktuellen Trainingsplan einsehen</a></p><p>Bei Fragen oder Unklarheiten kannst du direkt auf diese E-Mail antworten.</p><p>Sportliche Grüße,<br><strong>Mondo Tennisschule</strong></p>`
  },
  {
    id: 'system_event',
    title: 'Turnier- & Camp-Einladung',
    category: 'Events & Camps',
    subject: 'Einladung: Kommendes Tennis-Event / Camp',
    contentHtml: `<p>{Anrede},</p><p>wir laden dich herzlich zu unserem kommenden Tennis-Highlight ein!</p><h3>Details zum Event:</h3><ul><li><strong>Datum:</strong> In Kürze verfügbar</li><li><strong>Zielgruppe:</strong> Kinder, Jugendliche &amp; Erwachsene</li><li><strong>Programm:</strong> Matchpraxis, Techniktraining &amp; jede Menge Spaß!</li></ul><p>Die Teilnehmerplätze sind begrenzt. Sichere dir deinen Platz direkt über unser Portal:</p><p><a href="{PortalLink}" class="email-button" data-type="cta-button">Jetzt Platz sichern &amp; anmelden</a></p><p>Wir freuen uns auf dich!</p><p>Viele Grüße,<br><strong>Dein Mondo Trainerteam</strong></p>`
  },
  {
    id: 'system_newsletter',
    title: 'Allgemeiner Vereins- & Tennisschul-Newsletter',
    category: 'Newsletter',
    subject: 'Mondo Newsletter: Neuigkeiten & Termine | {Datum}',
    contentHtml: `<p>{Anrede},</p><p>herzlich willkommen zur neuesten Ausgabe unseres Newsletters! Wir blicken auf spannende Wochen zurück und möchten dir die wichtigsten Updates aus der Tennisschule und dem Verein mitgeben.</p><h3>Rückblick &amp; Highlights</h3><p>In den vergangenen Wochen haben unsere Teams und Trainingsgruppen großartige Fortschritte erzielt.</p><h3>Kommende Termine</h3><ul><li>Trainingsstart der neuen Saison</li><li>Sonder-Workshops &amp; Tennolino-Turniere</li><li>Vereinsfeste &amp; Events</li></ul><p><a href="{PortalLink}" class="email-button" data-type="cta-button">Zum Online-Portal</a></p><p>Vielen Dank für dein Vertrauen und deinen sportlichen Einsatz!</p><p>Sportliche Grüße,<br><strong>Nicole &amp; das Team der Mondo Tennisschule</strong></p>`
  }
];

// Multer storage configuration using random UUIDs to avoid path traversal
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, attachmentsUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const uploadImage = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Ungültiger Bildtyp. Erlaubt: JPEG, PNG, WEBP (max. 5 MB)'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const ALLOWED_ATTACHMENT_TYPES = ['application/pdf'];
const uploadAttachment = multer({
  storage: attachmentStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Ungültiger Dateityp. Als Anhang sind ausschließlich PDF-Dateien erlaubt (max. 10 MB).'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Helper to build database query for global target audience
 */
function buildAudienceQuery(targetAudience) {
  const query = {
    emailVerified: true,
    isActive: true
  };

  if (targetAudience === 'adults') {
    query.$or = [
      { 'familyMembers.0': { $exists: false } },
      { isAdult: true }
    ];
  } else if (targetAudience === 'children') {
    query['familyMembers.0'] = { $exists: true };
  }

  return query;
}

/**
 * Central Recipient Resolver for all 5 Targeting Modes
 * Includes strict status filtering and multi-child deduplication ("Tim & Lisa").
 */
export async function resolveRecipients({
  targetingType = 'global',
  targetCriteria = {},
  targetAudience = 'all'
}) {
  const recipientsMap = new Map(); // key: lowercase email -> recipient object

  const addRecipient = (email, data) => {
    if (!email || typeof email !== 'string' || !email.includes('@')) return;
    const cleanEmail = email.trim().toLowerCase();

    if (recipientsMap.has(cleanEmail)) {
      const existing = recipientsMap.get(cleanEmail);
      // Aggregate child names if different (e.g. parents registering 2 kids)
      if (data.childName && !existing.childNames.includes(data.childName)) {
        existing.childNames.push(data.childName);
        existing.isFamily = true;
        existing.firstName = existing.childNames.join(' & ');
        existing.name = `${existing.firstName} ${existing.lastName}`.trim();
      }
    } else {
      const childNames = data.childName ? [data.childName] : (data.childNames || []);
      recipientsMap.set(cleanEmail, {
        userId: data.userId || null,
        studentId: data.studentId || null,
        email: cleanEmail,
        firstName: childNames.length > 1 ? childNames.join(' & ') : (data.firstName || ''),
        lastName: data.lastName || '',
        childNames,
        isFamily: !!data.isFamily || childNames.length > 0,
        name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
        status: 'pending'
      });
    }
  };

  if (targetingType === 'global') {
    const query = buildAudienceQuery(targetAudience);
    const users = await StudentPortalUser.find(query).select('_id email firstName lastName familyMembers isAdult').lean();
    for (const u of users) {
      const hasKids = Array.isArray(u.familyMembers) && u.familyMembers.length > 0;
      const childNames = hasKids ? u.familyMembers.map(m => m.firstName).filter(Boolean) : [];
      addRecipient(u.email, {
        userId: u._id,
        firstName: childNames.length > 0 ? childNames.join(' & ') : (u.firstName || ''),
        lastName: u.lastName || '',
        childNames,
        isFamily: hasKids,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim()
      });
    }
  } else if (targetingType === 'seasonal') {
    // Only pending or processed registrations (NEVER cancelled or rejected)
    const query = {
      status: { $in: ['pending', 'processed'] }
    };
    if (targetCriteria.periodId) {
      query.periodId = targetCriteria.periodId;
    }
    if (targetCriteria.formType && targetCriteria.formType !== 'all') {
      query.formType = targetCriteria.formType;
    }
    if (targetCriteria.talentinosGroup && targetCriteria.talentinosGroup !== 'all') {
      const group = targetCriteria.talentinosGroup;
      if (group === 'kindergarten_rot') {
        query.trainingsart = { $regex: /kindergarten|rot/i };
      } else if (group === 'orange_gruen') {
        query.trainingsart = { $regex: /orange|grün|gruen/i };
      } else if (group === 'gelb') {
        query.trainingsart = { $regex: /^(?=.*gelb)(?!.*team).*$/i };
      } else if (group === 'team_gelb_u15') {
        query.trainingsart = { $regex: /team[- ]?gelb/i };
      }
    }

    const registrations = await SeasonalRegistration.find(query)
      .populate('studentPortalUserId', '_id email firstName lastName isActive emailVerified')
      .lean();

    for (const reg of registrations) {
      const user = reg.studentPortalUserId;
      const targetEmail = user?.email || reg.email;
      if (!targetEmail) continue;

      const isKids = reg.formType === 'kids';
      addRecipient(targetEmail, {
        userId: user?._id || null,
        studentId: reg.studentId || null,
        childName: isKids ? reg.firstName : null,
        firstName: reg.firstName,
        lastName: reg.lastName,
        isFamily: isKids,
        name: `${reg.firstName} ${reg.lastName}`.trim()
      });
    }
  } else if (targetingType === 'camp') {
    // Only pending or confirmed camp registrations (NEVER cancelled or rejected)
    const query = {
      status: { $in: ['pending', 'confirmed'] }
    };
    if (targetCriteria.campId) {
      query.campId = targetCriteria.campId;
    }

    const registrations = await CampRegistration.find(query)
      .populate('studentPortalUserId', '_id email firstName lastName isActive emailVerified')
      .lean();

    for (const reg of registrations) {
      const user = reg.studentPortalUserId;
      const targetEmail = user?.email || reg.email;
      if (!targetEmail) continue;

      addRecipient(targetEmail, {
        userId: user?._id || null,
        studentId: reg.studentId || null,
        childName: reg.firstName,
        firstName: reg.firstName,
        lastName: reg.lastName,
        isFamily: true,
        name: `${reg.firstName} ${reg.lastName}`.trim()
      });
    }
  } else if (targetingType === 'day_venue') {
    const elemMatch = {};
    if (targetCriteria.day) elemMatch.day = targetCriteria.day;
    if (targetCriteria.venue) elemMatch.venue = targetCriteria.venue;

    const query = {
      assignments: { $elemMatch: elemMatch }
    };

    const students = await Student.find(query).select('_id firstName lastName email adult assignments').lean();

    const studentEmails = students.map(s => s.email).filter(Boolean);
    const portalUsers = await StudentPortalUser.find({ email: { $in: studentEmails }, isActive: true }).lean();
    const portalUserMap = new Map(portalUsers.map(p => [p.email.toLowerCase(), p]));

    for (const s of students) {
      if (!s.email) continue;
      const pu = portalUserMap.get(s.email.toLowerCase());
      addRecipient(s.email, {
        userId: pu?._id || null,
        studentId: s._id,
        firstName: s.firstName,
        lastName: s.lastName,
        isFamily: !s.adult,
        childName: !s.adult ? s.firstName : null,
        name: `${s.firstName} ${s.lastName}`.trim()
      });
    }
  } else if (targetingType === 'custom') {
    let userIds = Array.isArray(targetCriteria.specificUserIds) ? [...targetCriteria.specificUserIds] : [];
    let studentIds = Array.isArray(targetCriteria.specificStudentIds) ? [...targetCriteria.specificStudentIds] : [];

    if (Array.isArray(targetCriteria.specificRecipients)) {
      for (const r of targetCriteria.specificRecipients) {
        if (r.userId && !userIds.includes(r.userId)) userIds.push(r.userId);
        if (r.studentId && !studentIds.includes(r.studentId)) studentIds.push(r.studentId);
        if (!r.userId && !r.studentId && r.email) {
          addRecipient(r.email, {
            name: r.name || r.email,
            email: r.email
          });
        }
      }
    }

    if (userIds.length > 0) {
      const portalUsers = await StudentPortalUser.find({ _id: { $in: userIds }, isActive: true }).lean();
      for (const u of portalUsers) {
        addRecipient(u.email, {
          userId: u._id,
          firstName: u.firstName,
          lastName: u.lastName,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim()
        });
      }
    }

    if (studentIds.length > 0) {
      const students = await Student.find({ _id: { $in: studentIds } }).lean();
      for (const s of students) {
        if (!s.email) continue;
        addRecipient(s.email, {
          studentId: s._id,
          firstName: s.firstName,
          lastName: s.lastName,
          name: `${s.firstName} ${s.lastName}`.trim()
        });
      }
    }
  }

  return Array.from(recipientsMap.values());
}

/**
 * GET /api/broadcast-email/recipients-count
 * Returns live recipient count for any targeting configuration
 */
router.get('/recipients-count', async (req, res) => {
  try {
    const targetingType = req.query.targetingType || 'global';
    const targetAudience = req.query.targetAudience || 'all';

    let targetCriteria = {};
    if (req.query.targetCriteria) {
      try {
        targetCriteria = typeof req.query.targetCriteria === 'string'
          ? JSON.parse(req.query.targetCriteria)
          : req.query.targetCriteria;
      } catch (e) {
        targetCriteria = {};
      }
    } else {
      targetCriteria = {
        periodId: req.query.periodId || null,
        campId: req.query.campId || null,
        formType: req.query.formType || 'all',
        talentinosGroup: req.query.talentinosGroup || null,
        day: req.query.day || null,
        venue: req.query.venue || null,
        specificUserIds: req.query.specificUserIds ? req.query.specificUserIds.split(',') : [],
        specificStudentIds: req.query.specificStudentIds ? req.query.specificStudentIds.split(',') : []
      };
    }

    const recipients = await resolveRecipients({
      targetingType,
      targetCriteria,
      targetAudience
    });

    res.json({
      success: true,
      targetingType,
      targetAudience,
      recipientCount: recipients.length
    });
  } catch (error) {
    logger.error('Error fetching broadcast recipients count:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abrufen der Empfängeranzahl' });
  }
});

/**
 * GET /api/broadcast-email/target-options
 * Returns dynamic targeting options (active seasons, camps, assigned venues, days, talentinos)
 */
router.get('/target-options', async (req, res) => {
  try {
    // 1. Seasons (active & recent)
    const periods = await RegistrationPeriod.find({}).sort({ startDate: -1 }).limit(6).lean();
    const seasonOptions = await Promise.all(periods.map(async (p) => {
      const [kidsCount, adultsCount] = await Promise.all([
        SeasonalRegistration.countDocuments({ periodId: p._id, formType: 'kids', status: { $in: ['pending', 'processed'] } }),
        SeasonalRegistration.countDocuments({ periodId: p._id, formType: 'adults', status: { $in: ['pending', 'processed'] } })
      ]);
      return {
        _id: p._id,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        isActive: p.isActive,
        kidsCount,
        adultsCount,
        totalCount: kidsCount + adultsCount
      };
    }));

    // 2. Camps & Events
    const camps = await Camp.find({}).sort({ startDate: -1 }).limit(10).lean();
    const campOptions = await Promise.all(camps.map(async (c) => {
      const count = await CampRegistration.countDocuments({ campId: c._id, status: { $in: ['pending', 'confirmed'] } });
      return {
        _id: c._id,
        name: c.name,
        campType: c.campType,
        startDate: c.startDate,
        endDate: c.endDate,
        participantCount: count
      };
    }));

    // 3. Days & Venues from Student assignments
    const venues = await Student.distinct('assignments.venue');
    const cleanVenues = venues.filter(v => v && typeof v === 'string' && v.trim().length > 0).sort();

    const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    // 4. Talentinos groups
    const talentinos = [
      { id: 'all', label: 'Alle Jugend- & Kinderstufen' },
      { id: 'kindergarten_rot', label: 'Kindergarten & Rot (ca. 4–8 Jahre)' },
      { id: 'orange_gruen', label: 'Orange & Grün (ca. 8–12 Jahre)' },
      { id: 'gelb', label: 'Gelb / Freizeit (11–17 Jahre)' },
      { id: 'team_gelb_u15', label: 'Team-Gelb (U15 / Mannschaft)' }
    ];

    res.json({
      success: true,
      seasons: seasonOptions,
      camps: campOptions,
      venues: cleanVenues,
      days,
      talentinos
    });
  } catch (error) {
    logger.error('Error fetching broadcast target options:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden der Zielgruppen-Optionen' });
  }
});

/**
 * GET /api/broadcast-email/search-recipients?q=...
 * Typeahead search across StudentPortalUser and Student collections
 */
router.get('/search-recipients', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, results: [] });
    }

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const [users, students] = await Promise.all([
      StudentPortalUser.find({
        isActive: true,
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex }
        ]
      })
      .select('_id firstName lastName email isAdult familyMembers')
      .limit(15)
      .lean(),

      Student.find({
        email: { $exists: true, $ne: null },
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex }
        ]
      })
      .select('_id firstName lastName email adult')
      .limit(15)
      .lean()
    ]);

    const results = [];
    const seenEmails = new Set();

    for (const u of users) {
      const email = u.email ? u.email.toLowerCase() : '';
      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);
        const childCount = Array.isArray(u.familyMembers) ? u.familyMembers.length : 0;
        results.push({
          id: u._id,
          userId: u._id,
          type: 'portal_user',
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email,
          subtitle: childCount > 0 ? `Elternkonto (${childCount} Kind/er)` : (u.isAdult ? 'Erwachsener' : 'Portal-Nutzer')
        });
      }
    }

    for (const s of students) {
      const email = s.email ? s.email.toLowerCase() : '';
      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);
        results.push({
          id: s._id,
          studentId: s._id,
          type: 'student',
          firstName: s.firstName || '',
          lastName: s.lastName || '',
          name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
          email: s.email,
          subtitle: s.adult ? 'Schüler (Erwachsen)' : 'Schüler (Jugend)'
        });
      }
    }

    res.json({
      success: true,
      results: results.slice(0, 25)
    });
  } catch (error) {
    logger.error('Error searching broadcast recipients:', error);
    res.status(500).json({ success: false, error: 'Fehler bei der Empfängersuche' });
  }
});

/**
 * Public image serve for inline broadcast email images (no auth required — UUIDs are unguessable)
 */
export function serveBroadcastImage(req, res) {
  const filePath = path.join(imagesUploadDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Bild nicht gefunden' });
  }
  res.sendFile(filePath);
}

/**
 * POST /api/broadcast-email/upload-image
 * Uploads an inline image for TipTap content
 */
router.post('/upload-image', (req, res) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Bilddatei übermittelt' });
    }

    const publicUrl = `/api/broadcast-email/images/${req.file.filename}`;
    res.json({
      success: true,
      url: publicUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  });
});

/**
 * POST /api/broadcast-email/upload-attachment
 * Uploads a PDF attachment
 */
router.post('/upload-attachment', (req, res) => {
  uploadAttachment.single('attachment')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Anhangsdatei übermittelt' });
    }

    res.json({
      success: true,
      attachment: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      }
    });
  });
});

/**
 * POST /api/broadcast-email/send-test
 * Sends a single formatted test email to the logged-in administrator
 */
router.post('/send-test', async (req, res) => {
  try {
    const { subject, contentHtml, attachments = [], seasonName = '' } = req.body;

    if (!subject || !contentHtml) {
      return res.status(400).json({ success: false, error: 'Betreff und Inhalt sind erforderlich' });
    }

    const adminEmail = req.user.email;
    if (!adminEmail) {
      return res.status(400).json({ success: false, error: 'Keine E-Mail-Adresse für den Administrator hinterlegt' });
    }

    const mockAdminUser = {
      firstName: req.user.name ? req.user.name.split(' ')[0] : 'Admin',
      lastName: req.user.name ? req.user.name.split(' ').slice(1).join(' ') : '',
      email: adminEmail,
      salutation: `Hallo ${req.user.name ? req.user.name.split(' ')[0] : 'Admin'}`
    };

    const rendered = renderBroadcastEmail(contentHtml, mockAdminUser, {
      subject: `[TEST-VORSCHAU] ${subject}`,
      seasonName
    });

    const nodemailerAttachments = (attachments || []).map(resolveAttachment);

    const sendResult = await sendEmail({
      to: adminEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: nodemailerAttachments,
      replyTo: process.env.REPLY_TO_EMAIL || 'info@mondo-tennisschule.de'
    });

    const isSimulated = sendResult?.simulated;
    logger.info(`Test broadcast email processed for admin: ${adminEmail} (simulated: ${!!isSimulated})`);

    res.json({
      success: true,
      simulated: !!isSimulated,
      message: isSimulated
        ? `[Lokaler Dev-Modus]: Test-E-Mail wurde erfolgreich generiert & simuliert (Details im Log). Echter Posteingang-Empfang erfolgt auf dem Live-Server.`
        : `Test-E-Mail erfolgreich an ${adminEmail} gesendet.`
    });
  } catch (error) {
    logger.error('Error sending test broadcast email:', error);
    res.status(500).json({ success: false, error: `Fehler beim Senden der Test-E-Mail: ${error.message}` });
  }
});

/**
 * Background worker executing sequential email dispatch with pacing
 */
async function processBroadcastSending(broadcastId, attachments = []) {
  try {
    const broadcast = await BroadcastEmail.findById(broadcastId);
    if (!broadcast) return;

    logger.info(`Starting background email broadcast ${broadcastId} for ${broadcast.recipients.length} recipient(s)`);

    const nodemailerAttachments = (attachments || []).map(resolveAttachment);

    for (let i = 0; i < broadcast.recipients.length; i++) {
      // 1. Check if broadcast was cancelled
      const freshCheck = await BroadcastEmail.findById(broadcastId).select('status');
      if (!freshCheck || freshCheck.status === 'cancelled') {
        logger.info(`Broadcast ${broadcastId} was cancelled by administrator during dispatch.`);
        return;
      }

      const recipient = broadcast.recipients[i];
      if (recipient.status === 'sent') continue; // Skip already sent (resumability)

      const userContext = {
        firstName: recipient.name ? recipient.name.split(' ')[0] : '',
        lastName: recipient.name ? recipient.name.split(' ').slice(1).join(' ') : '',
        email: recipient.email,
        salutation: recipient.name ? `Hallo ${recipient.name.split(' ')[0]}` : ''
      };

      const rendered = renderBroadcastEmail(broadcast.contentHtml, userContext, {
        subject: broadcast.subject
      });

      let sentSuccess = false;
      let lastError = null;

      // Try sending with a single retry on transient error
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await sendEmail({
            to: recipient.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: nodemailerAttachments,
            replyTo: process.env.REPLY_TO_EMAIL || 'info@mondo-tennisschule.de'
          });
          sentSuccess = true;
          break;
        } catch (err) {
          lastError = err.message;
          if (attempt === 1) {
            await new Promise(r => setTimeout(r, 2000)); // 2s retry delay
          }
        }
      }

      if (sentSuccess) {
        await BroadcastEmail.updateOne(
          { _id: broadcastId, 'recipients._id': recipient._id },
          {
            $set: {
              'recipients.$.status': 'sent',
              'recipients.$.sentAt': new Date()
            },
            $inc: { sentCount: 1 }
          }
        );
      } else {
        await BroadcastEmail.updateOne(
          { _id: broadcastId, 'recipients._id': recipient._id },
          {
            $set: {
              'recipients.$.status': 'failed',
              'recipients.$.error': lastError || 'Versand fehlgeschlagen'
            },
            $inc: { failedCount: 1 }
          }
        );
      }

      // SMTP-Pacing: 500ms pause between emails to protect mail reputation & avoid greylisting (skip in test)
      if (process.env.NODE_ENV !== 'test') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Mark completed
    await BroadcastEmail.findByIdAndUpdate(broadcastId, {
      status: 'completed',
      completedAt: new Date()
    });

    logger.info(`Broadcast ${broadcastId} successfully completed.`);
  } catch (workerError) {
    logger.error(`Unhandled error in processBroadcastSending for ${broadcastId}:`, workerError);
    await BroadcastEmail.findByIdAndUpdate(broadcastId, {
      status: 'failed'
    });
  }
}

/**
 * POST /api/broadcast-email/send
 * Starts live bulk email sending with granular targeting and optional noticeboard cross-posting
 */
router.post('/send', async (req, res) => {
  try {
    const {
      subject,
      contentHtml,
      targetingType = 'global',
      targetCriteria = {},
      targetAudience = 'all',
      attachments = [],
      publishToNoticeboard = false
    } = req.body;

    if (!subject || !contentHtml) {
      return res.status(400).json({ success: false, error: 'Betreff und Inhalt sind erforderlich' });
    }

    const recipients = await resolveRecipients({
      targetingType,
      targetCriteria,
      targetAudience
    });

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Keine verifizierten Empfänger für die ausgewählte Zielgruppe gefunden' });
    }

    let createdAnnouncementId = null;

    // Cross-channel publish to Student Portal Noticeboard (restricted to global or seasonal)
    if (publishToNoticeboard && (targetingType === 'global' || targetingType === 'seasonal')) {
      try {
        const announcementAttachments = attachments.map(copyAttachmentToAnnouncements).filter(Boolean);

        let noticeboardAudience = 'all';
        if (targetingType === 'global') {
          noticeboardAudience = targetAudience || 'all';
        } else if (targetingType === 'seasonal' && targetCriteria.formType) {
          noticeboardAudience = targetCriteria.formType === 'kids' ? 'children' : (targetCriteria.formType === 'adults' ? 'adults' : 'all');
        }

        // Clean personalized tags for noticeboard posting
        const noticeboardContent = contentHtml
          .replace(/\{Vorname\}|\{firstName\}/gi, 'Vereinsmitglieder')
          .replace(/\{Nachname\}|\{lastName\}/gi, '')
          .replace(/\{Anrede\}|\{salutation\}/gi, 'Liebe Mitglieder und Tennisfreunde')
          .replace(/\{Datum\}|\{date\}/gi, new Intl.DateTimeFormat('de-DE').format(new Date()))
          .replace(/\{Saison\}|\{season\}/gi, 'Wintertraining 2026/2027')
          .substring(0, 4900); // Announcement model has maxlength 5000

        const announcement = new Announcement({
          title: subject.replace(/\{[^{}]+\}/g, '').trim().substring(0, 195),
          content: noticeboardContent,
          targetAudience: noticeboardAudience,
          priority: 'normal',
          isActive: true,
          publishDate: new Date(),
          createdBy: req.user._id,
          attachments: announcementAttachments
        });

        await announcement.save();
        createdAnnouncementId = announcement._id;
        logger.info(`Cross-channel noticeboard announcement created: ${createdAnnouncementId}`);
      } catch (annError) {
        logger.error('Failed to create cross-channel announcement:', annError);
        // Do not abort email dispatch if announcement fails
      }
    }

    const broadcast = new BroadcastEmail({
      subject,
      contentHtml,
      contentText: htmlToPlainText(contentHtml),
      targetingType,
      targetCriteria,
      targetAudience,
      publishToNoticeboard: !!publishToNoticeboard,
      createdAnnouncementId,
      recipients,
      attachments,
      senderAdminId: req.user._id,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      status: 'sending',
      sentAt: new Date()
    });

    await broadcast.save();

    logger.info(`Admin ${req.user.email} initiated bulk email "${subject}" (${targetingType}) to ${recipients.length} recipient(s)`);

    res.status(202).json({
      success: true,
      broadcastId: broadcast._id,
      recipientCount: recipients.length,
      createdAnnouncementId,
      message: 'Versand gestartet'
    });

    // Start background worker
    setImmediate(() => {
      processBroadcastSending(broadcast._id, attachments);
    });

  } catch (error) {
    logger.error('Error initiating broadcast email dispatch:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Starten des Rundmail-Versands' });
  }
});

/**
 * POST /api/broadcast-email/cancel/:id
 * Cancels an ongoing broadcast dispatch
 */
router.post('/cancel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id);

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    if (broadcast.status !== 'sending') {
      return res.status(400).json({ success: false, error: `Rundmail kann nicht abgebrochen werden (Status: ${broadcast.status})` });
    }

    broadcast.status = 'cancelled';
    await broadcast.save();

    logger.info(`Admin ${req.user.email} cancelled broadcast ${id}`);

    res.json({
      success: true,
      message: 'Versand erfolgreich abgebrochen'
    });
  } catch (error) {
    logger.error('Error cancelling broadcast:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abbrechen des Versands' });
  }
});

/**
 * GET /api/broadcast-email/status/:id
 * Returns current progress metrics for polling
 */
router.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id).select('status sentCount failedCount recipientCount completedAt subject sentAt');

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    res.json({
      success: true,
      status: broadcast.status,
      sentCount: broadcast.sentCount,
      failedCount: broadcast.failedCount,
      recipientCount: broadcast.recipientCount,
      sentAt: broadcast.sentAt,
      completedAt: broadcast.completedAt
    });
  } catch (error) {
    logger.error('Error fetching broadcast status:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abrufen des Status' });
  }
});

/**
 * =========================================================================
 * DRAFTS (Entwürfe) CRUD
 * =========================================================================
 */
router.get('/drafts', async (req, res) => {
  try {
    const drafts = await BroadcastEmail.find({ status: 'draft', isTemplate: { $ne: true } })
      .sort({ updatedAt: -1 })
      .populate('senderAdminId', 'name email')
      .lean();

    res.json({ success: true, drafts });
  } catch (error) {
    logger.error('Error fetching broadcast drafts:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden der Entwürfe' });
  }
});

router.post('/draft', async (req, res) => {
  try {
    const {
      draftId,
      subject = '',
      contentHtml = '',
      targetingType = 'global',
      targetCriteria = {},
      targetAudience = 'all',
      attachments = [],
      publishToNoticeboard = false
    } = req.body;

    let draft;
    if (draftId) {
      draft = await BroadcastEmail.findById(draftId);
    }

    if (draft && draft.status === 'draft') {
      draft.subject = subject;
      draft.contentHtml = contentHtml;
      draft.contentText = htmlToPlainText(contentHtml);
      draft.targetingType = targetingType;
      draft.targetCriteria = targetCriteria;
      draft.targetAudience = targetAudience;
      draft.attachments = attachments;
      draft.publishToNoticeboard = !!publishToNoticeboard;
      await draft.save();
    } else {
      draft = new BroadcastEmail({
        subject,
        contentHtml,
        contentText: htmlToPlainText(contentHtml),
        targetingType,
        targetCriteria,
        targetAudience,
        attachments,
        publishToNoticeboard: !!publishToNoticeboard,
        senderAdminId: req.user._id,
        status: 'draft',
        isTemplate: false
      });
      await draft.save();
    }

    res.json({
      success: true,
      draftId: draft._id,
      message: 'Entwurf erfolgreich gespeichert'
    });
  } catch (error) {
    logger.error('Error saving broadcast draft:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Speichern des Entwurfs' });
  }
});

router.delete('/draft/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await BroadcastEmail.findOneAndDelete({ _id: id, status: 'draft' });
    res.json({ success: true, message: 'Entwurf gelöscht' });
  } catch (error) {
    logger.error('Error deleting broadcast draft:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Löschen des Entwurfs' });
  }
});

/**
 * =========================================================================
 * TEMPLATES (Vorlagen) CRUD
 * =========================================================================
 */
router.get('/templates', async (req, res) => {
  try {
    const customTemplates = await BroadcastEmail.find({ isTemplate: true })
      .sort({ updatedAt: -1 })
      .populate('senderAdminId', 'name email')
      .lean();

    res.json({
      success: true,
      systemTemplates: SYSTEM_TEMPLATES,
      customTemplates
    });
  } catch (error) {
    logger.error('Error fetching broadcast templates:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden der Vorlagen' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { title, subject, contentHtml, attachments = [] } = req.body;
    if (!title || !subject || !contentHtml) {
      return res.status(400).json({ success: false, error: 'Titel, Betreff und Inhalt sind erforderlich' });
    }

    const template = new BroadcastEmail({
      subject,
      contentHtml,
      contentText: htmlToPlainText(contentHtml),
      attachments,
      senderAdminId: req.user._id,
      isTemplate: true,
      templateTitle: title,
      status: 'completed'
    });

    await template.save();

    res.json({
      success: true,
      template,
      message: 'Vorlage erfolgreich gespeichert'
    });
  } catch (error) {
    logger.error('Error saving broadcast template:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Speichern der Vorlage' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await BroadcastEmail.findOneAndDelete({ _id: id, isTemplate: true });
    res.json({ success: true, message: 'Vorlage gelöscht' });
  } catch (error) {
    logger.error('Error deleting broadcast template:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Löschen der Vorlage' });
  }
});

/**
 * GET /api/broadcast-email/history
 * Lists past broadcasts with pagination, excluding templates and drafts
 */
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const filter = {
      isTemplate: { $ne: true },
      status: { $ne: 'draft' }
    };

    const [broadcasts, total] = await Promise.all([
      BroadcastEmail.find(filter)
        .select('-contentHtml -contentText -recipients')
        .populate('senderAdminId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BroadcastEmail.countDocuments(filter)
    ]);

    res.json({
      success: true,
      broadcasts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching broadcast history:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden des Archivs' });
  }
});

/**
 * GET /api/broadcast-email/:id
 * Returns single broadcast details including full recipient delivery report
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id)
      .populate('senderAdminId', 'name email')
      .lean();

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    res.json({
      success: true,
      broadcast
    });
  } catch (error) {
    logger.error('Error fetching broadcast details:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden der Rundmail' });
  }
});

export default router;
