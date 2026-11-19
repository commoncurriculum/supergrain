import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

// The live demo on the homepage: a bowl of cereal seen from above. Each piece
// is its own component. Every tick changes one value. With Supergrain, only
// the piece that read that value re-renders. With one useState at the top,
// every piece re-renders.

const TICK_MS = 700;
const TONES = ["#e3a43a", "#d99530", "#eab651", "#cf8a2a"];

interface Spot {
  x: number;
  y: number;
  tone: string;
}

// A fixed pseudo-random layout, so the server and the browser draw the same bowl.
function layout(): Array<Spot> {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots: Array<Spot> = [];
  for (let tries = 0; spots.length < 240 && tries < 20000; tries++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 196;
    const x = Math.round(250 + Math.cos(angle) * radius);
    const y = Math.round(250 + Math.sin(angle) * radius);
    if (spots.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < 19 * 19)) continue;
    spots.push({ x, y, tone: TONES[Math.floor(random() * TONES.length)]! });
  }
  return spots;
}

const SPOTS = layout();
export const PIECE_COUNT = SPOTS.length;

const store = createReactive({
  // How far each piece is turned, in steps of 47 degrees.
  turns: SPOTS.map((_, i) => Math.imul(i + 1, 2654435761) >>> 29),
  // How many pieces rendered because of the last change.
  lastRenders: 1,
});

let renders = 0;

function useFlash() {
  const ref = useRef<SVGGElement>(null);
  const mounted = useRef(false);
  renders++;
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    ref.current?.animate(
      [{ scale: "1.9", color: "#ffe14d", stroke: "#e8432a", strokeWidth: "3px" }, {}],
      { duration: 650, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
  });
  return ref;
}

function Piece({ spot, turn }: { spot: Spot; turn: number }) {
  const ref = useFlash();
  return (
    <g transform={`translate(${spot.x} ${spot.y})`}>
      <g ref={ref} className="sg-piece" style={{ color: spot.tone, rotate: `${turn * 47}deg` }}>
        <path d="M0,-14 C9,-8 9,8 0,14 C-9,8 -9,-8 0,-14Z" fill="currentColor" />
        <path d="M0,-9 Q2.5,0 0,9" fill="none" />
      </g>
    </g>
  );
}

const SupergrainPiece = tracked(({ index }: { index: number }) => (
  <Piece spot={SPOTS[index]!} turn={store.turns[index]!} />
));

function useTick(running: boolean, change: (index: number) => void) {
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (renders > 0) store.lastRenders = renders;
      renders = 0;
      change(Math.floor(Math.random() * PIECE_COUNT));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, change]);
}

const changeStore = (index: number) => {
  store.turns[index]!++;
};

const SupergrainPieces = memo(function SupergrainPieces({ running }: { running: boolean }) {
  useTick(running, changeStore);
  return SPOTS.map((_, i) => <SupergrainPiece key={i} index={i} />);
});

const UseStatePieces = memo(function UseStatePieces({ running }: { running: boolean }) {
  const [turns, setTurns] = useState(() => [...store.turns]);
  const [change] = useState(() => (index: number) => {
    setTurns((prev) => {
      const next = [...prev];
      next[index]!++;
      return next;
    });
  });
  useTick(running, change);
  return turns.map((turn, i) => <Piece key={i} spot={SPOTS[i]!} turn={turn} />);
});

// The sticker on the bowl. It shows how many pieces rendered on the last change.
const Burst = tracked(() => {
  const count = store.lastRenders;
  return (
    <div className="sg-burst" aria-live="off">
      <svg viewBox="-100 -100 200 200" aria-hidden="true">
        <polygon points={BURST_POINTS} />
      </svg>
      <p>
        <b className={count > 9 ? "sg-burst-many" : undefined}>{count}</b>
        <span>{count === 1 ? "re-render" : "re-renders"}</span>
        <span>per change</span>
      </p>
    </div>
  );
});

const BURST_POINTS = Array.from({ length: 36 }, (_, i) => {
  const radius = i % 2 ? 78 : 97;
  const angle = (i * Math.PI) / 18;
  return `${Math.round(Math.cos(angle) * radius)},${Math.round(Math.sin(angle) * radius)}`;
}).join(" ");

export function CerealBowl() {
  const [mode, setMode] = useState<"supergrain" | "usestate">("supergrain");
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  const pick = (next: "supergrain" | "usestate") => {
    renders = 0;
    store.lastRenders = next === "supergrain" ? 1 : PIECE_COUNT;
    setMode(next);
  };

  return (
    <figure className="sg-demo">
      <div className="sg-bowl">
        <svg
          viewBox="0 0 500 500"
          role="img"
          aria-label="A bowl of cereal. Each piece is a component."
        >
          <circle cx="262" cy="266" r="234" className="sg-bowl-shadow" />
          <circle cx="250" cy="250" r="244" className="sg-bowl-edge" />
          <circle cx="250" cy="250" r="238" className="sg-bowl-rim" />
          <circle cx="250" cy="250" r="212" className="sg-bowl-milk" />
          {mode === "supergrain" ? (
            <SupergrainPieces running={running} />
          ) : (
            <UseStatePieces running={running} />
          )}
        </svg>
        <Burst />
      </div>
      <figcaption className="sg-demo-bar">
        <div className="sg-switch" role="radiogroup" aria-label="How the bowl keeps its state">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "supergrain"}
            onClick={() => pick("supergrain")}
          >
            Supergrain
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "usestate"}
            onClick={() => pick("usestate")}
          >
            One useState
          </button>
        </div>
        <button type="button" className="sg-pause" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Play"}
        </button>
      </figcaption>
    </figure>
  );
}
