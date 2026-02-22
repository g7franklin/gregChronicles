import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth as getFirebaseAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getApp(): FirebaseApp {
  const apps = getApps();
  if (apps.length) return apps[0] as FirebaseApp;
  return initializeApp(config);
}

export function getAuth() {
  return getFirebaseAuth(getApp());
}

export function getAuthToken(): Promise<string | null> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return Promise.resolve(null);
  return user.getIdToken();
}

export async function signInWithGoogle(): Promise<void> {
  const auth = getAuth();
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOut(): Promise<void> {
  const auth = getAuth();
  await fbSignOut(auth);
}
