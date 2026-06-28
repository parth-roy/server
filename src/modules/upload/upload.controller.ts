import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { s3Service, UploadFolder } from './upload.service';
import { logger } from '@shared/logger';

// ── Multer: store uploads in memory, then stream straight to DO Spaces ─────
const storage = multer.memoryStorage();

// General upload middleware (10 MB cap)
export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Strict profile avatar middleware: 3 MB, single image only
export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB cap for profile pictures
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG or WEBP images are allowed for profile pictures'));
    }
  },
});

export const uploadController = {
  /**
   * POST /api/v1/upload/single
   * Upload a single file to the specified folder.
   * Body: multipart/form-data — field "file" + optional "folder" text field.
   * Allowed folders: profile | bookings | documents | banners | uploads
   */
  uploadSingle: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: 'No file provided' });
      }

      // Validate folder param against allowed values; fall back to 'uploads'
      const allowedFolders = Object.values(UploadFolder) as string[];
      const rawFolder = (req.body.folder as string | undefined)?.trim().toLowerCase() ?? '';
      const folder = allowedFolders.includes(rawFolder) ? rawFolder : UploadFolder.UPLOADS;

      const result = await s3Service.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        folder,
      );

      if (!result.success) {
        return res.status(422).json({ success: false, message: result.error ?? 'Upload failed' });
      }

      return res.status(200).json({
        success: true,
        data: { url: result.url, key: result.key },
        message: 'File uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/upload/multiple
   * Upload up to 10 files to the specified folder.
   * Body: multipart/form-data — field "files[]" + optional "folder" text field.
   */
  uploadMultiple: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files provided' });
      }

      const allowedFolders = Object.values(UploadFolder) as string[];
      const rawFolder = (req.body.folder as string | undefined)?.trim().toLowerCase() ?? '';
      const folder = allowedFolders.includes(rawFolder) ? rawFolder : UploadFolder.UPLOADS;

      const results = await s3Service.uploadMultiple(
        files.map((f) => ({ buffer: f.buffer, fileName: f.originalname, contentType: f.mimetype })),
        folder,
      );

      const successful = results.filter((r) => r.success).map((r) => ({ url: r.url, key: r.key }));
      const failedCount = results.filter((r) => !r.success).length;

      return res.status(200).json({
        success: failedCount === 0,
        data: { files: successful, totalUploaded: successful.length, failedCount },
        message:
          failedCount === 0
            ? 'All files uploaded successfully'
            : `${successful.length} uploaded, ${failedCount} failed`,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/v1/upload/:key
   * Delete a file by its S3 key (URL-encoded, e.g. profile%2Fuuid-photo.jpg).
   */
  deleteFile: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.params.key;
      if (!key) {
        return res.status(400).json({ success: false, message: 'File key is required' });
      }

      // Decode URI component in case key contains '/' encoded as '%2F'
      const decodedKey = decodeURIComponent(String(key));
      const result = await s3Service.deleteFile(decodedKey);

      if (!result.success) {
        return res.status(422).json({ success: false, message: result.error ?? 'Delete failed' });
      }

      return res.status(200).json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
};