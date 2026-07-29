import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { formatPhoneDisplay } from '../utils/phone.js';

const PENDING_VERIFICATION_PHONE_KEY = 'pendingVerificationPhone';
const PENDING_VERIFICATION_COOLDOWN_KEY = 'pendingVerificationCooldownUntil';
const PENDING_VERIFICATION_TOKEN_KEY = 'pendingVerificationToken';

function getStoredCooldown() {
  const storedValueRaw = sessionStorage.getItem(PENDING_VERIFICATION_COOLDOWN_KEY);
  if (storedValueRaw === null) return null;

  const storedValue = Number(storedValueRaw);
  if (!storedValue) return 0;
  return Math.max(0, Math.ceil((storedValue - Date.now()) / 1000));
}

function persistVerificationCooldown(seconds) {
  if ((seconds ?? 0) > 0) {
    sessionStorage.setItem(
      PENDING_VERIFICATION_COOLDOWN_KEY,
      String(Date.now() + seconds * 1000)
    );
    return;
  }

  sessionStorage.setItem(PENDING_VERIFICATION_COOLDOWN_KEY, '0');
}

export default function VerifyPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const phone = useMemo(
    () => location.state?.phone || sessionStorage.getItem(PENDING_VERIFICATION_PHONE_KEY) || '',
    [location.state]
  );
  const locationCooldown = location.state?.resendCooldown;
  const requestToken = useMemo(
    () => location.state?.requestToken
      || sessionStorage.getItem(PENDING_VERIFICATION_TOKEN_KEY)
      || '',
    [location.state]
  );

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(() => {
    const storedCooldown = getStoredCooldown();
    if (storedCooldown !== null) return storedCooldown;
    if (typeof locationCooldown === 'number') return locationCooldown;
    return 60;
  });

  useEffect(() => {
    if (!phone && !requestToken) {
      toast.error('Сначала укажите номер телефона');
      navigate('/login', { replace: true });
      return;
    }

    if (phone) sessionStorage.setItem(PENDING_VERIFICATION_PHONE_KEY, phone);
    if (sessionStorage.getItem(PENDING_VERIFICATION_COOLDOWN_KEY) === null) {
      persistVerificationCooldown(typeof locationCooldown === 'number' ? locationCooldown : 60);
    }
  }, [locationCooldown, navigate, phone, requestToken]);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setTimeout(() => setTimer((current) => current - 1), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  const handleVerify = async (event) => {
    event.preventDefault();
    if (code.length !== 6) {
      toast.error('Введите 6-значный код');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify', {
        ...(requestToken ? { requestToken } : { phone }),
        code,
      });
      sessionStorage.removeItem(PENDING_VERIFICATION_PHONE_KEY);
      sessionStorage.removeItem(PENDING_VERIFICATION_COOLDOWN_KEY);
      sessionStorage.removeItem(PENDING_VERIFICATION_TOKEN_KEY);
      login(data.token, data.user);
      toast.success('Аккаунт подтвержден!');
      navigate(data.user.role === 'ADMIN' ? '/admin' : '/visitor');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Неверный код');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.post('/auth/resend-code', requestToken ? { requestToken } : { phone });
      toast.success('Новый код отправлен');
      persistVerificationCooldown(60);
      setTimer(60);
    } catch (err) {
      const responseMessage = err.response?.data?.message || 'Ошибка отправки';
      const secondsFromMessage = Number(responseMessage.match(/(\d+)/)?.[1] || 0);
      if (err.response?.status === 429 && secondsFromMessage > 0) {
        persistVerificationCooldown(secondsFromMessage);
        setTimer(secondsFromMessage);
      }
      toast.error(responseMessage);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Подтверждение</h1>
          <p className="text-slate-500 mt-2">Введите код из WhatsApp</p>
          {phone && <p className="text-brand-600 font-medium mt-1">{formatPhoneDisplay(phone)}</p>}
        </div>

        <form onSubmit={handleVerify} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Код подтверждения</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Подтвердить
          </Button>

          <button
            type="button"
            onClick={handleResend}
            disabled={resending || timer > 0}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          >
            {resending
              ? 'Отправка...'
              : timer > 0
                ? `Отправить код повторно через ${timer} сек.`
                : 'Отправить код повторно'}
          </button>
        </form>
      </div>
    </div>
  );
}
