import express from 'express';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import Gallery from '../models/Gallery.js';
import Media from '../models/Media.js';

const router = express.Router();

// Get all published galleries
router.get('/', verifyPortalAuth, async (req, res) => {
  try {
    const galleries = await Gallery.find({ isPublished: true })
      .sort({ date: -1 })
      .lean();
    
    res.json({ galleries });
  } catch (error) {
    console.error('Error fetching portal galleries:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Galerien' });
  }
});

// Get a specific published gallery with its media
router.get('/:id', verifyPortalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.length !== 24) {
      return res.status(400).json({ error: 'Ungültige Galerie-ID' });
    }

    const gallery = await Gallery.findOne({ _id: id, isPublished: true }).lean();
    if (!gallery) {
      return res.status(404).json({ error: 'Galerie nicht gefunden' });
    }

    const media = await Media.find({ gallery: gallery._id, isPublished: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .select('originalFilename mimeType type size width height sortOrder isPublished')
      .lean();

    res.json({ gallery, media });
  } catch (error) {
    console.error('Error fetching portal gallery detail:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Galerie', details: error.message });
  }
});

export default router;
