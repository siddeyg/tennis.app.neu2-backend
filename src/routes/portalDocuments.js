import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { verifyPortalAuth } from '../middleware/verifyPortalAuth.js';
import Document from '../models/Document.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const uploadDir = path.join(__dirname, '../../uploads/documents');

// All routes require student portal authentication
router.use(verifyPortalAuth);

// GET /api/portal/documents — list student-visible documents
router.get('/', async (req, res) => {
  try {
    const docs = await Document.find(
      { visibleTo: { $in: ['student'] } },
      // Only return safe fields (no internal filename, no uploadedBy)
      'originalName mimeType size category description createdAt'
    ).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    logger.error('Error fetching portal documents:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Dokumente' });
  }
});

// GET /api/portal/documents/:id/download — download student-visible file
router.get('/:id/download', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    if (!doc.visibleTo.includes('student')) {
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
    logger.error('Error downloading portal document:', err);
    res.status(500).json({ error: 'Fehler beim Download' });
  }
});

export default router;
