import { Injectable } from "@nestjs/common";

type AccessRevokedHandler = (userId: number) => void | Promise<void>;

/** Notify live connections only after an account change has been persisted. */
@Injectable()
export class UserStatusEvents {
  private readonly handlers = new Set<AccessRevokedHandler>();

  onAccessRevoked(handler: AccessRevokedHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async revokeAccess(userId: number): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(userId)));
  }
}
