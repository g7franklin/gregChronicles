import * as admin from 'firebase-admin';
import { getProjectId } from '../config.js';

let initialized = false;

export function initFirebaseAdmin(): void {
  if (initialized) return;
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT or GCP_PROJECT must be set');
  }
  admin.initializeApp({ projectId });
  initialized = true;
}
