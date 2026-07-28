import { io } from 'socket.io-client';
import { API_BASE_URL } from './config.js';

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = localStorage.getItem('wingd_token');
    socket = io(API_BASE_URL || '/', { auth: { token }, autoConnect: true });
  }
  return socket;
}
