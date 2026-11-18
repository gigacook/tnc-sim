import { useEffect, useRef, type PointerEvent } from 'react';

/** how far the knob travels from the middle, in px (the base is 132 px, the knob 56 px: play.css) */
const TRAVEL = 38;

/**
 * The thumb pad for walking on a touch screen: push the knob the way you want to go. Looking around is a
 * drag anywhere else on the floor. It is a pointer-only control and hidden from assistive technology: the
 * station list does everything it does, by keyboard and by screen reader. Hidden where the pointer is a mouse.
 */
export function Pad({ onMove }: { onMove(x: number, y: number): void }) {
  const knob = useRef<HTMLSpanElement>(null);
  const finger = useRef(-1);
  const move = useRef(onMove);
  move.current = onMove;

  const put = (x: number, y: number) => {
    if (knob.current) knob.current.style.transform = `translate(${x * TRAVEL}px, ${-y * TRAVEL}px)`;
    move.current(x, y);
  };
  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / TRAVEL;
    let y = -(e.clientY - (r.top + r.height / 2)) / TRAVEL;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    put(x, y);
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== finger.current) return;
    finger.current = -1;
    put(0, 0);
  };
  // the pad goes away when a panel opens: nobody is walking then
  useEffect(() => () => move.current(0, 0), []);

  return (
    <div
      className="pad"
      aria-hidden="true"
      onPointerDown={(e) => {
        if (finger.current !== -1) return;
        finger.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        follow(e);
      }}
      onPointerMove={(e) => e.pointerId === finger.current && follow(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span ref={knob} className="pad-knob" />
    </div>
  );
}
