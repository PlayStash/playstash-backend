import { createHash, randomBytes } from "node:crypto";

export function createAuthSeed(seed: string | undefined): string {
  if (!seed) return randomBytes(32).toString("hex");
  if (Buffer.byteLength(seed, "utf8") < 32) {
    throw new Error(
      "AUTH_SEED must contain at least 32 bytes of independently generated randomness.",
    );
  }
  return createHash("sha256").update(seed).digest("hex");
}
