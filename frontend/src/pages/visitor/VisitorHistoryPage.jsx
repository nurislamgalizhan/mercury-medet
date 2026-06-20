import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import Pagination from '../../components/ui/Pagination.jsx';

const PAYMENT_LABEL = { CASH: 'Наличные', KASPI: 'Kaspi', HALYK: 'Halyk', MIXED: 'Смешанная' };
const SUBSCRIPTION_STATUS_LABEL = {
  ACTIVE: 'Активен',
  EXPIRED: 'Завершен',
  REFUNDED: 'Возврат',
  CANCELLED: 'Деактивирован',
};

export default function VisitorHistoryPage() {
  const [tab, setTab] = useState('visits');
  const [visitLogs, setVisitLogs] = useState([]);
  const [saleLogs, setSaleLogs] = useState([]);
  const [visitMeta, setVisitMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [saleMeta, setSaleMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [visitPage, setVisitPage] = useState(1);
  const [salePage, setSalePage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVisits = async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/visits/my', { params: { page: visitPage, limit: 15 } });
        setVisitLogs(data.data);
        setVisitMeta(data.meta);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Не удалось загрузить историю посещений');
      } finally {
        setLoading(false);
      }
    };

    if (tab === 'visits') fetchVisits();
  }, [tab, visitPage]);

  useEffect(() => {
    const fetchSales = async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/sales/my', { params: { page: salePage, limit: 15 } });
        setSaleLogs(data.data);
        setSaleMeta(data.meta);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Не удалось загрузить историю покупок');
      } finally {
        setLoading(false);
      }
    };

    if (tab === 'purchases') fetchSales();
  }, [tab, salePage]);

  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    setLoading(true);
  };

  const renderLoading = () => (
    <div className="divide-y divide-slate-50">
      {[...Array(6)].map((_, index) => (
        <div key={index} className="p-4 animate-pulse">
          <div className="h-4 bg-slate-100 rounded w-1/2 mb-2" />
          <div className="h-3 bg-slate-100 rounded w-1/4" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">История</h1>
        <p className="text-sm text-slate-500 mt-1">Ваши посещения и покупки абонементов.</p>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => handleTabChange('visits')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'visits' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
          Посещения
        </button>
        <button onClick={() => handleTabChange('purchases')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'purchases' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
          Покупки
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {tab === 'visits' && (
          <>
            {loading ? renderLoading() : visitLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400">Посещений пока нет</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {visitLogs.map((log) => (
                  <div key={log.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-800">{format(new Date(log.createdAt), 'dd.MM.yyyy HH:mm')}</p>
                      <p className="text-sm text-slate-500">
                        {log.section?.name || 'Секция'} · {log.guestCount > 0 ? `С гостями: ${log.guestCount}` : 'Без гостей'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">-{log.visitsDeducted}</p>
                      <p className="text-xs text-slate-400">посещ.</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 border-t border-slate-100">
              <Pagination page={visitPage} pages={visitMeta.pages} onPageChange={setVisitPage} />
            </div>
          </>
        )}

        {tab === 'purchases' && (
          <>
            {loading ? renderLoading() : saleLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400">Покупок пока нет</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {saleLogs.map((sale) => {
                  const status = sale.status === 'REFUNDED'
                    ? 'Возврат'
                    : SUBSCRIPTION_STATUS_LABEL[sale.subscription?.status] || 'Активная';
                  return (
                    <div key={sale.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{sale.section?.name || 'Секция'}</p>
                          <p className="text-sm text-slate-600 mt-0.5">{sale.tariff?.name || 'Тариф'}</p>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full ${sale.status === 'REFUNDED' || sale.subscription?.status === 'CANCELLED' ? 'bg-red-50 text-red-700' : sale.subscription?.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">Куплен</p>
                          <p className="font-medium text-slate-900 mt-1">{format(new Date(sale.createdAt), 'dd.MM.yyyy')}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">Действует до</p>
                          <p className="font-medium text-slate-900 mt-1">
                            {sale.subscription?.subscriptionEnd ? format(new Date(sale.subscription.subscriptionEnd), 'dd.MM.yyyy') : '—'}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">Остаток</p>
                          <p className="font-medium text-slate-900 mt-1">
                            {sale.tariff?.visitsAmount === null ? '∞' : `${sale.subscription?.visitsBalance ?? 0} посещ.`}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">Оплата</p>
                          <p className="font-medium text-slate-900 mt-1">{PAYMENT_LABEL[sale.paymentMethod] || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Сумма</span>
                        <span className="font-semibold text-slate-900">{Number(sale.pricePaid || 0).toLocaleString()} ₸</span>
                      </div>
                      {sale.refundAmount > 0 && (
                        <div className="flex items-center justify-between text-sm text-red-600">
                          <span>Возврат</span>
                          <span className="font-semibold">-{Number(sale.refundAmount || 0).toLocaleString()} ₸</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="p-4 border-t border-slate-100">
              <Pagination page={salePage} pages={saleMeta.pages} onPageChange={setSalePage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
