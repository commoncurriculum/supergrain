import type { activityMachine } from "./machines/activity";
import type { ActorRefFromLogic } from "xstate";

export interface AttachActivityOptions {
  /** Minimum ms between USER_INPUT events sent to the machine. High-
   *  frequency DOM events (mousemove fires at pointer rate) would
   *  otherwise re-enter `active` — timer restart + emit + subscriber
   *  notification — per event. Default 1_000. */
  inputThrottleMs?: number;
}

/**
 * Attach DOM listeners to an ActivityMachine actor. Returns a cleanup
 * function that removes every listener.
 *
 * Listeners bind to the target the browser actually dispatches on:
 *   - 10 user-input events (keydown, mousemove, …) → USER_INPUT, on document
 *   - `visibilitychange` → FOCUS/BLUR by `document.hidden`, on document
 *   - page-lifecycle `resume` / `freeze` → FOCUS / BLUR, on document
 *   - window `focus` / `pageshow` → FOCUS and `blur` / `pagehide` → BLUR, on
 *     `document.defaultView` (the window) when present
 *
 * USER_INPUT is throttled (leading edge): the machine's idle timeout is
 * 15s, so a 1s notification floor delays idle detection by at most 1s
 * while cutting mousemove traffic to the machine by ~99%.
 */
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

  // (eventTarget, eventName, handler) triples — one list drives both attach
  // and detach, so they can't drift.
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

  // Seed from the document's current state: a hidden tab or an unfocused
  // window shouldn't start in `active` (the chart's initial state).
  if (target.hidden || !target.hasFocus()) actor.send({ type: "BLUR" });

  return () => {
    for (const [t, e, h] of bindings) t.removeEventListener(e, h);
  };
}
