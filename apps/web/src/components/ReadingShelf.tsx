import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ReadingBook } from "../services/readingLog";

import { bookColor } from "./ReadingBookCover";

/** A small, demand-rendered scene. The HTML collection remains the accessible source of truth. */
export default function ReadingShelf({ books, selectedId, onSelect }: {
  books: ReadingBook[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    let disposed = false;
    let frame = 0;
    let visible = true;
    let remaining = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const textures: THREE.Texture[] = [];
    const images: HTMLImageElement[] = [];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 3.4, 9);
    camera.lookAt(0, 1.1, 0);
    scene.add(new THREE.HemisphereLight(0xfff8e8, 0x9b8770, 2.2));
    const sun = new THREE.DirectionalLight(0xffeddb, 2.4);
    sun.position.set(-4, 8, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -6 });
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(20, 0.14, 2.4), new THREE.MeshStandardMaterial({ color: 0xb19e82, roughness: 0.95 }));
    shelf.position.y = -0.14;
    shelf.receiveShadow = true;
    scene.add(shelf);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.24;
    floor.receiveShadow = true;
    scene.add(floor);

    const active = Math.max(0, books.findIndex(book => book.id === selectedId));
    const displayed = books.slice(Math.max(0, active - 4), active + 5);
    const targets: { group: THREE.Group; baseY: number; id: string }[] = [];
    const hits: THREE.Object3D[] = [];
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let hovered: string | null = null;
    let targetCameraX = 0;

    function draw() {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      camera.position.x += (targetCameraX - camera.position.x) * 0.12;
      camera.lookAt(0, 1.1, 0);
      for (const item of targets) {
        const y = item.baseY + (hovered === item.id ? 0.12 : 0);
        item.group.position.y = reduced.matches ? y : THREE.MathUtils.lerp(item.group.position.y, y, 0.15);
      }
      renderer.render(scene, camera);
      if (--remaining > 0) frame = requestAnimationFrame(draw);
    }
    function invalidate() {
      remaining = reduced.matches ? 1 : 35;
      if (!frame && !disposed && visible && !document.hidden) frame = requestAnimationFrame(draw);
    }
    for (const book of displayed) {
      const index = books.indexOf(book) - active;
      const chosen = index === 0;
      const color = bookColor(book.title);
      const group = new THREE.Group();
      const height = chosen ? 2.9 : 2.5;
      group.position.set(index * 1.8, height / 2, -Math.abs(index) * 0.2);
      group.rotation.y = chosen ? -0.13 : -Math.sign(index) * 0.28;
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 768;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 768);
      ctx.strokeStyle = "#eadcc0"; ctx.lineWidth = 2; ctx.strokeRect(32, 32, 448, 704);
      ctx.fillStyle = "#f6edd9"; ctx.font = "20px sans-serif";
      ctx.fillText("F O L I O  /  B I B L I O T E C A", 55, 90);
      ctx.font = "44px Georgia";
      const words = book.title.split(/\s+/);
      let line = ""; let y = 245;
      for (const word of words) {
        if (ctx.measureText(`${line} ${word}`).width > 395 && line) {
          ctx.fillText(line, 55, y, 400); y += 57; line = "";
        }
        if (y > 530) break;
        line += `${line ? " " : ""}${word}`;
      }
      ctx.fillText(line, 55, y, 400);
      ctx.font = "22px sans-serif"; ctx.fillText(book.authors.join(", ") || "Autor desconocido", 55, 659, 395);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures.push(texture);
      const coverMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 });
      const binding = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      const pages = new THREE.Mesh(new THREE.BoxGeometry(1.56, height - 0.09, 0.26), new THREE.MeshStandardMaterial({ color: 0xf1e9d6, roughness: 1 }));
      group.add(pages);
      const front = new THREE.Mesh(new THREE.BoxGeometry(1.64, height, 0.045), [binding, binding, binding, binding, coverMaterial, binding]);
      front.position.z = 0.155; front.castShadow = true;
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.64, height, 0.045), binding);
      back.position.z = -0.155;
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.065, height, 0.34), binding);
      spine.position.x = -0.8;
      group.add(front, back, spine);
      for (let line = 0; line < 9; line++) {
        const pageLine = new THREE.Mesh(new THREE.BoxGeometry(0.006, height - 0.12, 0.003), new THREE.MeshStandardMaterial({ color: 0xcfc3ae }));
        pageLine.position.set(0.785, 0, -0.11 + line * 0.026);
        group.add(pageLine);
      }
      group.traverse(object => { object.userData.bookId = book.id; });
      scene.add(group); hits.push(group); targets.push({ group, baseY: height / 2, id: book.id });
      if (book.coverUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (disposed) return;
          ctx.drawImage(img, 0, 0, 512, 768);
          texture.needsUpdate = true; invalidate();
        };
        // The generated cloth cover remains when a host does not permit texture loading.
        img.src = book.coverUrl; images.push(img);
      }
    }
    function hit(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(hits, true)[0]?.object.userData.bookId as string | undefined;
    }
    function move(event: PointerEvent) {
      hovered = hit(event) ?? null;
      targetCameraX = reduced.matches ? 0 : pointer.x * 0.28;
      renderer.domElement.style.cursor = hovered ? "pointer" : "default";
      invalidate();
    }
    function leave() { hovered = null; targetCameraX = 0; invalidate(); }
    function click(event: PointerEvent) { const id = hit(event); if (id) select.current(id); }
    function lost(event: Event) { event.preventDefault(); setUnavailable(true); }
    function resize() {
      const width = element!.clientWidth; const height = element!.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.position.z = width < 600 ? 10 : 9;
      camera.updateProjectionMatrix(); invalidate();
    }
    const observer = new ResizeObserver(resize); observer.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) invalidate(); });
    intersection.observe(element);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("pointerup", click);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", invalidate);
    reduced.addEventListener("change", leave);
    resize();
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      observer.disconnect(); intersection.disconnect();
      document.removeEventListener("visibilitychange", invalidate);
      reduced.removeEventListener("change", leave);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      images.forEach(img => { img.onload = null; });
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
        }
      });
      materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
      sun.shadow.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [books, selectedId]);

  return <div className="reading-shelf-canvas" ref={host} data-unavailable={unavailable} aria-hidden="true">
    {unavailable ? <div className="reading-shelf-fallback">{books.slice(0, 7).map(book => <span key={book.id} style={{ background: bookColor(book.title) }}>{book.title}</span>)}</div> : null}
  </div>;
}
