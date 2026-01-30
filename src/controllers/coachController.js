const Coach = require("../models/Coach.js");

exports.getCoaches = async (req, res) => {
  try {
    const coaches = await Coach.find();
    res.json(coaches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addCoach = async (req, res) => {
  try {
    const coach = new Coach(req.body);
    await coach.save();
    res.status(201).json(coach);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateCoach = async (req, res) => {
  try {
    const coach = await Coach.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(coach);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteCoach = async (req, res) => {
  try {
    await Coach.findByIdAndDelete(req.params.id);
    res.json({ message: "Trainer gelöscht" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
