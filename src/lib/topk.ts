/** Maintains the best K items without retaining the full candidate stream. */
export class TopK<T> {
  private heap: T[] = [];
  constructor(private readonly k: number, private readonly compare: (a: T, b: T) => number) {}
  push(item: T) {
    if (this.k <= 0) return;
    if (this.heap.length < this.k) { this.heap.push(item); this.bubbleUp(this.heap.length - 1); return; }
    // heap root is the current worst item. Replace it only if the new item is better.
    if (this.compare(item, this.heap[0]) < 0) { this.heap[0] = item; this.sinkDown(0); }
  }
  toSorted(): T[] { return this.heap.slice().sort(this.compare); }
  get size() { return this.heap.length; }
  private worse(a: T, b: T) { return this.compare(a, b) > 0; }
  private bubbleUp(idx: number) {
    while (idx > 0) {
      const p = Math.floor((idx - 1) / 2);
      if (!this.worse(this.heap[idx], this.heap[p])) break;
      [this.heap[idx], this.heap[p]] = [this.heap[p], this.heap[idx]];
      idx = p;
    }
  }
  private sinkDown(idx: number) {
    for (;;) {
      const l = idx * 2 + 1, r = l + 1;
      let worst = idx;
      if (l < this.heap.length && this.worse(this.heap[l], this.heap[worst])) worst = l;
      if (r < this.heap.length && this.worse(this.heap[r], this.heap[worst])) worst = r;
      if (worst === idx) break;
      [this.heap[idx], this.heap[worst]] = [this.heap[worst], this.heap[idx]];
      idx = worst;
    }
  }
}

export class Reservoir<T> {
  private items: T[] = [];
  private seen = 0;
  constructor(private readonly max: number, private readonly seed = 0xdecafbad) {}
  push(item: T) {
    if (this.max <= 0) return;
    this.seen++;
    if (this.items.length < this.max) { this.items.push(item); return; }
    const j = Math.floor(this.random() * this.seen);
    if (j < this.max) this.items[j] = item;
  }
  toArray() { return this.items.slice(); }
  private random() {
    // deterministic LCG, sufficient for sampling visualization points.
    const next = (Math.imul(1664525, this.seed + this.seen) + 1013904223) >>> 0;
    return next / 0xffffffff;
  }
}
