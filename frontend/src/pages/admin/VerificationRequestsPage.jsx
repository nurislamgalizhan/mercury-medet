import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { formatPhoneDisplay } from '../../utils/phone.js';

export default function VerificationRequestsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/verification-requests', {
        params: { page, limit: 20, ...(query && { search: query }) },
      });
      setRequests(data.data);
      setMeta(data.meta);
      window.dispatchEvent(new CustomEvent('verification-count', { detail: data.meta.total }));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const verify = async (request) => {
    if (!window.confirm(`Подтвердить ${request.firstName} ${request.lastName}? Выбранные данные и пароль будут сохранены.`)) return;
    setProcessingId(request.id);
    try {
      await api.post(`/verification-requests/${request.id}/verify`);
      toast.success('Клиент верифицирован');
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось подтвердить заявку');
      await loadRequests();
    } finally {
      setProcessingId(null);
    }
  };

  const remove = async (request) => {
    if (!window.confirm(`Удалить заявку ${request.firstName} ${request.lastName}? Отменить это действие нельзя.`)) return;
    setProcessingId(request.id);
    try {
      await api.delete(`/verification-requests/${request.id}`);
      toast.success('Заявка удалена');
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Не удалось удалить заявку');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Верификация клиентов</h1>
        <p className="text-sm text-slate-500 mt-1">Ожидают подтверждения: {meta.total}</p>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по имени, фамилии или телефону"
          />
        </div>

        {loading ? (
          <p className="p-8 text-center text-slate-400">Загрузка...</p>
        ) : requests.length === 0 ? (
          <p className="p-8 text-center text-slate-400">Ожидающих заявок нет</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((request) => (
              <div key={request.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{request.firstName} {request.lastName}</p>
                  <p className="text-sm text-slate-600">{formatPhoneDisplay(request.phone)}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {format(new Date(request.createdAt), 'dd.MM.yyyy HH:mm')}
                    {request.duplicateCount > 1 && ` · заявок на этот номер: ${request.duplicateCount}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" loading={processingId === request.id} onClick={() => verify(request)}>
                    Верифицировать
                  </Button>
                  <Button size="sm" variant="danger" disabled={processingId === request.id} onClick={() => remove(request)}>
                    Удалить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Pagination page={meta.page} pages={meta.pages} onPageChange={setPage} />
    </div>
  );
}
