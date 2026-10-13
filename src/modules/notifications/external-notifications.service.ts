import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import configuration from "../../configuration.js";
import type { PlaystashGame } from "../games/playstash-game.entity.js";

type LibraryEvent = "game.added" | "game.updated" | "game.extra.added";
interface Notification {
  event: LibraryEvent;
  game: { id: number; title: string; version?: string };
  timestamp: string;
  extra?: string;
}

/** Opt-in server notifications; delivery failures never interrupt library indexing. */
@Injectable()
export class ExternalNotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(this.constructor.name);
  private readonly queue: Notification[] = [];
  private readonly shutdown = new AbortController();
  private running = false;

  publish(event: LibraryEvent, game: PlaystashGame, extra?: string): void {
    if (game.access_restricted) return;
    if (
      !configuration.NOTIFICATIONS.WEBHOOK_URL ||
      this.shutdown.signal.aborted
    )
      return;
    if (this.queue.length >= 100) {
      this.logger.warn(
        "Notification queue is full; skipping a library notification.",
      );
      return;
    }
    this.queue.push({
      event,
      game: {
        id: game.id,
        title: game.title || `Game ${game.id}`,
        version: game.version,
      },
      timestamp: new Date().toISOString(),
      ...(extra && { extra }),
    });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.shutdown.signal.aborted) {
        const notification = this.queue.shift()!;
        await this.deliver(notification);
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(notification: Notification): Promise<void> {
    const config = configuration.NOTIFICATIONS;
    const action =
      notification.event === "game.added"
        ? "New game"
        : notification.event === "game.updated"
          ? "Updated game"
          : "New extra";
    const body =
      config.WEBHOOK_FORMAT === "discord"
        ? {
            content:
              `PlayStash — ${action}: ${notification.game.title}${notification.game.version ? ` (${notification.game.version})` : ""}${notification.extra ? ` — ${notification.extra}` : ""}`.slice(
                0,
                2000,
              ),
            allowed_mentions: { parse: [] },
          }
        : notification;
    for (
      let attempt = 0;
      attempt < 3 && !this.shutdown.signal.aborted;
      attempt++
    ) {
      try {
        const response = await fetch(config.WEBHOOK_URL!, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            ...(config.WEBHOOK_TOKEN && {
              Authorization: `Bearer ${config.WEBHOOK_TOKEN}`,
            }),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([
            this.shutdown.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        // Consume/cancel the response so connections can be reused.
        await response.body?.cancel();
        if (response.ok) return;
        if (response.status !== 429 && response.status < 500) break;
      } catch {
        if (this.shutdown.signal.aborted) return;
      }
      if (attempt < 2) {
        try {
          await delay(500 * (attempt + 1), undefined, {
            signal: this.shutdown.signal,
          });
        } catch {
          return;
        }
      }
    }
    this.logger.warn(
      "External notification could not be delivered after retrying.",
    );
  }

  onModuleDestroy(): void {
    this.shutdown.abort();
    this.queue.length = 0;
  }
}
