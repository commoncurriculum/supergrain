import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A field of grains that fills the top of the page. Each grain is its own
// component. The grains inside the name are lighter than the rest. A short
// program, which the reader can edit, runs every tick and changes the store.
// Only the grains whose values changed re-render.

const TICK_MS = 700;
const STEP = 13.5;
const NAME_TONES = ["#ffc93c", "#ffd766", "#ffe59a", "#fff1c4", "#f4b62a"];
const FIELD_TONES = ["#5a2f10", "#6b3a14", "#4d270d", "#744116"];
const DRIFTS = 8;

interface Grain {
  x: number;
  y: number;
  /** True for the grains that spell the word. */
  inName: boolean;
  /** True once the pointer has passed over the grain. */
  picked: boolean;
  /** Degrees this grain is turned. */
  turn: number;
  /** A color to paint over the grain's own, or null. */
  color: string | null;
}

interface Layout {
  width: number;
  height: number;
  size: number;
}

const WIDE: Layout = { width: 1440, height: 500, size: 196 };
const NARROW: Layout = { width: 720, height: 580, size: 196 };
const NAME = "Supergrain";

const field = createReactive({
  layout: WIDE,
  word: NAME,
  grains: [] as Array<Grain>,
  // How many grains rendered because of the last change.
  lastRenders: 0,
  error: "",
});

let renders = 0;
let settle = 0;
let quietUntil = 0;

/** Run a change, then report how many grains React rendered because of it. */
function measure(change: () => void) {
  renders = 0;
  change();
  window.clearTimeout(settle);
  settle = window.setTimeout(() => (field.lastRenders = renders), 120);
}

/** Small, fixed variation per grain, so the field looks the same on every visit. */
const hash = (index: number) => Math.imul(index + 1, 2654435761) >>> 0;

/** One grain per point of a staggered grid. */
function plant(layout: Layout): Array<Grain> {
  const grains: Array<Grain> = [];
  for (let row = 0, y = STEP / 2; y < layout.height; y += STEP * 0.92, row++) {
    for (let x = (row % 2 ? STEP : STEP / 2) - STEP / 4; x < layout.width; x += STEP) {
      grains.push({
        x,
        y,
        inName: false,
        picked: false,
        turn: hash(grains.length) % 360,
        color: null,
      });
    }
  }
  return grains;
}

/** Draw the word on a canvas, then mark each grain that sits inside a letter. */
function spell(word: string) {
  const { layout, grains } = field;
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.textAlign = "center";
  context.textBaseline = "middle";
  // The name breaks over two lines on a narrow screen. Any other word is one line.
  const lines =
    layout === NARROW && word === NAME ? [word.slice(0, 5), word.slice(5)] : [word || " "];
  context.font = `${layout.size}px "Rammetto One"`;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  const size = Math.min(layout.size, (layout.size * layout.width * 0.94) / widest);
  context.font = `${size}px "Rammetto One"`;
  lines.forEach((line, i) => {
    const y = layout.height / 2 + (i - (lines.length - 1) / 2) * size * 1.08 + size * 0.03;
    context.fillText(line, layout.width / 2, y);
  });
  const pixels = context.getImageData(0, 0, layout.width, layout.height).data;
  for (const grain of grains) {
    const inName =
      pixels[(Math.round(grain.y) * layout.width + Math.round(grain.x)) * 4 + 3]! > 128;
    if (grain.inName !== inName) grain.inName = inName;
  }
}

const GrainPiece = tracked(({ index }: { index: number }) => {
  const grain = field.grains[index]!;
  const ref = useRef<SVGPathElement>(null);
  const mounted = useRef(false);
  renders++;
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    ref.current?.animate([{ scale: "3.2" }, { scale: "1" }], {
      duration: 900,
      easing: "cubic-bezier(.2,.7,.3,1)",
    });
  });
  const tones = grain.inName ? NAME_TONES : FIELD_TONES;
  return (
    <g transform={`translate(${grain.x} ${grain.y})`}>
      <path
        ref={ref}
        className="sg-grain"
        onPointerEnter={() => {
          quietUntil = Date.now() + 2500;
          measure(() => (grain.picked = true));
        }}
        d="M0,-7.5 C4.8,-4.3 4.8,4.3 0,7.5 C-4.8,4.3 -4.8,-4.3 0,-7.5Z"
        style={{
          fill: grain.color ?? (grain.picked ? "#ff5a36" : tones[hash(index) % tones.length]),
          rotate: `${grain.turn}deg`,
        }}
      />
    </g>
  );
});

// Grains drift a little in a few interleaved groups, so the field is never
// still. That motion is CSS only and renders nothing.
const Grains = tracked(() => {
  const count = field.grains.length;
  const groups: Array<Array<number>> = Array.from({ length: DRIFTS }, () => []);
  for (let i = 0; i < count; i++) groups[hash(i) % DRIFTS]!.push(i);
  return groups.map((group, g) => (
    <g key={g} className="sg-drift" style={{ "--drift": g } as React.CSSProperties}>
      {group.map((index) => (
        <GrainPiece key={index} index={index} />
      ))}
    </g>
  ));
});

export const GrainField = tracked(() => {
  const { layout } = field;
  useEffect(() => {
    const next = window.matchMedia("(max-width: 719px)").matches ? NARROW : WIDE;
    let cancelled = false;
    void document.fonts.load(`${next.size}px "Rammetto One"`).then(() => {
      if (cancelled) return;
      field.layout = next;
      field.grains = plant(next);
      spell(field.word);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <svg
      className="sg-field"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="A field of grains with a word spelled in lighter grains. Each grain is a component."
    >
      <Grains />
    </svg>
  );
});

type Program = (store: { grains: Array<Grain> }, pick: <T>(list: Array<T>) => T) => void;

const pick = <T,>(list: Array<T>): T => list[Math.floor(Math.random() * list.length)]!;

const PROGRAM = `// Runs every ${TICK_MS} ms. Edit it.
const grain = pick(store.grains);
grain.turn += 200;
grain.color = "#6fc3ee";`;

const EVERY = `// Change every grain. This is the work that
// one useState at the top does on each change.
for (const grain of store.grains) {
  grain.turn += 40;
}`;

const WORD_CODE = `const store = createReactive({ word: "Supergrain", grains });

<input
  value={store.word}
  onChange={(event) => (store.word = event.target.value)}
/>

// When the word changes, each grain is told
// whether it is now inside a letter.
grain.inName = isInside(letters, grain);

// A grain re-renders only if its own value changed.
const Grain = tracked(({ grain }) => (
  <path fill={grain.inName ? light : dark} />
));`;

const POINTER_CODE = `const Grain = tracked(({ grain }) => (
  <path
    fill={grain.picked ? "tomato" : grain.tone}
    onPointerEnter={() => (grain.picked = true)}
  />
));

// No reducer, no selector, no memo. The handler
// writes to the object and that one grain re-renders.`;

type Example = "word" | "pointer" | "program";
const EXAMPLES: Array<{ id: Example; name: string }> = [
  { id: "word", name: "Type a word" },
  { id: "pointer", name: "Touch the field" },
  { id: "program", name: "Write the change" },
];

function compile(code: string): Program | string {
  try {
    // The reader's own code, run in the reader's own browser.
    // oxlint-disable-next-line no-new-func
    return new Function("store", "pick", code) as Program;
  } catch (error) {
    return String(error);
  }
}

const Count = tracked(() => (
  <p className="sg-editor-count" aria-live="off">
    <b>{field.lastRenders.toLocaleString("en-US")}</b> of{" "}
    {field.grains.length.toLocaleString("en-US")} components re-rendered on the last change.
  </p>
));

const Problem = tracked(() =>
  field.error ? <p className="sg-editor-error">{field.error}</p> : null,
);

const WordInput = tracked(() => (
  <label className="sg-editor-word">
    <span>store.word</span>
    <input
      type="text"
      maxLength={14}
      spellCheck={false}
      value={field.word}
      onChange={(event) => {
        quietUntil = Date.now() + 2500;
        measure(() => {
          field.word = event.target.value;
          spell(field.word);
        });
      }}
    />
  </label>
));

export function GrainEditor() {
  const [example, setExample] = useState<Example>("word");
  const [code, setCode] = useState(PROGRAM);
  const [running, setRunning] = useState(true);
  const program = useRef<Program | null>(null);

  useEffect(() => {
    const compiled = compile(code);
    if (typeof compiled === "string") {
      field.error = compiled;
    } else {
      field.error = "";
      program.current = compiled;
    }
  }, [code]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  // Something changes every tick, so the field is never idle. In the last
  // example it is the reader's program. In the others one grain turns, unless
  // the reader has just changed something themselves.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (field.grains.length === 0 || Date.now() < quietUntil) return;
      measure(() => {
        if (example !== "program") {
          pick(field.grains).turn += 200;
          return;
        }
        try {
          program.current?.(field, pick);
        } catch (error) {
          field.error = String(error);
        }
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, example]);

  return (
    <div className="sg-editor">
      <div className="sg-editor-bar">
        <div className="sg-editor-presets" role="tablist" aria-label="Examples">
          {EXAMPLES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={example === item.id}
              onClick={() => setExample(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setRunning(!running)}>
          {running ? "Pause" : "Play"}
        </button>
      </div>
      <Count />
      {example === "word" && (
        <>
          <WordInput />
          <pre>{WORD_CODE}</pre>
        </>
      )}
      {example === "pointer" && (
        <>
          <p className="sg-editor-hint">Move your pointer across the grains above.</p>
          <pre>{POINTER_CODE}</pre>
        </>
      )}
      {example === "program" && (
        <>
          <textarea
            aria-label="The code that changes the field. Edit it."
            spellCheck={false}
            rows={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <p className="sg-editor-hint">
            <button type="button" onClick={() => setCode(PROGRAM)}>
              One grain
            </button>{" "}
            <button type="button" onClick={() => setCode(EVERY)}>
              Every grain
            </button>
          </p>
          <Problem />
        </>
      )}
    </div>
  );
}
