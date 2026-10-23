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
