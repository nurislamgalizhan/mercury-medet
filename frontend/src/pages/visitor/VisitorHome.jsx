import { useMemo, useState } from 'react';
import { differenceInDays, format, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function VisitorHome() {
  const { user, refreshUser } = useAuth();
  const activeSubscriptions = user?.activeSubscriptions || [];
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState('');
  const [guestCount, setGuestCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState('');

  const selectedSubscription = useMemo(() => {
    if (activeSubscriptions.length === 1) return activeSubscriptions[0];
    return activeSubscriptions.find((s) => s.id === Number(selectedSubscriptionId)) || activeSubscriptions[0] || null;
  }, [activeSubscriptions, selectedSubscriptionId]);

  const selectedTariff = selectedSubscription?.tariff || null;
  const subscriptionActive = Boolean(selectedSubscription && !isPast(new Date(selectedSubscription.subscriptionEnd)));
  const isUnlimited = selectedTariff?.visitsAmount === null;
  const isFrozen = Boolean(selectedSubscription?.frozenUntil && !isPast(new Date(selectedSubscription.frozenUntil)));
  const daysLeft = selectedSubscription?.subscriptionEnd
    ? Math.max(0, differenceInDays(new Date(selectedSubscription.subscriptionEnd), new Date()))
    : 0;
  const totalVisitsToDeduct = useMemo(() => 1 + guestCount, [guestCount]);
  const maxGuests = Math.max(0, (selectedSubscription?.visitsBalance ?? 1) - 1);
  const canCheckIn = !isFrozen && (isUnlimited ? subscriptionActive : Boolean(selectedSubscription?.visitsBalance > 0 && subscriptionActive));

  const resetVisitFlow = () => {
    setConfirmOpen(false);
    setDuplicateWarning('');
    setGuestCount(0);
  };

  const handleSelectSubscription = (subscriptionId) => {
    setSelectedSubscriptionId(String(subscriptionId));
    setGuestCount(0);
    setDuplicateWarning('');
  };

  const submitCheckIn = async (confirmDuplicate = false) => {
    if (!selectedSubscription) {
      toast.error('Нет активного абонемента');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/visits/checkin', {
        sectionId: selectedSubscription.sectionId,
        visitsDeducted: isUnlimited ? 1 : totalVisitsToDeduct,
        guestCount: isUnlimited ? 0 : guestCount,
        confirmDuplicate,
      });
      toast.success(data.message);
      await refreshUser();
      resetVisitFlow();
    } catch (err) {
      if (err.response?.data?.code === 'DUPLICATE_CHECKIN_CONFIRMATION_REQUIRED') {
        setDuplicateWarning(err.response.data.message);
        setConfirmOpen(true);
        return;
      }
      toast.error(err.response?.data?.message || 'Ошибка списания');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {activeSubscriptions.length > 1 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-medium text-slate-700 mb-3">Выберите секцию</p>
          <div className="flex flex-wrap gap-2">
            {activeSubscriptions.map((subscription) => (
              <button
                key={subscription.id}
                type="button"
                onClick={() => handleSelectSubscription(subscription.id)}
                className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                  selectedSubscription?.id === subscription.id
                    ? 'bg-brand-50 border-brand-500 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {subscription.section?.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-brand-600 to-brand-800 rounded-3xl p-8 text-white text-center shadow-lg">
        <p className="text-brand-200 text-sm font-medium mb-2">Ваш баланс</p>
        {selectedSubscription ? (
          isUnlimited ? (
            <p className="text-6xl font-black">∞</p>
          ) : (
            <p className="text-6xl font-black">{selectedSubscription.visitsBalance ?? 0}</p>
          )
        ) : (
          <p className="text-6xl font-black">0</p>
        )}
        <p className="text-brand-200 mt-2 text-sm">
          {isUnlimited ? 'Безлимитный абонемент' : 'посещений'}
        </p>

        {selectedSubscription?.subscriptionEnd && (
          <div className="mt-5 pt-5 border-t border-brand-500">
            {isFrozen ? (
              <>
                <p className="text-blue-200 text-xs font-medium">Абонемент заморожен</p>
                <p className="text-white font-semibold mt-0.5">
                  до {format(new Date(selectedSubscription.frozenUntil), 'd MMMM yyyy', { locale: ru })}
                </p>
                <p className="text-brand-300 text-xs mt-0.5">
                  Действует до {format(new Date(selectedSubscription.subscriptionEnd), 'd MMMM yyyy', { locale: ru })}
                </p>
              </>
            ) : subscriptionActive ? (
              <>
                <p className="text-brand-200 text-xs">Действует до</p>
                <p className="text-white font-semibold mt-0.5">
                  {format(new Date(selectedSubscription.subscriptionEnd), 'd MMMM yyyy', { locale: ru })}
                </p>
                <p className="text-brand-300 text-xs mt-0.5">Осталось {daysLeft} дн.</p>
              </>
            ) : (
              <p className="text-red-300 text-sm font-medium">Абонемент истек</p>
            )}
          </div>
        )}

        {!selectedSubscription && (
          <p className="text-brand-300 text-sm mt-4">Нет активного абонемента</p>
        )}
      </div>

      {canCheckIn && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-slate-800 mb-1">Отметить посещение</h2>
            <p className="text-sm text-slate-500">
              {isUnlimited
                ? 'Для безлимитного тарифа можно отметить только собственное посещение.'
                : 'Вы можете отметить себя и при необходимости добавить гостей.'}
            </p>
          </div>

          {!isUnlimited && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800">Гости</p>
                  <p className="text-sm text-slate-500">С каждого гостя спишется отдельное посещение.</p>
                </div>
                <Button
                  variant={guestCount > 0 ? 'secondary' : 'success'}
                  size="sm"
                  onClick={() => setGuestCount((count) => (count > 0 ? 0 : Math.min(1, maxGuests)))}
                >
                  {guestCount > 0 ? 'Убрать гостей' : 'Добавить гостя'}
                </Button>
              </div>

              {guestCount > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Количество гостей</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setGuestCount((count) => Math.max(0, count - 1))}
                      className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-white transition-colors font-medium"
                    >
                      −
                    </button>
                    <span className="text-xl font-bold text-slate-900 w-8 text-center">{guestCount}</span>
                    <button
                      type="button"
                      onClick={() => setGuestCount((count) => Math.min(maxGuests, count + 1))}
                      className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-white transition-colors font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Всего спишется</span>
                <span className="font-semibold text-slate-800">{totalVisitsToDeduct}</span>
              </div>
            </div>
          )}

          <Button className="w-full" size="lg" onClick={() => setConfirmOpen(true)}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Отметиться
          </Button>
        </div>
      )}

      {selectedSubscription && selectedTariff && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-900">{selectedTariff.name}</h2>
              <p className="text-sm text-slate-500 mt-1">Ваш текущий тариф</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              {selectedTariff.visitsAmount === null ? 'Безлимит' : `${selectedTariff.visitsAmount} посещ.`}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Секция</p>
              <p className="font-medium text-slate-900 mt-1">{selectedSubscription.section?.name}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Окно посещения</p>
              <p className="font-medium text-slate-900 mt-1">{selectedTariff.accessLabel || 'Любое время'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Срок действия</p>
              <p className="font-medium text-slate-900 mt-1">{selectedTariff.durationDays} дн.</p>
            </div>
          </div>
        </div>
      )}

      {isFrozen && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 text-center">
          <p className="text-blue-800 font-medium">Абонемент заморожен</p>
          <p className="text-blue-600 text-sm mt-1">
            Заморозка действует до {format(new Date(selectedSubscription.frozenUntil), 'd MMMM yyyy', { locale: ru })}
          </p>
        </div>
      )}

      {!canCheckIn && !isFrozen && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 text-center">
          <p className="text-amber-800 font-medium">
            {selectedSubscription ? 'Нет доступных посещений' : 'Нет активного абонемента'}
          </p>
          <p className="text-amber-600 text-sm mt-1">Приобретите абонемент в разделе «Тарифы»</p>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => !loading && resetVisitFlow()}
        title={duplicateWarning ? 'Повторное списание' : 'Подтверждение'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-slate-600 text-center">
            {duplicateWarning
              ? duplicateWarning
              : isUnlimited
                ? (
                    <>
                      Подтвердите посещение<br />
                      <span className="text-sm text-slate-500">{selectedSubscription?.section?.name}</span>
                    </>
                  )
                : (
                    <>
                      Подтвердите списание{' '}
                      <span className="font-bold text-slate-900 text-lg">{totalVisitsToDeduct}</span>{' '}
                      посещ.<br />
                      <span className="text-sm text-slate-500">{selectedSubscription?.section?.name}</span>
                    </>
                  )}
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={resetVisitFlow} disabled={loading}>
              Нет
            </Button>
            <Button className="flex-1" loading={loading} onClick={() => submitCheckIn(Boolean(duplicateWarning))}>
              Да, списать
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
