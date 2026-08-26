import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import PhoneInput from '../components/ui/PhoneInput.jsx';
import { isCompletePhone, toApiPhone } from '../utils/phone.js';

export default function ForgotPasswordPage() {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isCompletePhone(phone)) {
      setPhoneError('Введите номер в формате +7 XXX XXX XX XX');
      return;
    }

    setPhoneError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { phone: toApiPhone(phone) });
      setSubmitted(true);
      toast.success('Заявка отправлена администратору');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось отправить заявку');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-4 shadow-lg text-white text-2xl font-bold">?</div>
          <h1 className="text-2xl font-bold text-slate-900">Восстановление пароля</h1>
          <p className="text-slate-500 mt-1">Меркурий Медет</p>
        </div>

        {submitted ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Заявка отправлена</h2>
            <p className="text-sm text-slate-500 mt-2">
              Администратор создаст временный пароль и передаст его вам. После входа потребуется установить новый пароль.
            </p>
            <Link to="/login" className="inline-block mt-6 text-sm font-medium text-brand-600 hover:underline">Вернуться ко входу</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 space-y-4">
            <p className="text-sm text-slate-500">Введите номер аккаунта. Заявка на сброс пароля появится у администратора.</p>
            <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} error={phoneError} />
            <Button type="submit" loading={loading} className="w-full" size="lg">Отправить заявку</Button>
            <p className="text-center text-sm text-slate-500">
              <Link to="/login" className="text-brand-600 hover:underline">Вернуться ко входу</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
