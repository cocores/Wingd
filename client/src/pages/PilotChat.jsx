import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../context/AuthContext.jsx';

export default function PilotChat() {
  const { id } = useParams();
  const { user } = useAuth();
  const [match, setMatch] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let socket;
    (async () => {
      try {
        const [matchRes, msgRes] = await Promise.all([
          api.get(`/matches/${id}`),
          api.get(`/matches/${id}/pilot-messages`),
        ]);
        setMatch(matchRes.data.match);
        setMessages(msgRes.data.messages);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load this chat');
        return;
      }

      socket = getSocket();
      socket.emit('join-pilot-room', { matchId: id }, (ack) => {
        if (ack?.error) setError(ack.error);
      });
      socket.on('pilot-message', (msg) => {
        setMessages((prev) => [...prev, msg]);
      });
    })();

    return () => {
      socket?.off('pilot-message');
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    getSocket().emit('pilot-message', { matchId: id, body }, (ack) => {
      if (ack?.error) setError(ack.error);
    });
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

  return (
    <div className="page chat-page">
      <Link to="/matches">← Back to matches</Link>
      <h1>Chat with {other.name}</h1>
      <p className="muted">Your co-pilots gave this the green light. Take it from here!</p>

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
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${other.name}…`} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
