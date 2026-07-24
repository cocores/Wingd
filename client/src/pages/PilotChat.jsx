import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useMatchChat } from '../hooks/useMatchChat.js';

export default function PilotChat() {
  const { id } = useParams();
  const { user } = useAuth();
  const { match, messages, error, bottomRef, send, refetchMatch } = useMatchChat(id, 'pilot');
  const [body, setBody] = useState('');

  function handleSend(e) {
    e.preventDefault();
    if (!body.trim()) return;
    send(body);
    setBody('');
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

  const other = match.pilotA.id === user.id ? match.pilotB : match.pilotA;

  async function unmatch() {
    if (!window.confirm(`Unmatch with ${other.name}? This ends the match.`)) return;
    await api.post(`/matches/${id}/unmatch`);
    await refetchMatch();
  }

  return (
    <div className="page chat-page">
      <Link to="/matches">← Back to matches</Link>
      <div className="chat-header">
        <h1>Chat with {other.name}</h1>
        {match.chatUnlocked && (
          <button className="link-btn" onClick={unmatch}>
            Unmatch
          </button>
        )}
      </div>
      {match.chatUnlocked ? (
        <p className="muted">Your co-pilots gave this the green light. Take it from here!</p>
      ) : (
        <p className="error">This match has ended. This chat is now read-only.</p>
      )}

      <div className="chat-window">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.senderUserId === user.id ? 'mine' : ''}`}>
            <span className="chat-sender">{m.senderName}</span>
            <p>{m.body}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {match.chatUnlocked && (
        <form className="chat-input" onSubmit={handleSend}>
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${other.name}…`} />
          <button type="submit">Send</button>
        </form>
      )}
    </div>
  );
}
