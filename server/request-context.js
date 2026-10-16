// Per-request context (the signed-in user) so the audit log can link entries to user accounts
// without threading the user through every service call.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const runWithUser = (user, fn) => storage.run({ user }, fn);
export const currentUserId = () => storage.getStore()?.user?.id ?? null;
