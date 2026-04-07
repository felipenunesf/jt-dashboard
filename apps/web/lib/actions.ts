'use server';

import { signOut as authSignOut } from '@/lib/auth';

export async function logoutAction() {
  await authSignOut({ redirectTo: '/login' });
}
