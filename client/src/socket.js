import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = localStorage.getItem('wingd_token');
    socket = io('/', { auth: { token }, autoConnect: true });
  }
  return socket;
}
