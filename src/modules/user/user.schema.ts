import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  email: z.string().email('Invalid email address').optional(),
  profileImageUrl: z.string().url('Invalid image URL').optional(),
  language: z.enum(['en', 'hi', 'bn']).optional(),
  fcmToken: z.string().min(1).optional(),
  usageType: z.enum(['Business Usage', 'Personal Usage', 'House Shifting Usage']).optional(),
  whatsappOptIn: z.boolean().optional(),
  profileComplete: z.boolean().optional(),
});

export const addAddressSchema = z.object({
  label: z.string().min(1, 'Label is required').max(50),
  addressLine1: z.string().min(5, 'Address too short').max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().default(false),
});

export const updateAddressSchema = addAddressSchema.partial();

export const addGstSchema = z.object({
  gstin: z
    .string()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      'Invalid GSTIN format. Example: 22AAAAA0000A1Z5'
    ),
  businessName: z.string().min(2).max(200).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AddAddressInput = z.infer<typeof addAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type AddGstInput = z.infer<typeof addGstSchema>;

export const addTeamMemberSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  email: z.string().email('Invalid email').optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian mobile number'),
  role: z.enum(['ADMIN', 'MANAGER', 'VIEWER']).default('VIEWER'),
});

export const updateTeamMemberSchema = addTeamMemberSchema.partial();

export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

export const updateFcmTokenSchema = z.object({
  fcmToken: z.string().min(10, 'Invalid FCM token'),
});