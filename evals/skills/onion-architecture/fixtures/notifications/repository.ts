import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Notification, NotificationChannel, NotificationPreferences } from '@devdigest/shared';
import type { NotificationPreferenceRow, NotificationRow } from '../../db/rows.js';

export type { NotificationPreferenceRow, NotificationRow };

export class NotificationsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, userId: string, unreadOnly: boolean): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(t.notifications)
      .where(
        and(
          eq(t.notifications.workspaceId, workspaceId),
          eq(t.notifications.userId, userId),
          unreadOnly ? isNull(t.notifications.readAt) : undefined,
        ),
      )
      .orderBy(desc(t.notifications.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      link: r.link,
      read: r.readAt !== null,
      created_at: r.createdAt.toISOString(),
    }));
  }

  async getPreferences(workspaceId: string, userId: string): Promise<NotificationPreferences> {
    const [row] = await this.db
      .select()
      .from(t.notificationPreferences)
      .where(
        and(
          eq(t.notificationPreferences.workspaceId, workspaceId),
          eq(t.notificationPreferences.userId, userId),
        ),
      )
      .limit(1);
    return {
      channel: (row?.channel ?? 'in_app') as NotificationChannel,
      muted_kinds: row?.mutedKinds ?? [],
    };
  }

  async upsertPreferences(
    workspaceId: string,
    userId: string,
    channel: NotificationChannel,
    mutedKinds: string[],
  ): Promise<NotificationPreferences> {
    const [row] = await this.db
      .insert(t.notificationPreferences)
      .values({ workspaceId, userId, channel, mutedKinds })
      .onConflictDoUpdate({
        target: [t.notificationPreferences.workspaceId, t.notificationPreferences.userId],
        set: { channel, mutedKinds, updatedAt: new Date() },
      })
      .returning();
    return { channel: row!.channel as NotificationChannel, muted_kinds: row!.mutedKinds };
  }
}
