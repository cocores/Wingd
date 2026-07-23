import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

function otherName(match, userId) {
  if (match.isPilot) {
    return match.pilotA.id === userId ? match.pilotB.name : match.pilotA.name;
  }
  return `${match.pilotA.name} & ${match.pilotB.name}`;
}

export default function Matches() {
  const { user } = useAuth();
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await api.get('/matches');
    setMatches(data.matches);
  }

  async function respond(matchId, action) {
    await api.post(`/matches/${matchId}/${action}`);
    load();
  }

  return (
    <div className="page">
      <h1>Matches</h1>
      {matches.length === 0 && <p className="muted">No matches yet — go find your co-pilot's next favorite person in Discover.</p>}
      <ul className="list matches-list">
        {matches.map((m) => (
          <li key={m.id} className="card match-row">
            <div>
              <strong>{otherName(m, user.id)}</strong>
              <span className={`badge ${m.status}`}>{m.status.replace('_', ' ')}</span>
            </div>
            <div className="match-approvals">
              <span className={m.aApproved ? 'approved' : m.aRejected ? 'rejected' : ''}>
                {m.pilotA.name}'s co-pilots: {m.aRejected ? 'rejected' : m.aApproved ? 'approved' : 'reviewing'}
              </span>
              <span className={m.bApproved ? 'approved' : m.bRejected ? 'rejected' : ''}>
                {m.pilotB.name}'s co-pilots: {m.bRejected ? 'rejected' : m.bApproved ? 'approved' : 'reviewing'}
              </span>
            </div>
            <div className="match-actions">
              {m.canAccessCopilotRoom && m.status === 'copilot_review' && (
                <>
                  <Link to={`/matches/${m.id}/copilot-chat`}>
                    <button>Co-pilot chat</button>
                  </Link>
                  <button className="approve" onClick={() => respond(m.id, 'approve')}>
                    Vouch ✔
                  </button>
                  <button className="reject" onClick={() => respond(m.id, 'reject')}>
                    Not a fit ✕
                  </button>
                </>
              )}
              {m.canAccessCopilotRoom && m.status !== 'copilot_review' && (
                <Link to={`/matches/${m.id}/copilot-chat`}>
                  <button>Co-pilot chat</button>
                </Link>
              )}
              {m.isPilot && m.status === 'approved' && (
                <Link to={`/matches/${m.id}/pilot-chat`}>
                  <button className="primary">Open chat</button>
                </Link>
              )}
              {m.isPilot && m.status === 'copilot_review' && (
                <span className="muted">Your co-pilots are vetting this match.</span>
              )}
              {m.isPilot && m.status === 'rejected' && <span className="muted">Co-pilots called this one off.</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
