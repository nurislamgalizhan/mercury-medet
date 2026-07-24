import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axios.js';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Modal from './ui/Modal.jsx';

export default function FreezeSubscriptionModal({
  isOpen,
  onClose,
  subscription,
  userId,
  onSuccess,
}) {
  const remainingDays = subscription?.freezeDaysRemaining ?? 15;
  const [mode, setMode] = useState('FIXED');
  const [days, setDays] = useState(Math.min(7, remainingDays));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode('FIXED');
    setDays(Math.min(7, remainingDays));
  }, [isOpen, remainingDays]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post(`/users/${userId}/freeze`, {
        userSubscriptionId: subscription.id,
        mode,
        ...(mode === 'FIXED' && { days: Number(days) }),
      });
      toast.success(data.message);
      await onSuccess?.(data.subscription);
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Ошибка заморозки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !saving && onClose()}
      title={`Заморозить · ${subscription?.section?.name || ''}`}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Доступно</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{remainingDays} из 15 дней</p>
        </div>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Режим заморозки">
          <button
            type="button"
            onClick={() => setMode('FIXED')}
            className={`min-h-11 border px-3 py-2 text-sm font-medium ${
              mode === 'FIXED'
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            На срок
          </button>
          <button
            type="button"
            onClick={() => setMode('UNTIL_MANUAL')}
            className={`min-h-11 border px-3 py-2 text-sm font-medium ${
              mode === 'UNTIL_MANUAL'
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            Пока не разморожу
          </button>
        </div>

        {mode === 'FIXED' ? (
          <Input
            label="Количество дней"
            type="number"
            min="1"
            max={remainingDays}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            required
          />
        ) : (
          <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
            Авторазморозка сработает через {remainingDays} дн., если абонемент не разморозить раньше.
          </div>
        )}

        <Button type="submit" loading={saving} className="w-full" disabled={remainingDays < 1}>
          Заморозить
        </Button>
      </form>
    </Modal>
  );
}
