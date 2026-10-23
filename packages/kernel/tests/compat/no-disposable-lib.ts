// Type-checked by tsconfig.no-disposable.json, whose `lib` lacks
// `esnext.disposable` and which loads no `@types/node` — i.e. a consumer whose
// TypeScript doesn't know `Symbol.dispose`. Kernel ships `.ts` sources as its
// types, so they must still compile there, with `Disposer` degrading to a plain
// stop function. Excluded from the main tsconfig, where `Symbol.dispose` exists.
import { effect, type Disposer, type SymbolDisposable } from "../../src";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Interchangeable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// No `Symbol.dispose` in this lib, so the protocol type adds nothing...
export type ProtocolIsEmpty = Assert<Equal<SymbolDisposable, {}>>;
// ...and `Disposer` is just a stop function.
export type DisposerIsStopFunction = Assert<Interchangeable<Disposer, () => void>>;

const stop = effect(() => {});
stop();
