import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import Avatar from '../components/Avatar.jsx';
import VerifiedBadge from '../components/VerifiedBadge.jsx';

export default function Admirers() {
  const [admirers, setAdmirers] = useState(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [likedBack, setLikedBack] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data } = await api.get('/interests/admirers');
      setAdmirers(data.admirers);
    } catch (err) {
      if (err.response?.status === 402) setLocked(true);
      else setError(getErrorMessage(err, 'Could not load admirers'));
    }
  }

  async function likeBack(userId) {
    await api.post('/swipes', { targetUserId: userId, direction: 'like' });
    setLikedBack((prev) => ({ ...prev, [userId]: true }));
  }

  return (
    <div className="page">
      <h1>Interested in you</h1>

      {locked && (
        <div className="card">
          <p>See who's interested in you before you browse back — a premium feature.</p>
          <Link to="/premium">
            <button className="primary">Upgrade to Premium</button>
          </Link>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {admirers && admirers.length === 0 && <p className="muted">No admirers yet — once someone's wings send an interest your way, they'll show up here.</p>}

      {admirers && admirers.length > 0 && (
        <ul className="list">
          {admirers.map((a) => (
            <li key={a.interestId} className="card match-row">
              <div className="wing-queue-target">
                <Avatar name={a.name} photoUrl={a.photoUrl} className="wing-queue-photo" />
                <div>
                  <strong>
                    {a.name}
                    {a.age ? `, ${a.age}` : ''}
                    <VerifiedBadge verified={a.verified} />
                  </strong>
                  {a.bio && <p className="bio">{a.bio}</p>}
                </div>
              </div>
              <div className="match-actions">
                {likedBack[a.userId] ? (
                  <span className="success">Interest sent!</span>
                ) : (
                  <button className="like" onClick={() => likeBack(a.userId)}>
                    ♥ Like back
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
