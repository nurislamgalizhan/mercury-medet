import { useState, useCallback } from 'react';
import api from '../api/axios.js';
import toast from 'react-hot-toast';

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async ({ page = 1, limit = 20, search = '', sectionId } = {}) => {
    setLoading(true);
    try {
      const { data } = await api.get('/users', { params: { page, limit, search, ...(sectionId && { sectionId }) } });
      setUsers(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  }, []);

  const adjustUser = useCallback(async (id, payload) => {
    const { data } = await api.patch(`/users/${id}/adjust`, payload);
    return data;
  }, []);

  const deleteUser = useCallback(async (id) => {
    await api.delete(`/users/${id}`, { data: { confirmDeletion: true } });
  }, []);

  const createUser = useCallback(async (payload) => {
    const { data } = await api.post('/users', payload);
    return data;
  }, []);

  return { users, meta, loading, fetchUsers, adjustUser, deleteUser, createUser };
}
