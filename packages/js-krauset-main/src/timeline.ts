/**
 * Trace event parser — adapted from js-framework-benchmark's timeline.ts.
 *
 * The computation logic is identical to the original. Only the I/O layer is
 * changed: instead of reading trace files from disk, functions accept
 * in-memory trace event arrays.
 *
 * Original: js-framework-benchmark/webdriver-ts/src/timeline.ts
 */
import * as R from "ramda";

// Minimal config — we don't need logging in our test runner
const config = { LOG_DEBUG: false, LOG_DETAILS: false };

interface TimingResult {
  type: string;
  ts: number;
  dur: number;
  end: number;
  pid: number;
  evt?: any;
}

/**
 * @param entries
 * @param startLogicEvent usually "click", but might be "pointerup" if needed
 */
export function extractRelevantEvents(entries: any[], startLogicEvent: string) {
  let filteredEvents: TimingResult[] = [];
  let startLogicEvent_startTS = 0;
  let startLogicEvent_endTS = 0;

  entries.forEach((x) => {
    let e = x;
    if (config.LOG_DEBUG) console.log(JSON.stringify(e));
    if (e.name === "EventDispatch") {
      if (e.args.data.type === startLogicEvent) {
        if (config.LOG_DETAILS) console.log("startLogicEvent", e.args.data.type, +e.ts);
        startLogicEvent_startTS = +e.ts;
        startLogicEvent_endTS = +e.ts + e.dur;
        filteredEvents.push({
          type: "startLogicEvent",
          ts: +e.ts,
          dur: +e.dur,
          end: +e.ts + e.dur,
          pid: e.pid,
          evt: JSON.stringify(e),
        });
      }
      if (e.args.data.type === "click") {
        filteredEvents.push({
          type: "click",
          ts: +e.ts,
          dur: +e.dur,
          end: +e.ts + e.dur,
          pid: e.pid,
          evt: JSON.stringify(e),
        });
      } else if (e.args.data.type === "mousedown") {
        if (config.LOG_DETAILS) console.log("MOUSEDOWN", +e.ts);
        filteredEvents.push({
          type: "mousedown",
          ts: +e.ts,
          dur: +e.dur,
          end: +e.ts + e.dur,
          pid: e.pid,
          evt: JSON.stringify(e),
        });
      } else if (e.args.data.type === "pointerup") {
        if (config.LOG_DETAILS) console.log("POINTERUP", +e.ts);
        filteredEvents.push({
          type: "pointerup",
          ts: +e.ts,
          dur: +e.dur,
          end: +e.ts + e.dur,
          pid: e.pid,
          evt: JSON.stringify(e),
        });
      }
    } else if (e.name === "Layout" && e.ph === "X") {
      if (config.LOG_DETAILS) console.log("Layout", +e.ts, +e.ts + e.dur - startLogicEvent_startTS);
      filteredEvents.push({
        type: "layout",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "FunctionCall" && e.ph === "X") {
      if (config.LOG_DETAILS)
        console.log("FunctionCall", +e.ts, +e.ts + e.dur - startLogicEvent_startTS);
      filteredEvents.push({
        type: "functioncall",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "HitTest" && e.ph === "X") {
      if (config.LOG_DETAILS)
        console.log("HitTest", +e.ts, +e.ts + e.dur - startLogicEvent_startTS);
      filteredEvents.push({
        type: "hittest",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "Commit" && e.ph === "X") {
      if (config.LOG_DETAILS)
        console.log("COMMIT PAINT", +e.ts, +e.ts + e.dur - startLogicEvent_startTS);
      filteredEvents.push({
        type: "commit",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "Paint" && e.ph === "X") {
      if (config.LOG_DETAILS) console.log("PAINT", +e.ts, +e.ts + e.dur - startLogicEvent_startTS);
      filteredEvents.push({
        type: "paint",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "FireAnimationFrame" && e.ph === "X") {
      if (config.LOG_DETAILS)
        console.log("FireAnimationFrame", +e.ts, +e.ts - startLogicEvent_startTS);
      filteredEvents.push({
        type: "fireAnimationFrame",
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "TimerFire" && e.ph === "X") {
      if (config.LOG_DETAILS)
        console.log(
          "TimerFire",
          +e.ts,
          +e.ts - startLogicEvent_startTS,
          +e.ts - startLogicEvent_endTS,
        );
      filteredEvents.push({
        type: "timerFire",
        ts: +e.ts,
        dur: 0,
        end: +e.ts,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    } else if (e.name === "RequestAnimationFrame") {
      if (config.LOG_DETAILS)
        console.log(
          "RequestAnimationFrame",
          +e.ts,
          +e.ts - startLogicEvent_startTS,
          +e.ts - startLogicEvent_endTS,
        );
      filteredEvents.push({
        type: "requestAnimationFrame",
        ts: +e.ts,
        dur: 0,
        end: +e.ts,
        pid: e.pid,
        evt: JSON.stringify(e),
      });
    }
  });
  return filteredEvents;
}

const traceJSEventNames = [
  "EventDispatch",
  "EvaluateScript",
  "v8.evaluateModule",
  "FunctionCall",
  "TimerFire",
  "FireIdleCallback",
  "FireAnimationFrame",
  "RunMicrotasks",
  "V8.Execute",
];

const tracePaintEventNames = [
  "UpdateLayoutTree",
  "Layout",
  "Commit",
  "Paint",
  "Layerize",
  "PrePaint",
  // including "PrePaint" causes longer durations as reported by chrome
];

export function extractRelevantTraceEvents(
  relevantEventNames: string[],
  entries: any[],
  includeClick: boolean,
) {
  let filteredEvents: any[] = [];

  entries.forEach((x) => {
    let e = x;
    if (config.LOG_DEBUG) console.log(JSON.stringify(e));
    if (e.name === "EventDispatch") {
      if (e.args.data.type === "click" && includeClick) {
        if (config.LOG_DETAILS) console.log("CLICK", +e.ts);
        filteredEvents.push({ type: "click", ts: +e.ts, dur: +e.dur, end: +e.ts + e.dur });
      }
    } else if (relevantEventNames.includes(e.name) && e.ph === "X") {
      filteredEvents.push({
        type: e.name,
        ts: +e.ts,
        dur: +e.dur,
        end: +e.ts + e.dur,
        orig: JSON.stringify(e),
      });
    }
  });
  return filteredEvents;
}

function type_eq(...requiredTypes: string[]) {
  return (e: TimingResult) => requiredTypes.includes(e.type);
}

export interface CPUDurationResult {
  tsStart: number;
  tsEnd: number;
  duration: number;
  droppedNonMainProcessCommitEvents: boolean;
  droppedNonMainProcessOtherEvents: boolean;
  maxDeltaBetweenCommits: number;
  numberCommits: number;
  layouts: number;
  raf_long_delay: number;
}

function logEvents(events: TimingResult[], click: TimingResult) {
  events.forEach((e) => {
    console.log("event", e.type, `${e.ts - click.ts} - ${e.end - click.ts}`, e.evt);
  });
}

/**
 * Compute total duration from in-memory trace events.
 * Identical logic to the original computeResultsCPU, but takes trace events
 * directly instead of reading from a file.
 */
export function computeResultsCPU(
  traceEvents: any[],
  startLogicEventName: string,
): CPUDurationResult {
  const perfLogEvents = extractRelevantEvents(traceEvents, startLogicEventName);
  let events = R.sortBy((e: TimingResult) => e.end)(perfLogEvents);

  // Find mousedown event. This is the start of the benchmark
  let mousedowns = R.filter(type_eq("mousedown"))(events);
  // Invariant: There must be exactly one click event
  if (mousedowns.length === 0) {
    // console.log("no mousedown event");
  } else if (mousedowns.length == 1) {
    // console.log("one mousedown event");
  } else if (mousedowns.length > 1) {
    throw "at most one mousedown event is expected";
  }

  // Find click event. This is the start of the benchmark. We're using the synthetic "startLogicEvent" event we've created above
  let clicks = R.filter(type_eq("startLogicEvent"))(events);
  // Invariant: There must be exactly one click event
  if (clicks.length !== 1) {
    console.log("exactly one click event is expected", events);
    throw "exactly one click event is expected";
  }
  let click = clicks[0];

  // check is delay from mousedown to click it unusually long
  if (mousedowns.length > 0) {
    let mousedownToClick = click.ts - mousedowns[0].ts;
    if (mousedownToClick > 5000) {
      console.log("difference between mousedown and click is unusually long", mousedownToClick);
    }
  }

  // The PID for the click event. We're dropping all events from other processes.
  let pid = click.pid;
  let eventsDuringBenchmark = R.filter((e: TimingResult) => e.ts > click.end || e.type === "click")(
    events,
  );
  if (config.LOG_DETAILS) logEvents(eventsDuringBenchmark, click);

  let droppedNonMainProcessCommitEvents = false;
  let droppedNonMainProcessOtherEvents = false;

  let eventsOnMainThreadDuringBenchmark = R.filter((e: TimingResult) => e.pid === pid)(
    eventsDuringBenchmark,
  );
  if (eventsOnMainThreadDuringBenchmark.length !== eventsDuringBenchmark.length) {
    let droppedEvents = R.filter((e: TimingResult) => e.pid !== pid)(events);
    if (R.any((e: TimingResult) => e.type === "commit")(droppedEvents)) {
      droppedNonMainProcessCommitEvents = true;
    }
    if (R.any((e: TimingResult) => e.type !== "commit")(droppedEvents)) {
      droppedNonMainProcessOtherEvents = true;
    }
  }

  let startFrom = R.filter(
    type_eq("click", "fireAnimationFrame", "timerFire", "layout", "functioncall"),
  )(eventsOnMainThreadDuringBenchmark);
  // we're looking for the commit after this event
  let startFromEvent = startFrom.at(-1)!;
  if (config.LOG_DETAILS) console.log("DEBUG: searching for commit event after", startFromEvent);
  let commit = R.find((e: TimingResult) => e.ts > startFromEvent.end)(
    R.filter(type_eq("commit"))(eventsOnMainThreadDuringBenchmark),
  );
  let allCommitsAfterClick = R.filter(type_eq("commit"))(eventsOnMainThreadDuringBenchmark);

  let numberCommits = allCommitsAfterClick.length;
  if (!commit) {
    if (allCommitsAfterClick.length === 0) {
      throw "No commit event found";
    } else {
      commit = allCommitsAfterClick.at(-1)!;
    }
  }
  let maxDeltaBetweenCommits =
    (allCommitsAfterClick.at(-1)!.ts - allCommitsAfterClick[0].ts) / 1000.0;

  let duration = (commit!.end - clicks[0].ts) / 1000.0;
  if (config.LOG_DEBUG) console.log("duration", duration);

  let layouts = R.filter(type_eq("layout"))(eventsOnMainThreadDuringBenchmark);

  // Adjust bogus delay for requestAnimationFrame
  let rafs_withinClick = R.filter((e: TimingResult) => e.ts >= click.ts && e.ts <= click.end)(
    R.filter(type_eq("requestAnimationFrame"))(events),
  );
  let fafs = R.filter((e: TimingResult) => e.ts >= click.ts && e.ts < commit!.ts)(
    R.filter(type_eq("fireAnimationFrame"))(events),
  );

  let raf_long_delay = 0;
  if (rafs_withinClick.length > 0 && fafs.length > 0) {
    let waitDelay = (fafs[0].ts - click.end) / 1000.0;
    if (rafs_withinClick.length == 1 && fafs.length == 1) {
      if (waitDelay > 16) {
        let ignored = false;
        for (let e of layouts) {
          if (e.ts < fafs[0].ts) {
            ignored = true;
            break;
          }
        }
        if (!ignored) {
          raf_long_delay = waitDelay - 16;
          duration = duration - raf_long_delay;
        }
      }
    } else if (fafs.length == 1) {
      throw "Unexpected situation. Did not happen in the past. One fire animation frame, but non consistent request animation frames";
    }
  }

  return {
    tsStart: click.ts,
    tsEnd: commit!.end,
    duration,
    layouts: layouts.length,
    raf_long_delay,
    droppedNonMainProcessCommitEvents,
    droppedNonMainProcessOtherEvents,
    maxDeltaBetweenCommits,
    numberCommits,
  };
}

interface Interval {
  start: number;
  end: number;
  timingResult: TimingResult;
}

function isContained(testIv: Interval, otherIv: Interval) {
  return testIv.start >= otherIv.start && testIv.end <= otherIv.end;
}

function newContainedInterval(outer: TimingResult, intervals: Array<Interval>) {
  let outerIv = { start: outer.ts, end: outer.end, timingResult: outer };
  let cleanedUp: Array<Interval> = [];
  let isContainedRes = intervals.some((iv) => isContained(outerIv, iv));
  if (!isContainedRes) {
    cleanedUp.push(outerIv);
  }

  for (let iv of intervals) {
    if (iv.start < outer.ts || iv.end > outer.end) {
      cleanedUp.push(iv);
    }
  }
  return cleanedUp;
}

export function computeResultsJS(cpuTrace: CPUDurationResult, traceEvents: any[]): number {
  return computeResultsFromTrace(cpuTrace, traceEvents, traceJSEventNames, true);
}

export function computeResultsPaint(cpuTrace: CPUDurationResult, traceEvents: any[]): number {
  return computeResultsFromTrace(cpuTrace, traceEvents, tracePaintEventNames, false);
}

/**
 * Compute script or paint duration from in-memory trace events.
 * Identical logic to the original computeResultsFromTrace, but takes
 * trace events directly instead of reading from a file.
 */
export function computeResultsFromTrace(
  cpuTrace: CPUDurationResult,
  traceEvents: any[],
  relevantTraceEvents: string[],
  includeClick: boolean,
): number {
  const totalDuration = cpuTrace;

  const perfLogEvents = extractRelevantTraceEvents(relevantTraceEvents, traceEvents, includeClick);

  const eventsWithin = R.filter<TimingResult>(
    (e) => e.ts >= totalDuration.tsStart && e.ts <= totalDuration.tsEnd,
  )(perfLogEvents);

  for (let ev of eventsWithin) {
    ev.ts -= totalDuration.tsStart;
    ev.end -= totalDuration.tsStart;
  }

  let intervals: Array<Interval> = [];
  for (let ev of eventsWithin) {
    intervals = newContainedInterval(ev, intervals);
  }
  if (config.LOG_DETAILS) {
    if (intervals.length > 1) {
      console.log(`*** More than 1 interval ${intervals.length}`, intervals);
    } else {
      console.log(`1 interval`, intervals);
    }
  }
  let res = intervals.reduce((p, c) => p + (c.end - c.start), 0) / 1000.0;
  return res;
}
