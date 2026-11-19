/** URL-safe slug generation with uniqueness fallback. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export function ensureUniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  return (async () => {
    const root = slugify(base) || 'item';
    if (!(await exists(root))) return root;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${root}-${i}`;
      if (!(await exists(candidate))) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  })();
}

export function reference(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const time = Date.now().toString(36).toUpperCase().slice(-6);
  return `${prefix}-${time}-${rand}`;
}
