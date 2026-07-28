import { useEffect, useState } from 'react';
import { api } from '../api';
import { useNotifications } from '../context/NotificationsContext.jsx';

export default function Copilots() {
  const { refresh: refreshNotifications } = useNotifications();
  const [copilots, setCopilots] = useState([]);
  const [pilotingFor, setPilotingFor] = useState([]);
  const [relationshipLabel, setRelationshipLabel] = useState('');
  const [copilotEmail, setCopilotEmail] = useState('');
  const [latestInviteLink, setLatestInviteLink] = useState('');

  useEffect(() => {
    load();
    api.post('/notifications/mark-copilots-seen').then(refreshNotifications);
  }, []);

  async function load() {
    const [mine, piloting] = await Promise.all([api.get('/copilots/mine'), api.get('/copilots/piloting-for')]);
    setCopilots(mine.data.copilots);
    setPilotingFor(piloting.data.pilots);
  }

  async function createInvite(e) {
    e.preventDefault();
    const { data } = await api.post('/copilots/invites', { relationshipLabel, copilotEmail });
    const link = `${window.location.origin}/invite/${data.inviteCode}`;
    setLatestInviteLink(link);
    setRelationshipLabel('');
    setCopilotEmail('');
    load();
  }

  async function removeLink(id) {
    await api.delete(`/copilots/${id}`);
    load();
  }

  return (
    <div className="page">
      <h1>Co-pilots</h1>
      <p className="muted">Co-pilots are the friends who vouch for you and chat with your matches' co-pilots before you dive in.</p>

      <div className="card">
        <h3>Invite a co-pilot</h3>
        <form className="form form-inline" onSubmit={createInvite}>
          <label>
            Their name / relationship
            <input
              value={relationshipLabel}
              onChange={(e) => setRelationshipLabel(e.target.value)}
              placeholder="e.g. Best friend Sam"
            />
          </label>
          <label>
            Their email (optional)
            <input type="email" value={copilotEmail} onChange={(e) => setCopilotEmail(e.target.value)} placeholder="sam@example.com" />
          </label>
          <button type="submit">Generate invite link</button>
        </form>
        {latestInviteLink && (
          <p className="invite-link">
            Share this link: <code>{latestInviteLink}</code>
          </p>
        )}
      </div>

      <div className="card">
        <h3>Your co-pilots</h3>
        {copilots.length === 0 && <p className="muted">No co-pilots yet. Invite a friend above.</p>}
        <ul className="list">
          {copilots.map((c) => (
            <li key={c.id}>
              <span>
                {c.copilotName || c.copilotEmail || 'Pending invite'} {c.relationshipLabel ? `— ${c.relationshipLabel}` : ''}
              </span>
              <span className={`badge ${c.status}`}>{c.status}</span>
              <button className="link-btn" onClick={() => removeLink(c.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Pilots you're co-piloting for</h3>
        {pilotingFor.length === 0 && <p className="muted">You're not vouching for anyone yet.</p>}
        <ul className="list">
          {pilotingFor.map((p) => (
            <li key={p.id}>
              <span>{p.pilotName}</span>
              {p.relationshipLabel && <span className="muted">{p.relationshipLabel}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
