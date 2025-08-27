import Dexie, { type EntityTable } from "dexie";

export interface SavedQuery {
  id?: number;
  connectionId: string;
  database?: string;
  name: string;
  description?: string;
  query: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  isFavorite: boolean;
}

class SavedQueriesDB extends Dexie {
  savedQueries!: EntityTable<SavedQuery, "id">;

  constructor() {
    super("SavedQueriesDB");
    this.version(1).stores({
      savedQueries: "++id, connectionId, name, isFavorite, *tags"
    });
  }
}

const db = new SavedQueriesDB();

export const savedQueriesService = {
  async saveQuery(query: Omit<SavedQuery, "id">): Promise<number> {
    return await db.savedQueries.add(query);
  },

  async updateQuery(id: number, updates: Partial<SavedQuery>): Promise<void> {
    await db.savedQueries.update(id, {
      ...updates,
      updatedAt: new Date()
    });
  },

  async getQueries(connectionId: string, database?: string): Promise<SavedQuery[]> {
    let query = db.savedQueries
      .where("connectionId")
      .equals(connectionId);

    if (database) {
      query = query.filter(q => q.database === database);
    }

    return await query
      .reverse()
      .toArray();
  },

  async getFavorites(connectionId: string): Promise<SavedQuery[]> {
    return await db.savedQueries
      .where("connectionId")
      .equals(connectionId)
      .and(q => q.isFavorite)
      .reverse()
      .toArray();
  },

  async searchQueries(
    connectionId: string,
    searchTerm: string
  ): Promise<SavedQuery[]> {
    const lowerSearch = searchTerm.toLowerCase();
    return await db.savedQueries
      .where("connectionId")
      .equals(connectionId)
      .filter(q => 
        q.name.toLowerCase().includes(lowerSearch) ||
        q.description?.toLowerCase().includes(lowerSearch) ||
        q.query.toLowerCase().includes(lowerSearch) ||
        q.tags?.some(tag => tag.toLowerCase().includes(lowerSearch))
      )
      .reverse()
      .toArray();
  },

  async getByTag(connectionId: string, tag: string): Promise<SavedQuery[]> {
    return await db.savedQueries
      .where("tags")
      .equals(tag)
      .and(q => q.connectionId === connectionId)
      .reverse()
      .toArray();
  },

  async deleteQuery(id: number): Promise<void> {
    await db.savedQueries.delete(id);
  },

  async toggleFavorite(id: number): Promise<void> {
    const query = await db.savedQueries.get(id);
    if (query) {
      await db.savedQueries.update(id, {
        isFavorite: !query.isFavorite,
        updatedAt: new Date()
      });
    }
  }
};