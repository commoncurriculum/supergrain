// Not `length = 0` to clear: that releases the backing store, and the next
// push reallocates it.
export class Scratch<T> {
  readonly items: Array<T | undefined> = [];
  size = 0;

  push(item: T): void {
    this.items[this.size++] = item;
  }

  at(index: number): T {
    return this.items[index] as T;
  }

  insertAt(index: number, item: T): void {
    for (let i = this.size; i > index; i--) this.items[i] = this.items[i - 1];
    this.items[index] = item;
    this.size++;
  }

  removeAt(index: number): void {
    this.size--;
    for (let i = index; i < this.size; i++) this.items[i] = this.items[i + 1];
    this.items[this.size] = undefined;
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.items[i] = undefined;
    this.size = 0;
  }
}
