import type { MarketplaceTask } from "@kumo/shared";

/**
 * Storage boundary extracted from the original Kumo coordinator.
 *
 * The source implementation shells out to sqlite3. The BNB port keeps the
 * repository contract independent of persistence so local, durable and hosted
 * stores can be swapped without changing task semantics.
 */
export interface TaskStore {
  list(): Promise<MarketplaceTask[]>;
  listByStatus(status: string): Promise<MarketplaceTask[]>;
  listByRequester(requester: string): Promise<MarketplaceTask[]>;
  get(id: string): Promise<MarketplaceTask | null>;
  save(task: MarketplaceTask): Promise<MarketplaceTask>;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, MarketplaceTask>();

  async list() {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByStatus(status: string) {
    return (await this.list()).filter((task) => task.status === status);
  }

  async listByRequester(requester: string) {
    return (await this.list()).filter((task) => task.requester === requester);
  }

  async get(id: string) {
    return this.tasks.get(id) ?? null;
  }

  async save(task: MarketplaceTask) {
    this.tasks.set(task.id, task);
    return task;
  }
}
