import { createReactive } from "@supergrain/kernel";
import { tracked, useComputed } from "@supergrain/kernel/react";
import { useEffect } from "react";

// The whole page sits on a field of grains. Each grain is one plain object in
// one array, drawn by its own component. A loop nudges a few of them every
// frame by writing to their objects, so the field moves like cells under a
// microscope, and only the grains that were written to re-render. Click a
// grain to open its object and change it.

const NAME = "Supergrain";
const NAME_TONES = ["#ffc93c", "#ffd766", "#ffe59a", "#fff1c4", "#f4b62a"];
const FIELD_TONES = ["#5a2f10", "#6b3a14", "#4d270d", "#744116"];
export const SWATCHES = ["#ffc93c", "#ff5a36", "#6fc3ee", "#8fd16a", "#fff4d8"];
/** The most grains the field will plant. Bigger screens get bigger spacing. */
const MOST = 4500;
/** How far a grain wanders from its spot, in pixels. */
const WANDER = 5;
/** How close the pointer has to be to push a grain, and how hard it pushes. */
const REACH = 90;
const PUSH = 26;
/** A grain takes this many frames to glide to its next spot. */
const GLIDE = 24;
/** The share of the field that is gliding at any moment, at speed 1. */
const BUSY = 0.045;
const DRIFTS = 12;

export interface Grain {
  /** Where the grain was planted. */
  x: number;
  y: number;
  /** How far it has drifted from there. */
  dx: number;
  dy: number;
  /** Degrees it is turned. */
  turn: number;
  color: string;
  size: number;
  /** A pinned grain is left alone by the loop. */
  pinned: boolean;
}

const field = createReactive({
  width: 0,
  height: 0,
  grains: [] as Array<Grain>,
  /** Index of the grain whose object is open, or -1. */
  selected: -1,
  /** 0 stops the loop. 1 is the normal pace. */
  speed: 1,
  /** Measured twice a second. */
  rendersPerFrame: 0,
  framesPerSecond: 0,
});

let renders = 0;

const hash = (index: number) => Math.imul(index + 1, 2654435761) >>> 0;
const round = (value: number) => Math.round(value * 10) / 10;

/** Plant one grain per point of a loose grid. Grains inside the name get the lighter colors. */
function plant(width: number, height: number): Array<Grain> {
  const step = Math.max(16, Math.sqrt((width * height) / MOST));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = width < 720 ? [NAME.slice(0, 5), NAME.slice(5)] : [NAME];
  context.font = "900 100px Geist";
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  const size = Math.min((100 * width * 0.92) / widest, height * 0.3);
  context.font = `900 ${size}px Geist`;
  lines.forEach((line, i) => {
    context.fillText(line, width / 2, height * 0.28 + (i - (lines.length - 1) / 2) * size * 0.95);
  });
  const pixels = context.getImageData(0, 0, width, height).data;

  const grains: Array<Grain> = [];
  for (let row = 0, y = step / 2; y < height; y += step * 0.9, row++) {
    for (let x = row % 2 ? step : step / 2; x < width; x += step) {
      const seed = hash(grains.length);
      const inName = pixels[(Math.round(y) * width + Math.round(x)) * 4 + 3]! > 128;
      const tones = inName ? NAME_TONES : FIELD_TONES;
      grains.push({
        x: round(x + ((seed % 7) - 3) * 0.5),
        y: round(y + (((seed >>> 3) % 7) - 3) * 0.5),
        dx: 0,
        dy: 0,
        turn: seed % 360,
        color: tones[seed % tones.length]!,
        size: round((step / 15) * (inName ? 1.25 : 1)),
        pinned: false,
      });
    }
  }
  return grains;
}

const GrainPiece = tracked(({ index }: { index: number }) => {
  const grain = field.grains[index]!;
  // True for one grain. A new selection re-renders two grains, not all of them.
  const open = useComputed(() => field.selected === index);
  renders++;
  return (
    <path
      className={open ? "sg-cell sg-cell-open" : "sg-cell"}
      data-index={index}
      d="M0,-8 C5.2,-4.6 5.2,4.6 0,8 C-5.2,4.6 -5.2,-4.6 0,-8Z"
      style={{
        translate: `${grain.x + grain.dx}px ${grain.y + grain.dy}px`,
        rotate: `${grain.turn}deg`,
        scale: grain.size,
        fill: grain.color,
      }}
    />
  );
});

// The whole field also sways a little, in a few interleaved groups. That part
// is CSS and renders nothing.
const Grains = tracked(() => {
  const groups: Array<Array<number>> = Array.from({ length: DRIFTS }, () => []);
  for (let i = 0; i < field.grains.length; i++) groups[hash(i) % DRIFTS]!.push(i);
  return groups.map((group, drift) => (
    <g key={drift} className="sg-drift" style={{ "--drift": drift } as React.CSSProperties}>
      {group.map((index) => (
        <GrainPiece key={index} index={index} />
      ))}
    </g>
  ));
});

/**
 * The loop. A share of the grains is gliding at any moment. Each frame it
 * moves those a step closer to where they are going, by assigning to their
 * objects, and starts a few more. Nothing else on the page is touched.
 */
function live() {
  const pointer = { x: -1000, y: -1000, moved: false };
  const onMove = (event: PointerEvent) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.moved = true;
  };
  window.addEventListener("pointermove", onMove);

  // Where each gliding grain is going. These are the loop's own notes, not state.
  let gliding: Array<number> = [];
  let goal = { dx: new Float32Array(0), dy: new Float32Array(0), turn: new Float32Array(0) };
  let left = new Uint8Array(0);
  const start = (index: number, dx: number, dy: number, turn: number) => {
    if (left[index] === 0) gliding.push(index);
    left[index] = GLIDE;
    goal.dx[index] = dx;
    goal.dy[index] = dy;
    goal.turn[index] = turn;
  };

  let cursor = 0;
  let owed = 0;
  let frames = 0;
  let since = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    frame = requestAnimationFrame(tick);
    const { grains, speed } = field;
    frames++;
    if (now - since >= 500) {
      field.rendersPerFrame = Math.round(renders / frames);
      field.framesPerSecond = Math.round((frames * 1000) / (now - since));
      renders = 0;
      frames = 0;
      since = now;
    }
    if (left.length !== grains.length) {
      gliding = [];
      left = new Uint8Array(grains.length);
      goal = {
        dx: new Float32Array(grains.length),
        dy: new Float32Array(grains.length),
        turn: new Float32Array(grains.length),
      };
    }
    if (grains.length === 0) return;

    // Start a few more. The step is prime, so neighbors do not start together.
    owed += ((grains.length * BUSY) / GLIDE) * speed;
    for (; owed >= 1; owed--) {
      cursor = (cursor + 7919) % grains.length;
      const grain = grains[cursor]!;
      if (grain.pinned || left[cursor] !== 0) continue;
      start(
        cursor,
        (Math.random() * 2 - 1) * WANDER,
        (Math.random() * 2 - 1) * WANDER,
        grain.turn + (Math.random() * 2 - 1) * 30,
      );
    }

    // Grains near the pointer head away from it.
    if (pointer.moved) {
      pointer.moved = false;
      for (let i = 0; i < grains.length; i++) {
        const grain = grains[i]!;
        const awayX = grain.x - pointer.x;
        const awayY = grain.y - pointer.y;
        const distance = Math.hypot(awayX, awayY);
        if (distance > REACH || distance === 0 || grain.pinned) continue;
        const push = ((REACH - distance) / REACH) * PUSH;
        start(i, (awayX / distance) * push, (awayY / distance) * push, grain.turn);
      }
    }

    // Move every gliding grain one step closer.
    let kept = 0;
    for (const index of gliding) {
      const grain = grains[index]!;
      const share = 1 / left[index]!;
      grain.dx = round(grain.dx + (goal.dx[index]! - grain.dx) * share);
      grain.dy = round(grain.dy + (goal.dy[index]! - grain.dy) * share);
      grain.turn = round(grain.turn + (goal.turn[index]! - grain.turn) * share);
      if (--left[index]! > 0) gliding[kept++] = index;
    }
    gliding.length = kept;
  });

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
  };
}

export const GrainField = tracked(() => {
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sow = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // A phone's address bar changes the height while scrolling. Keep the field.
      if (width === field.width && Math.abs(height - field.height) < 160) return;
      field.width = width;
      field.height = height;
      field.grains = plant(width, height);
      // Open a grain in the name, so the panel has an object to show.
      field.selected = field.grains.findIndex(
        (grain) => grain.x > width * 0.3 && NAME_TONES.includes(grain.color),
      );
    };

    void document.fonts.load("900 100px Geist").then(() => {
      if (cancelled) return;
      sow();
      if (!still) stop = live();
    });
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sow, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      stop();
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <svg
      className="sg-field"
      width={field.width}
      height={field.height}
      role="img"
      aria-label="A field of grains that drift slowly. The name Supergrain is spelled in lighter grains."
      onClick={(event) => {
        const index = (event.target as SVGElement).dataset.index;
        if (index !== undefined) field.selected = Number(index);
      }}
    >
      <Grains />
    </svg>
  );
});

/** The open grain's own object, printed as it is. Three of its values can be changed here. */
export const GrainInspector = tracked(() => {
  const index = field.selected;
  const grain = field.grains[index];
  if (!grain) return <div className="sg-inspector" />;
  return (
    <div className="sg-inspector">
      <p className="sg-inspector-title">
        <code>store.grains[{index}]</code>
        <span>Click any grain to open its object.</span>
      </p>
      <dl>
        <dt>x</dt>
        <dd>{grain.x}</dd>
        <dt>y</dt>
        <dd>{grain.y}</dd>
        <dt>dx</dt>
        <dd>{grain.dx}</dd>
        <dt>dy</dt>
        <dd>{grain.dy}</dd>
        <dt>turn</dt>
        <dd>{grain.turn}</dd>
        <dt>color</dt>
        <dd>
          <span className="sg-swatches" role="radiogroup" aria-label="color">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={grain.color === color}
                aria-label={color}
                style={{ background: color }}
                onClick={() => (grain.color = color)}
              />
            ))}
          </span>
          <span className="sg-inspector-value">"{grain.color}"</span>
        </dd>
        <dt>size</dt>
        <dd>
          <input
            type="range"
            aria-label="size"
            min={0.5}
            max={6}
            step={0.1}
            value={grain.size}
            onChange={(event) => (grain.size = Number(event.target.value))}
          />
          <span className="sg-inspector-value">{round(grain.size)}</span>
        </dd>
        <dt>pinned</dt>
        <dd>
          <label>
            <input
              type="checkbox"
              checked={grain.pinned}
              onChange={(event) => (grain.pinned = event.target.checked)}
            />
            <span className="sg-inspector-value">{String(grain.pinned)}</span>
          </label>
        </dd>
      </dl>
    </div>
  );
});

/** What the page is doing right now, measured. */
export const GrainStats = tracked(() => (
  <p className="sg-stats" aria-live="off">
    <span>
      <b>{field.grains.length.toLocaleString("en-US")}</b> objects on this page
    </span>
    <span>
      <b>{field.rendersPerFrame.toLocaleString("en-US")}</b> components re-render per frame
    </span>
    <span>
      <b>{field.framesPerSecond}</b> frames a second
    </span>
  </p>
));

export const SpeedControl = tracked(() => (
  <label className="sg-speed">
    <code>store.speed = {field.speed}</code>
    <input
      type="range"
      aria-label="speed"
      min={0}
      max={4}
      step={0.5}
      value={field.speed}
      onChange={(event) => (field.speed = Number(event.target.value))}
    />
  </label>
));
