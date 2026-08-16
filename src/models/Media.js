import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema({
  gallery: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Gallery',
    required: [true, 'Media must belong to a gallery']
  },
  originalFilename: {
    type: String,
    required: [true, 'Original filename is required'],
    trim: true
  },
  filePath: {
    type: String,
    required: [true, 'File path is required'],
    select: false // Do not expose physical path by default
  },
  thumbnailPath: {
    type: String,
    required: [true, 'Thumbnail path is required'],
    select: false
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  type: {
    type: String,
    enum: ['image', 'video'],
    required: [true, 'Media type (image or video) is required']
  },
  size: {
    type: Number, // in bytes
    required: [true, 'File size is required']
  },
  width: {
    type: Number,
    required: [true, 'Width is required for layout stability']
  },
  height: {
    type: Number,
    required: [true, 'Height is required for layout stability']
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  isPublished: {
    type: Boolean,
    default: true // Typically published if uploaded to a published gallery, but toggleable
  },
  uploader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Ensure sortOrder is populated correctly within a gallery
mediaSchema.index({ gallery: 1, sortOrder: 1 });

const Media = mongoose.model('Media', mediaSchema);
export default Media;
