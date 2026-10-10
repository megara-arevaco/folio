---
name: Folio — Loquet editorial
description: Interfaz marfil y piedra, tipografía editorial y acentos ocre mate, basada en Loquet Contact 1.
colors:
  canvas: "#f9f5ed"
  surface: "#f1ede6"
  control: "#ebe5da"
  ink: "#111111"
  text: "#25231f"
  text-muted: "#625d54"
  text-faint: "#6b6459"
  rule: "#dcd5c9"
  rule-strong: "#b5aca3"
  accent: "#ad9a6d"
  accent-deep: "#6f603e"
  accent-content: "#ffffff"
typography:
  display:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "clamp(2.75rem, 4.5vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Libre Caslon Display, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Jost, Avenir Next, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  book-title:
    fontFamily: "Jost, Avenir Next, Arial, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "Jost, Avenir Next, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
  compact:
    fontFamily: "Jost, Avenir Next, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Jost, Avenir Next, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "SFMono-Regular, Roboto Mono, JetBrains Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "3px"
  panel: "3px"
  cover: "3px"
  chip: "999px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"
---

# Folio — Loquet editorial

## Dirección y referencia

El usuario pidió rediseñar las cinco secciones con una adaptación muy fiel de https://demo.gloriathemes.com/loquet/demo/contact-1/. Se toman su fondo marfil continuo, bloques piedra, tinta negra, ocre mate, titulares serif ligeros, espaciado amplio y esquinas de 3px. Se elimina el marco nogal anterior.

Folio sigue siendo una herramienta local de trabajo: no añade mapas, fotografías, formularios de contacto ni contenido comercial de la referencia. Conserva sus funciones, rutas, textos y organización operativa. La escena de uso es una sesión prolongada preparando ebooks en casa con iluminación normal; las superficies claras mantienen legibles formularios y tablas.

## Tipografía

Loquet usa Futura PT, Poynter Oldstyle Display y Orpheus Pro. La adaptación usa Jost para controles y texto y Libre Caslon Display para marca y títulos, alternativas abiertas alojadas en `apps/web/public/fonts/`. No se requieren Adobe Fonts ni peticiones externas en ejecución. Los títulos de libros, navegación y campos mantienen la voz UI para favorecer la lectura rápida.

## Composición

- Aplicación a todo el ancho, sin borde exterior ni sombra.
- Cabecera horizontal marfil con regla fina; contenedor máximo de 88rem y altura de 7rem en escritorio.
- Marca serif a la izquierda, navegación de cinco destinos a la derecha. Ruta activa con subrayado ocre, no solo un cambio de color.
- Área de trabajo con máximo de 88rem y padding de 4.5rem arriba, 3rem lateral y 5rem abajo.
- Titular de 44–72px, seguido de bloques operativos piedra con padding fluido de 24–48px.
- Entrada de archivo antes de la cola; metadatos conserva portada y formulario; dispositivo conserva su tabla; lecturas conserva sus portadas de 136 × 204px y grupos mensuales.

## Controles y estados

Botones y campos de 44px con esquinas de 3px. Acción primaria ocre con texto negro; hover ocre oscuro con texto blanco. El ocre claro no se utiliza para texto esencial sobre marfil. Controles primarios deshabilitados usan fondo piedra y texto secundario. Selección, placeholders y caret siguen la paleta.

Éxito y foco mantienen verde oscuro; error conserva rojo. Los estados funcionales siguen diferenciados de la marca. El foco visible usa contorno de 2px y separación de 3px. Las transiciones duran 180ms; `prefers-reduced-motion` elimina movimiento no esencial. El gesto distintivo une subrayado de navegación y respuesta tonal de la zona de archivo al arrastrar.

## Responsive

Hasta 1180px la navegación pasa al menú desplegable. Hasta 1080px el editor de metadatos se apila. Hasta 760px la cabecera mide 62px, el contenido tiene 24px de margen lateral, los títulos miden 44px y las tablas pasan a registros etiquetados. No se estiran las portadas para rellenar espacio.

## Revisión realizada

TypeScript y build de Vite correctos. Capturas de las cinco rutas a 1440px y 390px inspeccionadas en `.impeccable/review/`: sin desbordamiento horizontal, menú móvil funcional y jerarquía consistente. Veredicto: adaptación visual coherente con la referencia; no es una copia exacta de sus fuentes comerciales ni de su composición de contacto. La revisión cubre estados iniciales, no valida conversiones reales, un e-reader conectado ni datos poblados.

## Evitar

Marco nogal, píldoras en campos y botones ordinarios, glassmorphism, gradientes decorativos, sombras anchas, mapas o fotografías de relleno y tipografía serif en controles densos.
