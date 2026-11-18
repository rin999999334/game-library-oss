const MAX_KEYS = 160;
type Entry = { at: number; value: unknown };
const values = new Map<string, Entry>(), pending = new Map<string, Promise<unknown>>();
export function peek<T>(key: string): T | undefined {
  const hit = values.get(key);
  if (!hit || Date.now() - hit.at > 5 * 60 * 1000) return undefined;
  return hit.value as T;
}
export function forget(key: string) { values.delete(key); }
export function cached<T>(key: string, request: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const promise = request().then(value => {
    values.delete(key);
    values.set(key, { at: Date.now(), value });
    while (values.size > MAX_KEYS) values.delete(values.keys().next().value!);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
