/**
 * Sidebar Adapter Factory
 *
 * Creates the appropriate sidebar adapter based on database type.
 */

import { DbType } from '@/types/connection';
import type { SidebarAdapter } from '@/types/sidebar';
import { MongoSidebarAdapter } from './MongoSidebarAdapter';
import { RedisSidebarAdapter } from './RedisSidebarAdapter';

export function createSidebarAdapter(dbType: DbType): SidebarAdapter | null {
  switch (dbType) {
    case DbType.MongoDB:
      return new MongoSidebarAdapter();
    case DbType.Redis:
      return new RedisSidebarAdapter();
    default:
      // SQL databases still use DatabaseSidebar (for now)
      return null;
  }
}

export function shouldUseUnifiedSidebar(dbType: DbType): boolean {
  return dbType === DbType.MongoDB || dbType === DbType.Redis;
}
