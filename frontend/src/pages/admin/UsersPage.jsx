import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useUsers } from '../../hooks/useUsers.js';
import { useSections } from '../../hooks/useSections.js';
import Pagination from '../../components/ui/Pagination.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Input from '../../components/ui/Input.jsx';
import PhoneInput from '../../components/ui/PhoneInput.jsx';
import { isCompletePhone, toApiPhone } from '../../utils/phone.js';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const EMPTY_CLIENT = { firstName: '', lastName: '', phone: '' };

export default function UsersPage() {
  const { users, meta, loading, fetchUsers, createUser } = useUsers();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CLIENT);
  const [creating, setCreating] = useState(false);
  const { sections, fetchSections } = useSections(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sectionId, setSectionId] = useState('all');

  const load = useCallback(() => fetchUsers({ page, search, sectionId: sectionId === 'all' ? undefined : sectionId }), [page, search, sectionId, fetchUsers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchSections(); }, [fetchSections]);

  // Reset to page 1 when search changes
  const handleSearch = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateForm(EMPTY_CLIENT);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!createForm.firstName.trim() || !createForm.lastName.trim()) {
      toast.error('Укажите имя и фамилию');
      return;
    }
    if (!isCompletePhone(createForm.phone)) {
      toast.error('Введите номер в формате +7 XXX XXX XX XX');
      return;
    }
    setCreating(true);
    try {
      const created = await createUser({
        firstName: createForm.firstName.trim(),
        lastName: createForm.lastName.trim(),
        phone: toApiPhone(createForm.phone),
      });
      toast.success(`${created.firstName} ${created.lastName} добавлен`);
      closeCreate();
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось создать клиента');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Клиенты</h1>
          <p className="text-slate-500 text-sm mt-1">Всего: {meta.total}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Добавить клиента</Button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={() => { setSectionId('all'); setPage(1); }} className={`px-3 py-2 rounded-xl border text-sm ${sectionId === 'all' ? 'bg-brand-50 border-brand-500 text-brand-700' : 'border-slate-200 text-slate-600'}`}>Все</button>
            {sections.map((section) => (
              <button key={section.id} onClick={() => { setSectionId(String(section.id)); setPage(1); }} className={`px-3 py-2 rounded-xl border text-sm ${sectionId === String(section.id) ? 'bg-brand-50 border-brand-500 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                {section.name}
              </button>
            ))}
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Поиск по имени, фамилии, телефону..."
              value={search}
              onChange={handleSearch}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-slate-50">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="p-4 animate-pulse flex gap-4">
                <div className="w-10 h-10 bg-slate-100 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-1/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Клиенты не найдены</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {users.map((u) => (
              <Link
                key={u.id}
                to={`/admin/users/${u.id}`}
                className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 font-semibold flex items-center justify-center flex-shrink-0">
                  {u.firstName[0]}{u.lastName[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{u.firstName} {u.lastName}</p>
                  <p className="text-sm text-slate-400">{u.phone}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold text-slate-800">
                    {u.subscriptions?.length
                      ? u.subscriptions.map((s) => `${s.section?.name}: ${s.tariff?.visitsAmount === null ? '∞' : s.visitsBalance}`).join(' · ')
                      : `${u.visitsBalance} посещений`}
                  </p>
                  {u.subscriptions?.[0]?.subscriptionEnd ? (
                    <p className="text-xs text-slate-400">
                      до {format(new Date(u.subscriptions[0].subscriptionEnd), 'dd.MM.yyyy')}
                    </p>
                  ) : u.subscriptionEnd && (
                    <p className="text-xs text-slate-400">
                      до {format(new Date(u.subscriptionEnd), 'dd.MM.yyyy')}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 hidden xs:flex sm:flex">
                  {u.awaitingPassword ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-700">
                      <span className="w-1.5 h-1.5 bg-sky-500 rounded-full" />
                      <span className="hidden sm:inline">Добавленный администратором</span>
                    </span>
                  ) : u.isVerified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      <span className="hidden sm:inline">Верифицирован</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                      <span className="hidden sm:inline">Не верифицирован</span>
                    </span>
                  )}
                </div>
                <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}

        <div className="p-4 border-t border-slate-100">
          <Pagination page={page} pages={meta.pages} onPageChange={setPage} />
        </div>
      </div>

      <Modal isOpen={createOpen} onClose={closeCreate} title="Новый клиент">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Имя"
            value={createForm.firstName}
            onChange={(e) => setCreateForm((current) => ({ ...current, firstName: e.target.value }))}
            maxLength={200}
          />
          <Input
            label="Фамилия"
            value={createForm.lastName}
            onChange={(e) => setCreateForm((current) => ({ ...current, lastName: e.target.value }))}
            maxLength={200}
          />
          <PhoneInput
            label="Номер телефона"
            value={createForm.phone}
            onChange={(phone) => setCreateForm((current) => ({ ...current, phone }))}
          />
          <p className="text-xs text-slate-500">
            Клиент сразу станет полноценным — ему можно продавать абонементы и отмечать посещения.
            Пароль выдавать сейчас не нужно: войти в личный кабинет он сможет после того,
            как вы нажмёте «Выдать пароль» в его карточке.
          </p>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={closeCreate}>Отмена</Button>
            <Button type="submit" className="flex-1" loading={creating}>Создать</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
