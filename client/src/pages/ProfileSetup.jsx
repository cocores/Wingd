import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import LocationInput from '../components/LocationInput.jsx';
import { GENDER_OPTIONS, INTERESTED_IN_OPTIONS } from '../constants.js';
import Avatar from '../components/Avatar.jsx';
import { pushConfigured, pushSupported, currentPermission, enablePushNotifications } from '../lib/push.js';

export default function ProfileSetup() {
  const { user, setHasProfile } = useAuth();
  const [form, setForm] = useState({
    age: '',
    gender: '',
    interestedIn: '',
    bio: '',
    location: '',
    photoUrl: '',
  });
  const [verified, setVerified] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);
  const [notifStatus, setNotifStatus] = useState(null);
  const [notifError, setNotifError] = useState('');
  const [enablingNotif, setEnablingNotif] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/profiles/me');
      if (data.profile) {
        setForm({
          age: data.profile.age ?? '',
          gender: data.profile.gender ?? '',
          interestedIn: data.profile.interestedIn ?? '',
          bio: data.profile.bio ?? '',
          location: data.profile.location ?? '',
          photoUrl: data.profile.photoUrl ?? '',
        });
        setVerified(!!data.profile.verified);
      }
    })();
    (async () => {
      if (!pushConfigured()) return;
      setNotifStatus((await pushSupported()) ? currentPermission() : 'unsupported');
    })();
  }, []);

  async function handleEnableNotifications() {
    setNotifError('');
    setEnablingNotif(true);
    try {
      await enablePushNotifications();
      setNotifStatus('granted');
    } catch (err) {
      setNotifError(err.message);
      setNotifStatus(currentPermission());
    } finally {
      setEnablingNotif(false);
    }
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const { data } = await api.post('/profiles/me/photo', formData);
      update('photoUrl', data.photoUrl);
      setVerified(false);
    } catch (err) {
      setPhotoError(getErrorMessage(err, 'Could not upload photo'));
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    setSaved(false);
    try {
      await api.put('/profiles/me', { ...form, age: form.age ? Number(form.age) : null });
      setHasProfile(true);
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save profile'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Your pilot profile</h1>
      <p className="muted">This is what other pilots (and their co-pilots) will see.</p>

      <div className="card">
        <h3>
          Verification {verified && <span className="verify-badge">✓</span>}
        </h3>
        {verified ? (
          <p className="success">You're verified — other pilots and wings can see the checkmark on your profile.</p>
        ) : (
          <>
            <p className="muted">A quick live selfie check shows other pilots and wings you're really you.</p>
            <Link to="/verify">
              <button>Get verified</button>
            </Link>
          </>
        )}
      </div>

      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Photo
          <Avatar name={user?.name} photoUrl={form.photoUrl} className="profile-photo-preview" />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploadingPhoto} />
          {uploadingPhoto && <span className="muted">Uploading…</span>}
          {photoError && <span className="error">{photoError}</span>}
        </label>
        <label>
          Age
          <input type="number" min={18} value={form.age} onChange={(e) => update('age', e.target.value)} />
        </label>
        <label>
          Gender
          <select value={form.gender} onChange={(e) => update('gender', e.target.value)}>
            <option value="">Select…</option>
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {form.gender && !GENDER_OPTIONS.some((o) => o.value === form.gender) && <option value={form.gender}>{form.gender}</option>}
          </select>
        </label>
        <label>
          Interested in
          <select value={form.interestedIn} onChange={(e) => update('interestedIn', e.target.value)}>
            <option value="">Select…</option>
            {INTERESTED_IN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {form.interestedIn && !INTERESTED_IN_OPTIONS.some((o) => o.value === form.interestedIn) && (
              <option value={form.interestedIn}>{form.interestedIn}</option>
            )}
          </select>
        </label>
        <label>
          Location
          <LocationInput value={form.location} onChange={(value) => update('location', value)} />
        </label>
        <label>
          Bio
          <textarea rows={4} value={form.bio} onChange={(e) => update('bio', e.target.value)} placeholder="Tell your future co-pilots about yourself" />
        </label>
        {error && <p className="error">{error}</p>}
        {saved && <p className="success">Saved!</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {notifStatus && (
        <div className="card">
          <h3>Push notifications</h3>
          <p className="muted">Get notified about new matches, wing votes, and messages — even when Wingd isn't open.</p>
          {notifError && <p className="error">{notifError}</p>}
          {notifStatus === 'granted' && <p className="success">Notifications are on.</p>}
          {notifStatus === 'denied' && (
            <p className="muted">Blocked — enable notifications for this site in your browser's settings to turn them back on.</p>
          )}
          {notifStatus === 'unsupported' && <p className="muted">Not supported in this browser.</p>}
          {notifStatus === 'default' && (
            <button onClick={handleEnableNotifications} disabled={enablingNotif}>
              {enablingNotif ? 'Enabling…' : 'Enable notifications'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
