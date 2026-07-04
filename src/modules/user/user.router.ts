import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as UserController from './user.controller';
import { uploadAvatar } from '@modules/upload/upload.controller';
import {
  updateProfileSchema,
  addAddressSchema,
  updateAddressSchema,
  addGstSchema,
  addTeamMemberSchema,
  updateTeamMemberSchema,
  updateFcmTokenSchema,
} from './user.schema';

export const userRouter = Router();

// All user routes require authentication
userRouter.use(authenticate);

// ─── Profile ───────────────────────────────────────────────────────────────
userRouter.get('/me', UserController.getProfile);
userRouter.get('/me/stats', UserController.getStats);
userRouter.patch('/me', validate(updateProfileSchema), UserController.updateProfile);
userRouter.put('/me/fcm-token', validate(updateFcmTokenSchema), UserController.updateFcmToken);

// POST /api/v1/users/me/avatar — upload profile picture (max 3 MB JPEG/PNG/WEBP)
// uploadAvatar is the multer middleware (3 MB limit + image-only filter)
userRouter.post('/me/avatar', uploadAvatar.single('file'), UserController.uploadAvatar);

// ─── Addresses ─────────────────────────────────────────────────────────────
userRouter.get('/me/addresses', UserController.getAddresses);
userRouter.post('/me/addresses', validate(addAddressSchema), UserController.addAddress);
userRouter.patch('/me/addresses/:id', validate(updateAddressSchema), UserController.updateAddress);
userRouter.delete('/me/addresses/:id', UserController.deleteAddress);
userRouter.post('/me/addresses/:id/set-default', UserController.setDefaultAddress);

// ─── GST ───────────────────────────────────────────────────────────────────
userRouter.get('/me/gst', UserController.getGstDetails);
userRouter.post('/me/gst', validate(addGstSchema), UserController.addGstDetail);
userRouter.delete('/me/gst/:id', UserController.deleteGstDetail);
userRouter.post('/me/gst/:id/set-primary', UserController.setPrimaryGst);

// ─── Team Members (Enterprise) ─────────────────────────────────────────────
userRouter.get('/me/team', UserController.getTeamMembers);
userRouter.post('/me/team', validate(addTeamMemberSchema), UserController.addTeamMember);
userRouter.patch('/me/team/:id', validate(updateTeamMemberSchema), UserController.updateTeamMember);
userRouter.delete('/me/team/:id', UserController.deleteTeamMember);