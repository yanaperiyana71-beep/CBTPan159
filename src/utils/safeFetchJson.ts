export async function parseResponseJsonSafe<T = any>(res: Response): Promise<T | null> {
  try {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const raw = await res.text();
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    if (
      trimmed.startsWith('<') ||
      /^<!doctype/i.test(trimmed) ||
      /^<html/i.test(trimmed)
    ) {
      return null;
    }
    if (!ct.includes('application/json') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
