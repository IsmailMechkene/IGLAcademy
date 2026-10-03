// Input validation helpers for IPC handlers. All IPC input is validated in the
// main process before touching the database or filesystem.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function requireString(value: unknown, field: string, maxLen = 500): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(`${field} must not be empty`);
  if (trimmed.length > maxLen) throw new ValidationError(`${field} is too long (max ${maxLen})`);
  return trimmed;
}

export function optionalString(value: unknown, field: string, maxLen = 2000): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (value.length > maxLen) throw new ValidationError(`${field} is too long (max ${maxLen})`);
  return value;
}

export function requireId(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return n;
}

export function optionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireId(value, field);
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function requirePath(value: unknown, field: string): string {
  const s = requireString(value, field, 4096);
  // Reject paths with null bytes and obviously invalid input
  if (s.includes('\0')) throw new ValidationError(`${field} contains invalid characters`);
  return s;
}
