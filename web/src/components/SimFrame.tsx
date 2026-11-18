import { useEffect, useRef, useState } from 'react';
import type { Machine, Tool } from '../lib/types';

/** What the simulator (bridge.js) tells the app. */
export type SimMessage =
  | { type: 'tnc:ready' }
  | { type: 'tnc:changed'; name: string; machine: Machine; text: string }
  | { type: 'tnc:selected'; name: string; machine: Machine }
  | { type: 'tnc:program'; id: string; name: string; machine: Machine; text: string };

interface Props {
  /** Opened as soon as the simulator says it is ready (and again whenever it changes identity). */
  program?: { name: string; text: string; machine: Machine; tools?: Tool[] } | null;
  onMessage?: (m: SimMessage) => void;
}

/**
 * The single-file simulator served by tnc-server at /sim/, in an iframe on the same origin.
 * bridge.js inside it only accepts messages from this exact parent and origin, and we only
 * accept messages from this exact frame and origin.
 */
export function SimFrame({ program, onMessage }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const post = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, location.origin);

  useEffect(() => {
    function listen(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as SimMessage;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      // any answer proves the bridge is listening (covers a 'tnc:ready' sent before we were)
      if (m.type === 'tnc:ready' || m.type === 'tnc:program') setReady(true);
      onMessageRef.current?.(m);
    }
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  // open the program when the sim is ready or a different program is handed in
  const key = program ? `${program.machine}:${program.name}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is deliberately not a dependency: edits flow the other way while the sim is open
  useEffect(() => {
    if (ready && program) post({ type: 'tnc:open', ...program });
  }, [ready, key]);

  return (
    <div className="simframe">
      {!ready && <div className="simframe-loading">Loading the simulator…</div>}
      <iframe
        ref={frame}
        src="/sim/"
        title="TNC simulator"
        allow="fullscreen; clipboard-read; clipboard-write"
        onLoad={() => post({ type: 'tnc:get', id: 'hello' })}
      />
    </div>
  );
}
