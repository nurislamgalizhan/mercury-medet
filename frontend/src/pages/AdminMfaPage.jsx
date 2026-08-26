import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { formatPhoneDisplay } from '../utils/phone.js';

export default function AdminMfaPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const phone = location.state?.phone || '';
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(location.state?.resendCooldown ?? 60);

  useEffect(() => {
    if (!phone) navigate('/login', { replace: true });
  }, [phone, navigate]);

  useEffect(() => {
    if (timer <= 0) return undefined;
    const timeout = setTimeout(() => setTimer((value) => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [timer]);

  const handleVerify = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error('Введите 6-значный код');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/admin-mfa/verify', { phone, code });
      login(data.token, data.user);
      navigate(data.user.mustChangePassword ? '/change-temporary-password' : '/admin', { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Неверный код подтверждения');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const { data } = await api.post('/auth/admin-mfa/resend', { phone });
      setTimer(data.resendCooldown ?? 60);
      toast.success('Новый код отправлен в WhatsApp');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось отправить код');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <form onSubmit={handleVerify} className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Вход администратора</h1>
          <p className="text-sm text-slate-500 mt-2">Код отправлен в WhatsApp</p>
          <p className="text-sm font-medium text-brand-600 mt-1">{formatPhoneDisplay(phone)}</p>
        </div>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          autoFocus
          className="w-full px-4 py-3 text-center text-2xl font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <Button type="submit" loading={loading} className="w-full" size="lg">Подтвердить</Button>
        <button type="button" onClick={handleResend} disabled={resending || timer > 0} className="w-full text-sm text-brand-600 disabled:text-slate-400">
          {resending ? 'Отправка...' : timer > 0 ? `Повторная отправка через ${timer} сек.` : 'Отправить код повторно'}
        </button>
        <button type="button" onClick={() => navigate('/login')} className="w-full text-sm text-slate-400 hover:text-slate-600">Вернуться ко входу</button>
      </form>
    </div>
  );
}
