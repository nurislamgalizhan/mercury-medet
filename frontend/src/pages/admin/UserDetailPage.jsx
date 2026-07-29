import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import SellTariffModal from '../../components/admin/SellTariffModal.jsx';
import FreezeSubscriptionModal from '../../components/FreezeSubscriptionModal.jsx';
import { useTariffs } from '../../hooks/useTariffs.js';

const PAYMENT_LABEL = { CASH: 'Наличные', KASPI: 'Kaspi', HALYK: 'Halyk', MIXED: 'Смешанная' };
const SUBSCRIPTION_STATUS_LABEL = {
  ACTIVE: 'Активен',
  EXPIRED: 'Завершен',
  REFUNDED: 'Возврат',
  CANCELLED: 'Деактивирован',
};

export default function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tariffs, fetchTariffs } = useTariffs(true);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sellOpen, setSellOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ visitsBalance: '' });
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinVisits, setCheckinVisits] = useState(1);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refundSale, setRefundSale] = useState(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [editSale, setEditSale] = useState(null);
  const [editForm, setEditForm] = useState({ tariffId: '', pricePaid: '', paymentMethod: 'CASH', cashAmount: '', cardAmount: '', cardProvider: 'KASPI' });
  const [subscriptionToCancel, setSubscriptionToCancel] = useState(null);
  const [subscriptionToActivate, setSubscriptionToActivate] = useState(null);
  const [activateForm, setActivateForm] = useState({ visitsBalance: '' });
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  const fetchUser = async () => {
    try {
      const { data } = await api.get(`/users/${id}`);
      setUser(data);
    } catch {
      toast.error('Пользователь не найден');
      navigate('/admin/users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUser(); }, [id]);
  useEffect(() => { fetchTariffs(); }, [fetchTariffs]);

  const handleResetPassword = async () => {
    setResetPasswordLoading(true);
    try {
      const { data } = await api.post(`/users/${id}/reset-password`);
      setTemporaryPassword(data.temporaryPassword);
      toast.success('Временный пароль создан');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось сбросить пароль');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const closeResetPassword = () => {
    setResetPasswordOpen(false);
    setTemporaryPassword('');
  };

  const subscriptions = user?.subscriptions || [];
  const activeSubscriptions = subscriptions.filter((s) => s.status === 'ACTIVE');
  const tariffOptions = useMemo(() => tariffs.map((t) => ({ ...t, label: `${t.section?.name || 'Секция'} · ${t.name}` })), [tariffs]);

  const openAdjust = (subscription) => {
    setSelectedSubscription(subscription);
    setAdjustForm({ visitsBalance: subscription.visitsBalance });
    setAdjustOpen(true);
  };

  const openCheckin = (subscription) => {
    setSelectedSubscription(subscription);
    setCheckinVisits(1);
    setCheckinOpen(true);
  };

  const openFreeze = (subscription) => {
    setSelectedSubscription(subscription);
    setFreezeOpen(true);
  };

  const handleAdjust = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/users/${id}/adjust`, {
        userSubscriptionId: selectedSubscription.id,
        visitsBalance: parseInt(adjustForm.visitsBalance, 10),
      });
      toast.success('Баланс обновлен');
      setAdjustOpen(false);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка обновления');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminCheckin = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/visits/admin-checkin', {
        userId: parseInt(id, 10),
        sectionId: selectedSubscription.sectionId,
        visitsDeducted: checkinVisits,
      });
      toast.success(`Списано ${checkinVisits} посещ.`);
      setCheckinOpen(false);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка списания');
    } finally {
      setSaving(false);
    }
  };

  const handleUnfreeze = async (subscription) => {
    if (!confirm(`Разморозить абонемент в секции «${subscription.section?.name}»?`)) return;
    try {
      await api.post(`/users/${id}/unfreeze`, { userSubscriptionId: subscription.id });
      toast.success('Абонемент разморожен');
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка разморозки');
    }
  };

  const openEditSale = (sale) => {
    setEditSale(sale);
    setEditForm({
      tariffId: sale.tariffId || sale.tariff?.id || '',
      pricePaid: sale.pricePaid,
      paymentMethod: sale.paymentMethod,
      cashAmount: sale.cashAmount || '',
      cardAmount: sale.cardAmount || '',
      cardProvider: sale.cardProvider || 'KASPI',
    });
  };

  const handleEditSale = async (e) => {
    e.preventDefault();
    setSaving(true);
    const pricePaid = parseInt(editForm.pricePaid, 10) || 0;
    const cashAmount = editForm.paymentMethod === 'CASH' ? pricePaid : editForm.paymentMethod === 'MIXED' ? parseInt(editForm.cashAmount, 10) || 0 : 0;
    const cardAmount = ['KASPI', 'HALYK'].includes(editForm.paymentMethod) ? pricePaid : editForm.paymentMethod === 'MIXED' ? parseInt(editForm.cardAmount, 10) || 0 : 0;
    try {
      await api.patch(`/sales/${editSale.id}`, {
        tariffId: parseInt(editForm.tariffId, 10),
        pricePaid,
        paymentMethod: editForm.paymentMethod,
        cashAmount,
        cardAmount,
        cardProvider:
          editForm.paymentMethod === 'KASPI' ? 'KASPI'
          : editForm.paymentMethod === 'HALYK' ? 'HALYK'
          : editForm.paymentMethod === 'MIXED' ? editForm.cardProvider
          : null,
      });
      toast.success('Продажа обновлена');
      setEditSale(null);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка редактирования');
    } finally {
      setSaving(false);
    }
  };

  const handleRefund = async (e) => {
    e.preventDefault();
    if (!confirm('Операция возврата необратима. Продолжить?')) return;
    setSaving(true);
    try {
      await api.post(`/sales/${refundSale.id}/refund`, { refundAmount: parseInt(refundAmount, 10) || 0 });
      toast.success('Возврат оформлен');
      setRefundSale(null);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка возврата');
    } finally {
      setSaving(false);
    }
  };

  const openCancelSubscription = (subscription) => {
    const ok = confirm(
      `Внимание: абонемент в секции «${subscription.section?.name}» будет деактивирован, остаток посещений станет 0. Продолжить?`
    );
    if (!ok) return;
    setSubscriptionToCancel(subscription);
  };

  const openActivateSubscription = (subscription) => {
    const isUnlimited = subscription.tariff?.visitsAmount === null;
    const initialBalance = isUnlimited ? '' : String(Math.min(
      subscription.tariff?.visitsAmount || 1,
      Math.max(1, subscription.visitsBalance || 1)
    ));
    setSubscriptionToActivate(subscription);
    setActivateForm({ visitsBalance: initialBalance });
  };

  const handleCancelSubscription = async () => {
    if (!subscriptionToCancel) return;
    setSaving(true);
    try {
      await api.post(`/users/${id}/subscriptions/${subscriptionToCancel.id}/cancel`, { confirmDeactivation: true });
      toast.success('Абонемент деактивирован');
      setSubscriptionToCancel(null);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка деактивации');
    } finally {
      setSaving(false);
    }
  };

  const handleActivateSubscription = async (e) => {
    e.preventDefault();
    if (!subscriptionToActivate) return;
    setSaving(true);
    try {
      const isUnlimited = subscriptionToActivate.tariff?.visitsAmount === null;
      await api.post(`/users/${id}/subscriptions/${subscriptionToActivate.id}/activate`, {
        ...(!isUnlimited && { visitsBalance: parseInt(activateForm.visitsBalance, 10) || 1 }),
      });
      toast.success('Абонемент активирован');
      setSubscriptionToActivate(null);
      fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка активации');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-400">Загрузка...</div>;
  if (!user) return null;

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <button onClick={() => navigate('/admin/users')} className="text-sm text-slate-500 hover:text-slate-800 mb-6">← Назад к списку</button>

      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{user.firstName} {user.lastName}</h1>
          <p className="text-slate-500">{user.phone}</p>
          <p className="text-xs text-slate-400 mt-1">Активных абонементов: {activeSubscriptions.length}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setResetPasswordOpen(true)}>Сбросить пароль</Button>
          <Button onClick={() => setSellOpen(true)}>Продать абонемент</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {subscriptions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center text-slate-400 md:col-span-2">Абонементов нет</div>
        ) : subscriptions.map((subscription) => {
          const isActive = subscription.status === 'ACTIVE';
          const isUnlimited = subscription.tariff?.visitsAmount === null;
          const isFrozen = subscription.frozenUntil && new Date(subscription.frozenUntil) > new Date();
          const canActivate = !isActive && subscription.status !== 'REFUNDED' && new Date(subscription.subscriptionEnd) > new Date();
          return (
            <div key={subscription.id} className={`rounded-2xl border p-5 bg-white ${isActive ? 'border-slate-100' : 'border-slate-100 opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-400">Секция</p>
                  <h2 className="font-semibold text-slate-900">{subscription.section?.name}</h2>
                  <p className="text-sm text-slate-500 mt-1">{subscription.tariff?.name}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {SUBSCRIPTION_STATUS_LABEL[subscription.status] || subscription.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">Остаток</p>
                  <p className="font-bold text-slate-900 text-xl">{isUnlimited ? '∞' : subscription.visitsBalance}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">До</p>
                  <p className="font-medium text-slate-900">{format(new Date(subscription.subscriptionEnd), 'dd.MM.yyyy')}</p>
                </div>
              </div>
              {isActive && subscription.tariff?.visitsAmount !== 1 && (
                <p className="mt-3 text-xs text-slate-500">
                  Заморозка: доступно {subscription.freezeDaysRemaining ?? 15} из 15 дней
                </p>
              )}
              {isFrozen && <p className="mt-3 text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2">Заморожен до {format(new Date(subscription.frozenUntil), 'dd.MM.yyyy')}</p>}
              {isActive && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button size="sm" variant="secondary" onClick={() => openCheckin(subscription)}>Списать</Button>
                  {!isUnlimited && <Button size="sm" variant="secondary" onClick={() => openAdjust(subscription)}>Корректировка</Button>}
                  {!isFrozen && subscription.tariff?.visitsAmount !== 1 && (subscription.freezeDaysRemaining ?? 15) > 0 && <Button size="sm" variant="secondary" onClick={() => openFreeze(subscription)}>Заморозить</Button>}
                  {isFrozen && <Button size="sm" variant="secondary" onClick={() => handleUnfreeze(subscription)}>Разморозить</Button>}
                  <Button size="sm" variant="danger" onClick={() => openCancelSubscription(subscription)}>Деактивировать</Button>
                </div>
              )}
              {!isActive && canActivate && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button size="sm" variant="success" onClick={() => openActivateSubscription(subscription)}>Активировать</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-6">
        <div className="p-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800">Последние посещения</h2></div>
        {(user.visitLogs || []).length === 0 ? <p className="p-6 text-center text-slate-400 text-sm">Нет записей</p> : (
          <div className="divide-y divide-slate-50">
            {user.visitLogs.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-slate-600">{format(new Date(v.createdAt), 'dd.MM.yyyy HH:mm')}</p>
                  <p className="text-xs text-slate-400">{v.section?.name}</p>
                </div>
                <span className="text-sm font-medium text-slate-800">−{v.visitsDeducted} посещений</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800">История покупок</h2></div>
        {(user.saleLogs || []).length === 0 ? <p className="p-6 text-center text-slate-400 text-sm">Нет записей</p> : (
          <div className="divide-y divide-slate-50">
            {user.saleLogs.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{s.section?.name} · {s.tariff?.name}</p>
                  <p className="text-xs text-slate-400">{format(new Date(s.createdAt), 'dd.MM.yyyy HH:mm')} · {PAYMENT_LABEL[s.paymentMethod]} · {s.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-600">{s.pricePaid.toLocaleString()} ₸</span>
                  {s.status !== 'REFUNDED' && <button onClick={() => openEditSale(s)} className="text-xs text-brand-600">Изменить</button>}
                  {s.status !== 'REFUNDED' && <button onClick={() => { setRefundSale(s); setRefundAmount(String(s.pricePaid)); }} className="text-xs text-red-600 font-medium">Возврат</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SellTariffModal isOpen={sellOpen} onClose={() => setSellOpen(false)} user={user} onSuccess={fetchUser} />

      <Modal isOpen={resetPasswordOpen} onClose={closeResetPassword} title="Сбросить пароль">
        {temporaryPassword ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Передайте пароль клиенту сейчас. После закрытия он больше не будет показан.
            </p>
            <div className="rounded-xl bg-slate-900 text-white px-4 py-4 text-center text-xl font-mono tracking-wider select-all">
              {temporaryPassword}
            </div>
            <Button
              className="w-full"
              onClick={async () => {
                await navigator.clipboard.writeText(temporaryPassword);
                toast.success('Пароль скопирован');
              }}
            >
              Копировать
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Все текущие сессии клиента завершатся. При следующем входе он будет обязан создать новый пароль.
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={closeResetPassword}>Отмена</Button>
              <Button className="flex-1" loading={resetPasswordLoading} onClick={handleResetPassword}>Сбросить</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={checkinOpen} onClose={() => setCheckinOpen(false)} title={`Списать посещение · ${selectedSubscription?.section?.name || ''}`}>
        <form onSubmit={handleAdminCheckin} className="space-y-4">
          <Input label="Количество посещений" type="number" min="1" max={selectedSubscription?.tariff?.visitsAmount === null ? undefined : selectedSubscription?.visitsBalance} value={checkinVisits} onChange={(e) => setCheckinVisits(parseInt(e.target.value, 10) || 1)} />
          <Button type="submit" loading={saving} className="w-full">Списать</Button>
        </form>
      </Modal>

      <Modal isOpen={adjustOpen} onClose={() => setAdjustOpen(false)} title={`Корректировка · ${selectedSubscription?.section?.name || ''}`}>
        <form onSubmit={handleAdjust} className="space-y-4">
          <Input label="Баланс посещений" type="number" min="0" max={selectedSubscription?.tariff?.visitsAmount ?? undefined} value={adjustForm.visitsBalance} onChange={(e) => setAdjustForm({ visitsBalance: e.target.value })} />
          <Button type="submit" loading={saving} className="w-full">Сохранить</Button>
        </form>
      </Modal>

      <FreezeSubscriptionModal
        isOpen={freezeOpen}
        onClose={() => setFreezeOpen(false)}
        subscription={selectedSubscription}
        userId={id}
        onSuccess={fetchUser}
      />

      <Modal isOpen={Boolean(refundSale)} onClose={() => setRefundSale(null)} title="Возврат абонемента">
        <form onSubmit={handleRefund} className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-medium">Операция необратима. Возврат возможен только если по абонементу не было посещений.</div>
          <Input label="Сумма возврата" type="number" min="0" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} required />
          <Button type="submit" variant="danger" loading={saving} className="w-full">Оформить возврат</Button>
        </form>
      </Modal>

      <Modal isOpen={Boolean(subscriptionToCancel)} onClose={() => setSubscriptionToCancel(null)} title="Деактивация абонемента">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-medium">
            Второе предупреждение: операция необратима. Абонемент будет деактивирован, остаток посещений станет 0, клиент больше не сможет отмечаться по этой секции.
          </div>
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">{subscriptionToCancel?.section?.name} · {subscriptionToCancel?.tariff?.name}</p>
            <p className="mt-1">Остаток: {subscriptionToCancel?.tariff?.visitsAmount === null ? '∞' : subscriptionToCancel?.visitsBalance} посещ.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={() => setSubscriptionToCancel(null)} className="flex-1">Отмена</Button>
            <Button variant="danger" type="button" loading={saving} onClick={handleCancelSubscription} className="flex-1">Деактивировать</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(subscriptionToActivate)} onClose={() => setSubscriptionToActivate(null)} title="Активировать абонемент">
        <form onSubmit={handleActivateSubscription} className="space-y-4">
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-800">
            <p className="font-medium">{subscriptionToActivate?.section?.name} · {subscriptionToActivate?.tariff?.name}</p>
            <p className="mt-1">Можно активировать только пока срок действия не истек.</p>
          </div>
          {subscriptionToActivate?.tariff?.visitsAmount !== null && (
            <Input
              label="Баланс посещений после активации"
              type="number"
              min="1"
              max={subscriptionToActivate?.tariff?.visitsAmount ?? undefined}
              value={activateForm.visitsBalance}
              onChange={(e) => setActivateForm({ visitsBalance: e.target.value })}
              required
            />
          )}
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={() => setSubscriptionToActivate(null)} className="flex-1">Отмена</Button>
            <Button variant="success" type="submit" loading={saving} className="flex-1">Активировать</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(editSale)} onClose={() => setEditSale(null)} title="Редактировать продажу">
        <form onSubmit={handleEditSale} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Тариф</label>
            <select className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm" value={editForm.tariffId} onChange={(e) => setEditForm({ ...editForm, tariffId: e.target.value })} required>
              {tariffOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <Input label="Сумма" type="number" min="0" value={editForm.pricePaid} onChange={(e) => setEditForm({ ...editForm, pricePaid: e.target.value })} required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Оплата</label>
            <select className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm" value={editForm.paymentMethod} onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}>
              <option value="CASH">Наличные</option>
              <option value="KASPI">Kaspi</option>
              <option value="HALYK">Halyk</option>
              <option value="MIXED">Смешанная</option>
            </select>
          </div>
          {editForm.paymentMethod === 'MIXED' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Наличными" type="number" min="0" value={editForm.cashAmount} onChange={(e) => setEditForm({ ...editForm, cashAmount: e.target.value })} />
              <Input label="Картой" type="number" min="0" value={editForm.cardAmount} onChange={(e) => setEditForm({ ...editForm, cardAmount: e.target.value })} />
            </div>
          )}
          {editForm.paymentMethod === 'MIXED' && (
            <select className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm" value={editForm.cardProvider} onChange={(e) => setEditForm({ ...editForm, cardProvider: e.target.value })}>
              <option value="KASPI">Kaspi</option>
              <option value="HALYK">Halyk</option>
            </select>
          )}
          <Button type="submit" loading={saving} className="w-full">Сохранить</Button>
        </form>
      </Modal>
    </div>
  );
}
