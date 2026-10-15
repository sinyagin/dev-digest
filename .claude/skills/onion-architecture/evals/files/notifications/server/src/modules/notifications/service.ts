import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { Notification, NotificationChannel, NotificationPreferences } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { NotificationsRepository } from './repository.js';

export class NotificationsService {
  private repo: NotificationsRepository;

  constructor(private container: Container) {
    this.repo = new NotificationsRepository(container.db);
  }

  async list(workspaceId: string, userId: string, unreadOnly: boolean): Promise<Notification[]> {
    const prefs = await this.repo.getPreferences(workspaceId, userId);
    const items = await this.repo.list(workspaceId, userId, unreadOnly);
    return items.filter((n) => !prefs.muted_kinds.includes(n.kind));
  }

  async markRead(workspaceId: string, userId: string, id: string): Promise<void> {
    const updated = await this.container.db
      .update(t.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(t.notifications.workspaceId, workspaceId),
          eq(t.notifications.userId, userId),
          eq(t.notifications.id, id),
        ),
      )
      .returning({ id: t.notifications.id });
    if (updated.length === 0) throw new NotFoundError(`notification ${id} not found`);
  }

  async getPreferences(workspaceId: string, userId: string): Promise<NotificationPreferences> {
    return this.repo.getPreferences(workspaceId, userId);
  }

  async setPreferences(
    workspaceId: string,
    userId: string,
    channel: NotificationChannel,
    mutedKinds: string[],
  ): Promise<NotificationPreferences> {
    return this.repo.upsertPreferences(workspaceId, userId, channel, mutedKinds);
  }
}
