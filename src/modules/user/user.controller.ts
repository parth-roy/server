import { prisma } from '@shared/db/prisma';
import { Request, Response, NextFunction } from 'express';
import * as UserService from './user.service';
import { sendSuccess, sendCreated } from '@shared/utils/response';
import { s3Service, UploadFolder } from '@modules/upload/upload.service';


// ─── Profile ───────────────────────────────────────────────────────────────

export async function getProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const user = await UserService.getProfile(req.user!.id);
        sendSuccess(res, user);
    } catch (err) {
        next(err);
    }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const user = await UserService.updateProfile(req.user!.id, req.body);
        sendSuccess(res, user, 'Profile updated');
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/v1/users/me/avatar
 * multipart/form-data with field "file" (image only, max 3 MB).
 * Uploads to DO Spaces profile/ folder, updates DB, returns updated user.
 */
export async function uploadAvatar(req: Request, res: Response, next: NextFunction) {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        // Extra guard — multer fileFilter already blocks this, but belt-and-suspenders
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            return res.status(422).json({
                success: false,
                message: 'Only JPEG, PNG or WEBP images are allowed',
            });
        }

        // Upload to DO Spaces  →  profile/<uuid>-filename.jpg
        const uploadResult = await s3Service.uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            UploadFolder.PROFILE,
            3 * 1024 * 1024, // 3 MB cap enforced again at service level
        );

        if (!uploadResult.success || !uploadResult.url) {
            return res.status(502).json({
                success: false,
                message: uploadResult.error ?? 'Failed to upload image to storage',
            });
        }

        // Persist URL to database
        const updatedUser = await UserService.updateProfileImage(req.user!.id, uploadResult.url);

        return sendSuccess(res, updatedUser, 'Profile picture updated successfully');
    } catch (err) {
        next(err);
    }
}

// ─── Addresses ─────────────────────────────────────────────────────────────

export async function getAddresses(req: Request, res: Response, next: NextFunction) {
    try {
        const addresses = await UserService.getAddresses(req.user!.id);
        sendSuccess(res, addresses);
    } catch (err) {
        next(err);
    }
}

export async function addAddress(req: Request, res: Response, next: NextFunction) {
    try {
        const address = await UserService.addAddress(req.user!.id, req.body);
        sendCreated(res, address, 'Address added');
    } catch (err) {
        next(err);
    }
}

export async function updateAddress(req: Request, res: Response, next: NextFunction) {
    try {
        const address = await UserService.updateAddress(
            req.user!.id,
            req.params.id as string,
            req.body
        );
        sendSuccess(res, address, 'Address updated');
    } catch (err) {
        next(err);
    }
}

export async function deleteAddress(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await UserService.deleteAddress(req.user!.id, req.params.id as string);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}

export async function setDefaultAddress(req: Request, res: Response, next: NextFunction) {
    try {
        const address = await UserService.setDefaultAddress(req.user!.id, req.params.id as string);
        sendSuccess(res, address, 'Default address updated');
    } catch (err) {
        next(err);
    }
}

// ─── GST ───────────────────────────────────────────────────────────────────

export async function getGstDetails(req: Request, res: Response, next: NextFunction) {
    try {
        const gst = await UserService.getGstDetails(req.user!.id);
        sendSuccess(res, gst);
    } catch (err) {
        next(err);
    }
}

export async function addGstDetail(req: Request, res: Response, next: NextFunction) {
    try {
        const gst = await UserService.addGstDetail(req.user!.id, req.body);
        sendCreated(res, gst, 'GST detail added');
    } catch (err) {
        next(err);
    }
}

export async function deleteGstDetail(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await UserService.deleteGstDetail(req.user!.id, req.params.id as string);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}

export async function setPrimaryGst(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await UserService.setPrimaryGst(req.user!.id, req.params.id as string);
    sendSuccess(res, result, 'Primary GST set');
  } catch (err) {
    next(err);
  }
}

// ─── Team Members ────────────────────────────────────────────────────────
export async function getTeamMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await UserService.getTeamMembers(req.user!.id);
    sendSuccess(res, result, 'Team members fetched successfully');
  } catch (err) {
    next(err);
  }
}

export async function addTeamMember(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await UserService.addTeamMember(req.user!.id, req.body);
    sendSuccess(res, result, 'Team member added successfully', 201);
  } catch (err) {
    next(err);
  }
}

export async function updateTeamMember(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await UserService.updateTeamMember(req.user!.id, req.params.id as string, req.body);
    sendSuccess(res, result, 'Team member updated successfully');
  } catch (err) {
    next(err);
  }
}

export async function deleteTeamMember(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await UserService.deleteTeamMember(req.user!.id, req.params.id as string);
    sendSuccess(res, result, 'Team member deleted successfully');
  } catch (err) {
    next(err);
  }
}

// ─── FCM Token ──────────────────────────────────────────────────────────────

export async function updateFcmToken(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.user!.id;
    const { fcmToken } = req.body as { fcmToken: string };
    await prisma.user.update({ where: { id }, data: { fcmToken } });
    return res.status(200).json({ success: true, message: 'FCM token updated' });
  } catch (error) {
    next(error);
  }
}
