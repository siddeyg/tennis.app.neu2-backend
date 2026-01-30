/**
 * Middleware to check if user can access student data
 * - Admin: can access all students
 * - Coach: can access all students (view only)
 * - Student: can only access their own data
 *
 * Must be used AFTER requireAuth middleware
 */
export const checkStudentAccess = (req, res, next) => {
  // Admin and Coach can access all students
  if (req.user.role === "admin" || req.user.role === "coach") {
    return next();
  }

  // Student can only access their own data
  if (req.user.role === "student") {
    const requestedStudentId = req.params.id;
    const userStudentId = req.user.studentId;

    // If no specific student ID in params (e.g., GET /api/students), filter will be applied in route
    if (!requestedStudentId) {
      return next();
    }

    // Check if student is accessing their own data
    if (requestedStudentId === String(userStudentId)) {
      return next();
    }

    return res.status(403).json({
      error: "Keine Berechtigung",
      message: "Sie können nur Ihre eigenen Daten einsehen"
    });
  }

  return res.status(403).json({ error: "Keine Berechtigung" });
};

/**
 * Middleware to check if user can modify student data
 * - Admin: can modify all students
 * - Coach: cannot modify students
 * - Student: can modify only their own data (limited fields)
 */
export const checkStudentModify = (req, res, next) => {
  // Admin can modify all students
  if (req.user.role === "admin") {
    return next();
  }

  // Student can modify their own data (limited fields)
  if (req.user.role === "student") {
    const requestedStudentId = req.params.id;
    const userStudentId = req.user.studentId;

    if (requestedStudentId === String(userStudentId)) {
      // Restrict what students can modify
      const allowedFields = ["email", "phone", "adress", "availableTimes", "comment"];
      const requestedFields = Object.keys(req.body);
      const unauthorizedFields = requestedFields.filter(f => !allowedFields.includes(f));

      if (unauthorizedFields.length > 0) {
        return res.status(403).json({
          error: "Keine Berechtigung",
          message: `Sie können diese Felder nicht bearbeiten: ${unauthorizedFields.join(", ")}`
        });
      }

      return next();
    }

    return res.status(403).json({
      error: "Keine Berechtigung",
      message: "Sie können nur Ihre eigenen Daten bearbeiten"
    });
  }

  // Coach cannot modify students
  return res.status(403).json({
    error: "Keine Berechtigung",
    message: "Trainer können Schülerdaten nicht bearbeiten"
  });
};
