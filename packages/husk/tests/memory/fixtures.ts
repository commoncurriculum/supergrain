import { signal } from "@supergrain/kernel";
import { delay } from "@supergrain/test-utils/memory";

import { defineResource, dispose, reactivePromise, reactiveTask, resource } from "../../src";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface HuskPayload {
  id: number;
  values: Array<number>;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makePayload(seed: number, width = 24): Array<HuskPayload> {
  return Array.from({ length: width }, (_, index) => ({
    id: seed * 1_000 + index,
    values: Array.from({ length: 18 }, (__, offset) => seed + index + offset),
  }));
}

export async function runHuskCycle(seed: number): Promise<void> {
  const resourceTrigger = signal(0);
  const resourceDeferreds: Array<Deferred<number>> = [];
  const asyncResource = resource(
    { value: 0, payload: makePayload(seed) },
    async (state, { abortSignal }) => {
      const current = resourceTrigger();
      const run = deferred<number>();
      resourceDeferreds.push(run);
      const value = await run.promise;
      if (abortSignal.aborted) return;
      state.value = current + value;
      state.payload = makePayload(seed + value);
    },
  );

  resourceTrigger(1);

  const promiseTrigger = signal(0);
  const promiseDeferreds: Array<Deferred<{ value: number; payload: Array<HuskPayload> }>> = [];
  const reactive = reactivePromise(async (abortSignal) => {
    const current = promiseTrigger();
    const run = deferred<{ value: number; payload: Array<HuskPayload> }>();
    abortSignal.addEventListener("abort", () =>
      run.resolve({ value: current, payload: makePayload(seed) }),
    );
    promiseDeferreds.push(run);
    return run.promise;
  });

  promiseTrigger(1);
  promiseTrigger(2);

  const task = reactiveTask(async (mode: "ok" | "fail", value: number) => {
    if (mode === "fail") throw new Error(`task-${value}`);
    return { value, payload: makePayload(seed + value, 12) };
  });

  const okRun = task.run("ok", seed);
  const failedRun = task.run("fail", seed).catch(() => undefined);

  dispose(asyncResource);
  dispose(reactive as object);

  for (const run of resourceDeferreds) {
    run.resolve(seed);
  }
  for (const run of promiseDeferreds) {
    run.resolve({ value: seed, payload: makePayload(seed + 1, 16) });
  }

  await Promise.allSettled([
    okRun,
    failedRun,
    ...resourceDeferreds.map((run) => run.promise),
    ...promiseDeferreds.map((run) => run.promise),
  ]);
  await delay();
}

/**
 * Exercises defineResource — reusable factory that creates multiple
 * independent instances and disposes them all.
 */
export async function runDefineResourceCycle(seed: number): Promise<void> {
  const fetchData = defineResource<number, { value: number; payload: Array<HuskPayload> }>(
    () => ({ value: 0, payload: makePayload(seed) }),
    async (state, url, { abortSignal }) => {
      const run = deferred<Array<HuskPayload>>();
      abortSignal.addEventListener("abort", () => run.resolve([]));
      const result = await run.promise;
      if (abortSignal.aborted) return;
      state.value = url + result.length;
      state.payload = makePayload(seed + url);
    },
  );

  const trigger = signal(seed);
  const instances = Array.from({ length: 5 }, () => fetchData(() => trigger()));

  trigger(seed + 1);
  trigger(seed + 2);

  for (const instance of instances) {
    dispose(instance);
  }
  await delay();
}
