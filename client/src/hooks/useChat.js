import { useEffect, useRef, useState } from 'react';
import { api, getErrorMessage } from '../api';
import { getSocket } from '../socket';

// Pilot-to-pilot chat, unlocked once a match exists.
export function usePilotChat(matchId) {
  const [match, setMatch] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    function handleMessage(msg) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      api.post(`/matches/${matchId}/mark-read`).catch(() => {});
    }
    socket.on('pilot-message', handleMessage);

    (async () => {
      try {
        const [matchRes, msgRes] = await Promise.all([api.get(`/matches/${matchId}`), api.get(`/matches/${matchId}/pilot-messages`)]);
        if (!active) return;
        setMatch(matchRes.data.match);
        setMessages(msgRes.data.messages);
      } catch (err) {
        if (active) setError(getErrorMessage(err, 'Could not load this chat'));
        return;
      }

      socket.emit('join-pilot-room', { matchId }, (ack) => {
        if (ack?.error && active) setError(ack.error);
      });
    })();

    return () => {
      active = false;
      socket.off('pilot-message', handleMessage);
    };
  }, [matchId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(body) {
    getSocket().emit('pilot-message', { matchId, body }, (ack) => {
      if (ack?.error) setError(ack.error);
    });
  }

  async function refetchMatch() {
    const { data } = await api.get(`/matches/${matchId}`);
    setMatch(data.match);
  }

  return { match, messages, error, bottomRef, send, refetchMatch };
}

// A pilot's own wing circle discussing one interest, before or after it's decided.
export function useWingChat(interestId) {
  const [interest, setInterest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    function handleMessage(msg) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      api.post(`/interests/${interestId}/mark-read`).catch(() => {});
    }
    socket.on('copilot-message', handleMessage);

    (async () => {
      try {
        const [interestRes, msgRes] = await Promise.all([
          api.get(`/interests/${interestId}`),
          api.get(`/interests/${interestId}/messages`),
        ]);
        if (!active) return;
        setInterest(interestRes.data.interest);
        setMessages(msgRes.data.messages);
      } catch (err) {
        if (active) setError(getErrorMessage(err, 'Could not load this chat'));
        return;
      }

      socket.emit('join-copilot-room', { interestId }, (ack) => {
        if (ack?.error && active) setError(ack.error);
      });
    })();

    return () => {
      active = false;
      socket.off('copilot-message', handleMessage);
    };
  }, [interestId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(body) {
    getSocket().emit('copilot-message', { interestId, body }, (ack) => {
      if (ack?.error) setError(ack.error);
    });
  }

  async function refetchInterest() {
    const { data } = await api.get(`/interests/${interestId}`);
    setInterest(data.interest);
  }

  return { interest, messages, error, bottomRef, send, refetchInterest };
}
