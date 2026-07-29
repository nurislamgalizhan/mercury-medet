import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

export default function TemporaryPasswordPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.password.length < 6) return toast.error('Пароль должен содержать минимум 6 символов');
    if (form.password !== form.confirm) return toast.error('Пароли не совпадают');

    setLoading(true);
    try {
      const { data } = await api.post('/auth/complete-temporary-password', {
        newPassword: form.password,
      });
      login(data.token, data.user);
      toast.success('Новый пароль сохранен');
      navigate(data.user.role === 'ADMIN' ? '/admin' : '/visitor', { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось сохранить пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Создайте новый пароль</h1>
          <p className="text-sm text-slate-500 mt-2">Временный пароль больше не понадобится.</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border border-slate-100 rounded-2xl p-8 space-y-4 shadow-sm">
          <Input label="Новый пароль" type="password" minLength={6} maxLength={200} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
          <Input label="Повторите пароль" type="password" minLength={6} maxLength={200} value={form.confirm} onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))} required />
          <Button type="submit" loading={loading} className="w-full" size="lg">Сохранить пароль</Button>
        </form>
      </div>
    </div>
  );
}
