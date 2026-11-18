import { useEffect, useRef, useState } from 'react';

/** A menu behind a toggle button: its open state, the button's ref, and Esc closes it and hands the focus back to the button. */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return { open, setOpen, toggle };
}
