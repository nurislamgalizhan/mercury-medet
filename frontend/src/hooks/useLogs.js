import { useState, useCallback } from 'react';
import api from '../api/axios.js';
import toast from 'react-hot-toast';

export function useVisitLogs() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async ({ page = 1, limit = 20, from, to, userId, sectionId } = {}) => {
    setLoading(true);
    try {
      const { data } = await api.get('/visits', {
        params: {
          page,
          limit,
          ...(from && { from: from.toISOString() }),
          ...(to && { to: to.toISOString() }),
          ...(userId && { userId }),
          ...(sectionId && { sectionId }),
        },
      });
      setLogs(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка загрузки посещений');
    } finally {
      setLoading(false);
    }
  }, []);

  const prependLog = useCallback((log) => {
    setLogs((prev) => [{ ...log, _isNew: true, _flashId: Date.now() }, ...prev.filter((item) => item.id !== log.id)].slice(0, 20));
    setMeta((prev) => ({ ...prev, total: (prev.total || 0) + 1 }));
  }, []);

  return { logs, meta, loading, fetchLogs, prependLog };
}

export function useSaleLogs() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1, totalRevenue: 0 });
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async ({ page = 1, limit = 20, from, to, sectionId } = {}) => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales', {
        params: {
          page,
          limit,
          ...(from && { from: from.toISOString() }),
          ...(to && { to: to.toISOString() }),
          ...(sectionId && { sectionId }),
        },
      });
      setLogs(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка загрузки продаж');
    } finally {
      setLoading(false);
    }
  }, []);

  return { logs, meta, loading, fetchLogs };
}
