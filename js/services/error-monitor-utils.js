export function normalizeCapturedError(errorLike, extra = {}) {
  const message =
    errorLike?.message ||
    errorLike?.reason?.message ||
    errorLike?.reason ||
    String(errorLike || "unknown_error");

  return {
    message: String(message || "unknown_error"),
    stack: String(errorLike?.stack || errorLike?.reason?.stack || "").slice(0, 4000),
    source: String(extra.source || errorLike?.filename || errorLike?.type || "runtime"),
    line: Number(extra.line ?? errorLike?.lineno ?? 0) || null,
    column: Number(extra.column ?? errorLike?.colno ?? 0) || null,
  };
}

