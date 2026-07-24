import { useEffect, useRef, useState } from 'react';
import { api, getErrorMessage } from '../api';
import { getSocket } from '../socket';

// Shared data/socket lifecycle for the co-pilot vetting room and the pilot-to-pilot
// chat — both rooms differ only by name, so `room` ('copilot' | 'pilot') selects the
// REST endpoint suffix and socket event names.
export function useMatchChat(matchId, room) {
  const [match, setMatch] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let active = true;
    const socket = getSocket();
    const messageEvent = `${room}-message`;

    function handleMessage(msg) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      api.post(`/matches/${matchId}/mark-read`, { room }).catch(() => {});
    }
    socket.on(messageEvent, handleMessage);

    (async () => {
      try {
        const [matchRes, msgRes] = await Promise.all([
          api.get(`/matches/${matchId}`),
          api.get(`/matches/${matchId}/${room}-messages`),
        ]);
        if (!active) return;
        setMatch(matchRes.data.match);
        setMessages(msgRes.data.messages);
      } catch (err) {
        if (active) setError(getErrorMessage(err, 'Could not load this chat'));
        return;
      }

      socket.emit(`join-${room}-room`, { matchId }, (ack) => {
        if (ack?.error && active) setError(ack.error);
      });
    })();

    return () => {
      active = false;
      socket.off(messageEvent, handleMessage);
    };
  }, [matchId, room]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(body) {
    getSocket().emit(`${room}-message`, { matchId, body }, (ack) => {
      if (ack?.error) setError(ack.error);
    });
  }

  async function refetchMatch() {
    const { data } = await api.get(`/matches/${matchId}`);
    setMatch(data.match);
  }

  return { match, messages, error, bottomRef, send, refetchMatch };
}
