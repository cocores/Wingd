import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useNotifications } from '../context/NotificationsContext.jsx';

export default function Copilots() {
  const { refresh: refreshNotifications } = useNotifications();
  const [copilots, setCopilots] = useState([]);
  const [pilotingFor, setPilotingFor] = useState([]);
  const [relationshipLabel, setRelationshipLabel] = useState('');
  const [copilotEmail, setCopilotEmail] = useState('');
  const [latestInviteLink, setLatestInviteLink] = useState('');
  const [circle, setCircle] = useState({ maxCircleSize: 5, acceptedCount: 0 });
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    load();
    api.post('/notifications/mark-copilots-seen').then(refreshNotifications);
  }, []);

  async function load() {
    const [mine, piloting] = await Promise.all([api.get('/copilots/mine'), api.get('/copilots/piloting-for')]);
    setCopilots(mine.data.copilots);
    setPilotingFor(piloting.data.pilots);
    setCircle({ maxCircleSize: mine.data.maxCircleSize, acceptedCount: mine.data.acceptedCount });
  }

  async function createInvite(e) {
    e.preventDefault();
    setInviteError('');
    try {
      const { data } = await api.post('/copilots/invites', { relationshipLabel, copilotEmail });
      const link = `${window.location.origin}/invite/${data.inviteCode}`;
      setLatestInviteLink(link);
      setRelationshipLabel('');
      setCopilotEmail('');
      load();
    } catch (err) {
      setInviteError(getErrorMessage(err, 'Could not create invite'));
    }
  }

  const circleFull = circle.acceptedCount >= circle.maxCircleSize;

  async function removeLink(id) {
    await api.delete(`/copilots/${id}`);
    load();
  }

  return (
    <div className="page">
      <h1>Your wing circle</h1>
      <p className="muted">
        Bring 2–5 of your best friends along as your wingmen. They vote on who you're interested in before it's ever sent, and you'll see how many
        vouched (and what they said) once you match. ({circle.acceptedCount} of {circle.maxCircleSize})
      </p>

      <div className="card">
        <h3>Invite a wingman</h3>
        {circleFull ? (
          <p className="muted">Your circle is full — remove someone below to invite a different wingman.</p>
        ) : (
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
        )}
        {inviteError && <p className="error">{inviteError}</p>}
        {latestInviteLink && (
          <p className="invite-link">
            Share this link: <code>{latestInviteLink}</code>
          </p>
        )}
      </div>

      <div className="card">
        <h3>Your wingmen</h3>
        {copilots.length === 0 && <p className="muted">No wingmen yet. Invite a friend above.</p>}
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
        <h3>Pilots whose wing circle you're in</h3>
        {pilotingFor.length === 0 && <p className="muted">You're not a wingman for anyone yet.</p>}
        {pilotingFor.length > 0 && (
          <p className="muted">
            <Link to="/wing-queue">Go to the wing queue</Link> to vote on their pending interests.
          </p>
        )}
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
