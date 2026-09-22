import { Router } from 'express';
import { authenticate, requireVerified, requireAdmin } from '../middleware/auth.js';
import {
  getUsers,
  getUserById,
  createUser,
  adjustUser,
  renameClient,
  deleteUser,
  cancelSubscription,
  activateSubscription,
  getAdminActionLogs,
  freezeSubscription,
  unfreezeSubscription,
  resetClientPassword,
  issueClientPassword,
} from '../controllers/userController.js';

const router = Router();

// Freeze/unfreeze: visitor can manage their own, admin can manage any
router.post('/:id/freeze', authenticate, requireVerified, freezeSubscription);
router.post('/:id/unfreeze', authenticate, requireVerified, unfreezeSubscription);

router.use(authenticate, requireVerified, requireAdmin);

router.get('/', getUsers);
router.get('/admin-history', getAdminActionLogs);
router.post('/', createUser);
router.post('/:id/reset-password', resetClientPassword);
router.post('/:id/issue-password', issueClientPassword);
router.get('/:id', getUserById);
router.patch('/:id/adjust', adjustUser);
router.patch('/:id/name', renameClient);
router.post('/:id/subscriptions/:subscriptionId/cancel', cancelSubscription);
router.post('/:id/subscriptions/:subscriptionId/activate', activateSubscription);
router.delete('/:id', deleteUser);

export default router;
