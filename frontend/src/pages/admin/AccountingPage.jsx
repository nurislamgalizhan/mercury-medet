import { useCallback, useEffect, useState } from 'react';
import { endOfDay, format, startOfDay } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/axios.js';
import DateRangePicker from '../../components/ui/DateRangePicker.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { useSaleLogs } from '../../hooks/useLogs.js';
import { useSections } from '../../hooks/useSections.js';

const PAYMENT_LABEL = { CASH: 'Наличные', KASPI: 'Kaspi', HALYK: 'Halyk', MIXED: 'Смешанная' };
const EXPORT_PAGE_SIZE = 100;

function downloadWorkbook(XLSX, workbook, fileName) {
  const lib = XLSX.default ?? XLSX;
  const buffer = lib.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadCsv(rows, fileName) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function fetchAllPages(path, params) {
  const rows = [];
  let page = 1;
  let pages = 1;
  do {
    const { data } = await api.get(path, { params: { ...params, page, limit: EXPORT_PAGE_SIZE } });
    rows.push(...data.data);
    pages = data.meta?.pages || 1;
    page += 1;
  } while (page <= pages);
  return rows;
}

function saleRow(sale) {
  return {
    'Дата': format(new Date(sale.createdAt), 'dd.MM.yyyy HH:mm'),
    'Секция': sale.section?.name ?? '',
    'Клиент': `${sale.user?.firstName ?? ''} ${sale.user?.lastName ?? ''}`.trim(),
    'Телефон': sale.user?.phone ?? '',
    'Тариф': sale.tariff?.name ?? '',
    'Статус': sale.status === 'REFUNDED' ? 'Возврат' : 'Активная',
    'Сумма': sale.pricePaid,
    'Сумма возврата': sale.refundAmount ?? 0,
    'Чистая сумма': (sale.pricePaid ?? 0) - (sale.refundAmount ?? 0),
    'Способ оплаты': PAYMENT_LABEL[sale.paymentMethod] || '',
    'Наличными': sale.cashAmount ?? 0,
    'Картой': sale.cardAmount ?? 0,
    'Провайдер карты': sale.cardProvider ? (sale.cardProvider === 'KASPI' ? 'Kaspi' : 'Halyk') : '',
  };
}

export default function AccountingPage() {
  const [dateRange, setDateRange] = useState({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const [salePage, setSalePage] = useState(1);
  const [sectionId, setSectionId] = useState('all');
  const [exporting, setExporting] = useState(false);

  const { logs: saleLogs, meta: saleMeta, loading: saleLoading, fetchLogs: fetchSales } = useSaleLogs();
  const { sections, fetchSections } = useSections(true);

  const sectionParam = sectionId === 'all' ? undefined : sectionId;
  const loadSales = useCallback(() => {
    fetchSales({ page: salePage, from: dateRange.from, to: dateRange.to, sectionId: sectionParam });
  }, [salePage, dateRange, sectionParam, fetchSales]);

  useEffect(() => { fetchSections(); }, [fetchSections]);
  useEffect(() => { loadSales(); }, [loadSales]);

  const handleDateChange = (range) => {
    setDateRange(range);
    setSalePage(1);
  };

  const handleSectionChange = (nextSectionId) => {
    setSectionId(nextSectionId);
    setSalePage(1);
  };

  const fetchExportSales = async () => {
    const from = dateRange.from ?? startOfDay(new Date());
    const to = dateRange.to ?? endOfDay(new Date());
    const sales = await fetchAllPages('/sales', {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(sectionParam && { sectionId: sectionParam }),
    });
    return { sales, dateLabel: `${format(from, 'dd.MM.yyyy')}-${format(to, 'dd.MM.yyyy')}` };
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSXModule = await import('xlsx');
      const XLSX = XLSXModule.default ?? XLSXModule;
      const { sales, dateLabel } = await fetchExportSales();
      const workbook = XLSX.utils.book_new();
      const groups = sales.reduce((acc, sale) => {
        const key = sale.section?.name || 'Без секции';
        acc[key] = acc[key] || [];
        acc[key].push(sale);
        return acc;
      }, {});

      const entries = Object.entries(groups);
      if (!entries.length) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 'Дата': 'Нет данных' }]), 'Продажи');
      } else {
        entries.forEach(([sectionName, sectionSales]) => {
          const rows = sectionSales.map(saleRow);
          const total = sectionSales.reduce((sum, sale) => sum + (sale.pricePaid || 0), 0);
          const refunds = sectionSales.reduce((sum, sale) => sum + (sale.refundAmount || 0), 0);
          rows.push({}, { 'Дата': 'Итого', 'Сумма': total, 'Сумма возврата': refunds, 'Чистая сумма': total - refunds });
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sectionName.slice(0, 31));
        });
      }

      downloadWorkbook(XLSX, workbook, `продажи_${dateLabel}.xlsx`);
      toast.success('Excel-файл успешно выгружен');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Ошибка экспорта Excel');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const { sales, dateLabel } = await fetchExportSales();
      const rows = sales.map(saleRow);
      if (!rows.length) {
        toast.error('Нет данных для выгрузки за выбранный период');
        return;
      }
      downloadCsv(rows, `продажи_${dateLabel}.csv`);
      toast.success('CSV-файл успешно выгружен');
    } catch (err) {
      console.error('CSV export error:', err);
      toast.error('Ошибка экспорта CSV');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Бухгалтерия</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />
          <button onClick={handleExportCsv} disabled={exporting} className="px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">CSV</button>
          <button onClick={handleExport} disabled={exporting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">{exporting ? '...' : 'Excel'}</button>
        </div>
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
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-slate-500">Всего: <span className="font-semibold text-slate-800">{saleMeta.total}</span></p>
          <p className="text-sm font-semibold text-emerald-600">Чистая выручка: {(saleMeta.netRevenue ?? saleMeta.totalRevenue ?? 0).toLocaleString()} тг</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Дата</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Клиент</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Секция</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Тариф</th>
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Оплата</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {saleLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : saleLogs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Нет продаж</td></tr>
              ) : saleLogs.map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap">{format(new Date(sale.createdAt), 'dd.MM.yyyy HH:mm')}</td>
                  <td className="px-4 py-3 font-medium">
                    {sale.user?.firstName} {sale.user?.lastName}
                    <p className="text-xs text-slate-400">{sale.user?.phone}</p>
                  </td>
                  <td className="px-4 py-3">{sale.section?.name}</td>
                  <td className="px-4 py-3">
                    {sale.tariff?.name}
                    <p className="text-xs text-slate-400">{sale.status === 'REFUNDED' ? `Возврат ${sale.refundAmount?.toLocaleString()} тг` : 'Активная'}</p>
                  </td>
                  <td className="px-4 py-3">{PAYMENT_LABEL[sale.paymentMethod]}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">{((sale.pricePaid || 0) - (sale.refundAmount || 0)).toLocaleString()} тг</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-100">
          <Pagination page={salePage} pages={saleMeta.pages} onPageChange={setSalePage} />
        </div>
      </div>
    </div>
  );
}
