import express from 'express';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Student from '../models/Student.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Helper function to calculate age from birthdate
const calculateAge = (birthdate) => {
  const today = new Date();
  const birthDate = new Date(birthdate);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// GET /api/portal/children - Get all children for logged-in parent
router.get('/', verifyPortalAuth, async (req, res) => {
  try {
    const user = await StudentPortalUser.findById(req.user.id)
      .populate('familyMembers.studentId', 'firstName lastName');

    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Filter only children and format response
    const children = user.familyMembers
      .filter(member => member.relationship === 'child')
      .map(child => ({
        _id: child._id,
        firstName: child.firstName || '',
        lastName: child.lastName || '',
        birthdate: child.birthdate || null,
        sex: child.sex || '',
        member: child.member || false,
        mitgliedsstatus: child.mitgliedsstatus || null,
        phone: child.phone || '',
        age: child.birthdate ? calculateAge(child.birthdate) : null,
        studentId: child.studentId?._id || null,
        studentName: child.studentId
          ? `${child.studentId.firstName} ${child.studentId.lastName}`
          : null,
        createdAt: child.createdAt
      }));

    res.json({ children });
  } catch (error) {
    logger.error("Error fetching children", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Laden der Kinder' });
  }
});

// POST /api/portal/children - Add new child
router.post('/', verifyPortalAuth, auditLogMiddleware({ action: 'CREATE', resource: 'Child' }), async (req, res) => {
  try {
    const { firstName, lastName, birthdate, sex, member, phone, mitgliedsstatus } = req.body;

    // Validation
    if (!firstName || !lastName || !birthdate) {
      return res.status(400).json({
        error: 'Vorname, Nachname und Geburtsdatum sind erforderlich'
      });
    }

    if (!sex || !['männlich', 'weiblich', 'divers'].includes(sex)) {
      return res.status(400).json({
        error: 'Geschlecht ist erforderlich'
      });
    }

    // Validate name length and characters
    if (firstName.length < 2 || firstName.length > 50) {
      return res.status(400).json({ error: 'Vorname muss 2-50 Zeichen lang sein' });
    }
    if (lastName.length < 2 || lastName.length > 50) {
      return res.status(400).json({ error: 'Nachname muss 2-50 Zeichen lang sein' });
    }

    // Validate birthdate and age
    const age = calculateAge(birthdate);
    if (age < 0 || age >= 100) {
      return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
    }
    if (age >= 19) {
      return res.status(400).json({
        error: 'Kind muss unter 19 Jahre alt sein. Familienmitglieder ab 19 Jahren sollten ein eigenes Portal-Konto anlegen.'
      });
    }

    // Validate phone if provided
    if (phone && (phone.length < 10 || phone.length > 20)) {
      return res.status(400).json({
        error: 'Telefonnummer muss 10-20 Zeichen lang sein'
      });
    }

    const user = await StudentPortalUser.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Require parent to have phone number before adding children
    if (!user.phone) {
      return res.status(400).json({
        error: 'Bitte fügen Sie zuerst eine Telefonnummer zu Ihrem Profil hinzu. Bei Minderjährigen ist eine Notfallkontaktnummer erforderlich.'
      });
    }

    // Check maximum children limit
    const currentChildren = user.familyMembers.filter(m => m.relationship === 'child');
    if (currentChildren.length >= 10) {
      return res.status(400).json({
        error: 'Maximal 10 Kinder pro Konto erlaubt'
      });
    }

    // Check for duplicate child name
    const duplicate = currentChildren.find(
      child => child.firstName === firstName && child.lastName === lastName
    );
    if (duplicate) {
      return res.status(400).json({
        error: `Ein Kind mit dem Namen "${firstName} ${lastName}" existiert bereits`
      });
    }

    // Create new child entry
    const resolvedMitgliedsstatus = mitgliedsstatus || null;
    const newChild = {
      relationship: 'child',
      name: `${firstName} ${lastName}`,  // Keep for backward compatibility
      firstName,
      lastName,
      birthdate: new Date(birthdate),
      sex,
      member: resolvedMitgliedsstatus ? resolvedMitgliedsstatus === 'Mitglied' : (member === true || member === 'true'),
      mitgliedsstatus: resolvedMitgliedsstatus,
      phone: phone || '',
      createdAt: new Date()
    };

    user.familyMembers.push(newChild);
    await user.save();

    // Get the newly added child (last item in array)
    const addedChild = user.familyMembers[user.familyMembers.length - 1];

    res.status(201).json({
      child: {
        _id: addedChild._id,
        firstName: addedChild.firstName,
        lastName: addedChild.lastName,
        sex: addedChild.sex,
        member: addedChild.member,
        mitgliedsstatus: addedChild.mitgliedsstatus || null,
        birthdate: addedChild.birthdate,
        phone: addedChild.phone,
        age: calculateAge(addedChild.birthdate),
        studentId: null,
        studentName: null,
        createdAt: addedChild.createdAt
      },
      message: `${firstName} erfolgreich hinzugefügt`
    });
  } catch (error) {
    logger.error("Error adding child", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Hinzufügen des Kindes' });
  }
});

// PUT /api/portal/children/:childId - Update child information
router.put('/:childId', verifyPortalAuth, auditLogMiddleware({ action: 'UPDATE', resource: 'Child' }), async (req, res) => {
  try {
    const { childId } = req.params;
    const { firstName, lastName, birthdate, sex, member, phone, mitgliedsstatus } = req.body;

    const user = await StudentPortalUser.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Find the child
    const child = user.familyMembers.id(childId);
    if (!child || child.relationship !== 'child') {
      return res.status(404).json({ error: 'Kind nicht gefunden' });
    }

    // Validate if provided
    if (firstName) {
      if (firstName.length < 2 || firstName.length > 50) {
        return res.status(400).json({ error: 'Vorname muss 2-50 Zeichen lang sein' });
      }
      child.firstName = firstName;
      child.name = `${firstName} ${child.lastName || lastName || ''}`.trim();
    }

    if (lastName) {
      if (lastName.length < 2 || lastName.length > 50) {
        return res.status(400).json({ error: 'Nachname muss 2-50 Zeichen lang sein' });
      }
      child.lastName = lastName;
      child.name = `${child.firstName || firstName || ''} ${lastName}`.trim();
    }

    if (birthdate) {
      const age = calculateAge(birthdate);
      if (age < 0 || age >= 100) {
        return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
      }
      if (age >= 18) {
        return res.status(400).json({
          error: 'Kind muss unter 18 Jahre alt sein. Familienmitglieder ab 18 Jahren sollten ein eigenes Portal-Konto anlegen.'
        });
      }
      child.birthdate = new Date(birthdate);
    }

    if (phone !== undefined) {
      if (phone && (phone.length < 10 || phone.length > 20)) {
        return res.status(400).json({
          error: 'Telefonnummer muss 10-20 Zeichen lang sein'
        });
      }
      child.phone = phone || '';
    }

    if (sex) {
      if (!['männlich', 'weiblich', 'divers'].includes(sex)) {
        return res.status(400).json({ error: 'Ungültiges Geschlecht' });
      }
      child.sex = sex;
    }

    if (mitgliedsstatus !== undefined) {
      child.mitgliedsstatus = mitgliedsstatus || null;
      child.member = mitgliedsstatus === 'Mitglied';
    } else if (member !== undefined) {
      child.member = member === true || member === 'true';
    }

    await user.save();

    // Populate studentId if exists
    await user.populate('familyMembers.studentId', 'firstName lastName');
    const updatedChild = user.familyMembers.id(childId);

    res.json({
      child: {
        _id: updatedChild._id,
        firstName: updatedChild.firstName,
        lastName: updatedChild.lastName,
        birthdate: updatedChild.birthdate,
        sex: updatedChild.sex,
        member: updatedChild.member,
        mitgliedsstatus: updatedChild.mitgliedsstatus || null,
        phone: updatedChild.phone,
        age: updatedChild.birthdate ? calculateAge(updatedChild.birthdate) : null,
        studentId: updatedChild.studentId?._id || null,
        studentName: updatedChild.studentId
          ? `${updatedChild.studentId.firstName} ${updatedChild.studentId.lastName}`
          : null,
        createdAt: updatedChild.createdAt
      },
      message: 'Kind erfolgreich aktualisiert'
    });
  } catch (error) {
    logger.error("Error updating child", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Kindes' });
  }
});

// DELETE /api/portal/children/:childId - Remove child
router.delete('/:childId', verifyPortalAuth, auditLogMiddleware({ action: 'DELETE', resource: 'Child' }), async (req, res) => {
  try {
    const { childId } = req.params;

    const user = await StudentPortalUser.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Find the child
    const child = user.familyMembers.id(childId);
    if (!child || child.relationship !== 'child') {
      return res.status(404).json({ error: 'Kind nicht gefunden' });
    }

    // Check for active registrations
    const activeRegistrations = await SeasonalRegistration.countDocuments({
      studentPortalUserId: req.user.id,
      familyMemberId: childId,
      status: { $in: ['pending', 'approved'] }
    });

    if (activeRegistrations > 0) {
      return res.status(400).json({
        error: 'Kind kann nicht gelöscht werden, da aktive Anmeldungen vorhanden sind'
      });
    }

    // Store child name for response message
    const childName = child.firstName && child.lastName
      ? `${child.firstName} ${child.lastName}`
      : child.name || 'Kind';

    // Remove the child using pull method (recommended for subdocuments)
    user.familyMembers.pull(childId);
    await user.save();

    res.json({
      message: `${childName} erfolgreich entfernt`
    });
  } catch (error) {
    logger.error("Error deleting child", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Löschen des Kindes' });
  }
});

export default router;
