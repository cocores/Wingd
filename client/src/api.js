import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export function getErrorMessage(err, fallback) {
  return err.response?.data?.error || fallback;
}

const savedToken = localStorage.getItem('wingd_token');
if (savedToken) setAuthToken(savedToken);
