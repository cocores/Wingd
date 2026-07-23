import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext.jsx';

export default function CopilotChat() {
  const { id } = useParams();
  const { user } = useAuth();
  const [match, setMatch] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    function handleMessage(msg) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    }
    socket.on('copilot-message', handleMessage);

    (async () => {
      try {
        const [matchRes, msgRes] = await Promise.all([
          api.get(`/matches/${id}`),
          api.get(`/matches/${id}/copilot-messages`),
        ]);
        if (!active) return;
        setMatch(matchRes.data.match);
        setMessages(msgRes.data.messages);
      } catch (err) {
        if (active) setError(err.response?.data?.error || 'Could not load this chat');
        return;
      }

      socket.emit('join-copilot-room', { matchId: id }, (ack) => {
        if (ack?.error && active) setError(ack.error);
      });
    })();

    return () => {
      active = false;
      socket.off('copilot-message', handleMessage);
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    getSocket().emit('copilot-message', { matchId: id, body }, (ack) => {
      if (ack?.error) setError(ack.error);
    });
    setBody('');
  }

  async function respond(action) {
    await api.post(`/matches/${id}/${action}`);
    const { data } = await api.get(`/matches/${id}`);
    setMatch(data.match);
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

      {(match.status === 'copilot_review' || match.status === 'approved') && !match.myApproved && (
        <div className="vouch-bar">
          <button className="approve" onClick={() => respond('approve')}>
            Vouch for this match ✔
          </button>
          <button className="reject" onClick={() => respond('reject')}>
            Not a fit ✕
          </button>
        </div>
      )}
      {(match.status === 'copilot_review' || match.status === 'approved') && match.myApproved && (
        <div className="vouch-bar">
          <button className="reject" onClick={() => respond('withdraw')}>
            Withdraw vouch
          </button>
        </div>
      )}
      {match.status === 'approved' && <p className="success">Both sides' co-pilots approved — the pilots can now chat directly!</p>}
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
      <form className="chat-input" onSubmit={send}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the other co-pilots…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
