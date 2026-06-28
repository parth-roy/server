/**
 * firebase.ts — Firebase Admin SDK initialization
 *
 * SECURITY: Service account credentials MUST be provided via environment variables:
 *   FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL
 * OR via FIREBASE_PRIVATE_KEY_PATH pointing to a file that is NOT committed to git.
 *
 * NEVER commit *firebase-adminsdk*.json files to the repository.
 * They are gitignored via: src\/**\/*firebase-adminsdk*.json
 *
 * If credentials were already committed, revoke them immediately at:
 * https://console.firebase.google.com/project/_/settings/serviceaccounts
 */
import admin from 'firebase-admin';
import { env } from './env';
import * as fs from 'fs';
import * as path from 'path';

let firebaseApp: admin.app.App;

function getServiceAccount() {
  // If FIREBASE_PRIVATE_KEY_PATH is provided, load from file
  if (env.FIREBASE_PRIVATE_KEY_PATH) {
    const filePath = path.resolve(process.cwd(), env.FIREBASE_PRIVATE_KEY_PATH);
    if (fs.existsSync(filePath)) {
      const serviceAccount = require(filePath);
      return {
        projectId: serviceAccount.project_id,
        privateKey: serviceAccount.private_key,
        clientEmail: serviceAccount.client_email,
      };
    }
  }

  // Otherwise, load from environment variables
  return {
    projectId: env.FIREBASE_PROJECT_ID,
    privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
  };
}

export function getFirebase(): admin.app.App {
  if (!firebaseApp) {
    const serviceAccount = getServiceAccount();
    
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return firebaseApp;
}

export function getMessaging(): admin.messaging.Messaging {
  return getFirebase().messaging();
}