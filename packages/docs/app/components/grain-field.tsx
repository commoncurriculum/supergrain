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
  /** True for the grains that spell the name. */
  inName: boolean;
  /** Degrees this grain is turned. */
  turn: number;
  /** A color to paint over the grain's own, or null. */
  color: string | null;
}

interface Layout {
  width: number;
  height: number;
  size: number;
  lines: Array<{ text: string; y: number }>;
}

const WIDE: Layout = {
  width: 1440,
  height: 500,
  size: 196,
  lines: [{ text: "Supergrain", y: 256 }],
};
const NARROW: Layout = {
  width: 720,
  height: 580,
  size: 196,
  lines: [
    { text: "Super", y: 180 },
    { text: "grain", y: 392 },
  ],
};

const field = createReactive({
  layout: WIDE,
  grains: [] as Array<Grain>,
  // How many grains rendered because of the last run of the program.
  lastRenders: 0,
  error: "",
});

let renders = 0;

/** Small, fixed variation per grain, so the field looks the same on every visit. */
const hash = (index: number) => Math.imul(index + 1, 2654435761) >>> 0;

/** Draw the name on a canvas and keep one grain per grid point, marked if it is inside a letter. */
async function plant(layout: Layout): Promise<Array<Grain>> {
  await document.fonts.load(`${layout.size}px "Rammetto One"`);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.font = `${layout.size}px "Rammetto One"`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const line of layout.lines) context.fillText(line.text, layout.width / 2, line.y);
  const pixels = context.getImageData(0, 0, layout.width, layout.height).data;

  const grains: Array<Grain> = [];
  for (let row = 0, y = STEP / 2; y < layout.height; y += STEP * 0.92, row++) {
    for (let x = (row % 2 ? STEP : STEP / 2) - STEP / 4; x < layout.width; x += STEP) {
      const alpha = pixels[(Math.round(y) * layout.width + Math.round(x)) * 4 + 3]!;
      grains.push({ x, y, inName: alpha > 128, turn: hash(grains.length) % 360, color: null });
    }
  }
  return grains;
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
        d="M0,-7.5 C4.8,-4.3 4.8,4.3 0,7.5 C-4.8,4.3 -4.8,-4.3 0,-7.5Z"
        style={{
          fill: grain.color ?? tones[hash(index) % tones.length],
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
    void plant(next).then((grains) => {
      if (cancelled) return;
      field.layout = next;
      field.grains = grains;
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
      aria-label="A field of grains with the name Supergrain spelled in lighter grains. Each grain is a component."
    >
      <Grains />
    </svg>
  );
});

type Program = (store: { grains: Array<Grain> }, pick: <T>(list: Array<T>) => T) => void;

const pick = <T,>(list: Array<T>): T => list[Math.floor(Math.random() * list.length)]!;

const PRESETS = [
  {
    name: "One grain",
    code: `// Runs every ${TICK_MS} ms. Each grain is a component.
const grain = pick(store.grains);
grain.turn += 200;
grain.color = "#ff5a36";`,
  },
  {
    name: "The name",
    code: `// Turn every grain in the name.
for (const grain of store.grains) {
  if (grain.inName) grain.turn += 40;
}`,
  },
  {
    name: "Every grain",
    code: `// Turn all of them. This is what one
// useState at the top does on every change.
for (const grain of store.grains) {
  grain.turn += 40;
}`,
  },
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
    {field.grains.length.toLocaleString("en-US")} components re-rendered on the last run.
  </p>
));

const Problem = tracked(() =>
  field.error ? <p className="sg-editor-error">{field.error}</p> : null,
);

export function GrainEditor() {
  const [code, setCode] = useState(PRESETS[0]!.code);
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

  useEffect(() => {
    if (!running) return;
    let settle = 0;
    const id = window.setInterval(() => {
      if (field.grains.length === 0 || !program.current) return;
      renders = 0;
      try {
        program.current(field, pick);
      } catch (error) {
        field.error = String(error);
      }
      // Read the count once React has rendered what the program changed.
      settle = window.setTimeout(() => (field.lastRenders = renders), 120);
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(settle);
    };
  }, [running]);

  return (
    <div className="sg-editor">
      <div className="sg-editor-bar">
        <div className="sg-editor-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              aria-pressed={code === preset.code}
              onClick={() => setCode(preset.code)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setRunning(!running)}>
          {running ? "Pause" : "Play"}
        </button>
      </div>
      <textarea
        aria-label="The code that changes the field. Edit it."
        spellCheck={false}
        rows={6}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <Problem />
      <Count />
    </div>
  );
}
