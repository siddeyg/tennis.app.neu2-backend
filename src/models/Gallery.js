import mongoose from 'mongoose';

const gallerySchema = new mongoose.Schema({
  headline: {
    type: String,
    required: [true, 'Headline is required'],
    trim: true,
    maxlength: [100, 'Headline cannot be more than 100 characters']
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now
  },
  coverImage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media'
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual populate for media
gallerySchema.virtual('media', {
  ref: 'Media',
  localField: '_id',
  foreignField: 'gallery',
  justOne: false
});

const Gallery = mongoose.model('Gallery', gallerySchema);
export default Gallery;
