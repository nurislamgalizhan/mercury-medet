import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios.js';

const TOKEN_KEY = 'pendingAdminVerificationToken';

export default function VerificationPendingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('PENDING');
  const requestToken = sessionStorage.getItem(TOKEN_KEY);

  useEffect(() => {
    if (!requestToken) {
      setStatus('NOT_FOUND');
      return undefined;
    }

    let active = true;
    let timer;
    const checkStatus = async () => {
      try {
        const { data } = await api.post('/auth/registration-status', { requestToken });
        if (!active) return;
        setStatus(data.status);
        if (data.status === 'VERIFIED') {
          sessionStorage.removeItem(TOKEN_KEY);
          timer = setTimeout(() => navigate('/login', { replace: true }), 1200);
          return;
        }
        if (data.status === 'PENDING') {
          timer = setTimeout(checkStatus, 10_000);
        }
      } catch {
        if (active) timer = setTimeout(checkStatus, 10_000);
      }
    };

    checkStatus();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [navigate, requestToken]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-5 shadow-lg">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm">
          {status === 'VERIFIED' ? (
            <>
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mb-4">✓</div>
              <h1 className="text-xl font-bold text-slate-900">Номер подтвержден</h1>
              <p className="text-sm text-slate-500 mt-2">Переходим на страницу входа...</p>
            </>
          ) : status === 'NOT_FOUND' ? (
            <>
              <h1 className="text-xl font-bold text-slate-900">Заявка не найдена</h1>
              <p className="text-sm text-slate-500 mt-2">Она могла быть удалена или просрочена.</p>
              <Link to="/register" className="inline-block mt-5 text-sm font-medium text-brand-600 hover:underline">
                Создать новую заявку
              </Link>
            </>
          ) : (
            <>
              <div className="w-10 h-10 mx-auto border-4 border-brand-600 border-t-transparent rounded-full animate-spin mb-5" />
              <h1 className="text-xl font-bold text-slate-900">Ожидаем администратора</h1>
              <p className="text-sm text-slate-500 mt-2">
                Сообщите администратору, что заявка отправлена. Страница обновится автоматически.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
