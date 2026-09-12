import { useCallback, useEffect, useState } from 'react';
import { endOfDay, format, startOfDay } from 'date-fns';
import DateRangePicker from '../../components/ui/DateRangePicker.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { useVisitLogs } from '../../hooks/useLogs.js';
import { useSections } from '../../hooks/useSections.js';
import { useAdminSocket } from '../../hooks/useSocket.js';

const OWN_SITE = 'MERCURY';

const SOURCE_LABELS = {
  MERCURY: 'Этот сайт · mmedet.kz',
  BVA: 'Из BVA, Коперника 130 · qr.bva.kz',
};

export default function VisitsAdminPage() {
  const [dateRange, setDateRange] = useState({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const [page, setPage] = useState(1);
  const [sectionId, setSectionId] = useState('all');
  const [search, setSearch] = useState('');
  const { logs, meta, loading, fetchLogs, prependLog } = useVisitLogs();
  const { sections, fetchSections } = useSections(true);

  const sectionParam = sectionId === 'all' ? undefined : sectionId;
  const loadVisits = useCallback(() => {
    fetchLogs({ page, from: dateRange.from, to: dateRange.to, sectionId: sectionParam, search });
  }, [page, dateRange, sectionParam, search, fetchLogs]);

  useEffect(() => { fetchSections(); }, [fetchSections]);
  useEffect(() => { loadVisits(); }, [loadVisits]);

  useAdminSocket((visitLog) => {
    const createdAt = new Date(visitLog.createdAt);
    const matchesSection = sectionId === 'all' || visitLog.sectionId === Number(sectionId);
    const matchesDate = (!dateRange.from || createdAt >= dateRange.from) && (!dateRange.to || createdAt <= dateRange.to);
    // While a search is active, only let through check-ins that match it.
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [visitLog.user?.firstName, visitLog.user?.lastName, visitLog.user?.phone]
      .some((value) => value?.toLowerCase().includes(query));
    if (page === 1 && matchesSection && matchesDate && matchesSearch) {
      prependLog(visitLog);
    }
  });

  const handleDateChange = (range) => {
    setDateRange(range);
    setPage(1);
  };

  const handleSectionChange = (nextSectionId) => {
    setSectionId(nextSectionId);
    setPage(1);
  };

  const handleSearch = (event) => {
    setSearch(event.target.value);
    setPage(1);
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Посещения</h1>
          <p className="text-slate-500 text-sm mt-1">Отметки клиентов по секциям.</p>
        </div>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => handleSectionChange('all')} className={`px-3 py-2 rounded-xl border text-sm ${sectionId === 'all' ? 'bg-brand-50 border-brand-500 text-brand-700' : 'border-slate-200 text-slate-600'}`}>Все</button>
        {sections.map((section) => (
          <button key={section.id} onClick={() => handleSectionChange(String(section.id))} className={`px-3 py-2 rounded-xl border text-sm ${sectionId === String(section.id) ? 'bg-brand-50 border-brand-500 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
            {section.name}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 space-y-4">
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
          <p className="text-sm text-slate-500">Всего: <span className="font-semibold text-slate-800">{meta.total}</span></p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Дата</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Клиент</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Секция</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Источник</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">Гости</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">Списано</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Нет данных</td></tr>
              ) : logs.map((visit) => (
                <tr key={`${visit.id}-${visit._flashId || ''}`} className={visit._isNew ? 'animate-flash-green' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3 whitespace-nowrap">{format(new Date(visit.createdAt), 'dd.MM.yyyy HH:mm')}</td>
                  <td className="px-4 py-3 font-medium">
                    {visit.user?.firstName} {visit.user?.lastName}
                    <p className="text-xs text-slate-400">{visit.user?.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{visit.section?.name}</td>
                  <td className="px-4 py-3">
                    {visit.sourceSite && visit.sourceSite !== OWN_SITE ? (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {SOURCE_LABELS[visit.sourceSite]}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {SOURCE_LABELS[visit.sourceSite] || 'Локально'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{visit.guestCount ?? 0}</td>
                  <td className="px-4 py-3 text-right font-semibold">-{visit.visitsDeducted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-100">
          <Pagination page={page} pages={meta.pages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
