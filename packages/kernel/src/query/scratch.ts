/**
 * A list to reuse: once it has grown to the most it held, adding items
 * allocates nothing. `clear` empties its slots, so it holds on to nothing,
 * but keeps the room. (Setting an array's `length` to 0 gives the room back,
 * and the next push allocates it again.)
 */
export class Scratch<T> {
  /** The items, in `items[0]` up to `items[size - 1]`. Slots past those are empty. */
  readonly items: Array<T | undefined> = [];
  size = 0;

  push(item: T): void {
    this.items[this.size++] = item;
  }

  at(index: number): T {
    return this.items[index] as T;
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.items[i] = undefined;
    this.size = 0;
  }
}
