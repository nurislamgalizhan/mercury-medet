import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import PhoneInput from '../components/ui/PhoneInput.jsx';
import { formatPhoneDisplay, isCompletePhone, toApiPhone } from '../utils/phone.js';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setTimeout(() => setTimer((current) => current - 1), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  const handleSendCode = async (event) => {
    event.preventDefault();
    if (!isCompletePhone(phone)) {
      setPhoneError('Введите номер в формате +7 XXX XXX XX XX');
      return;
    }

    setPhoneError('');
    const apiPhone = toApiPhone(phone);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { phone: apiPhone });
      toast.success('Код отправлен в WhatsApp');
      setStep('reset');
      setPhone(apiPhone);
      setTimer(60);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка отправки');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.post('/auth/forgot-password', { phone: toApiPhone(phone) });
      toast.success('Новый код отправлен');
      setTimer(60);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка отправки');
    } finally {
      setResending(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (code.length !== 6) nextErrors.code = 'Введите 6-значный код';
    if (password.length < 6) nextErrors.password = 'Минимум 6 символов';
    else if (password.length > 200) nextErrors.password = 'Максимум 200 символов';
    if (password !== confirm) nextErrors.confirm = 'Пароли не совпадают';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await api.post('/auth/reset-password', {
        phone: toApiPhone(phone),
        code,
        newPassword: password,
      });
      toast.success('Пароль успешно изменен!');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка смены пароля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Восстановление пароля</h1>
          <p className="text-slate-500 mt-1">Меркурий Медет</p>
        </div>

        {step === 'phone' && (
          <form onSubmit={handleSendCode} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-4">
            <p className="text-sm text-slate-500">Введите номер телефона, привязанный к аккаунту. Мы отправим код в WhatsApp.</p>
            <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} error={phoneError} />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Отправить код
            </Button>
            <p className="text-center text-sm text-slate-500">
              <Link to="/login" className="text-brand-600 hover:underline">Вернуться ко входу</Link>
            </p>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={handleReset} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-4">
            <p className="text-sm text-slate-500">
              Код отправлен на <span className="font-medium text-slate-700">{formatPhoneDisplay(phone)}</span>
            </p>

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
              {errors.code && <p className="text-red-500 text-xs mt-1">{errors.code}</p>}
            </div>

            <Input
              label="Новый пароль"
              type="password"
              placeholder="Минимум 6 символов"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />

            <Input
              label="Подтверждение пароля"
              type="password"
              placeholder="••••••"
              maxLength={200}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={errors.confirm}
            />

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Сохранить пароль
            </Button>

            {timer > 0 ? (
              <p className="text-center text-sm text-slate-400">
                Повторная отправка через <span className="font-semibold text-slate-600">{timer}</span> сек.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="w-full text-sm text-brand-600 hover:underline disabled:opacity-50"
              >
                {resending ? 'Отправка...' : 'Отправить код повторно'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
