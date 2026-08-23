import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotifications } from '../context/NotificationsContext.jsx';

function otherPilot(match, userId) {
  return match.pilotA.id === userId ? match.pilotB : match.pilotA;
}

const INTEREST_STATUS_LABELS = {
  pending_wings: 'Awaiting your wings',
  sent: 'Sent — waiting on them',
  declined_by_wings: 'Wings called this one off',
};

function VouchSummary({ name, vouch }) {
  return (
    <div>
      <strong>{name}'s wings:</strong> {vouch.approveCount} of {vouch.circleSize} vouched
      {vouch.notes.length > 0 && (
        <ul className="list">
          {vouch.notes.map((n, i) => (
            <li key={i}>
              <span className="muted">
                {n.copilotName}: "{n.note}"
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Matches() {
  const { user } = useAuth();
  const { refresh: refreshNotifications } = useNotifications();
  const [matches, setMatches] = useState([]);
  const [interests, setInterests] = useState([]);

  useEffect(() => {
    load();
    api.post('/notifications/mark-matches-seen').then(refreshNotifications);
  }, []);

  async function load() {
    const [matchRes, interestRes] = await Promise.all([api.get('/matches'), api.get('/interests/mine')]);
    setMatches(matchRes.data.matches);
    setInterests(interestRes.data.interests);
  }

  async function unmatch(matchId) {
    if (!window.confirm('Unmatch? This ends the match for both pilots.')) return;
    await api.post(`/matches/${matchId}/unmatch`);
    load();
  }

  const pendingInterests = interests.filter((i) => i.status !== 'sent' || !matches.some((m) => otherPilot(m, user.id).id === i.toUser.id));

  return (
    <div className="page">
      <h1>Matches</h1>
      {matches.length === 0 && <p className="muted">No matches yet — go find your wings' next favorite person in Discover.</p>}
      <ul className="list matches-list">
        {matches.map((m) => {
          const other = otherPilot(m, user.id);
          return (
            <li key={m.id} className="card match-row">
              <div>
                <strong>{other.name}</strong>
                <span className={`badge ${m.status}`}>{m.status === 'matched' ? 'Cleared for takeoff' : 'Landed'}</span>
              </div>
              <div className="match-approvals">
                <VouchSummary name={m.pilotA.name} vouch={m.aVouch} />
                <VouchSummary name={m.pilotB.name} vouch={m.bVouch} />
              </div>
              <div className="match-actions">
                {m.chatUnlocked && (
                  <Link to={`/matches/${m.id}/pilot-chat`}>
                    <button className="primary">Open chat</button>
                  </Link>
                )}
                {m.status === 'unmatched' && <span className="muted">This match has ended.</span>}
                {m.isPilot && m.isActive && (
                  <button className="link-btn" onClick={() => unmatch(m.id)}>
                    Unmatch
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <h2>Your outgoing interests</h2>
      {pendingInterests.length === 0 && <p className="muted">Nothing pending — go browse Discover.</p>}
      <ul className="list matches-list">
        {pendingInterests.map((i) => (
          <li key={i.id} className="card match-row">
            <div>
              <strong>{i.toUser.name}</strong>
              <span className={`badge ${i.status}`}>{INTEREST_STATUS_LABELS[i.status] || i.status}</span>
            </div>
            <p className="muted">
              {i.approveCount} of {i.circleSize} of your wings approved
            </p>
            <div className="match-actions">
              <Link to={`/interests/${i.id}/chat`}>
                <button>View wing chat</button>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
