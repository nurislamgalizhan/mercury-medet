import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Sliding session: the API hands back a refreshed token as we go, so an
    // active user never reaches the expiry.
    const renewed = response.headers?.['x-session-token'];
    if (renewed) {
      try {
        localStorage.setItem('token', renewed);
      } catch {
        /* storage unavailable — the current token still works */
      }
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    if (
      error.response?.status === 428
      && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED'
      && window.location.pathname !== '/change-temporary-password'
    ) {
      window.location.href = '/change-temporary-password';
    }
    return Promise.reject(error);
  }
);

export default api;
