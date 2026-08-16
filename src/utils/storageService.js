import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'galleries');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');
const MAX_DIMENSION = 4000;

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(THUMBNAIL_DIR)) fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

class LocalFileStorage {
  /**
   * Process and save a file securely
   * @param {String} tempFilePath - The physical path to the temporary uploaded file
   * @param {String} originalName - Original filename for logging/reference
   * @param {String} mimeType - The mime type reported by multer
   * @param {Number} videoWidth - Width provided by frontend for videos
   * @param {Number} videoHeight - Height provided by frontend for videos
   * @returns {Promise<Object>} - Object containing file paths and metadata
   */
  async saveMedia(tempFilePath, originalName, mimeType, videoWidth = 1920, videoHeight = 1080) {
    // 1. Verify Magic Bytes
    const type = await fileTypeFromFile(tempFilePath);
    if (!type || (!type.mime.startsWith('image/') && !type.mime.startsWith('video/'))) {
      throw new Error('Invalid or unsupported file type. Magic bytes verification failed.');
    }

    const isImage = type.mime.startsWith('image/');
    const isVideo = type.mime.startsWith('video/');
    const fileId = uuidv4();
    
    let finalBuffer;
    let width = 0;
    let height = 0;
    let finalExt = isImage ? 'webp' : type.ext;
    let finalMime = isImage ? 'image/webp' : type.mime;

    const originalFilename = `${fileId}.${finalExt}`;
    const thumbnailFilename = `${fileId}_thumb.webp`;
    
    const physicalPath = path.join(UPLOAD_DIR, originalFilename);
    const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFilename);

    if (isImage) {
      // 2. Process image with sharp: Strip EXIF, resize if too large, convert to WebP
      const image = sharp(tempFilePath);
      const metadata = await image.metadata();

      // Check Decompression Bomb potential
      if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
          // Resize it down safely
          image.resize({
              width: metadata.width > metadata.height ? MAX_DIMENSION : null,
              height: metadata.height >= metadata.width ? MAX_DIMENSION : null,
              fit: 'inside',
              withoutEnlargement: true
          });
      }

      // Convert to webp and strip metadata (which happens by default unless withMetadata is called)
      const { data: processedBuffer, info } = await image
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
        
      finalBuffer = processedBuffer;
      width = info.width;
      height = info.height;

      // Generate Thumbnail
      await sharp(processedBuffer)
        .resize({ width: 400, height: 400, fit: 'inside' })
        .webp({ quality: 60 })
        .toFile(thumbnailPath);

    } else if (isVideo) {
        width = parseInt(videoWidth) || 1920;
        height = parseInt(videoHeight) || 1080;
        
        finalBuffer = await fs.promises.readFile(tempFilePath);
        
        // Generate a placeholder thumbnail for video (or use a static asset)
        // Creating a simple 400x400 black square with sharp as a placeholder
        await sharp({
            create: {
              width: 400,
              height: 400,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        })
        .webp()
        .toFile(thumbnailPath);
    }

    // 3. Save physical file securely
    await fs.promises.writeFile(physicalPath, finalBuffer);

    return {
      filePath: physicalPath,
      thumbnailPath: thumbnailPath,
      mimeType: finalMime,
      size: finalBuffer.length,
      width,
      height,
      type: isImage ? 'image' : 'video'
    };
  }

  async deleteMedia(filePath, thumbnailPath) {
      try {
          if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
          if (fs.existsSync(thumbnailPath)) await fs.promises.unlink(thumbnailPath);
      } catch (err) {
          console.error("Error deleting media files:", err);
      }
  }
}

export default new LocalFileStorage();
