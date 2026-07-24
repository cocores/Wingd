import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useMatchChat } from '../hooks/useMatchChat.js';

export default function CopilotChat() {
  const { id } = useParams();
  const { user } = useAuth();
  const { match, messages, error, bottomRef, send, refetchMatch } = useMatchChat(id, 'copilot');
  const [body, setBody] = useState('');

  function handleSend(e) {
    e.preventDefault();
    if (!body.trim()) return;
    send(body);
    setBody('');
  }

  async function respond(action) {
    await api.post(`/matches/${id}/${action}`);
    await refetchMatch();
  }

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/matches">Back to matches</Link>
      </div>
    );
  }

  if (!match) return <div className="page">Loading…</div>;

  return (
    <div className="page chat-page">
      <Link to="/matches">← Back to matches</Link>
      <h1>
        Co-pilot vetting room — {match.pilotA.name} & {match.pilotB.name}
      </h1>
      <p className="muted">
        This room is only visible to co-pilots. Chat here to figure out if {match.pilotA.name} and {match.pilotB.name} are a good fit before they
        start talking.
      </p>

      {match.canVouch && (
        <div className="vouch-bar">
          <button className="approve" onClick={() => respond('approve')}>
            Vouch for this match ✔
          </button>
          <button className="reject" onClick={() => respond('reject')}>
            Not a fit ✕
          </button>
        </div>
      )}
      {match.canWithdraw && (
        <div className="vouch-bar">
          <button className="reject" onClick={() => respond('withdraw')}>
            Withdraw vouch
          </button>
        </div>
      )}
      {match.chatUnlocked && <p className="success">Both sides' co-pilots approved — the pilots can now chat directly!</p>}
      {match.status === 'rejected' && <p className="error">This match was called off by a co-pilot.</p>}
      {match.status === 'unmatched' && <p className="error">One of the pilots unmatched. This chat is now read-only.</p>}

      <div className="chat-window">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.senderUserId === user.id ? 'mine' : ''}`}>
            <span className="chat-sender">{m.senderName}</span>
            <p>{m.body}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={handleSend}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the other co-pilots…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
