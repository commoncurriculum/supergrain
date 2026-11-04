import { createActor, type AnyActorLogic, type ActorRefFromLogic, type InputFrom } from "xstate";

/**
 * Test helper: spawn an actor and capture every emitted event.
 *
 * XState v5 supports `"*"` as a wildcard for `actor.on(...)` at runtime,
 * but its types restrict the event-name argument to declared emitted types.
 * We localize the cast here so test files don't repeat it.
 *
 * Pass the machine's emitted union as the second type parameter:
 *
 *   const { actor, emitted } = spawnTestActor<
 *     typeof activityMachine, ActivityEmitted
 *   >(activityMachine, { idleAfterMs: 1_000 })
 */
export function spawnTestActor<TLogic extends AnyActorLogic, TEmitted = unknown>(
  logic: TLogic,
  input?: InputFrom<TLogic>,
): {
  actor: ActorRefFromLogic<TLogic>;
  emitted: ReadonlyArray<TEmitted>;
} {
  const captured: TEmitted[] = [];
  const actor = createActor(logic, { input } as never) as ActorRefFromLogic<TLogic>;
  (actor as { on: (event: string, cb: (e: unknown) => void) => unknown }).on("*", (event) => {
    captured.push(event as TEmitted);
  });
  actor.start();
  return { actor, emitted: captured };
}

/**
 * In-memory EventTarget stand-ins. The bridge only uses addEventListener /
 * removeEventListener / (document) `hidden` / `defaultView`, so these model
 * exactly that, with a `dispatch` helper. Window-level events (focus/blur/
 * pageshow/pagehide) go on `defaultView`; the rest on the document.
 */
export class FakeEventTarget {
  private handlers = new Map<string, Set<EventListener>>();

  addEventListener(event: string, handler: EventListener): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: EventListener): void {
    this.handlers.get(event)?.delete(handler);
  }

  dispatch(event: string): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler({ type: event } as Event);
  }

  handlerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

export class FakeWindow extends FakeEventTarget {}

export class FakeDocument extends FakeEventTarget {
  hidden = false;
  focused = true;
  defaultView: FakeWindow | null;

  constructor(win: FakeWindow | null = new FakeWindow()) {
    super();
    this.defaultView = win;
  }

  hasFocus(): boolean {
    return this.focused;
  }
}

export const asDocument = (fake: FakeDocument) => fake as unknown as Document;
export const windowOf = (fake: FakeDocument) => fake.defaultView as FakeWindow;
