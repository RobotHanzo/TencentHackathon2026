/** Preserve the source label while making an embedded official reference inspectable. */
export function sourceUrl(sourceName: string, content: string): string | undefined {
  const candidate = /^https:\/\//i.test(sourceName)
    ? sourceName
    : content.match(/https:\/\/[^\s<>"\]]+/)?.[0];
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
