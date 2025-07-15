const Student = require("../models/Student");

exports.getStudents = async (req, res) => {
  try {
    const students = await Student.find();
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addStudent = async (req, res) => {
  try {
    const student = new Student(req.body);
    await student.save();
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: "Schüler gelöscht" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
