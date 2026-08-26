import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import { useSections } from '../../hooks/useSections.js';
import { useTariffs } from '../../hooks/useTariffs.js';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';

const TIME_TYPE_LABEL = { ANY: 'Любое время', MORNING: 'День', EVENING: 'Вечер' };
const PAYMENT_OPTIONS = [
  { value: 'KASPI', label: 'Kaspi', icon: '/icons/kaspi.svg', accent: 'border-red-300 bg-red-50 text-red-700', selected: 'ring-red-500 border-red-500' },
  { value: 'HALYK', label: 'Halyk', icon: '/icons/halyk.svg', accent: 'border-emerald-300 bg-emerald-50 text-emerald-700', selected: 'ring-emerald-500 border-emerald-500' },
  { value: 'CASH', label: 'Наличными', icon: null, accent: 'border-slate-300 bg-slate-50 text-slate-700', selected: 'ring-slate-500 border-slate-500' },
  { value: 'MIXED', label: 'Смешанная', icon: null, accent: 'border-amber-300 bg-amber-50 text-amber-700', selected: 'ring-amber-500 border-amber-500' },
];

export default function SellTariffModal({ isOpen, onClose, user, onSuccess }) {
  const { sections, loading: sectionsLoading, fetchSections } = useSections(true);
  const { tariffs, loading: tariffsLoading, fetchTariffs } = useTariffs(true);
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedTariff, setSelectedTariff] = useState(null);
  const [pricePaid, setPricePaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cardProvider, setCardProvider] = useState('KASPI');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSections();
      setSelectedSectionId('');
      setSelectedTariff(null);
      setPricePaid('');
      setPaymentMethod('CASH');
      setCashAmount('');
      setCardAmount('');
      setCardProvider('KASPI');
    }
  }, [isOpen, fetchSections]);

  useEffect(() => {
    if (isOpen && selectedSectionId) {
      fetchTariffs({ sectionId: selectedSectionId });
    }
  }, [isOpen, selectedSectionId, fetchTariffs]);

  const activeSectionIds = useMemo(
    () => new Set((user?.activeSubscriptions || user?.subscriptions || []).filter((s) => s.status === 'ACTIVE').map((s) => s.sectionId)),
    [user]
  );

  const selectedSection = sections.find((s) => s.id === Number(selectedSectionId));
  const sectionBlocked = selectedSectionId && activeSectionIds.has(Number(selectedSectionId));
  const blockReason = !user?.isVerified
    ? 'Клиент не прошел верификацию'
    : sectionBlocked
      ? `У клиента уже есть активный абонемент в секции «${selectedSection?.name || 'секция'}»`
      : null;

  const totalPrice = parseInt(pricePaid, 10) || 0;
  const cashNum = parseInt(cashAmount, 10) || 0;
  const cardNum = parseInt(cardAmount, 10) || 0;
  const mixedSumValid = paymentMethod !== 'MIXED' || (cashNum > 0 && cardNum > 0 && cashNum + cardNum === totalPrice);
  const canConfirm = selectedTariff && totalPrice > 0 && mixedSumValid && !blockReason;

  const handleSelectSection = (sectionId) => {
    setSelectedSectionId(String(sectionId));
    setSelectedTariff(null);
    setPricePaid('');
  };

  const handleSelectTariff = (tariff) => {
    setSelectedTariff(tariff);
    setPricePaid(String(tariff.price));
  };

  const handleCashChange = (value) => {
    setCashAmount(value);
    if (paymentMethod === 'MIXED' && value !== '' && totalPrice > 0) {
      setCardAmount(String(Math.max(0, totalPrice - (parseInt(value, 10) || 0))));
    }
  };

  const handleCardChange = (value) => {
    setCardAmount(value);
    if (paymentMethod === 'MIXED' && value !== '' && totalPrice > 0) {
      setCashAmount(String(Math.max(0, totalPrice - (parseInt(value, 10) || 0))));
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setLoading(true);
    try {
      await api.post('/sales', {
        userId: user.id,
        tariffId: selectedTariff.id,
        pricePaid: totalPrice,
        paymentMethod,
        cashAmount: paymentMethod === 'CASH' ? totalPrice : paymentMethod === 'MIXED' ? cashNum : 0,
        cardAmount: paymentMethod === 'KASPI' || paymentMethod === 'HALYK' ? totalPrice : paymentMethod === 'MIXED' ? cardNum : 0,
        cardProvider:
          paymentMethod === 'KASPI' ? 'KASPI'
          : paymentMethod === 'HALYK' ? 'HALYK'
          : paymentMethod === 'MIXED' ? cardProvider
          : null,
      });
      toast.success('Абонемент продан успешно!');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка продажи');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Продать абонемент" size="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          Клиент: <span className="font-medium text-slate-800">{user?.firstName} {user?.lastName}</span>
        </p>

        {blockReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-medium">
            {blockReason}. Продажа невозможна.
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Секция</p>
          {sectionsLoading ? (
            <div className="h-11 bg-slate-100 rounded-xl animate-pulse" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => {
                const blocked = activeSectionIds.has(section.id);
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => handleSelectSection(section.id)}
                    className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      Number(selectedSectionId) === section.id
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : blocked
                          ? 'border-slate-200 bg-slate-50 text-slate-400'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {section.name}{blocked ? ' · активен' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedSectionId && !sectionBlocked && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Тариф</p>
            {tariffsLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {tariffs.map((tariff) => (
                  <button
                    key={tariff.id}
                    type="button"
                    onClick={() => handleSelectTariff(tariff)}
                    className={`w-full text-left p-4 border rounded-xl transition-all ${
                      selectedTariff?.id === tariff.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-800">{tariff.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {TIME_TYPE_LABEL[tariff.timeType]}
                          {tariff.timeStart && ` · ${tariff.timeStart}-${tariff.timeEnd}`}
                          {' · '}{tariff.durationDays} дней
                          {' · '}{tariff.visitsAmount ? `${tariff.visitsAmount} посещений` : 'Безлимит'}
                        </p>
                      </div>
                      <p className="text-lg font-bold text-brand-600 whitespace-nowrap">{tariff.price.toLocaleString()} тг</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedTariff && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Фактически оплачено (тг)</label>
              <input
                type="number"
                min="0"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={pricePaid}
                onChange={(e) => {
                  setPricePaid(e.target.value);
                  if (paymentMethod === 'MIXED') {
                    setCashAmount('');
                    setCardAmount('');
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Способ оплаты</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_OPTIONS.map((opt) => {
                  const isSelected = paymentMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(opt.value);
                        if (opt.value !== 'MIXED') {
                          setCashAmount('');
                          setCardAmount('');
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm font-medium transition-all ${opt.accent} ${isSelected ? `ring-2 ${opt.selected}` : 'opacity-70 hover:opacity-100'}`}
                    >
                      {opt.icon && <img src={opt.icon} alt={opt.label} className="w-6 h-6" />}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {paymentMethod === 'MIXED' && (
              <div className="space-y-3 p-4 bg-amber-50/40 border border-amber-200 rounded-xl">
                <input type="number" min="0" placeholder="Наличными" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={cashAmount} onChange={(e) => handleCashChange(e.target.value)} />
                <div className="flex gap-2">
                  {['KASPI', 'HALYK'].map((p) => (
                    <button key={p} type="button" onClick={() => setCardProvider(p)} className={`px-3 py-1.5 border rounded-lg text-sm ${cardProvider === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                      {p === 'KASPI' ? 'Kaspi' : 'Halyk'}
                    </button>
                  ))}
                </div>
                <input type="number" min="0" placeholder="Картой" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={cardAmount} onChange={(e) => handleCardChange(e.target.value)} />
                <p className={`text-xs ${cashNum + cardNum === totalPrice ? 'text-emerald-600' : 'text-red-600'}`}>
                  Итого: {(cashNum + cardNum).toLocaleString()} тг {cashNum + cardNum === totalPrice ? '✓' : `(должно быть ${totalPrice.toLocaleString()})`}
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
          <Button variant="success" loading={loading} disabled={!canConfirm} onClick={handleConfirm} className="flex-1">Подтвердить продажу</Button>
        </div>
      </div>
    </Modal>
  );
}
