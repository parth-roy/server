import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// ── Folder constants (maps usage type to DO Spaces subfolder) ──────────────
export const UploadFolder = {
  PROFILE:   'profile',
  BOOKINGS:  'bookings',
  DOCUMENTS: 'documents',
  BANNERS:   'banners',
  UPLOADS:   'uploads',   // fallback / generic
} as const;

export type UploadFolderType = typeof UploadFolder[keyof typeof UploadFolder];

// ── S3 client configured for DigitalOcean Spaces ──────────────────────────
// DO Spaces is S3-compatible but requires:
//   1. Custom endpoint (not *.amazonaws.com)
//   2. forcePathStyle: false  → virtual-hosted style URLs
//   3. region = the slug before .digitaloceanspaces.com (e.g. 'sgp1')
const s3Client = new S3Client({
  region: 'sgp1',
  endpoint: env.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: env.DO_SPACES_KEY || '',
    secretAccessKey: env.DO_SPACES_SECRET || '',
  },
  forcePathStyle: false,
});

const BUCKET = env.DO_SPACES_BUCKET;
// CDN base: https://gomytruck.sgp1.digitaloceanspaces.com
const CDN_BASE = env.DO_SPACES_CDN_ENDPOINT;

// ── Allowed MIME types & their extensions ─────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB global cap

// ── Result types ──────────────────────────────────────────────────────────
export interface UploadResult {
  success: boolean;
  url?: string;    // full public CDN URL
  key?: string;    // S3 key (folder/uuid-filename.ext)
  error?: string;
}

/**
 * Build a sanitised object key.
 * e.g. profile/a3f1c2d4-...-photo.jpg
 */
function buildKey(folder: string, originalName: string): string {
  // Sanitise filename: strip path separators, keep only the extension
  const ext  = path.extname(originalName).toLowerCase() || '';
  const safe = path.basename(originalName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${folder}/${uuidv4()}-${safe}${ext}`;
}

/**
 * Validate file before upload.
 * Returns an error message string, or null if valid.
 */
function validate(buffer: Buffer, contentType: string, maxBytes = MAX_SIZE_BYTES): string | null {
  if (buffer.length === 0) return 'File buffer is empty';
  if (buffer.length > maxBytes) return `File too large (max ${maxBytes / (1024 * 1024)} MB)`;
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return `Unsupported file type: ${contentType}. Allowed: JPEG, PNG, WEBP, GIF, PDF`;
  }
  return null;
}

export const s3Service = {
  /**
   * Upload a single file to DigitalOcean Spaces.
   * @param file        Raw file buffer
   * @param fileName    Original file name (used to derive extension)
   * @param contentType MIME type (e.g. 'image/jpeg')
   * @param folder      Subfolder in the bucket (use UploadFolder constants)
   * @param maxBytes    Optional per-call size override (e.g. 3 MB for profile pics)
   */
  uploadFile: async (
    file: Buffer,
    fileName: string,
    contentType: string,
    folder: UploadFolderType | string = UploadFolder.UPLOADS,
    maxBytes?: number,
  ): Promise<UploadResult> => {
    // Validate
    const validationError = validate(file, contentType, maxBytes);
    if (validationError) {
      logger.warn(`Upload validation failed: ${validationError}`);
      return { success: false, error: validationError };
    }

    const key = buildKey(folder, fileName);

    try {
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: file,
        ContentType: contentType,
        // Public-read so profile images and banners are accessible via CDN URL
        ACL: 'public-read',
        // Cache uploaded files for 1 year (CDN-friendly)
        CacheControl: 'max-age=31536000',
      });

      await s3Client.send(command);

      // Public CDN URL: https://gomytruck.sgp1.digitaloceanspaces.com/profile/uuid.jpg
      const url = `${CDN_BASE}/${key}`;

      logger.info(`[S3] Uploaded → ${url}`);
      return { success: true, url, key };
    } catch (error: any) {
      logger.error('[S3] Upload error:', { message: error.message, code: error.Code });
      return { success: false, error: error.message ?? 'Upload failed' };
    }
  },

  /**
   * Upload multiple files to the same folder.
   */
  uploadMultiple: async (
    files: Array<{ buffer: Buffer; fileName: string; contentType: string }>,
    folder: UploadFolderType | string = UploadFolder.UPLOADS,
  ): Promise<Array<UploadResult>> => {
    const results: Array<UploadResult> = [];
    for (const f of files) {
      const result = await s3Service.uploadFile(f.buffer, f.fileName, f.contentType, folder);
      results.push(result);
    }
    return results;
  },

  /**
   * Delete a file from Spaces by its key.
   */
  deleteFile: async (key: string): Promise<{ success: boolean; error?: string }> => {
    if (!key || typeof key !== 'string') {
      return { success: false, error: 'Invalid key' };
    }
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      logger.info(`[S3] Deleted → ${key}`);
      return { success: true };
    } catch (error: any) {
      logger.error('[S3] Delete error:', { message: error.message });
      return { success: false, error: error.message ?? 'Delete failed' };
    }
  },

  /**
   * Generate a time-limited pre-signed URL for private file access.
   * (Useful for KYC documents etc. — not used for public profile images.)
   * @param key       S3 object key
   * @param expiresIn Seconds until URL expires (default 1 hour)
   */
  getSignedUrl: async (key: string, expiresIn = 3600): Promise<string | null> => {
    try {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const signed  = await getSignedUrl(s3Client, command, { expiresIn });
      return signed;
    } catch (error: any) {
      logger.error('[S3] Signed URL error:', { message: error.message });
      return null;
    }
  },
};