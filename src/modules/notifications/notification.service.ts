import { getMessaging } from '@config/firebase';
import { logger } from '@shared/logger';

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export const notificationService = {
  /**
   * Send push notification to a single device
   */
  sendToDevice: async (fcmToken: string, payload: NotificationPayload): Promise<{ success: boolean; messageId?: string; error?: string }> => {
    try {
      const messaging = getMessaging();
      const isBooking = payload.data?.type === 'NEW_BOOKING' || payload.data?.type === 'BOOKING_DISPATCH';

      const message: any = {
        data: {
            ...payload.data,
            title: payload.title, // Pass title/body in data so Flutter can display it
            body: payload.body,
        },
        token: fcmToken,
      };

      if (!isBooking) {
          message.notification = {
              title: payload.title,
              body: payload.body,
          };
      }

      if (payload.imageUrl) {
        message.android = { notification: { imageUrl: payload.imageUrl } };
      }

      const result = await messaging.send(message);
      logger.info(`Notification sent successfully to device: ${result}`);
      return { success: true, messageId: result };
    } catch (error: any) {
      logger.error(`Error sending notification to device:`, error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send push notification to multiple devices
   */
  sendToDevices: async (fcmTokens: string[], payload: NotificationPayload): Promise<{ success: boolean; successCount: number; failureCount: number; errors?: string[] }> => {
    try {
      const messaging = getMessaging();
      const isBooking = payload.data?.type === 'NEW_BOOKING' || payload.data?.type === 'BOOKING_DISPATCH';

      const message: any = {
        data: {
            ...payload.data,
            title: payload.title,
            body: payload.body,
        },
        tokens: fcmTokens,
      };

      if (!isBooking) {
          message.notification = {
              title: payload.title,
              body: payload.body,
          };
      }

      const result = await messaging.sendEachForMulticast(message);
      
      const successCount = result.successCount;
      const failureCount = result.failureCount;
      
      logger.info(`Multicast notification sent: ${successCount} success, ${failureCount} failed`);
      
      return {
        success: failureCount === 0,
        successCount,
        failureCount,
      };
    } catch (error: any) {
      logger.error(`Error sending multicast notification:`, error.message);
      return { success: false, successCount: 0, failureCount: fcmTokens.length, errors: [error.message] };
    }
  },

  /**
   * Send notification to a topic
   */
  sendToTopic: async (topic: string, payload: NotificationPayload): Promise<{ success: boolean; messageId?: string; error?: string }> => {
    try {
      const messaging = getMessaging();

      const message = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        topic: topic,
      };

      const result = await messaging.send(message);
      logger.info(`Topic notification sent to ${topic}: ${result}`);
      return { success: true, messageId: result };
    } catch (error: any) {
      logger.error(`Error sending topic notification:`, error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Subscribe device to a topic
   */
  subscribeToTopic: async (fcmToken: string, topic: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const messaging = getMessaging();
      await messaging.subscribeToTopic(fcmToken, topic);
      logger.info(`Device subscribed to topic: ${topic}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`Error subscribing to topic:`, error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Unsubscribe device from a topic
   */
  unsubscribeFromTopic: async (fcmToken: string, topic: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const messaging = getMessaging();
      await messaging.unsubscribeFromTopic(fcmToken, topic);
      logger.info(`Device unsubscribed from topic: ${topic}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`Error unsubscribing from topic:`, error.message);
      return { success: false, error: error.message };
    }
  },
};