import express from 'express';
import Student from '../models/Student.js';
import Coach from '../models/Coach.js';
import Announcement from '../models/Announcement.js';
import ScheduleChangeRequest from '../models/ScheduleChangeRequest.js';
import Absence from '../models/Absence.js';
import Attendance from '../models/Attendance.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';

const router = express.Router();

/**
 * @route   GET /api/portal/schedule
 * @desc    Get student's personalized schedule (their assigned courses)
 * @access  Private (student portal users only)
 */
router.get('/schedule', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    // Find student
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Get assignments with populated coach names
    let schedule = [];

    // Check if student has new-format assignments array
    if (student.assignments && student.assignments.length > 0) {
      // Use assignments array (new format)
      schedule = await Promise.all(
        student.assignments.map(async (assignment) => {
          let coachName = 'Unbekannt';

          // Try to find coach by ID or name
          if (assignment.coach) {
            const coach = await Coach.findById(assignment.coach);
            if (coach) {
              coachName = `${coach.firstName} ${coach.lastName}`;
            } else {
              // If not found by ID, maybe it's stored as name (legacy)
              coachName = assignment.coach;
            }
          }

          return {
            day: assignment.day,
            hour: assignment.hour,
            coach: coachName
          };
        })
      );
    } else if (student.day && student.hour) {
      // Fall back to legacy single assignment format
      let coachName = 'Unbekannt';

      if (student.coach) {
        const coach = await Coach.findById(student.coach);
        if (coach) {
          coachName = `${coach.firstName} ${coach.lastName}`;
        } else {
          coachName = student.coach;
        }
      }

      schedule = [{
        day: student.day,
        hour: student.hour,
        coach: coachName
      }];
    }

    // Sort schedule by day of week and hour
    const dayOrder = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    schedule.sort((a, b) => {
      const dayComparison = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
      if (dayComparison !== 0) return dayComparison;
      return a.hour - b.hour;
    });

    // Return student info + schedule
    res.json({
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        adult: student.adult,
        skillLevel: student.skillLevel,
        trainigGroup: student.trainigGroup,
        frequence: student.frequence
      },
      schedule
    });

  } catch (error) {
    console.error('Error fetching portal schedule:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden des Trainingsplans' });
  }
});

/**
 * @route   GET /api/portal/announcements
 * @desc    Get active announcements for students
 * @access  Private (student portal users only)
 */
router.get('/announcements', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const now = new Date();

    // Build base query for announcements
    const query = {
      isActive: true,
      publishDate: { $lte: now },
      $or: [
        { expiryDate: null },
        { expiryDate: { $gt: now } }
      ]
    };

    // Filter by target audience if Student record exists
    if (studentId) {
      const student = await Student.findById(studentId);
      if (student) {
        // Filter based on adult/child status
        if (student.adult) {
          query.targetAudience = { $in: ['all', 'adults'] };
        } else {
          query.targetAudience = { $in: ['all', 'children'] };
        }
      } else {
        // Student ID exists but not found - show all announcements
        query.targetAudience = 'all';
      }
    } else {
      // No Student record yet - show only 'all' announcements
      query.targetAudience = 'all';
    }

    const announcements = await Announcement.find(query)
      .select('title content priority publishDate')
      .sort({ priority: -1, publishDate: -1 }) // Urgent first, then by date
      .limit(50); // Limit to 50 most recent

    res.json(announcements);

  } catch (error) {
    console.error('Error fetching portal announcements:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigungen' });
  }
});

/**
 * @route   GET /api/portal/profile
 * @desc    Get full student profile data for viewing/editing
 * @access  Private (student portal users only)
 */
router.get('/profile', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const portalUserId = req.user.id;

    // If user has a Student record, return Student data
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ error: 'Schüler nicht gefunden' });
      }

      // Return full student data with flag indicating Student record exists
      return res.json({
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        birthDate: student.birthDate,
        email: student.email || '',
        phone: student.phone || '',
        address: student.adress || '',  // Map Student.adress to response.address
        adult: student.adult,
        skillLevel: student.skillLevel || '',
        trainigGroup: student.trainigGroup || '',
        member: student.member,
        team: student.team || '',
        frequence: student.frequence || '',
        availableTimes: student.availableTimes || [],
        hasStudentRecord: true
      });
    }

    // If no Student record, return StudentPortalUser data
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Return portal user data (basic profile info only)
    res.json({
      _id: portalUser._id,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthDate: portalUser.birthdate,
      email: portalUser.email || '',
      phone: portalUser.phone || '',
      address: portalUser.address || '',  // Return address from StudentPortalUser
      // Parent contact info (for children)
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || '',
      hasStudentRecord: false
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden des Profils' });
  }
});

/**
 * @route   PUT /api/portal/profile
 * @desc    Update student profile information (all editable fields)
 * @access  Private (student portal users only)
 */
router.put('/profile', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const portalUserId = req.user.id;
    // Accept both 'address' (correct) and 'adress' (legacy) for backward compatibility
    const { firstName, lastName, birthDate, email, phone, address, adress, parentName, parentEmail, parentPhone } = req.body;
    const addressValue = address || adress;  // Prefer 'address', fall back to 'adress'

    // Validate required fields
    if (!firstName || firstName.trim() === '') {
      return res.status(400).json({ error: 'Vorname ist erforderlich' });
    }

    if (!lastName || lastName.trim() === '') {
      return res.status(400).json({ error: 'Nachname ist erforderlich' });
    }

    if (!birthDate) {
      return res.status(400).json({ error: 'Geburtsdatum ist erforderlich' });
    }

    // Validate birthDate format
    const birthDateObj = new Date(birthDate);
    if (isNaN(birthDateObj.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
    }

    // Validate email format if provided (test trimmed value)
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Ungültige Email-Adresse' });
      }
    }

    // Validate phone format if provided (basic validation, test trimmed value)
    if (phone && phone.trim() !== '') {
      const phoneRegex = /^[\d\s+\-()]+$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ error: 'Ungültige Telefonnummer' });
      }
    }

    // Validate parent email format if provided
    if (parentEmail && parentEmail.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(parentEmail.trim())) {
        return res.status(400).json({ error: 'Ungültige Email-Adresse des Elternteils' });
      }
    }

    // If user has a Student record, update Student model
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ error: 'Schüler nicht gefunden' });
      }

      // Update all editable fields including name and birthdate
      student.firstName = firstName.trim();
      student.lastName = lastName.trim();
      student.birthDate = birthDateObj;
      student.email = email?.trim() || '';
      student.phone = phone?.trim() || '';
      student.adress = addressValue?.trim() || '';  // Update Student.adress field (legacy)

      await student.save();

      console.log(`Profile updated for student: ${student.firstName} ${student.lastName}`);

      // Return updated student data
      return res.json({
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        birthDate: student.birthDate,
        email: student.email,
        phone: student.phone,
        address: student.adress,  // Map Student.adress to response.address
        adult: student.adult,
        skillLevel: student.skillLevel || '',
        trainigGroup: student.trainigGroup || '',
        member: student.member,
        team: student.team || '',
        frequence: student.frequence || '',
        availableTimes: student.availableTimes || [],
        hasStudentRecord: true
      });
    }

    // If no Student record, update StudentPortalUser
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Update personal data in StudentPortalUser
    portalUser.firstName = firstName.trim();
    portalUser.lastName = lastName.trim();
    portalUser.birthdate = birthDateObj;

    // Track old parent values for admin notification
    const oldParentValues = {
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || ''
    };

    // Update email, phone, and address
    portalUser.email = email?.trim() || portalUser.email;
    portalUser.phone = phone?.trim() || '';
    if (addressValue && addressValue.trim() !== '') {
      portalUser.address = addressValue.trim();
    }

    // Update parent info if provided (for children)
    let parentInfoChanged = false;
    if (parentName !== undefined) {
      const newValue = parentName?.trim() || '';
      if (newValue !== oldParentValues.parentName) parentInfoChanged = true;
      portalUser.parentName = newValue;
    }
    if (parentEmail !== undefined) {
      const newValue = parentEmail?.trim().toLowerCase() || '';
      if (newValue !== oldParentValues.parentEmail) parentInfoChanged = true;
      portalUser.parentEmail = newValue;
    }
    if (parentPhone !== undefined) {
      const newValue = parentPhone?.trim() || '';
      if (newValue !== oldParentValues.parentPhone) parentInfoChanged = true;
      portalUser.parentPhone = newValue;
    }

    await portalUser.save();

    // Send admin notification if parent info changed (for children)
    if (parentInfoChanged && portalUser.isChild && portalUser.isChild()) {
      try {
        const { sendParentInfoChangeNotification } = await import('../utils/emailService.js');
        await sendParentInfoChangeNotification({
          childName: `${portalUser.firstName} ${portalUser.lastName}`,
          childEmail: portalUser.email,
          oldValues: oldParentValues,
          newValues: {
            parentName: portalUser.parentName || '',
            parentEmail: portalUser.parentEmail || '',
            parentPhone: portalUser.parentPhone || ''
          }
        });
        console.log(`Admin notification sent for parent info change: ${portalUser.email}`);
      } catch (emailError) {
        // Log but don't fail the request if email fails
        console.error('Failed to send admin notification:', emailError.message);
      }
    }

    console.log(`Profile updated for portal user: ${portalUser.firstName} ${portalUser.lastName}`);

    // Return updated portal user data
    res.json({
      _id: portalUser._id,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthDate: portalUser.birthdate,
      email: portalUser.email,
      phone: portalUser.phone,
      address: portalUser.address || '',  // Return address from StudentPortalUser
      // Parent contact info (for children)
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || '',
      hasStudentRecord: false
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Profils' });
  }
});

/**
 * @route   POST /api/portal/profile/complete
 * @desc    Complete user profile with address and parent info (for children)
 * @access  Private (student portal users only)
 */
router.post('/profile/complete', verifyPortalAuth, async (req, res) => {
  try {
    const portalUserId = req.user.id;
    const { address, parentName, parentEmail, parentPhone } = req.body;

    // Validate address (required for all)
    if (!address || address.trim().length === 0) {
      return res.status(400).json({ error: 'Adresse ist erforderlich' });
    }

    // Get portal user
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Check if email is verified
    if (!portalUser.emailVerified) {
      return res.status(400).json({
        error: 'Bitte verifizieren Sie zuerst Ihre E-Mail-Adresse',
        emailVerified: false
      });
    }

    // Check if user is a child - if so, parent info is required
    const isChild = portalUser.isChild();

    if (isChild) {
      if (!parentName || parentName.trim().length === 0) {
        return res.status(400).json({ error: 'Name eines Elternteils ist erforderlich für Kinder' });
      }
      if (!parentEmail || parentEmail.trim().length === 0) {
        return res.status(400).json({ error: 'E-Mail eines Elternteils ist erforderlich für Kinder' });
      }
      if (!parentPhone || parentPhone.trim().length === 0) {
        return res.status(400).json({ error: 'Telefonnummer eines Elternteils ist erforderlich für Kinder' });
      }

      // Validate parent email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(parentEmail.trim())) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse des Elternteils' });
      }
    }

    // Update portal user
    portalUser.address = address.trim();

    if (isChild) {
      portalUser.parentName = parentName.trim();
      portalUser.parentEmail = parentEmail.trim().toLowerCase();
      portalUser.parentPhone = parentPhone.trim();
    }

    portalUser.profileCompleted = true;
    await portalUser.save();

    res.json({
      message: 'Profil erfolgreich vervollständigt',
      profileCompleted: true,
      isChild
    });

  } catch (error) {
    console.error('Error completing profile:', error);
    res.status(500).json({ error: 'Serverfehler beim Vervollständigen des Profils' });
  }
});

/**
 * @route   POST /api/portal/schedule-change-requests
 * @desc    Create a new schedule change request
 * @access  Private (student portal users only)
 */
router.post('/schedule-change-requests', verifyPortalAuth, async (req, res) => {
  try {
    const { requestType, currentSlot, requestedSlot, reason } = req.body;
    const studentId = req.user.studentId;
    const portalUserId = req.user.id; // Changed from userId to id for test compatibility

    // Validate request type
    if (!['add', 'remove', 'change'].includes(requestType)) {
      return res.status(400).json({ error: 'Ungültiger Anfragetyp' });
    }

    // Validate reason
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Begründung ist erforderlich' });
    }

    if (reason.length > 500) {
      return res.status(400).json({ error: 'Begründung ist zu lang (max. 500 Zeichen)' });
    }

    // Validate slots based on request type
    if ((requestType === 'remove' || requestType === 'change') && !currentSlot?.day) {
      return res.status(400).json({ error: 'Aktueller Trainingsslot ist erforderlich' });
    }

    if ((requestType === 'add' || requestType === 'change') && !requestedSlot?.day) {
      return res.status(400).json({ error: 'Gewünschter Trainingsslot ist erforderlich' });
    }

    // Check if student exists
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Check if there's already a pending request for this student
    const existingPendingRequest = await ScheduleChangeRequest.findOne({
      studentId,
      status: 'pending'
    });

    if (existingPendingRequest) {
      return res.status(400).json({
        error: 'Du hast bereits eine offene Anfrage. Bitte warte auf die Bearbeitung.'
      });
    }

    // Create the request
    const changeRequest = new ScheduleChangeRequest({
      studentId,
      portalUserId,
      requestType,
      currentSlot: (requestType === 'remove' || requestType === 'change') ? currentSlot : undefined,
      requestedSlot: (requestType === 'add' || requestType === 'change') ? requestedSlot : undefined,
      reason: reason.trim()
    });

    await changeRequest.save();

    console.log(`Schedule change request created: ${requestType} by student ${student.firstName} ${student.lastName}`);

    // Convert to plain object and return fields directly
    const savedRequest = changeRequest.toObject();
    res.status(201).json({
      message: 'Anfrage erfolgreich erstellt',
      ...savedRequest  // Spread request fields to top level
    });

  } catch (error) {
    console.error('Error creating schedule change request:', error);
    res.status(500).json({ error: 'Serverfehler beim Erstellen der Anfrage' });
  }
});

/**
 * @route   GET /api/portal/schedule-change-requests
 * @desc    Get student's schedule change requests (all statuses)
 * @access  Private (student portal users only)
 */
router.get('/schedule-change-requests', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    // Find all requests for this student, sorted by most recent first
    const requests = await ScheduleChangeRequest.find({ studentId })
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    // Format requests for frontend
    const formattedRequests = requests.map(request => ({
      _id: request._id,
      requestType: request.requestType,
      currentSlot: request.currentSlot,
      requestedSlot: request.requestedSlot,
      reason: request.reason,
      status: request.status,
      adminResponse: request.adminResponse,
      reviewedBy: request.reviewedBy
        ? `${request.reviewedBy.firstName} ${request.reviewedBy.lastName}`
        : null,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt
    }));

    res.json(formattedRequests);

  } catch (error) {
    console.error('Error fetching schedule change requests:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Anfragen' });
  }
});

/**
 * @route   DELETE /api/portal/schedule-change-requests/:id
 * @desc    Cancel a pending schedule change request
 * @access  Private (student portal users only)
 */
router.delete('/schedule-change-requests/:id', verifyPortalAuth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const studentId = req.user.studentId;

    // Find the request
    const changeRequest = await ScheduleChangeRequest.findById(requestId);

    if (!changeRequest) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Verify this request belongs to the student (return 404 for security)
    if (changeRequest.studentId.toString() !== studentId.toString()) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Only allow cancellation of pending requests
    if (changeRequest.status !== 'pending') {
      return res.status(400).json({
        error: 'Nur offene Anfragen können storniert werden'
      });
    }

    await ScheduleChangeRequest.findByIdAndDelete(requestId);

    console.log(`Schedule change request cancelled: ${requestId}`);

    res.json({ message: 'Anfrage erfolgreich storniert' });

  } catch (error) {
    console.error('Error cancelling schedule change request:', error);
    res.status(500).json({ error: 'Serverfehler beim Stornieren der Anfrage' });
  }
});

/**
 * @route   POST /api/portal/absences
 * @desc    Report an absence for a training session
 * @access  Private (student portal users only)
 */
router.post('/absences', verifyPortalAuth, async (req, res) => {
  try {
    const { absenceDate, day, hour, coach, absenceType, reason } = req.body;
    const studentId = req.user.studentId;
    const portalUserId = req.user.id; // Changed from userId to id for test compatibility

    // Validate required fields
    if (!absenceDate || !day || !hour || !absenceType) {
      return res.status(400).json({ error: 'Alle Pflichtfelder müssen ausgefüllt werden' });
    }

    // Validate absence type
    if (!['illness', 'vacation', 'school', 'other'].includes(absenceType)) {
      return res.status(400).json({ error: 'Ungültiger Abwesenheitstyp' });
    }

    // Check if student exists
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Check if absence already exists for this date/time
    const existingAbsence = await Absence.findOne({
      studentId,
      absenceDate: new Date(absenceDate),
      day,
      hour,
      status: { $in: ['pending', 'acknowledged'] }
    });

    if (existingAbsence) {
      return res.status(400).json({
        error: 'Abwesenheit für diesen Termin wurde bereits gemeldet'
      });
    }

    // Create absence notification
    const absence = new Absence({
      studentId,
      portalUserId,
      absenceDate: new Date(absenceDate),
      day,
      hour,
      coach: coach || null,
      absenceType,
      reason: reason?.trim() || null
    });

    await absence.save();

    console.log(`Absence reported: ${student.firstName} ${student.lastName} - ${day} ${hour}:00, ${absenceDate}`);

    // Convert to plain object and return fields directly
    const savedAbsence = absence.toObject();
    res.status(201).json({
      message: 'Abwesenheit erfolgreich gemeldet',
      ...savedAbsence  // Spread absence fields to top level
    });

  } catch (error) {
    console.error('Error creating absence:', error);

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0];
      return res.status(400).json({ error: firstError.message });
    }

    if (error.message.includes('vergangene Termine')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Serverfehler beim Melden der Abwesenheit' });
  }
});

/**
 * @route   GET /api/portal/absences/upcoming
 * @desc    Get upcoming absences for quick view (next 10)
 * @access  Private (student portal users only)
 * NOTE: This route MUST come before /absences/:id to avoid route conflicts
 */
router.get('/absences/upcoming', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    const upcomingAbsences = await Absence.getUpcomingForStudent(studentId);

    res.json(upcomingAbsences);

  } catch (error) {
    console.error('Error fetching upcoming absences:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Abwesenheiten' });
  }
});

/**
 * @route   GET /api/portal/absences
 * @desc    Get student's absence history (past and upcoming)
 * @access  Private (student portal users only)
 */
router.get('/absences', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const { status, upcoming } = req.query;

    // Build query
    const query = { studentId };

    if (status && ['pending', 'acknowledged', 'cancelled'].includes(status)) {
      query.status = status;
    }

    if (upcoming === 'true') {
      // Only upcoming absences
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query.absenceDate = { $gte: today };
      query.status = { $in: ['pending', 'acknowledged'] };
    }

    // Find absences
    const absences = await Absence.find(query)
      .populate('acknowledgedBy', 'firstName lastName')
      .sort({ absenceDate: -1 })
      .limit(50)
      .lean();

    // Format absences for frontend
    const formattedAbsences = absences.map(absence => ({
      _id: absence._id,
      absenceDate: absence.absenceDate,
      day: absence.day,
      hour: absence.hour,
      coach: absence.coach,
      absenceType: absence.absenceType,
      reason: absence.reason,
      status: absence.status,
      acknowledgedBy: absence.acknowledgedBy
        ? `${absence.acknowledgedBy.firstName} ${absence.acknowledgedBy.lastName}`
        : null,
      acknowledgedAt: absence.acknowledgedAt,
      adminNotes: absence.adminNotes,
      createdAt: absence.createdAt
    }));

    res.json(formattedAbsences);

  } catch (error) {
    console.error('Error fetching absences:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Abwesenheiten' });
  }
});

/**
 * @route   DELETE /api/portal/absences/:id
 * @desc    Cancel an absence notification (if plans change)
 * @access  Private (student portal users only)
 */
router.delete('/absences/:id', verifyPortalAuth, async (req, res) => {
  try {
    const absenceId = req.params.id;
    const studentId = req.user.studentId;

    // Find the absence
    const absence = await Absence.findById(absenceId);

    if (!absence) {
      return res.status(404).json({ error: 'Abwesenheit nicht gefunden' });
    }

    // Verify this absence belongs to the student (return 404 for security)
    if (absence.studentId.toString() !== studentId.toString()) {
      return res.status(404).json({ error: 'Abwesenheit nicht gefunden' });
    }

    // Only allow deletion of pending absences
    if (absence.status !== 'pending') {
      return res.status(400).json({
        error: 'Nur ausstehende Abwesenheiten können gelöscht werden'
      });
    }

    // Only allow deletion of future absences
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const absDate = new Date(absence.absenceDate);
    absDate.setHours(0, 0, 0, 0);

    if (absDate < today) {
      return res.status(400).json({
        error: 'Vergangene Abwesenheiten können nicht gelöscht werden'
      });
    }

    // Delete the absence
    await Absence.findByIdAndDelete(absenceId);

    console.log(`Absence deleted: ${absenceId}`);

    res.json({ message: 'Abwesenheit erfolgreich gelöscht' });

  } catch (error) {
    console.error('Error deleting absence:', error);
    res.status(500).json({ error: 'Serverfehler beim Löschen der Abwesenheit' });
  }
});

/**
 * @route   GET /api/portal/attendance/history
 * @desc    Get student's attendance history
 * @access  Private (student portal users only)
 */
router.get('/attendance/history', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const { limit } = req.query;

    const history = await Attendance.getStudentHistory(
      studentId,
      limit ? parseInt(limit, 10) : 50
    );

    res.json(history);

  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Anwesenheitshistorie' });
  }
});

/**
 * @route   GET /api/portal/attendance/statistics
 * @desc    Get student's attendance statistics
 * @access  Private (student portal users only)
 */
router.get('/attendance/statistics', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    const statistics = await Attendance.getStudentStatistics(studentId);

    res.json(statistics);

  } catch (error) {
    console.error('Error fetching attendance statistics:', error);
    res.status(500).json({ error: 'Serverfehler beim Laden der Statistik' });
  }
});

export default router;
