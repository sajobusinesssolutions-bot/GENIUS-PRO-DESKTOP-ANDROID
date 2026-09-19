import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Panel, EmptyBlock } from './ui';

/**
 * Screens that can move money or rewrite the catalogue need the same guard, and
 * several were reachable from quick actions without one. Keeping the check and
 * the refusal in a single place means a new screen gets both, or neither
 * visibly — not a gate that silently passes everybody.
 */

/** Answers the live role matrix for the signed-in user. */
export function useCan(key: string | null | undefined): boolean {
  const { db } = useAppData();
  return canFor(db?.session.role, key);
}

/** True only for the owner account. Used where a permission key is too coarse. */
export function useIsOwner(): boolean {
  const { db } = useAppData();
  return db?.session.role === 'owner';
}

export function Denied({ title = 'Not your area', hint }: { title?: string; hint: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, justifyContent: 'center' }}>
      <Panel>
        <EmptyBlock icon="lock" title={title} hint={hint} />
      </Panel>
    </View>
  );
}
