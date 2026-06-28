import { z } from 'zod';

export const sendOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  fcmToken: z.string().optional(), // FCM device token — OTP is delivered via push notification
  role: z.enum(['CUSTOMER', 'DRIVER', 'ADMIN', 'FLEET_OWNER']).optional().default('CUSTOMER'),
});

export const verifyOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  otp: z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must be numeric'),
  fcmToken: z.string().optional(), // Firebase Cloud Messaging token
  role: z.enum(['CUSTOMER', 'DRIVER', 'ADMIN', 'FLEET_OWNER']).optional().default('CUSTOMER'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;