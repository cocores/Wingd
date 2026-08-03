import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useWingChat } from '../hooks/useChat.js';

const STATUS_LABELS = {
  pending_wings: 'Awaiting your wings',
  sent: 'Sent — wings approved',
  declined_by_wings: 'Wings called this one off',
};

export default function WingChat() {
  const { id } = useParams();
  const { user } = useAuth();
  const { interest, messages, error, bottomRef, send, refetchInterest } = useWingChat(id);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [voteError, setVoteError] = useState('');

  function handleSend(e) {
    e.preventDefault();
    if (!body.trim()) return;
    send(body);
    setBody('');
  }

  async function vote(voteValue) {
    setVoteError('');
    try {
      await api.post(`/interests/${id}/vote`, { vote: voteValue, note });
      setNote('');
      await refetchInterest();
    } catch (err) {
      setVoteError(getErrorMessage(err, 'Could not record your vote'));
    }
  }

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/matches">Back to matches</Link>
      </div>
    );
  }

  if (!interest) return <div className="page">Loading…</div>;

  return (
    <div className="page chat-page">
      <Link to="/matches">← Back to matches</Link>
      <h1>
        Wing chat — {interest.isMine ? `your interest in ${interest.toUser.name}` : `${interest.fromUser.name}'s interest in ${interest.toUser.name}`}
      </h1>
      <p className="muted">Only {interest.fromUser.name}'s wing circle can see this room.</p>

      <div className="card vouch-tally">
        <span className={`badge ${interest.status}`}>{STATUS_LABELS[interest.status] || interest.status}</span>
        <span className="muted">
          {interest.approveCount} of {interest.circleSize} wings approved ({interest.neededForMajority} needed for a majority)
        </span>
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
      </div>

      {interest.canVote && (
        <div className="card">
          {voteError && <p className="error">{voteError}</p>}
          <label>
            Optional note for the circle
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why do you think this is (or isn't) a fit?" />
          </label>
          <div className="vouch-bar">
            <button className="approve" onClick={() => vote('approve')}>
              Approve ✔
            </button>
            <button className="reject" onClick={() => vote('reject')}>
              Not a fit ✕
            </button>
          </div>
        </div>
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
      <form className="chat-input" onSubmit={handleSend}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the wing circle…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
