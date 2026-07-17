---
name: EPUB Translator — Biblioteca Taller
description: Un taller editorial claro, inspirado en una biblioteca personal, con marco nogal y superficies marfil.
colors:
  canvas: "oklch(57% 0.06 64)"
  frame: "oklch(76% 0.052 68)"
  sidebar: "oklch(94.5% 0.02 70)"
  surface: "oklch(98% 0.007 70)"
  control: "oklch(90% 0.028 70)"
  control-strong: "oklch(82.5% 0.036 68)"
  ink: "oklch(21% 0.018 60)"
  text: "oklch(27% 0.018 60)"
  text-muted: "oklch(43% 0.022 62)"
  text-faint: "oklch(51% 0.024 65)"
  rule: "oklch(57% 0.035 67 / 0.26)"
  walnut: "oklch(50% 0.067 65)"
  walnut-deep: "oklch(40% 0.06 62)"
  focus: "oklch(44% 0.055 158)"
  success: "oklch(55% 0.085 150)"
  error: "oklch(54% 0.16 28)"
typography:
  display:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  display-mobile:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  body-compact:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 550
    lineHeight: 1.25
  label-small:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 550
    lineHeight: 1.4
  mono:
    fontFamily: "SFMono-Regular, Roboto Mono, JetBrains Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  xs: "4px"
  cover: "6px"
  nav: "10px"
  control: "12px"
  panel: "14px"
  frame: "16px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"
  2xl: "80px"
components:
  button-primary:
    backgroundColor: "{colors.walnut}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "44px"
  panel:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: EPUB Translator — Biblioteca Taller

## Dirección

La interfaz toma de la referencia Booky su arquitectura, no su función: un marco nogal que hace visible el objeto-aplicación, una topbar marfil para las herramientas y una superficie blanca donde el libro es protagonista. La aplicación debe sentirse como una biblioteca personal convertida en mesa de trabajo, no como un panel SaaS.

La escena física es una persona preparando ebooks en casa durante una sesión larga, con luz ambiental normal. Por eso el área operativa es clara y silenciosa; el marrón nogal aparece en el perímetro, la selección y las acciones, no detrás de texto denso.

## Principios

- **El libro antes que el panel.** Portadas, títulos, archivos y progreso mandan visualmente.
- **Una sola mesa de trabajo.** La topbar reúne preparación y biblioteca sin fragmentar el flujo ni restar ancho al libro.
- **Profundidad por tono.** Blanco, marfil y nogal crean capas; las superficies en reposo no llevan sombras anchas.
- **Controles suaves, paneles contenidos.** Botones e inputs pueden ser píldora; paneles y tablas se limitan a 12–14px.
- **Estado inequívoco.** Nogal para acción/selección, verde para éxito, rojo solo para error o destrucción.

## Estructura responsive

- **Escritorio:** marco exterior de 10px, topbar horizontal de 80px y área operativa a todo el ancho.
- **Flujo principal:** la entrada de archivo ocupa siempre una fila completa y la cola aparece inmediatamente debajo.
- **Hasta 1180px:** la topbar conserva marca y botón de menú; las secciones aparecen en un desplegable agrupado.
- **Hasta 760px:** desaparece el marco exterior y los registros de tabla pasan a bloques etiquetados.

## Componentes

### Navegación

Cada destino usa un icono tipográfico dentro de un círculo blanco y una etiqueta. En escritorio, los cinco destinos forman una navegación horizontal continua dentro de la topbar, sin rótulos ni separadores adicionales. La ruta activa se apoya en fondo marfil más oscuro y regla fina; nunca depende solo del color.

### Superficies y tablas

Los paneles de trabajo usan `sidebar` y 14px. Las tablas viven sobre blanco, con cabecera `control` y reglas tenues. Una portada puede usar una sombra corta de hasta 8px para conservar su cualidad de objeto físico; los paneles no flotan.

Las fichas del archivo de lectura siguen una composición editorial vertical: portada fija de 136 × 204px, título y autor debajo y estado visible. Un clic en la portada abre el diálogo contextual de edición alineado con su borde superior y separado 8px a la derecha; si no cabe en pantalla, se coloca a la izquierda. No hay botón adicional ni expansión de la ficha. El diálogo se cierra con Escape, el botón de cierre o un clic exterior. La cuadrícula nunca estira una portada para rellenar espacio disponible.

Los grupos mensuales del archivo se presentan en orden cronológico ascendente, de enero a diciembre. Las lecturas sin fecha aparecen siempre al final.

### Campos y acciones

Inputs, selects y botones ordinarios miden 44px. Los controles secundarios del diálogo de edición de lectura forman una escala compacta de 1.6rem. Los campos de una sola línea y botones son píldora, como en la referencia. Textareas, zonas de archivo, alertas y popovers usan 12px. El foco siempre es un contorno verde oscuro de 2px con separación visible.

### Movimiento

Las transiciones duran 150–180ms con salida exponencial y comunican hover, selección o cambio de estado únicamente mediante color o borde; ningún control o ficha se desplaza verticalmente. `prefers-reduced-motion` reduce las transiciones a cambios instantáneos.

## No usar

- Tema oscuro, negro lacado o dorado metálico.
- Glassmorphism, texto con gradiente, fondos cuadriculados o texturas decorativas.
- Sombras anchas en paneles, tablas o botones.
- Tarjetas anidadas sin una función clara.
- Radios mayores de 16px en superficies; 999px queda reservado a controles y chips.
- Tipografía display distinta para navegación o controles.
