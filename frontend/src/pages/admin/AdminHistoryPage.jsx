import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import Pagination from '../../components/ui/Pagination.jsx';

const ACTION_LABELS = {
  USER_CREATED: 'Создан пользователь',
  VISITS_BALANCE_UPDATED: 'Изменен баланс посещений',
  TARIFF_SOLD: 'Продан абонемент',
  SALE_UPDATED: 'Исправлена продажа',
  SALE_REFUNDED: 'Возврат абонемента',
  USER_DEACTIVATED: 'Пользователь деактивирован',
  ADMIN_VISIT_CHECKIN: 'Ручное списание посещения',
  SUBSCRIPTION_FROZEN: 'Абонемент заморожен',
  SUBSCRIPTION_CANCELLED: 'Абонемент деактивирован',
};

function renderDetails(log) {
  const details = log.details || {};

  if (log.action === 'VISITS_BALANCE_UPDATED') {
    if (details.activatedSubscription) {
      return `Активирован: ${details.sectionName || 'Секция'} · ${details.tariffName || 'Тариф'}, баланс ${details.previousVisitsBalance ?? 0} -> ${details.nextVisitsBalance ?? 0}`;
    }
    return `Баланс: ${details.previousVisitsBalance ?? 0} -> ${details.nextVisitsBalance ?? 0}`;
  }

  if (log.action === 'TARIFF_SOLD') {
    return `${details.sectionName ? `${details.sectionName} · ` : ''}${details.tariffName || 'Тариф'} за ${Number(details.pricePaid || 0).toLocaleString()} тг`;
  }

  if (log.action === 'SALE_UPDATED') {
    return `Продажа #${details.saleId}: ${details.previous?.tariffName || 'тариф'} -> ${details.next?.tariffName || 'тариф'}`;
  }

  if (log.action === 'SALE_REFUNDED') {
    return `${details.sectionName ? `${details.sectionName} · ` : ''}${details.tariffName || 'Тариф'}, возврат ${Number(details.refundAmount || 0).toLocaleString()} тг`;
  }

  if (log.action === 'USER_CREATED') {
    return `${details.firstName || ''} ${details.lastName || ''}`.trim();
  }

  if (log.action === 'USER_DEACTIVATED') {
    return details.fullName || details.phone || 'Пользователь';
  }

  if (log.action === 'ADMIN_VISIT_CHECKIN') {
    return `Списано ${details.visitsDeducted ?? 1} посещ. для ${details.userName || 'клиента'}`;
  }

  if (log.action === 'SUBSCRIPTION_FROZEN') {
    const from = details.freezeFrom ? new Date(details.freezeFrom).toLocaleDateString('ru-RU') : null;
    const until = details.frozenUntil ? new Date(details.frozenUntil).toLocaleDateString('ru-RU') : '';
    return from
      ? `Заморожен на ${details.daysAdded} дн. (${from} — ${until})`
      : `Заморожен на ${details.daysAdded ?? 15} дней${until ? ` (до ${until})` : ''}`;
  }

  if (log.action === 'SUBSCRIPTION_CANCELLED') {
    return `${details.sectionName ? `${details.sectionName} · ` : ''}${details.tariffName || 'Тариф'}; остаток был ${details.previousVisitsBalance ?? 0}`;
  }

  return 'Изменение выполнено';
}

export default function AdminHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/users/admin-history', { params: { page, limit: 20 } });
        setLogs(data.data);
        setMeta(data.meta);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Не удалось загрузить историю изменений');
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [page]);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">История изменений</h1>
        <p className="text-slate-500 text-sm mt-1">Все действия администратора по посещениям, продажам и изменениям клиентов.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {[...Array(8)].map((_, index) => (
              <div key={index} className="p-4 animate-pulse">
                <div className="h-4 bg-slate-100 rounded w-1/2 mb-2" />
                <div className="h-3 bg-slate-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-slate-400">Изменений пока нет</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {logs.map((log) => (
              <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{ACTION_LABELS[log.action] || log.action}</p>
                  <p className="text-sm text-slate-600 mt-1">{renderDetails(log)}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Администратор: {log.admin?.firstName} {log.admin?.lastName}
                    {log.targetUser ? ` • Клиент: ${log.targetUser.firstName} ${log.targetUser.lastName}` : ''}
                  </p>
                </div>
                <div className="text-sm text-slate-500 whitespace-nowrap">
                  {format(new Date(log.createdAt), 'dd.MM.yyyy HH:mm:ss')}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-4 border-t border-slate-100">
          <Pagination page={page} pages={meta.pages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
