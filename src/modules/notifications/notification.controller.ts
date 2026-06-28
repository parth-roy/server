import { Request, Response, NextFunction } from 'express';
import { notificationService } from './notification.service';

export const notificationController = {
  /**
   * POST /api/v1/notifications/send
   * Send notification to a single device
   */
  send: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fcmToken, title, body, data } = req.body;

      if (!fcmToken || !title || !body) {
        return res.status(400).json({
          success: false,
          message: 'fcmToken, title, and body are required',
        });
      }

      const result = await notificationService.sendToDevice(fcmToken, { title, body, data });
      
      if (result.success) {
        res.status(200).json({
          success: true,
          data: { messageId: result.messageId },
          message: 'Notification sent successfully',
        });
      } else {
        throw new Error(result.error || 'Failed to send notification');
      }
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/notifications/send-multicast
   * Send notification to multiple devices
   */
  sendMulticast: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fcmTokens, title, body, data } = req.body;

      if (!fcmTokens || !Array.isArray(fcmTokens) || fcmTokens.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'fcmTokens (array) is required',
        });
      }

      if (!title || !body) {
        return res.status(400).json({
          success: false,
          message: 'title and body are required',
        });
      }

      const result = await notificationService.sendToDevices(fcmTokens, { title, body, data });
      res.status(200).json({
        success: true,
        data: result,
        message: 'Multicast notification sent',
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/notifications/subscribe
   * Subscribe device to a topic
   */
  subscribe: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fcmToken, topic } = req.body;

      if (!fcmToken || !topic) {
        return res.status(400).json({
          success: false,
          message: 'fcmToken and topic are required',
        });
      }

      const result = await notificationService.subscribeToTopic(fcmToken, topic);
      
      if (result.success) {
        res.status(200).json({
          success: true,
          data: null,
          message: `Subscribed to ${topic}`,
        });
      } else {
        throw new Error(result.error || 'Failed to subscribe');
      }
    } catch (error) {
      next(error);
    }
  },
};