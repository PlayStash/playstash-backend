const sensitive =
  /(?:password(?:hash|digest)?|passphrase|secret|seed|token(?:hash)?|apikey|xapikey|authorization|cookie|ssosubject|ssoprovider)$/i;

/** Query strings and fragments can contain OAuth codes and signed URLs. */
export function logPath(value: string | undefined): string {
  return (value ?? "").split(/[?#]/, 1)[0]!;
}

/** Preserve useful structured diagnostics while omitting nested credentials. */
function redactLogText(value: string): string {
  return (
    value
      .replace(
        /\b(?:Bearer|Basic)\s+[a-z0-9._~+/-]+=*/gi,
        (match) => `${match.split(/\s/, 1)[0]} **REDACTED**`,
      )
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
        try {
          const url = new URL(match);
          if (url.username || url.password) {
            url.username = "**REDACTED**";
            url.password = "**REDACTED**";
          }
          url.search = "";
          url.hash = "";
          return url.href;
        } catch {
          return "**OMITTED URL**";
        }
      })
      // Structured values can already have become text via Winston's %j/%o splat.
      .replace(
        /((?:["']?(?:password(?:[_-]?(?:hash|digest))?|api[_-]?key|access[_-]?token|refresh[_-]?token(?:[_-]?hash)?|client[_-]?secret|authorization|(?:set[_-]?)?cookie|auth[_-]?seed)["']?)\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;}\]]+)/gi,
        '$1"**REDACTED**"',
      )
  );
}

export function redactLogValue(
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (depth > 8) return "**OMITTED**";
  if (typeof value === "string") return redactLogText(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value))
    return "**OMITTED BINARY**";
  if (value && typeof value === "object") {
    if (ancestors.has(value)) return "**OMITTED CYCLE**";
    ancestors.add(value);
    try {
      if (Array.isArray(value))
        return value.map((item) => redactLogValue(item, depth + 1, ancestors));
      const record: Record<PropertyKey, unknown> =
        value instanceof Error ? { name: value.name } : {};
      for (const key of Reflect.ownKeys(value)) {
        const name = typeof key === "symbol" ? (key.description ?? "") : key;
        record[key] = sensitive.test(name.replace(/[-_]/g, ""))
          ? "**REDACTED**"
          : redactLogValue(Reflect.get(value, key), depth + 1, ancestors);
      }
      return record;
    } finally {
      ancestors.delete(value);
    }
  }
  return value;
}
