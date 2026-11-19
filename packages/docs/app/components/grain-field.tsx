import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

// A live demo on the homepage. Each grain is its own component. Every tick
// changes one value. With Supergrain, only the grain that read that value
// re-renders. With one useState at the top, every grain re-renders.

const COUNT = 864;
const TICK_MS = 140;

const store = createReactive({
  // Fixed pseudo-random start, so the server and the browser render the same field.
  grains: Array.from({ length: COUNT }, (_, i) => Math.imul(i + 1, 2654435761) >>> 30),
});

let renders = 0;

function useFlash() {
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  renders++;
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    ref.current?.animate([{ backgroundColor: "var(--sg-signal)", transform: "scale(1.5)" }, {}], {
      duration: 700,
      easing: "cubic-bezier(.2,.7,.3,1)",
    });
  });
  return ref;
}

const SupergrainGrain = tracked(({ index }: { index: number }) => {
  const ref = useFlash();
  return <span ref={ref} className="sg-grain" data-v={store.grains[index]} />;
});

function PlainGrain({ value }: { value: number }) {
  const ref = useFlash();
  return <span ref={ref} className="sg-grain" data-v={value} />;
}

const SupergrainField = memo(function SupergrainField({ running }: { running: boolean }) {
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const i = Math.floor(Math.random() * COUNT);
      store.grains[i] = (store.grains[i]! + 1) % 4;
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const grains = [];
  for (let i = 0; i < COUNT; i++) grains.push(<SupergrainGrain key={i} index={i} />);
  return <div className="sg-field">{grains}</div>;
});

const UseStateField = memo(function UseStateField({ running }: { running: boolean }) {
  const [grains, setGrains] = useState(() => [...store.grains]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setGrains((prev) => {
        const next = [...prev];
        const i = Math.floor(Math.random() * COUNT);
        next[i] = (next[i]! + 1) % 4;
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="sg-field">
      {grains.map((value, i) => (
        <PlainGrain key={i} value={value} />
      ))}
    </div>
  );
});

export function GrainField() {
  const [mode, setMode] = useState<"supergrain" | "usestate">("supergrain");
  const [running, setRunning] = useState(true);
  const [perSecond, setPerSecond] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  useEffect(() => {
    renders = 0;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      setPerSecond(Math.round((renders * 1000) / (now - last)));
      renders = 0;
      last = now;
    }, 1000);
    return () => clearInterval(id);
  }, [mode]);

  return (
    <figure className="sg-demo">
      <div className="sg-demo-bar">
        <div className="sg-switch" role="radiogroup" aria-label="State library">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "supergrain"}
            onClick={() => setMode("supergrain")}
          >
            Supergrain
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "usestate"}
            onClick={() => setMode("usestate")}
          >
            One useState
          </button>
        </div>
        <button type="button" className="sg-pause" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Play"}
        </button>
      </div>
      {mode === "supergrain" ? (
        <SupergrainField running={running} />
      ) : (
        <UseStateField running={running} />
      )}
      <figcaption className="sg-demo-caption">
        <span className="sg-count">{running ? perSecond.toLocaleString("en-US") : 0}</span>
        <span>
          component renders per second. Each grain is a component, and one value changes about seven
          times a second. A grain flashes when it renders.
        </span>
      </figcaption>
    </figure>
  );
}
