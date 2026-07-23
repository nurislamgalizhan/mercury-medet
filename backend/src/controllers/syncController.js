import { getSyncStatus, isVolleyballSyncEnabled } from '../services/syncClient.js';

export async function syncStatus(req, res, next) {
  try {
    if (!isVolleyballSyncEnabled()) {
      return res.json({ status: 'disabled', pendingProjections: 0, failedProjections: 0, lagSeconds: 0 });
    }
    res.json(await getSyncStatus());
  } catch (err) {
    next(err);
  }
}
