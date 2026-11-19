import { batch, unwrap } from "@supergrain/kernel";
import { Effect } from "effect";

import { defectToAdapterError, type SiloError } from "./errors";
import { applyEvent, HandleEvent, type InternalHandle } from "./transitions";

/** A handle plus the fetch that currently owns it. */
export interface Flight {
  readonly handle: InternalHandle;
  controller?: AbortController;
  inFlight?: Promise<void>;
}

export interface SingleFlightOptions<T> {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /** The adapter run. Call `retrying` from its `onFailure`. */
  run(retrying: (error: SiloError) => void): Effect.Effect<T, SiloError>;
  /** Write the result. Runs inside a batch; a returned error fails the handle. */
  commit(result: T): SiloError | void;
  /** Report a failure the adapter engine never saw: a commit error or a defect. */
  report(error: SiloError): void;
}

/**
 * Fetch into `flight.handle`, superseding the fetch in flight: its adapter
 * `signal` aborts and it lands nothing. Every event is stamped with this
 * fetch's generation, so the statechart ignores a superseded fetch's late
 * failures and teardown.
 *
 * A superseded fetch's promise follows its replacement, so awaiting the result
 * always reflects the state the handle settled into.
 */
export function runSingleFlight<T>(flight: Flight, options: SingleFlightOptions<T>): Promise<void> {
  const { handle } = flight;
  flight.controller?.abort();
  const controller = new AbortController();
  flight.controller = controller;
  batch(() => applyEvent(handle, HandleEvent.fetch()));
  const { generation } = unwrap(handle);

  const program = options
    .run((error) => batch(() => applyEvent(handle, HandleEvent.retrying(error, generation))))
    .pipe(
      Effect.flatMap((result) =>
        Effect.suspend(() => {
          const error = batch(() => {
            const failure = options.commit(result);
            if (failure === undefined) applyEvent(handle, HandleEvent.settled(generation));
            return failure;
          });
          if (error === undefined) return Effect.void;
          options.report(error);
          return Effect.fail(error);
        }),
      ),
      Effect.catchAll((error: SiloError) =>
        Effect.sync(() => batch(() => applyEvent(handle, HandleEvent.failed(error, generation)))),
      ),
      // Nothing may escape as a defect: `runPromiseExit` would discard it and
      // leave the handle fetching. The engine already coerces adapter defects;
      // this catches the rest, such as a subscriber throwing during the commit.
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          const error = defectToAdapterError(options.type, options.keys, defect);
          options.report(error);
          batch(() => applyEvent(handle, HandleEvent.failed(error, generation)));
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => batch(() => applyEvent(handle, HandleEvent.aborted(generation)))),
      ),
    );

  const run: Promise<void> = Effect.runPromiseExit(program, { signal: controller.signal }).then(
    () => {
      if (flight.inFlight === run) flight.inFlight = undefined;
      return flight.controller === controller ? undefined : flight.inFlight;
    },
  );
  flight.inFlight = run;
  return run;
}
