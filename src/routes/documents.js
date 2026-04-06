import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';
import Document from '../models/Document.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All document routes require admin or supermod authentication
router.use(requireAuth, requireAdminOrSupermod);

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // xlsx
  'application/vnd.oasis.opendocument.text',                                  // odt
];

// Multer diskStorage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uuid = crypto.randomUUID();
    cb(null, `${uuid}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, Bilder, DOCX, XLSX, ODT'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// GET /api/documents — list documents
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'supermod';
    const isCoach = req.user.role === 'trainer';

    if (!isAdmin && !isCoach) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const filter = isAdmin ? {} : { visibleTo: { $in: ['coach'] } };
    const docs = await Document.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    logger.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Dokumente' });
  }
});

// POST /api/documents — upload document (admin + supermod + coach)
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'supermod';
    const isCoach = req.user.role === 'trainer';

    if (!isAdmin && !isCoach) {
      if (req.file) fs.unlinkSync(path.join(uploadDir, req.file.filename));
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    let visibleTo = ['admin', 'coach']; // default for coaches
    if (isAdmin && req.body.visibleTo) {
      try {
        visibleTo = JSON.parse(req.body.visibleTo);
      } catch {
        visibleTo = Array.isArray(req.body.visibleTo)
          ? req.body.visibleTo
          : [req.body.visibleTo];
      }
    }

    const doc = new Document({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      category: req.body.category || 'Sonstiges',
      visibleTo,
      uploadedBy: req.user._id || req.user.id,
      uploadedByRole: isAdmin ? 'admin' : 'coach',
      description: req.body.description || ''
    });

    await doc.save();
    logger.info(`Document uploaded: ${doc.originalName} by ${req.user.role} ${req.user._id}`);
    res.status(201).json(doc);
  } catch (err) {
    logger.error('Error uploading document:', err);
    res.status(500).json({ error: 'Fehler beim Hochladen' });
  }
});

// GET /api/documents/:id/download — download file
router.get('/:id/download', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'supermod';
    const isCoach = req.user.role === 'trainer';

    if (!isAdmin && !isCoach) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    // Visibility check for coaches
    if (isCoach && !doc.visibleTo.includes('coach')) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const filePath = path.join(uploadDir, doc.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    res.setHeader('Content-Type', doc.mimeType);
    res.sendFile(filePath);
  } catch (err) {
    logger.error('Error downloading document:', err);
    res.status(500).json({ error: 'Fehler beim Download' });
  }
});

// PUT /api/documents/:id — update metadata (admin + supermod)
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'supermod') {
      return res.status(403).json({ error: 'Nur Administratoren können Dokumente bearbeiten' });
    }

    const { category, visibleTo, description, originalName } = req.body;
    const updates = {};
    if (category !== undefined) updates.category = category;
    if (visibleTo !== undefined) updates.visibleTo = visibleTo;
    if (description !== undefined) updates.description = description;
    if (originalName !== undefined) updates.originalName = originalName;

    const doc = await Document.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    res.json(doc);
  } catch (err) {
    logger.error('Error updating document:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
});

// DELETE /api/documents/:id — delete doc + file (admin + supermod)
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'supermod') {
      return res.status(403).json({ error: 'Nur Administratoren können Dokumente löschen' });
    }

    const doc = await Document.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    // Delete file from disk
    const filePath = path.join(uploadDir, doc.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    logger.info(`Document deleted: ${doc.originalName} by admin ${req.user._id}`);
    res.json({ message: 'Dokument gelöscht' });
  } catch (err) {
    logger.error('Error deleting document:', err);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Datei zu groß (max. 10MB)' });
  }
  if (err.message?.includes('Dateityp nicht erlaubt')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
