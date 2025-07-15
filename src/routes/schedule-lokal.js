const express = require("express");
const router = express.Router();
const {
  getSchedule,
  updateSchedule,
} = require("../controllers/scheduleController");

router.get("/", getSchedule);
router.put("/", updateSchedule);

module.exports = router;
