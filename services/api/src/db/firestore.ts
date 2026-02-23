import { Firestore } from '@google-cloud/firestore';
import { getProjectId, getFirestoreDatabaseId } from '../config.js';

let firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!firestore) {
    const projectId = getProjectId();
    const databaseId = getFirestoreDatabaseId();
    firestore = new Firestore({ projectId, ...(databaseId && { databaseId }) });
  }
  return firestore;
}

export const COLLECTIONS = {
  MEMOS: 'memos',
  DRAFTS: 'drafts',
  NEWSLETTERS: 'newsletters',
  SUBSCRIBERS: 'subscribers',
  PROMPT_VERSIONS: 'promptVersions',
  ADMIN_USERS: 'adminUsers',
} as const;
