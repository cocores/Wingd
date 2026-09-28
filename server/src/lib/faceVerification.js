import faceapi from '@vladmandic/face-api/dist/face-api.node-wasm.js';
import { Canvas, Image, ImageData, loadImage, createCanvas } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = path.join(__dirname, '..', '..', 'models');

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// face-api.js's own guidance puts "same person" around a Euclidean distance
// of ~0.6, but calibrating against six unrelated stock-photo faces here
// measured genuinely-different people as low as 0.50 — so 0.6 (or even 0.5)
// would false-accept a mismatch. This sits with a safety margin below that
// floor; a false rejection just means "try again," but a false accept
// defeats the entire point of the check, so it's the failure mode to bias
// against. Recalibrate against real usage (false-reject vs false-accept
// rates) once this has live traffic.
const MATCH_THRESHOLD = 0.45;

// Heuristic head-yaw estimate from 2D landmarks (nose position relative to
// the eye midpoint, normalized by eye separation) — not true 3D pose, but
// enough to tell "facing the camera" from "turned to a side" for a liveness
// prompt. One boundary (no dead zone between "straight" and "turned") since
// this can't be precisely calibrated without real test photos; this only
// needs to block the naive "upload any existing photo" attack, not
// withstand a determined one.
const YAW_THRESHOLD = 0.15;

let modelsLoaded;
function ensureModelsLoaded() {
  if (!modelsLoaded) {
    modelsLoaded = (async () => {
      await faceapi.tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
    })();
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

// left/right are from the viewer's perspective (i.e. what shows up mirrored
// on a front-facing camera preview), matching how the prompt reads on screen.
export function poseMatchesPrompt(yaw, pose) {
  if (pose === 'straight') return Math.abs(yaw) <= YAW_THRESHOLD;
  if (pose === 'left') return yaw <= -YAW_THRESHOLD;
  if (pose === 'right') return yaw >= YAW_THRESHOLD;
  return false;
}

// Returns { descriptor, yaw, faceCount }. faceCount lets callers distinguish
// "no face found" from "more than one face" without a second detection pass;
// descriptor/yaw are only present when faceCount === 1.
export async function detectFace(imageBuffer) {
  await ensureModelsLoaded();
  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);

  const detections = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();

  if (detections.length !== 1) return { descriptor: null, yaw: null, faceCount: detections.length };
  return { descriptor: detections[0].descriptor, yaw: estimateYaw(detections[0].landmarks), faceCount: 1 };
}

export function compareDescriptors(a, b) {
  const dist = faceapi.euclideanDistance(a, b);
  return { distance: dist, isMatch: dist < MATCH_THRESHOLD };
}
