'use client';
import { createContext, useContext } from 'react';
import type { Session } from './client';

export const AccountContext = createContext<{
  session: Session;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('账户上下文不可用');
  return value;
}
