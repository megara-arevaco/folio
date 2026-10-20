import { useLayoutEffect, useState, type RefObject } from "react";

export function useDocumentOffset(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const update = () => setOffset(ref.current ? ref.current.getBoundingClientRect().top + window.scrollY : 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    observer.observe(ref.current);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [ref, enabled]);
  return offset;
}
