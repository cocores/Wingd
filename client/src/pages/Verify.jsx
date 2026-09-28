import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { detectLivePose, poseMatchesPrompt } from '../lib/faceVerify.js';

const POSE_PROMPTS = {
  straight: 'Look straight at the camera',
  left: 'Turn your head slightly to the left',
  right: 'Turn your head slightly to the right',
};

function randomPose() {
  const keys = Object.keys(POSE_PROMPTS);
  return keys[Math.floor(Math.random() * keys.length)];
}

export default function Verify() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('idle'); // 'idle' | 'capturing'
  const [cameraError, setCameraError] = useState('');
  const [pose, setPose] = useState(randomPose());
  const [poseOk, setPoseOk] = useState(false);
  const [noFace, setNoFace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // null | { ok: true } | { error }
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    api.get('/profiles/me').then(({ data }) => {
      setProfile(data.profile);
      setMode(data.profile && !data.profile.verified ? 'capturing' : 'idle');
      setLoading(false);
    });
  }, []);

  const showCapture = !!profile?.photoUrl && mode === 'capturing';

  // Camera lifecycle: start once when entering capture mode, stop on
  // leaving it or unmounting. Deliberately not re-run on pose changes —
  // switching prompts shouldn't re-trigger a permission/camera renegotiation.
  useEffect(() => {
    if (!showCapture) return undefined;
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (active) setCameraError("Could not access your camera — check your browser's permissions for this site.");
      }
    })();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCapture]);

  // Live pose feedback: cheap to restart on every prompt change since it
  // doesn't touch the camera, just re-reads frames against a new target.
  useEffect(() => {
    if (!showCapture) return undefined;
    const interval = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      const { faceCount, yaw } = await detectLivePose(videoRef.current);
      setNoFace(faceCount === 0);
      setPoseOk(faceCount === 1 && poseMatchesPrompt(yaw, pose));
    }, 300);
    return () => clearInterval(interval);
  }, [showCapture, pose]);

  function retry() {
    setResult(null);
    setPose(randomPose());
  }

  function startVerifying() {
    setResult(null);
    setPose(randomPose());
    setMode('capturing');
  }

  async function capture() {
    setSubmitting(true);
    setResult(null);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));

      const formData = new FormData();
      formData.append('selfie', blob, 'selfie.jpg');
      formData.append('pose', pose);
      await api.post('/profiles/me/verify', formData);

      setResult({ ok: true });
      setMode('idle');
      setProfile((p) => ({ ...p, verified: true }));
    } catch (err) {
      setResult({ error: getErrorMessage(err, 'Could not verify — try again') });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <h1>Get verified</h1>
      <p className="muted">A quick live selfie, checked against your profile photo, to show other pilots and wings you're really you.</p>

      {!profile?.photoUrl && (
        <div className="card">
          <p>Add a profile photo first — verification compares your selfie against it.</p>
          <Link to="/profile">
            <button>Go to Profile</button>
          </Link>
        </div>
      )}

      {profile?.photoUrl && !showCapture && (
        <div className="card">
          {result?.ok || profile.verified ? (
            <>
              <p className="success">✔ You're verified!</p>
              <button className="link-btn" onClick={startVerifying}>
                Verify again
              </button>
            </>
          ) : (
            <button className="primary" onClick={startVerifying}>
              Start verification
            </button>
          )}
        </div>
      )}

      {showCapture && (
        <div className="card verify-card">
          {cameraError && <p className="error">{cameraError}</p>}
          {result?.error && <p className="error">{result.error}</p>}

          <p className="verify-prompt">{POSE_PROMPTS[pose]}</p>
          <div className="verify-video-wrap">
            <video ref={videoRef} muted playsInline className="verify-video" />
            {noFace && <span className="verify-hint">No face detected</span>}
          </div>
          <div className="vouch-bar">
            <button className={poseOk ? 'approve' : ''} onClick={capture} disabled={submitting}>
              {submitting ? 'Checking…' : poseOk ? 'Capture ✔' : 'Capture'}
            </button>
            <button className="link-btn" type="button" onClick={retry}>
              New pose
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
