import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Discover() {
  const [profiles, setProfiles] = useState([]);
  const [index, setIndex] = useState(0);
  const [matchNotice, setMatchNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/profiles/discover');
    setProfiles(data.profiles);
    setIndex(0);
    setLoading(false);
  }

  async function swipe(direction) {
    const target = profiles[index];
    if (!target) return;
    const { data } = await api.post('/swipes', { targetUserId: target.userId, direction });
    if (data.match) {
      setMatchNotice(data.match);
    }
    setIndex((i) => i + 1);
  }

  if (loading) return <div className="page">Loading pilots…</div>;

  const current = profiles[index];

  return (
    <div className="page">
      <h1>Discover</h1>
      {matchNotice && (
        <div className="match-banner">
          <p>
            🎉 It's a match! You liked each other. Your co-pilots can now vet it in{' '}
            <Link to="/matches">Matches</Link>.
          </p>
          <button onClick={() => setMatchNotice(null)}>Dismiss</button>
        </div>
      )}
      {!current ? (
        <div className="card">
          <p>No more pilots to discover right now. Check back later!</p>
          <button onClick={load}>Refresh</button>
        </div>
      ) : (
        <div className="swipe-card">
          {current.photoUrl && <img src={current.photoUrl} alt={current.name} className="swipe-photo" />}
          <h2>
            {current.name}
            {current.age ? `, ${current.age}` : ''}
          </h2>
          <p className="muted">
            {[current.gender, current.location].filter(Boolean).join(' · ')}
          </p>
          {current.interestedIn && <p className="muted">Interested in: {current.interestedIn}</p>}
          {current.bio && <p className="bio">{current.bio}</p>}
          <div className="swipe-actions">
            <button className="pass" onClick={() => swipe('pass')}>
              ✕ Pass
            </button>
            <button className="like" onClick={() => swipe('like')}>
              ♥ Like
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
