import express from 'express';
import passport from 'passport';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import Gallery from '../models/Gallery.js';
import Media from '../models/Media.js';
import storageService from '../utils/storageService.js';

const router = express.Router();

const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Setup Multer (Disk Storage to prevent memory exhaustion DoS)
const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB limit
    files: 10 // Max 10 files per request (concurrency limit)
  }
});

// Middleware to enforce admin role
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden: Admins only' });
};

// ==============================
// GALLERY ROUTES
// ==============================

// GET all published galleries (for students)
router.get('/', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const query = req.user.role === 'admin' ? {} : { isPublished: true };

    const galleries = await Gallery.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'coverImage',
        select: 'thumbnailPath type mimeType'
      });

    const total = await Gallery.countDocuments(query);

    res.json({
      galleries,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching galleries', error: error.message });
  }
});

// POST new gallery (Admin only)
router.post('/', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
  try {
    const { headline, date, description, isPublished } = req.body;
    const gallery = new Gallery({
      headline,
      date,
      description,
      isPublished: isPublished === 'true' || isPublished === true,
      creator: req.user._id
    });
    await gallery.save();
    res.status(201).json(gallery);
  } catch (error) {
    res.status(400).json({ message: 'Error creating gallery', error: error.message });
  }
});

// GET single gallery with media
router.get('/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) return res.status(404).json({ message: 'Gallery not found' });

    if (!gallery.isPublished && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Gallery is not published' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const mediaQuery = { gallery: gallery._id };
    if (req.user.role !== 'admin') mediaQuery.isPublished = true;

    const media = await Media.find(mediaQuery)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('originalFilename mimeType type size width height sortOrder isPublished');

    const totalMedia = await Media.countDocuments(mediaQuery);

    res.json({
      gallery,
      media,
      totalPages: Math.ceil(totalMedia / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching gallery', error: error.message });
  }
});

// PUT update single gallery (Admin only)
router.put('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
  try {
    const { isPublished, headline, description, coverImage } = req.body;
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) return res.status(404).json({ message: 'Gallery not found' });

    if (isPublished !== undefined) gallery.isPublished = isPublished;
    if (headline !== undefined) gallery.headline = headline;
    if (description !== undefined) gallery.description = description;
    
    if (coverImage !== undefined) {
      // Validate that the media exists and belongs to this gallery
      if (coverImage === null) {
        gallery.coverImage = undefined;
      } else {
        const mediaExists = await Media.findOne({ _id: coverImage, gallery: gallery._id });
        if (!mediaExists) {
          return res.status(400).json({ message: 'Invalid cover image. Media not found in this gallery.' });
        }
        gallery.coverImage = coverImage;
      }
    }

    await gallery.save();
    res.json(gallery);
  } catch (error) {
    res.status(500).json({ message: 'Error updating gallery', error: error.message });
  }
});

// PUT /:id/reorder to update sortOrder for media items
router.put('/:id/reorder', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
  try {
    const { mediaIds } = req.body; // Array of ordered media IDs
    
    if (!Array.isArray(mediaIds)) {
      return res.status(400).json({ message: 'mediaIds must be an array' });
    }

    // Verify gallery exists
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) return res.status(404).json({ message: 'Gallery not found' });

    // Update sortOrder in bulk using Promise.all and individual save() or bulkWrite
    const bulkOps = mediaIds.map((mediaId, index) => ({
      updateOne: {
        filter: { _id: mediaId, gallery: gallery._id },
        update: { $set: { sortOrder: index } }
      }
    }));

    if (bulkOps.length > 0) {
      await Media.bulkWrite(bulkOps);
    }

    res.json({ message: 'Media reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error reordering media', error: error.message });
  }
});

// DELETE single gallery and all its media (Admin only)
router.delete('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
  try {
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) return res.status(404).json({ message: 'Gallery not found' });

    const mediaItems = await Media.find({ gallery: gallery._id }).select('+filePath +thumbnailPath');
    
    // Delete physical files
    for (const media of mediaItems) {
      await storageService.deleteMedia(media.filePath, media.thumbnailPath);
    }
    
    // Delete database records
    await Media.deleteMany({ gallery: gallery._id });
    await Gallery.deleteOne({ _id: gallery._id });

    res.json({ message: 'Gallery and all associated media deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting gallery', error: error.message });
  }
});

// ==============================
// MEDIA ROUTES
// ==============================

// POST upload media to a gallery
router.post('/:id/media', passport.authenticate('jwt', { session: false }), requireAdmin, upload.array('files', 10), async (req, res) => {
  try {
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) {
      // Cleanup temp files if gallery doesn't exist
      if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      return res.status(404).json({ message: 'Gallery not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadedMedia = [];
    
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      try {
        // We pass video dimensions if provided in body (e.g. videoWidths array)
        let vWidth = 1920, vHeight = 1080;
        if (req.body.videoWidths && req.body.videoHeights) {
           const widths = Array.isArray(req.body.videoWidths) ? req.body.videoWidths : [req.body.videoWidths];
           const heights = Array.isArray(req.body.videoHeights) ? req.body.videoHeights : [req.body.videoHeights];
           if (widths[i]) vWidth = widths[i];
           if (heights[i]) vHeight = heights[i];
        }

        const metadata = await storageService.saveMedia(file.path, file.originalname, file.mimetype, vWidth, vHeight);
        
        const media = new Media({
          gallery: gallery._id,
          originalFilename: file.originalname,
          filePath: metadata.filePath,
          thumbnailPath: metadata.thumbnailPath,
          mimeType: metadata.mimeType,
          type: metadata.type,
          size: metadata.size,
          width: metadata.width,
          height: metadata.height,
          uploader: req.user._id,
          isPublished: true // Published by default in staging admin area
        });
        
        await media.save();
        uploadedMedia.push(media);
      } catch (err) {
        console.error(`Error processing file ${file.originalname}:`, err);
      } finally {
        // Always cleanup temp file
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    res.status(201).json({ message: 'Upload complete', uploaded: uploadedMedia });
  } catch (error) {
    console.error("Upload error:", error);
    // Cleanup any remaining temp files on total failure
    if (req.files) req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    res.status(500).json({ message: 'Error uploading media', error: error.message });
  }
});

// GET Secure File Stream (IDOR Protection)
router.get('/media/:mediaId/file', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const isThumb = req.query.thumb === 'true';
    const media = await Media.findById(req.params.mediaId).select('+filePath +thumbnailPath');
    
    if (!media) return res.status(404).json({ message: 'Media not found' });

    // Check if gallery is published if user is not admin
    if (req.user.role !== 'admin') {
       if (!media.isPublished) return res.status(403).json({ message: 'Media not published' });
       const gallery = await Gallery.findById(media.gallery);
       if (!gallery || !gallery.isPublished) return res.status(403).json({ message: 'Gallery not published' });
    }

    const targetPath = isThumb ? media.thumbnailPath : media.filePath;
    
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.setHeader('Content-Type', media.mimeType);
    if (isThumb) {
       res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    }
    
    const stream = fs.createReadStream(targetPath);
    
    // Catch stream errors to prevent crashes/leaks
    stream.on('error', (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) res.status(500).json({ message: 'Error streaming file' });
    });
    
    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ message: 'Error streaming media', error: error.message });
  }
});

// PUT update Media
router.put('/media/:mediaId', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    try {
        const { isPublished } = req.body;
        const media = await Media.findById(req.params.mediaId);
        if (!media) return res.status(404).json({ message: 'Media not found' });

        if (isPublished !== undefined) media.isPublished = isPublished;

        await media.save();
        res.json(media);
    } catch (error) {
        res.status(500).json({ message: 'Error updating media', error: error.message });
    }
});

// DELETE Media
router.delete('/media/:mediaId', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    try {
        const media = await Media.findById(req.params.mediaId).select('+filePath +thumbnailPath');
        if (!media) return res.status(404).json({ message: 'Media not found' });

        await storageService.deleteMedia(media.filePath, media.thumbnailPath);
        
        // Remove coverImage reference if this media was the cover
        await Gallery.updateMany({ coverImage: media._id }, { $unset: { coverImage: "" } });
        
        await Media.deleteOne({ _id: media._id });

        res.json({ message: 'Media deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting media', error: error.message });
    }
});

export default router;
