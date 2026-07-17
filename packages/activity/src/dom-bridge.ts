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
 * The mapping mirrors what frontend/app/services/socket.ts:96-129 does:
 *   - 10 user-input events (keydown, mousemove, scroll, …) → USER_INPUT
 *   - pageshow / focus / resume → FOCUS
 *   - pagehide / blur / freeze → BLUR
 *   - visibilitychange → FOCUS or BLUR depending on document.hidden
 *
 * USER_INPUT is throttled (leading edge): the machine's idle timeout is
 * 15s, so a 1s notification floor delays idle detection by at most 1s
 * while cutting mousemove traffic to the machine by ~99%.
 */
export function attachActivityListeners(
  actor: ActorRefFromLogic<typeof activityMachine>,
  target: Document = document,
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
  const focusEvents = ["pageshow", "resume", "focus"];
  const blurEvents = ["pagehide", "freeze", "blur"];

  const inputThrottleMs = opts.inputThrottleMs ?? 1000;
  let lastInputSentAt = -Infinity;
  const onInput = () => {
    const now = Date.now();
    if (now - lastInputSentAt < inputThrottleMs) return;
    lastInputSentAt = now;
    actor.send({ type: "USER_INPUT" });
  };
  const onFocus = () => actor.send({ type: "FOCUS" });
  const onBlur = () => actor.send({ type: "BLUR" });
  const onVisibility = () => {
    if (target.hidden) actor.send({ type: "BLUR" });
    else actor.send({ type: "FOCUS" });
  };

  for (const e of userEvents) target.addEventListener(e, onInput);
  for (const e of focusEvents) target.addEventListener(e, onFocus);
  for (const e of blurEvents) target.addEventListener(e, onBlur);
  target.addEventListener("visibilitychange", onVisibility);

  return () => {
    for (const e of userEvents) target.removeEventListener(e, onInput);
    for (const e of focusEvents) target.removeEventListener(e, onFocus);
    for (const e of blurEvents) target.removeEventListener(e, onBlur);
    target.removeEventListener("visibilitychange", onVisibility);
  };
}
