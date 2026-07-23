import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProfileSetup() {
  const { setHasProfile } = useAuth();
  const [form, setForm] = useState({
    age: '',
    gender: '',
    interestedIn: '',
    bio: '',
    location: '',
    photoUrl: '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/profiles/me');
      if (data.profile) {
        setForm({
          age: data.profile.age ?? '',
          gender: data.profile.gender ?? '',
          interestedIn: data.profile.interested_in ?? '',
          bio: data.profile.bio ?? '',
          location: data.profile.location ?? '',
          photoUrl: data.profile.photo_url ?? '',
        });
      }
    })();
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
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
      setError(err.response?.data?.error || 'Could not save profile');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Your pilot profile</h1>
      <p className="muted">This is what other pilots (and their co-pilots) will see.</p>
      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Age
          <input type="number" min={18} value={form.age} onChange={(e) => update('age', e.target.value)} />
        </label>
        <label>
          Gender
          <input value={form.gender} onChange={(e) => update('gender', e.target.value)} placeholder="e.g. woman, man, non-binary" />
        </label>
        <label>
          Interested in
          <input
            value={form.interestedIn}
            onChange={(e) => update('interestedIn', e.target.value)}
            placeholder="e.g. men, women, everyone"
          />
        </label>
        <label>
          Location
          <input value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="City" />
        </label>
        <label>
          Photo URL
          <input value={form.photoUrl} onChange={(e) => update('photoUrl', e.target.value)} placeholder="https://…" />
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
    </div>
  );
}
