import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import PhoneInput from '../components/ui/PhoneInput.jsx';
import { isCompletePhone, toApiPhone } from '../utils/phone.js';

const NAME_REGEX = /^[a-zA-ZА-ЯЁа-яё][a-zA-ZА-ЯЁа-яё\s-]*$/;
const PENDING_VERIFICATION_PHONE_KEY = 'pendingVerificationPhone';
const PENDING_VERIFICATION_COOLDOWN_KEY = 'pendingVerificationCooldownUntil';
const PENDING_VERIFICATION_TOKEN_KEY = 'pendingVerificationToken';
const PENDING_ADMIN_VERIFICATION_TOKEN_KEY = 'pendingAdminVerificationToken';

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

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    password: '',
    confirm: '',
    verificationMethod: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const nextErrors = {};

    if (!form.firstName.trim()) nextErrors.firstName = 'Введите имя';
    else if (!NAME_REGEX.test(form.firstName)) nextErrors.firstName = 'Только буквы, пробел и дефис';
    else if (form.firstName.length > 200) nextErrors.firstName = 'Максимум 200 символов';

    if (!form.lastName.trim()) nextErrors.lastName = 'Введите фамилию';
    else if (!NAME_REGEX.test(form.lastName)) nextErrors.lastName = 'Только буквы, пробел и дефис';
    else if (form.lastName.length > 200) nextErrors.lastName = 'Максимум 200 символов';

    if (!isCompletePhone(form.phone)) nextErrors.phone = 'Введите номер в формате +7 XXX XXX XX XX';
    if (form.password.length < 6) nextErrors.password = 'Минимум 6 символов';
    else if (form.password.length > 200) nextErrors.password = 'Максимум 200 символов';
    if (form.password !== form.confirm) nextErrors.confirm = 'Пароли не совпадают';
    if (!form.verificationMethod) nextErrors.verificationMethod = 'Выберите способ подтверждения';

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleNameInput = (field) => (event) => {
    const value = event.target.value;
    if (value && !/^[a-zA-ZА-ЯЁа-яё\s-]*$/.test(value)) return;
    if (value.length > 200) return;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: toApiPhone(form.phone),
      password: form.password,
      verificationMethod: form.verificationMethod,
    };

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', payload);
      if (data.status === 'PENDING_ADMIN') {
        sessionStorage.setItem(PENDING_ADMIN_VERIFICATION_TOKEN_KEY, data.requestToken);
        toast.success('Заявка отправлена администратору');
        navigate('/verification-pending');
        return;
      }

      const resendCooldown = data.resendCooldown ?? 60;
      sessionStorage.setItem(PENDING_VERIFICATION_PHONE_KEY, payload.phone);
      sessionStorage.setItem(PENDING_VERIFICATION_TOKEN_KEY, data.requestToken);
      persistVerificationCooldown(resendCooldown);
      toast.success('Код подтверждения отправлен в WhatsApp');
      navigate('/verify', { state: { phone: payload.phone, resendCooldown } });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка регистрации');
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Регистрация</h1>
          <p className="text-slate-500 mt-1">Меркурий Медет</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Имя"
              placeholder="Айдос"
              value={form.firstName}
              onChange={handleNameInput('firstName')}
              error={errors.firstName}
            />
            <Input
              label="Фамилия"
              placeholder="Сейткали"
              value={form.lastName}
              onChange={handleNameInput('lastName')}
              error={errors.lastName}
            />
          </div>

          <PhoneInput
            label="Телефон"
            value={form.phone}
            onChange={(phone) => setForm((current) => ({ ...current, phone }))}
            error={errors.phone}
          />

          <Input
            label="Пароль"
            type="password"
            placeholder="Минимум 6 символов"
            maxLength={200}
            value={form.password}
            onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
            error={errors.password}
          />

          <Input
            label="Подтверждение пароля"
            type="password"
            placeholder="••••••"
            maxLength={200}
            value={form.confirm}
            onChange={(e) => setForm((current) => ({ ...current, confirm: e.target.value }))}
            error={errors.confirm}
          />

          <fieldset>
            <legend className="block text-sm font-medium text-slate-700 mb-2">
              Способ подтверждения
            </legend>
            <div className="grid grid-cols-2 rounded-lg border border-slate-200 p-1 gap-1">
              {[
                ['WHATSAPP', 'WhatsApp'],
                ['ADMIN', 'Через администратора'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setForm((current) => ({ ...current, verificationMethod: value }));
                    setErrors((current) => ({ ...current, verificationMethod: undefined }));
                  }}
                  className={`min-h-11 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    form.verificationMethod === value
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {errors.verificationMethod && (
              <p className="mt-1.5 text-sm text-red-600">{errors.verificationMethod}</p>
            )}
          </fieldset>

          <Button
            type="submit"
            loading={loading}
            disabled={!form.verificationMethod}
            className="w-full"
            size="lg"
          >
            Зарегистрироваться
          </Button>

          <p className="text-center text-sm text-slate-500">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:underline">
              Войти
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
