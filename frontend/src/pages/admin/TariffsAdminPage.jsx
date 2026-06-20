import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useSections } from '../../hooks/useSections.js';
import { useTariffs } from '../../hooks/useTariffs.js';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';

const TIME_TYPE_LABEL = { ANY: 'Любое время', MORNING: 'День', EVENING: 'Вечер' };
const EMPTY_FORM = { sectionId: '', name: '', visitsAmount: '', durationDays: '', price: '', timeType: 'ANY', timeStart: '', timeEnd: '' };

export default function TariffsAdminPage() {
  const { tariffs, loading, fetchTariffs, createTariff, updateTariff, deactivateTariff, activateTariff } = useTariffs();
  const { sections, fetchSections, createSection, updateSection, deactivateSection, activateSection } = useSections();
  const [modalOpen, setModalOpen] = useState(false);
  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sectionForm, setSectionForm] = useState({ name: '' });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('active');
  const [selectedSectionId, setSelectedSectionId] = useState('all');

  useEffect(() => {
    fetchSections();
    fetchTariffs();
  }, [fetchSections, fetchTariffs]);

  const visibleTariffs = useMemo(() => (
    selectedSectionId === 'all'
      ? tariffs
      : tariffs.filter((t) => t.sectionId === Number(selectedSectionId))
  ), [tariffs, selectedSectionId]);
  const activeTariffs = visibleTariffs.filter((t) => t.isActive);
  const archivedTariffs = visibleTariffs.filter((t) => !t.isActive);
  const activeSections = sections.filter((s) => s.isActive);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sectionId: selectedSectionId === 'all' ? (activeSections[0]?.id || '') : selectedSectionId });
    setModalOpen(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      sectionId: t.sectionId,
      name: t.name,
      visitsAmount: t.visitsAmount ?? '',
      durationDays: t.durationDays,
      price: t.price,
      timeType: t.timeType,
      timeStart: t.timeStart ?? '',
      timeEnd: t.timeEnd ?? '',
    });
    setModalOpen(true);
  };

  const openSectionCreate = () => {
    setEditingSection(null);
    setSectionForm({ name: '' });
    setSectionModalOpen(true);
  };

  const openSectionEdit = (section) => {
    setEditingSection(section);
    setSectionForm({ name: section.name });
    setSectionModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        sectionId: parseInt(form.sectionId, 10),
        name: form.name,
        visitsAmount: form.visitsAmount === '' || form.visitsAmount === null ? null : parseInt(form.visitsAmount, 10),
        durationDays: parseInt(form.durationDays, 10),
        price: parseInt(form.price, 10),
        timeType: form.timeType,
        timeStart: form.timeType === 'ANY' ? null : (form.timeStart || null),
        timeEnd: form.timeType === 'ANY' ? null : (form.timeEnd || null),
      };
      if (editing) {
        await updateTariff(editing.id, payload);
        toast.success('Тариф обновлен');
      } else {
        await createTariff(payload);
        toast.success('Тариф создан');
      }
      setModalOpen(false);
      fetchTariffs();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleSectionSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: sectionForm.name };
      if (editingSection) {
        await updateSection(editingSection.id, payload);
        toast.success('Секция обновлена');
      } else {
        await createSection(payload);
        toast.success('Секция создана');
      }
      setSectionModalOpen(false);
      fetchSections();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка сохранения секции');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (t) => {
    if (!confirm(`Деактивировать тариф "${t.name}"?`)) return;
    await deactivateTariff(t.id);
    toast.success('Тариф деактивирован');
    fetchTariffs();
  };

  const handleActivate = async (t) => {
    if (!confirm(`Восстановить тариф "${t.name}"?`)) return;
    await activateTariff(t.id);
    toast.success('Тариф восстановлен');
    fetchTariffs();
  };

  const handleSectionDeactivate = async (section) => {
    if (!confirm(`Выключить секцию "${section.name}"? Она пропадет из продажи и выбора новых тарифов. Уже проданные абонементы и история сохранятся.`)) return;
    await deactivateSection(section.id);
    toast.success('Секция деактивирована');
    fetchSections();
  };

  const handleSectionActivate = async (section) => {
    if (!confirm(`Включить секцию "${section.name}"? Она снова появится в продаже и фильтрах.`)) return;
    await activateSection(section.id);
    toast.success('Секция восстановлена');
    fetchSections();
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const renderTariffCard = (t) => (
    <div key={t.id} className="rounded-2xl border p-5 bg-white border-slate-100">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 border-slate-100">
          {t.section?.name}
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-100">
          {TIME_TYPE_LABEL[t.timeType]}{t.timeStart && ` · ${t.timeStart}–${t.timeEnd}`}
        </span>
      </div>
      <h3 className="font-semibold text-slate-800 mb-1">{t.name}</h3>
      <p className="text-sm text-slate-500 mb-3">
        {t.visitsAmount ? `${t.visitsAmount} посещений` : 'Безлимит'} · {t.durationDays} дней
      </p>
      <div className="flex items-center justify-between">
        <p className="text-xl font-bold text-brand-600">{t.price.toLocaleString()} ₸</p>
        <div className="flex gap-2">
          <button onClick={() => openEdit(t)} className="text-xs text-slate-500 hover:text-brand-600">Изменить</button>
          {t.isActive ? (
            <button onClick={() => handleDeactivate(t)} className="text-xs text-red-400 hover:text-red-600">Деактивировать</button>
          ) : (
            <button onClick={() => handleActivate(t)} className="text-xs text-emerald-500 hover:text-emerald-700">Восстановить</button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Тарифы</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openSectionCreate}>+ Секция</Button>
          <Button onClick={openCreate}>+ Новый тариф</Button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setSelectedSectionId('all')} className={`px-3 py-2 rounded-xl text-sm border ${selectedSectionId === 'all' ? 'bg-brand-50 border-brand-500 text-brand-700' : 'border-slate-200 text-slate-600'}`}>Все</button>
          {sections.map((section) => (
            <button key={section.id} onClick={() => setSelectedSectionId(String(section.id))} className={`px-3 py-2 rounded-xl text-sm border ${selectedSectionId === String(section.id) ? 'bg-brand-50 border-brand-500 text-brand-700' : section.isActive ? 'border-slate-200 text-slate-600' : 'border-slate-200 text-slate-400 bg-slate-50'}`}>
              {section.name}{!section.isActive ? ' · архив' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-6">
        {[{ id: 'active', label: 'Активные' }, { id: 'archived', label: `Архивные${archivedTariffs.length ? ` (${archivedTariffs.length})` : ''}` }].map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === item.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => <div key={i} className="h-40 bg-slate-100 rounded-2xl animate-pulse" />)
        ) : (tab === 'active' ? activeTariffs : archivedTariffs).length === 0 ? (
          <p className="text-slate-400 col-span-3 text-center py-10">Нет тарифов</p>
        ) : (
          (tab === 'active' ? activeTariffs : archivedTariffs).map(renderTariffCard)
        )}
      </div>

      <div className="mt-10 bg-white rounded-2xl border border-slate-100 p-4">
        <h2 className="font-semibold text-slate-800 mb-1">Управление секциями</h2>
        <p className="text-sm text-slate-500 mb-4">Выключение секции скрывает ее из новых продаж, но не удаляет историю.</p>
        <div className="divide-y divide-slate-50">
          {sections.map((section) => (
            <div key={section.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-medium text-slate-800">{section.name}</p>
                <p className={`text-xs mt-0.5 ${section.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {section.isActive ? 'Активна' : 'Выключена'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openSectionEdit(section)}>Изменить</Button>
                {section.isActive ? (
                  <Button size="sm" variant="danger" onClick={() => handleSectionDeactivate(section)}>Выключить</Button>
                ) : (
                  <Button size="sm" variant="success" onClick={() => handleSectionActivate(section)}>Включить</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Редактировать тариф' : 'Новый тариф'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Секция</label>
            <select className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm" value={form.sectionId} onChange={set('sectionId')} required>
              <option value="">Выберите секцию</option>
              {activeSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </div>
          <Input label="Название" placeholder="Дневной — 8 посещений" value={form.name} onChange={set('name')} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Посещений (пусто = безлимит)" type="number" min="1" value={form.visitsAmount} onChange={set('visitsAmount')} />
            <Input label="Срок действия (дней)" type="number" min="1" value={form.durationDays} onChange={set('durationDays')} required />
          </div>
          <Input label="Цена (₸)" type="number" min="0" value={form.price} onChange={set('price')} required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Тип времени</label>
            <select className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm" value={form.timeType} onChange={set('timeType')}>
              <option value="ANY">Любое время</option>
              <option value="MORNING">Дневное</option>
              <option value="EVENING">Вечернее</option>
            </select>
          </div>
          {form.timeType !== 'ANY' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Начало (HH:MM)" type="time" value={form.timeStart} onChange={set('timeStart')} />
              <Input label="Конец (HH:MM)" type="time" value={form.timeEnd} onChange={set('timeEnd')} />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModalOpen(false)} className="flex-1">Отмена</Button>
            <Button type="submit" loading={saving} className="flex-1">Сохранить</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={sectionModalOpen} onClose={() => setSectionModalOpen(false)} title={editingSection ? 'Редактировать секцию' : 'Новая секция'}>
        <form onSubmit={handleSectionSave} className="space-y-4">
          <Input label="Название" placeholder="Волейбол" value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} required />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setSectionModalOpen(false)} className="flex-1">Отмена</Button>
            <Button type="submit" loading={saving} className="flex-1">Сохранить</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
