import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInAnonymously, signInWithPopup, linkWithPopup } from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc, serverTimestamp } from "firebase/firestore";
import type { GameProgress } from "../game/types";

const env = import.meta.env;
const configured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);

const app = configured
  ? (getApps()[0] ?? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID
    }))
  : null;

export const firebaseReady = Boolean(app);
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export async function signInGuest() {
  if (!auth) throw new Error("Configure o Firebase em apps/web/.env primeiro.");
  return signInAnonymously(auth);
}

export async function signInGoogle() {
  if (!auth) throw new Error("Configure o Firebase em apps/web/.env primeiro.");
  const provider = new GoogleAuthProvider();
  // Preserve the anonymous UID and its cloud data when the guest upgrades to Google.
  if (auth.currentUser?.isAnonymous) {
    return linkWithPopup(auth.currentUser, provider);
  }
  return signInWithPopup(auth, provider);
}

export async function cloudSave(uid: string, progress: GameProgress) {
  if (!db) throw new Error("Firebase não configurado.");
  await setDoc(doc(db, "users", uid, "game", "progress"), {
    ...progress,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function cloudLoad(uid: string): Promise<GameProgress | null> {
  if (!db) throw new Error("Firebase não configurado.");
  const snap = await getDoc(doc(db, "users", uid, "game", "progress"));
  return snap.exists() ? snap.data() as GameProgress : null;
}
