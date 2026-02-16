import mongoose from 'mongoose';

const { Schema } = mongoose;

const documentSchema = new Schema({
  filename: { type: String, required: true },          // UUID-based stored name
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },              // bytes
  category: {
    type: String,
    enum: ['Trainingsplan', 'Vereinsinfos', 'Formulare', 'Turniere', 'Sonstiges'],
    default: 'Sonstiges'
  },
  visibleTo: {
    type: [String],
    enum: ['admin', 'coach', 'student'],
    default: ['admin', 'coach']
  },
  uploadedBy: { type: Schema.Types.Mixed, required: true },
  uploadedByRole: { type: String, enum: ['admin', 'coach'], required: true },
  description: { type: String, maxlength: 1000 }
}, { timestamps: true });

documentSchema.index({ category: 1, createdAt: -1 });
documentSchema.index({ visibleTo: 1, category: 1 });

export default mongoose.model('Document', documentSchema);
