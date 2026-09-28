/* Ce que la synchronisation attend du navigateur, en mémoire :
   localStorage (avec un quota qu'un test peut épuiser), window et
   document (écouteurs, premier plan), navigator.onLine. */

class Stockage {
  private m = new Map<string, string>();
  plein = false;
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.plein) throw new DOMException("quota", "QuotaExceededError");
    this.m.set(k, String(v));
  }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const g = globalThis as Record<string, unknown>;
g.localStorage = new Stockage();
g.window = Object.assign(new EventTarget(), { location: { origin: "http://geoplan.test", pathname: "/" } });
g.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
