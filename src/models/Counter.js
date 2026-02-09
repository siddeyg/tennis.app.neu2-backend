import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: {
    type: Number,
    default: 1000  // Start ticket numbers at 1000
  }
});

const Counter = mongoose.model('Counter', counterSchema);
export default Counter;
