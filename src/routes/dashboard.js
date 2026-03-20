import express from 'express';
import SupportTicket from '../models/SupportTicket.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Camp from '../models/Camp.js';
import CampRegistration from '../models/CampRegistration.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/dashboard
 * Aggregate stats for the ticket portal dashboard.
 * Returns portal user count, ticket stats, camp registration counts.
 */
router.get('/', async (req, res) => {
  try {
    const [
      portalUserCount,
      unverifiedCount,
      familyMemberAgg,
      ticketStats,
      camps,
      campRegAgg
    ] = await Promise.all([
      StudentPortalUser.countDocuments({}),
      StudentPortalUser.countDocuments({ isVerified: false }),

      StudentPortalUser.aggregate([
        { $project: { count: { $size: { $ifNull: ['$familyMembers', []] } } } },
        { $group: { _id: null, total: { $sum: '$count' } } }
      ]),

      SupportTicket.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),

      Camp.find({ deletedAt: null }, '_id title maxParticipants').lean(),

      CampRegistration.aggregate([
        { $match: { status: { $in: ['pending', 'confirmed', 'waitlist'] } } },
        { $group: { _id: '$campId', count: { $sum: 1 } } }
      ])
    ]);

    // Build ticket summary
    const ticketMap = { open: 0, 'in-progress': 0, resolved: 0, closed: 0 };
    let ticketTotal = 0;
    for (const row of ticketStats) {
      ticketMap[row._id] = (ticketMap[row._id] || 0) + row.count;
      ticketTotal += row.count;
    }

    // Build per-camp registration map
    const regByCamp = {};
    for (const row of campRegAgg) {
      regByCamp[String(row._id)] = row.count;
    }

    const campRows = camps.map(c => ({
      _id: c._id,
      name: c.title,
      registrations: regByCamp[String(c._id)] || 0,
      maxParticipants: c.maxParticipants || 0
    }));
    campRows.sort((a, b) => b.registrations - a.registrations);

    const totalCampRegistrations = campRows.reduce((s, c) => s + c.registrations, 0);
    const totalCapacity = campRows.reduce((s, c) => s + c.maxParticipants, 0);

    const familyMemberCount = familyMemberAgg[0]?.total || 0;

    res.json({
      portalUsers: portalUserCount,
      unverifiedUsers: unverifiedCount,
      familyMembers: familyMemberCount,
      tickets: {
        open: ticketMap['open'],
        inProgress: ticketMap['in-progress'],
        resolved: ticketMap['resolved'],
        closed: ticketMap['closed'],
        total: ticketTotal
      },
      campRegistrations: {
        total: totalCampRegistrations,
        totalCapacity,
        perCamp: campRows
      }
    });
  } catch (err) {
    logger.error('Dashboard stats error', { error: err.message });
    res.status(500).json({ error: 'Serverfehler beim Laden der Dashboard-Daten' });
  }
});

export default router;
