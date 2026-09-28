import * as faceapi from '@vladmandic/face-api';

// Only detection + landmarks are needed here — the actual identity match
// against the profile photo happens server-side (this page is just for
// live UX feedback on whether the requested pose is being held).
let modelsLoaded;
function ensureModelsLoaded() {
  if (!modelsLoaded) {
    modelsLoaded = Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('/models'), faceapi.nets.faceLandmark68Net.loadFromUri('/models')]);
  }
  return modelsLoaded;
}

function average(points) {
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function estimateYaw(landmarks) {
  const leftEye = average(landmarks.getLeftEye());
  const rightEye = average(landmarks.getRightEye());
  const nose = average(landmarks.getNose());
  const eyeMidpoint = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeDistance = distance2d(leftEye, rightEye);
  return eyeDistance > 0 ? (nose.x - eyeMidpoint.x) / eyeDistance : 0;
}

// Mirrors server/src/lib/faceVerification.js's poseMatchesPrompt — this
// copy is only used for live client-side feedback (whether to enable the
// capture button); the server independently re-checks the captured frame
// and is the authority on whether verification actually succeeds.
const YAW_THRESHOLD = 0.15;
export function poseMatchesPrompt(yaw, pose) {
  if (pose === 'straight') return Math.abs(yaw) <= YAW_THRESHOLD;
  if (pose === 'left') return yaw <= -YAW_THRESHOLD;
  if (pose === 'right') return yaw >= YAW_THRESHOLD;
  return false;
}

export async function detectLivePose(videoEl) {
  await ensureModelsLoaded();
  const result = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
  if (!result) return { faceCount: 0, yaw: null };
  return { faceCount: 1, yaw: estimateYaw(result.landmarks) };
}
