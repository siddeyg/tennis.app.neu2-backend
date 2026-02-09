import express from 'express';
import ScheduleChangeRequest from '../models/ScheduleChangeRequest.js';
import Student from '../models/Student.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';

const router = express.Router();

// All routes require admin authentication
router.use(requireAuth);
router.use(requireRole(['admin']));

/**
 * @route   GET /api/schedule-change-requests
 * @desc    Get all schedule change requests (admin view)
 * @access  Private (admin only)
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    // Build query
    const query = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query.status = status;
    }

    // Find requests with populated student and reviewer info
    const requests = await ScheduleChangeRequest.find(query)
      .populate('studentId', 'firstName lastName email phone')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    res.json(requests);

  } catch (error) {
    logger.error("Error fetching schedule change requests", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Anfragen' });
  }
});

/**
 * @route   GET /api/schedule-change-requests/:id
 * @desc    Get specific schedule change request details
 * @access  Private (admin only)
 */
router.get('/:id', async (req, res) => {
  try {
    const request = await ScheduleChangeRequest.findById(req.params.id)
      .populate('studentId')
      .populate('reviewedBy', 'firstName lastName')
      .populate('portalUserId', 'email')
      .lean();

    if (!request) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    res.json(request);

  } catch (error) {
    logger.error("Error fetching schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Anfrage' });
  }
});

/**
 * @route   POST /api/schedule-change-requests/:id/approve
 * @desc    Approve a schedule change request and update student schedule
 * @access  Private (admin only)
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const { adminResponse } = req.body;
    const adminId = req.user._id;

    // Find the request
    const changeRequest = await ScheduleChangeRequest.findById(req.params.id);

    if (!changeRequest) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Check if already processed
    if (changeRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    // Find the student
    const student = await Student.findById(changeRequest.studentId);

    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Apply the schedule change based on request type
    switch (changeRequest.requestType) {
      case 'add':
        // Add new assignment
        if (!student.assignments) {
          student.assignments = [];
        }
        student.assignments.push({
          day: changeRequest.requestedSlot.day,
          hour: changeRequest.requestedSlot.hour,
          coach: changeRequest.requestedSlot.preferredCoach || null
        });
        break;

      case 'remove':
        // Remove specific assignment
        if (student.assignments && student.assignments.length > 0) {
          student.assignments = student.assignments.filter(
            assignment =>
              assignment.day !== changeRequest.currentSlot.day ||
              assignment.hour !== changeRequest.currentSlot.hour
          );
        } else {
          // Legacy single assignment format
          student.day = null;
          student.hour = null;
          student.coach = null;
        }
        break;

      case 'change':
        // Find and update the specific assignment
        if (student.assignments && student.assignments.length > 0) {
          const assignmentIndex = student.assignments.findIndex(
            assignment =>
              assignment.day === changeRequest.currentSlot.day &&
              assignment.hour === changeRequest.currentSlot.hour
          );

          if (assignmentIndex !== -1) {
            student.assignments[assignmentIndex] = {
              day: changeRequest.requestedSlot.day,
              hour: changeRequest.requestedSlot.hour,
              coach: changeRequest.requestedSlot.preferredCoach || student.assignments[assignmentIndex].coach
            };
          }
        } else {
          // Legacy single assignment format
          student.day = changeRequest.requestedSlot.day;
          student.hour = changeRequest.requestedSlot.hour;
          if (changeRequest.requestedSlot.preferredCoach) {
            student.coach = changeRequest.requestedSlot.preferredCoach;
          }
        }
        break;
    }

    // Save student changes
    await student.save();

    // Approve the request
    await changeRequest.approve(adminId, adminResponse || 'Anfrage genehmigt');

    logger.info('Schedule change request approved', { requestId: req.params.id, admin: req.user.firstName });

    res.json({
      message: 'Anfrage genehmigt und Trainingsplan aktualisiert',
      request: changeRequest,
      updatedStudent: {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        assignments: student.assignments
      }
    });

  } catch (error) {
    logger.error("Error approving schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Genehmigen der Anfrage' });
  }
});

/**
 * @route   POST /api/schedule-change-requests/:id/reject
 * @desc    Reject a schedule change request
 * @access  Private (admin only)
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { adminResponse } = req.body;
    const adminId = req.user._id;

    // Validate admin response
    if (!adminResponse || adminResponse.trim().length === 0) {
      return res.status(400).json({
        error: 'Begründung für Ablehnung ist erforderlich'
      });
    }

    // Find the request
    const changeRequest = await ScheduleChangeRequest.findById(req.params.id);

    if (!changeRequest) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Check if already processed
    if (changeRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    // Reject the request
    await changeRequest.reject(adminId, adminResponse.trim());

    logger.info('Schedule change request rejected', { requestId: req.params.id, admin: req.user.firstName });

    res.json({
      message: 'Anfrage abgelehnt',
      request: changeRequest
    });

  } catch (error) {
    logger.error("Error rejecting schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Ablehnen der Anfrage' });
  }
});

/**
 * @route   DELETE /api/schedule-change-requests/:id
 * @desc    Delete a schedule change request (admin cleanup)
 * @access  Private (admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    const changeRequest = await ScheduleChangeRequest.findById(req.params.id);

    if (!changeRequest) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Only allow deletion of processed (approved/rejected) requests
    if (changeRequest.status === 'pending') {
      return res.status(400).json({
        error: 'Offene Anfragen können nicht gelöscht werden. Bitte ablehnen stattdessen.'
      });
    }

    await ScheduleChangeRequest.findByIdAndDelete(req.params.id);

    logger.info('Schedule change request deleted', { requestId: req.params.id, admin: req.user.firstName });

    res.json({ message: 'Anfrage erfolgreich gelöscht' });

  } catch (error) {
    logger.error("Error deleting schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen der Anfrage' });
  }
});

export default router;
