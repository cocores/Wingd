import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, GrpcStatus, Filter } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-wingd';

if (!getApps().length) {
  // Against the Firestore emulator (FIRESTORE_EMULATOR_HOST set), no real
  // credentials are needed or resolvable. In production, a service account
  // is expected via GOOGLE_APPLICATION_CREDENTIALS.
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() });
}

export const db = getFirestore();
export { FieldValue, GrpcStatus, Filter };
export default db;
