import { useRef } from "react";

import { Bowl, Burst, PIECE_COUNT } from "@/components/cereal-bowl";

// The cereal box on the homepage. It is a real 3D box built from five faces.
// The bowl printed on the front is the live demo. Drag the box, or use the
// arrow keys, to turn it and read the other sides.

const START_TURN = -33;

export function CerealBox() {
  const box = useRef<HTMLDivElement>(null);
  const turn = useRef(START_TURN);
  const drag = useRef<{ x: number; turn: number } | null>(null);

  // The turn is written straight to the element, so turning the box renders nothing.
  const setTurn = (degrees: number) => {
    turn.current = degrees;
    box.current?.style.setProperty("--turn", `${degrees}deg`);
  };

  return (
    <div
      className="sg-box-scene"
      tabIndex={0}
      role="group"
      aria-label="A box of Supergrain cereal. Drag it, or press the left and right arrow keys, to turn it."
      onPointerDown={(event) => {
        if ((event.target as Element).closest("button, a")) return;
        drag.current = { x: event.clientX, turn: turn.current };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) setTurn(drag.current.turn + (event.clientX - drag.current.x) * 0.6);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setTurn(turn.current - 30);
        else if (event.key === "ArrowRight") setTurn(turn.current + 30);
      }}
    >
      <div ref={box} className="sg-box">
        <div className="sg-box-face sg-box-front">
          <p className="sg-box-name">
            <span>Super</span>
            <span>grain</span>
          </p>
          <p className="sg-ribbon">Reactive state for React</p>
          <Burst />
          <Bowl />
        </div>

        <div className="sg-box-face sg-box-right">
          <div className="sg-facts">
            <p className="sg-facts-title">Render Facts</p>
            <p>
              Serving size: 1 changed value
              <br />
              Pieces in this bowl: {PIECE_COUNT}
            </p>
            <dl>
              <div className="sg-facts-main">
                <dt>Re-renders per serving</dt>
                <dd>1</dd>
              </div>
              <div>
                <dt>Reducers</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Selectors</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Generics to write</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Benchmark score</dt>
                <dd>1.52</dd>
              </div>
              <div className="sg-facts-sub">
                <dt>plain useState</dt>
                <dd>1.52</dd>
              </div>
            </dl>
            <p>Ingredients: kernel, husk, silo, queries, mill.</p>
          </div>
        </div>

        <div className="sg-box-face sg-box-back">
          <p className="sg-box-back-title">How to prepare</p>
          <ol>
            <li>
              Add it.
              <code>pnpm add @supergrain/kernel</code>
            </li>
            <li>
              Make some state.
              <code>{"const todo = useReactive({ done: false })"}</code>
            </li>
            <li>
              Change it. Only the components that read it re-render.
              <code>todo.done = true</code>
            </li>
          </ol>
        </div>

        <div className="sg-box-face sg-box-left">
          <span>Supergrain</span>
        </div>
        <div className="sg-box-face sg-box-top" />
      </div>
    </div>
  );
}
