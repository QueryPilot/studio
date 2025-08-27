import Dexie, { type EntityTable } from "dexie";

export interface QueryHistoryEntry {
  id?: number;
  connectionId: string;
  database: string;
  query: string;
  executedAt: Date;
  executionTime?: number;
  rowCount?: number;
  error?: string;
  isFavorite?: boolean;
  name?: string;
}

class QueryHistoryDB extends Dexie {
  queryHistory!: EntityTable<QueryHistoryEntry, "id">;

  constructor() {
    super("QueryHistoryDB");
    this.version(1).stores({
      queryHistory: "++id, connectionId, database, executedAt, isFavorite"
    });
  }
}

const db = new QueryHistoryDB();

export const queryHistoryService = {
  async addEntry(entry: Omit<QueryHistoryEntry, "id">): Promise<number> {
    return await db.queryHistory.add(entry);
  },

  async getHistory(
    connectionId: string,
    database?: string,
    limit = 100
  ): Promise<QueryHistoryEntry[]> {
    let query = db.queryHistory
      .where("connectionId")
      .equals(connectionId);

    if (database) {
      query = query.filter(entry => entry.database === database);
    }

    return await query
      .reverse()
      .limit(limit)
      .toArray();
  },

  async searchHistory(
    connectionId: string,
    searchTerm: string,
    limit = 50
  ): Promise<QueryHistoryEntry[]> {
    return await db.queryHistory
      .where("connectionId")
      .equals(connectionId)
      .filter(entry => 
        entry.query.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .reverse()
      .limit(limit)
      .toArray();
  },

  async clearHistory(connectionId: string, database?: string): Promise<void> {
    if (database) {
      await db.queryHistory
        .where("connectionId")
        .equals(connectionId)
        .filter(entry => entry.database === database)
        .delete();
    } else {
      await db.queryHistory
        .where("connectionId")
        .equals(connectionId)
        .delete();
    }
  },

  async deleteEntry(id: number): Promise<void> {
    await db.queryHistory.delete(id);
  },

  async toggleFavorite(id: number, name?: string): Promise<void> {
    const entry = await db.queryHistory.get(id);
    if (entry) {
      await db.queryHistory.update(id, {
        isFavorite: !entry.isFavorite,
        name: !entry.isFavorite ? name : undefined
      });
    }
  },

  async getFavorites(
    connectionId: string,
    database?: string
  ): Promise<QueryHistoryEntry[]> {
    let query = db.queryHistory
      .where("connectionId")
      .equals(connectionId)
      .filter(entry => entry.isFavorite === true);

    if (database) {
      query = query.filter(entry => entry.database === database);
    }

    return await query
      .reverse()
      .toArray();
  },

  async updateFavoriteName(id: number, name: string): Promise<void> {
    await db.queryHistory.update(id, { name });
  }
};