import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ApiError } from "./validation";

export function firebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey)
    throw new ApiError(
      503,
      "not_configured",
      "Shared workspace is not configured. Ask the administrator to finish Firebase setup.",
    );
  const app =
    getApps().find((app) => app.name === "teamspace-server") ??
    initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      },
      "teamspace-server",
    );
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
  };
}
