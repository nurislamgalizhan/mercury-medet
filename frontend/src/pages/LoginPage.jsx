import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import PhoneInput from '../components/ui/PhoneInput.jsx';
import { isCompletePhone, toApiPhone } from '../utils/phone.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const attemptsRef = useRef(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [lockTimer, setLockTimer] = useState(0);
  const lockIntervalRef = useRef(null);

  const startLockCountdown = (seconds) => {
    setLockTimer(seconds);
    clearInterval(lockIntervalRef.current);
    lockIntervalRef.current = setInterval(() => {
      setLockTimer((timer) => {
        if (timer <= 1) {
          clearInterval(lockIntervalRef.current);
          setLockedUntil(null);
          return 0;
        }
        return timer - 1;
      });
    }, 1000);
  };

  const validate = () => {
    const nextErrors = {};
    if (!isCompletePhone(form.phone)) nextErrors.phone = 'Введите номер в формате +7 XXX XXX XX XX';
    if (!form.password) nextErrors.password = 'Введите пароль';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    if (lockedUntil && Date.now() < lockedUntil) {
      toast.error(`Слишком много попыток. Подождите ${lockTimer} сек.`);
      return;
    }

    const payload = {
      phone: toApiPhone(form.phone),
      password: form.password,
    };

    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', payload);
      attemptsRef.current = 0;

      login(data.token, data.user);
      toast.success(`Добро пожаловать, ${data.user.firstName}!`);
      navigate(
        data.user.mustChangePassword
          ? '/change-temporary-password'
          : data.user.role === 'ADMIN' ? '/admin' : '/visitor'
      );
    } catch (err) {
      attemptsRef.current += 1;
      toast.error(err.response?.data?.message || 'Неверный номер телефона или пароль');

      if (attemptsRef.current % 10 === 0) {
        const lockMinutes = attemptsRef.current / 10;
        const lockMs = lockMinutes * 60 * 1000;
        const until = Date.now() + lockMs;
        setLockedUntil(until);
        startLockCountdown(lockMinutes * 60);
        toast.error(`Форма временно заблокирована на ${lockMinutes} мин.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockedUntil && Date.now() < lockedUntil;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Меркурий Медет</h1>
          <p className="text-slate-500 mt-1">Войдите в свой аккаунт</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-4">
          {isLocked && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center text-sm text-red-700 font-medium">
              Слишком много попыток. Подождите {lockTimer} сек.
            </div>
          )}

          <PhoneInput
            label="Номер телефона"
            value={form.phone}
            onChange={(phone) => setForm((current) => ({ ...current, phone }))}
            error={errors.phone}
          />

          <Input
            label="Пароль"
            type="password"
            placeholder="Пароль"
            maxLength={200}
            value={form.password}
            onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
            error={errors.password}
          />

          <Button type="submit" loading={loading} disabled={!!isLocked} className="w-full" size="lg">
            Войти
          </Button>

          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-brand-600 hover:underline">
              Забыли пароль?
            </Link>
            <Link to="/register" className="text-brand-600 font-medium hover:underline">
              Зарегистрироваться
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
