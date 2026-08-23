import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useNotifications } from '../context/NotificationsContext.jsx';
import { resolveAssetUrl } from '../config.js';

export default function WingQueue() {
  const { refresh: refreshNotifications } = useNotifications();
  const [interests, setInterests] = useState([]);
  const [notes, setNotes] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/interests/queue');
    setInterests(data.interests);
    setLoading(false);
  }

  async function vote(interestId, voteValue) {
    setErrors((e) => ({ ...e, [interestId]: '' }));
    try {
      await api.post(`/interests/${interestId}/vote`, { vote: voteValue, note: notes[interestId] || '' });
      await load();
      refreshNotifications();
    } catch (err) {
      setErrors((e) => ({ ...e, [interestId]: getErrorMessage(err, 'Could not record your vote') }));
    }
  }

  return (
    <div className="page">
      <h1>Wing queue</h1>
      <p className="muted">Your friends are counting on you. Weigh in on who they're interested in before it's sent.</p>

      {loading ? (
        <div className="card">Loading…</div>
      ) : interests.length === 0 ? (
        <div className="card">
          <p>Nothing waiting on your vote right now.</p>
        </div>
      ) : (
        <ul className="list">
          {interests.map((interest) => (
            <li key={interest.id} className="card wing-queue-row">
              <div className="wing-queue-target">
                {interest.toUser.photoUrl && (
                  <img src={resolveAssetUrl(interest.toUser.photoUrl)} alt={interest.toUser.name} className="wing-queue-photo" />
                )}
                <div>
                  <strong>
                    {interest.fromUser.name} is interested in {interest.toUser.name}
                    {interest.toUser.age ? `, ${interest.toUser.age}` : ''}
                  </strong>
                  {interest.toUser.bio && <p className="bio">{interest.toUser.bio}</p>}
                </div>
              </div>

              <p className="muted">
                {interest.approveCount} of {interest.circleSize} wings approved so far ({interest.neededForMajority} needed)
              </p>

              {interest.votes.length > 0 && (
                <ul className="list">
                  {interest.votes.map((v) => (
                    <li key={v.copilotUserId}>
                      <span className={v.vote === 'approve' ? 'approved' : 'rejected'}>
                        {v.copilotName}: {v.vote === 'approve' ? 'approved ✔' : 'not a fit ✕'}
                      </span>
                      {v.note && <span className="muted"> — "{v.note}"</span>}
                    </li>
                  ))}
                </ul>
              )}

              {errors[interest.id] && <p className="error">{errors[interest.id]}</p>}

              <label>
                Optional note for the circle
                <textarea
                  value={notes[interest.id] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [interest.id]: e.target.value }))}
                  placeholder="Why do you think this is (or isn't) a fit?"
                />
              </label>
              <div className="vouch-bar">
                <button className="approve" onClick={() => vote(interest.id, 'approve')}>
                  Approve ✔
                </button>
                <button className="reject" onClick={() => vote(interest.id, 'reject')}>
                  Not a fit ✕
                </button>
                <Link to={`/interests/${interest.id}/chat`}>
                  <button className="link-btn" type="button">
                    Discuss with the circle
                  </button>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
