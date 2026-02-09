import express from 'express';
import Announcement from '../models/Announcement.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   GET /api/announcements
 * @desc    Get all announcements (admin view)
 * @access  Private (admin only - enforced by requireAuth + requireRole middleware)
 */
router.get('/', async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .sort({ publishDate: -1 }); // Newest first

    res.json(announcements);
  } catch (error) {
    logger.error("Error fetching announcements", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigungen' });
  }
});

/**
 * @route   GET /api/announcements/:id
 * @desc    Get single announcement
 * @access  Private (admin only)
 */
router.get('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email');

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    res.json(announcement);
  } catch (error) {
    logger.error("Error fetching announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigung' });
  }
});

/**
 * @route   POST /api/announcements
 * @desc    Create new announcement
 * @access  Private (admin only)
 */
router.post('/', async (req, res) => {
  try {
    const { title, content, targetAudience, priority, publishDate, expiryDate } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({ error: 'Titel und Inhalt sind erforderlich' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    // Create announcement
    const announcement = new Announcement({
      title,
      content,
      targetAudience: targetAudience || 'all',
      priority: priority || 'normal',
      publishDate: publishDate || Date.now(),
      expiryDate: expiryDate || null,
      createdBy: req.user._id // From requireAuth middleware
    });

    await announcement.save();

    // Populate creator info for response
    await announcement.populate('createdBy', 'firstName lastName email');

    res.status(201).json({
      message: 'Ankündigung erfolgreich erstellt',
      announcement
    });

  } catch (error) {
    logger.error("Error creating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Erstellen der Ankündigung' });
  }
});

/**
 * @route   PUT /api/announcements/:id
 * @desc    Update announcement
 * @access  Private (admin only)
 */
router.put('/:id', async (req, res) => {
  try {
    const { title, content, targetAudience, priority, isActive, publishDate, expiryDate } = req.body;

    // Find announcement
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    // Validation
    if (title && title.length > 200) {
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content && content.length > 5000) {
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    // Update fields
    if (title !== undefined) announcement.title = title;
    if (content !== undefined) announcement.content = content;
    if (targetAudience !== undefined) announcement.targetAudience = targetAudience;
    if (priority !== undefined) announcement.priority = priority;
    if (isActive !== undefined) announcement.isActive = isActive;
    if (publishDate !== undefined) announcement.publishDate = publishDate;
    if (expiryDate !== undefined) announcement.expiryDate = expiryDate;

    announcement.lastModifiedBy = req.user._id;

    await announcement.save();

    // Populate for response
    await announcement.populate('createdBy', 'firstName lastName email');
    await announcement.populate('lastModifiedBy', 'firstName lastName email');

    res.json({
      message: 'Ankündigung erfolgreich aktualisiert',
      announcement
    });

  } catch (error) {
    logger.error("Error updating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktualisieren der Ankündigung' });
  }
});

/**
 * @route   DELETE /api/announcements/:id
 * @desc    Delete announcement (soft delete - sets isActive to false)
 * @access  Private (admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    // Soft delete
    announcement.isActive = false;
    announcement.lastModifiedBy = req.user._id;
    await announcement.save();

    res.json({ message: 'Ankündigung erfolgreich gelöscht' });

  } catch (error) {
    logger.error("Error deleting announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen der Ankündigung' });
  }
});

/**
 * @route   POST /api/announcements/:id/activate
 * @desc    Reactivate deleted announcement
 * @access  Private (admin only)
 */
router.post('/:id/activate', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    announcement.isActive = true;
    announcement.lastModifiedBy = req.user._id;
    await announcement.save();

    res.json({ message: 'Ankündigung erfolgreich aktiviert' });

  } catch (error) {
    logger.error("Error activating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktivieren der Ankündigung' });
  }
});

export default router;
