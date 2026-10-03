// Natural (human-aware) sorting for numbered course files and folders.
// e.g. "2 - EC2" sorts before "10 - VPC", and "Lesson 2" before "Lesson 10".

const TOKEN_RE = /(\d+)|(\D+)/g;

export function naturalCompare(a: string, b: string): number {
  const aParts = a.match(TOKEN_RE) ?? [];
  const bParts = b.match(TOKEN_RE) ?? [];
  const len = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    const aIsNum = /^\d+$/.test(ap);
    const bIsNum = /^\d+$/.test(bp);

    if (aIsNum && bIsNum) {
      const an = parseInt(ap, 10);
      const bn = parseInt(bp, 10);
      if (an !== bn) return an - bn;
      // Same numeric value: shorter raw string first ("01" vs "1" stable)
      if (ap !== bp) return ap < bp ? -1 : 1;
    } else {
      const al = ap.toLowerCase();
      const bl = bp.toLowerCase();
      if (al !== bl) return al < bl ? -1 : 1;
    }
  }
  return aParts.length - bParts.length;
}

export function naturalSort<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)));
}
