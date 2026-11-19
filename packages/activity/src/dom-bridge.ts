import type { activityMachine } from "./machines/activity";
import type { ActorRefFromLogic } from "xstate";

export interface AttachActivityOptions {
  inputThrottleMs?: number;
}

// Browsers fire `visibilitychange`, `resume`, `freeze` on document and
// `focus`, `blur`, `pageshow`, `pagehide` on window.
export function attachActivityListeners(
  actor: ActorRefFromLogic<typeof activityMachine>,
  target: Document,
  opts: AttachActivityOptions = {},
): () => void {
  const userEvents = [
    "change",
    "keydown",
    "mousedown",
    "mouseup",
    "mousemove",
    "orientationchange",
    "scroll",
    "touchend",
    "touchmove",
    "touchstart",
  ];

  const inputThrottleMs = opts.inputThrottleMs ?? 1000;
  let lastInputSentAt = -Infinity;
  const onInput: EventListener = () => {
    const now = Date.now();
    if (now - lastInputSentAt < inputThrottleMs) return;
    lastInputSentAt = now;
    actor.send({ type: "USER_INPUT" });
  };
  const onFocus: EventListener = () => actor.send({ type: "FOCUS" });
  const onBlur: EventListener = () => actor.send({ type: "BLUR" });
  const onVisibility: EventListener = () => actor.send({ type: target.hidden ? "BLUR" : "FOCUS" });

  const bindings: Array<[EventTarget, string, EventListener]> = [];
  for (const e of userEvents) bindings.push([target, e, onInput]);
  bindings.push(
    [target, "visibilitychange", onVisibility],
    [target, "resume", onFocus],
    [target, "freeze", onBlur],
  );
  const win = target.defaultView;
  if (win) {
    bindings.push(
      [win, "focus", onFocus],
      [win, "pageshow", onFocus],
      [win, "blur", onBlur],
      [win, "pagehide", onBlur],
    );
  }

  for (const [t, e, h] of bindings) t.addEventListener(e, h);

  if (target.hidden || !target.hasFocus()) actor.send({ type: "BLUR" });

  return () => {
    for (const [t, e, h] of bindings) t.removeEventListener(e, h);
  };
}
