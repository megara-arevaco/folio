---
name: EPUB Translator — Kinpaku Workbench
description: A focused translation workbench with lacquer-dark surfaces, Kinpaku actions, and precise editorial typography.
colors:
  lacquer: "oklch(7% 0.006 95)"
  lacquer-deep: "oklch(4% 0.004 95)"
  lacquer-raised: "oklch(11% 0.006 95)"
  graphite: "oklch(15% 0.008 95)"
  graphite-raised: "oklch(19% 0.008 95)"
  champagne: "oklch(91% 0 0)"
  text: "oklch(88% 0 0)"
  text-muted: "oklch(72% 0 0)"
  text-faint: "oklch(62% 0 0)"
  rule: "oklch(78% 0 0 / 0.16)"
  kinpaku: "oklch(84% 0.19 80.46)"
  kinpaku-pale: "oklch(86% 0.07 84)"
  kinpaku-rich: "oklch(77% 0.13 82)"
  kinpaku-deep: "oklch(61% 0.085 78)"
  patina: "oklch(70% 0.12 188)"
  patina-deep: "oklch(49% 0.08 188)"
  vermilion: "oklch(58% 0.15 35)"
typography:
  display:
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 100
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 300
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  headline-mobile:
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 300
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.18rem"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
  mono:
    fontFamily: "SFMono-Regular, Roboto Mono, JetBrains Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "8px"
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
    backgroundColor: "{colors.kinpaku}"
    textColor: "{colors.lacquer-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 28px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.kinpaku-pale}"
    textColor: "{colors.lacquer-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 28px"
    height: "52px"
  button-primary-active:
    backgroundColor: "{colors.kinpaku-rich}"
    textColor: "{colors.lacquer-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 28px"
    height: "52px"
  button-secondary:
    backgroundColor: "{colors.lacquer}"
    textColor: "{colors.kinpaku}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 24px"
    height: "44px"
  input:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  surface:
    backgroundColor: "{colors.lacquer-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "24px"
---

# Design System: EPUB Translator — Kinpaku Workbench

## 1. Overview

**Creative North Star: “The Kinpaku Workbench”**

**Visual references:** [approved workbench direction](docs/design/kinpaku-workbench-direction-b.png) · [Kinpaku palette](docs/design/kinpaku-palette.png). These images document hierarchy and tone only; the production header stays flat and uses no background image or pattern.

EPUB Translator adopts the visual vocabulary of [impeccable.style](https://impeccable.style/) and the supplied desktop captures: black lacquer, sparse gold-leaf highlights, narrow editorial headings, exact alignment, and a quiet technical undercurrent. The result must feel like a specialist instrument for books—not a generic admin panel and not a marketing page transplanted into an application.

The product opens directly into the task. Large Alumni Sans headings orient the user, while Albert Sans carries controls, tables, progress, and long-form copy. Kinpaku gold is deliberately scarce: it identifies the current location, the primary action, and decisive success. Patina teal handles keyboard focus, links, and informational states. Dense operational areas use graphite layers, fine rules, and whitespace instead of floating card grids.

The desktop captures use cinematic negative space and a two-column editorial composition. Inside the app, preserve that confidence while increasing information density: a centered shell up to 1440px, a 12-column grid for complex workspaces, and flex layouts for toolbars and compact control groups. Use 24px page gutters below 760px, 32px at tablet widths, and 48–56px on wide screens. Tables become stacked job records rather than horizontally squeezed tables when their useful columns no longer fit.

**Key Characteristics:**

- Lacquer-black canvas with restrained graphite elevation.
- Kinpaku gold reserved for action, selection, and meaningful completion.
- Narrow display type for orientation; highly legible sans-serif for work.
- Square, precise controls with 2–4px radii; pills only for compact status or icon controls.
- Responsive structure changes at 760px and 1080px; typography does not merely shrink.
- Motion communicates state in 150–250ms and always has a reduced-motion path.

**The Product-First Rule.** Borrow the identity, not the landing-page choreography. No decorative entrance sequence, oversized hero, or ornamental art may delay translation, conversion, metadata editing, device transfer, or reading-log work.

**The Eight-Pixel Rule.** All layout spacing is composed from 8, 16, 24, 32, 48, and 80px. A one-off value must solve a measurable alignment problem.

**The Structural Responsive Rule.** At 1080px, multi-column workspaces simplify; at 760px, navigation becomes a menu, actions stack, and data tables become labeled records. Never preserve desktop density by forcing horizontal scrolling across the page.

## 2. Colors

The palette pairs near-black lacquer with neutral text, gold-leaf action, oxidized-teal focus, and a single vermilion error color. The canonical values live in the frontmatter.

### Primary

- **Kinpaku Gold:** Primary actions, active navigation, selected states, progress completion, and the rare high-value accent. It must remain under roughly 10% of a normal application screen.
- **Pale Kinpaku:** Primary-button hover and subtle emphasis on a dark surface.
- **Rich Kinpaku:** Pressed controls and denser progress or selection states.
- **Deep Kinpaku:** Low-emphasis borders and gold text that needs less luminance.

### Secondary

- **Patina Teal:** Keyboard focus rings, links, informational status, and secondary active indicators.
- **Deep Patina:** Teal text or borders when the brighter tone does not meet contrast requirements.

### Tertiary

- **Vermilion:** Errors, destructive actions, and failed jobs only. Never use it as decoration.

### Neutral

- **Lacquer:** Global application canvas.
- **Deep Lacquer:** Header, terminal-like areas, and the deepest recessed layer.
- **Raised Lacquer:** Main panels, menus, and work surfaces.
- **Graphite / Raised Graphite:** Inputs, table headers, code-like values, and hover layers.
- **Champagne:** High-emphasis headings and values.
- **Text / Muted / Faint:** Primary copy, secondary copy, and metadata respectively. Faint text is never used for essential instructions.
- **Rule:** Dividers and structural borders; use 1px only.

**The One Gold Voice Rule.** Gold means “act here,” “you are here,” or “this succeeded.” If it does none of those jobs, remove it.

**The Lacquer Layer Rule.** Depth comes from adjacent dark tones and 1px rules. Do not place a wide soft shadow behind every container.

**The Contrast Rule.** Body copy and placeholders must meet 4.5:1. Muted or faint tokens are prohibited for required labels, instructions, and job errors.

## 3. Typography

**Display Font:** Alumni Sans (Albert Sans and Arial fallback)  
**Body Font:** Albert Sans (Avenir Next, Helvetica Neue, Arial, and system-ui fallback)  
**Label/Mono Font:** SFMono-Regular (Roboto Mono, JetBrains Mono, and Consolas fallback)

**Character:** Alumni Sans provides the tall, precise editorial silhouette visible in the supplied captures. Albert Sans keeps a dense utility interface calm and readable. Monospace is reserved for IDs, filenames when alignment matters, durations, percentages, device paths, and technical output.

### Hierarchy

- **Display** (100, 56px, 1.02): Rare workspace introductions or empty-state orientation on wide screens. Never use inside tables or cards.
- **Headline** (300, 40px, 1.04): Primary page heading. On screens below 760px use 32px.
- **Title** (500, 18.9px, 1.35): Panel, queue, and form-section titles.
- **Body** (400, 16px, 1.6): Instructions and prose, capped at 70ch.
- **Label** (500, 14px, 1.25): Buttons, navigation, field labels, and table headings. Sentence case by default.
- **Mono** (400, 12px, 1.4): Operational metadata. Uppercase tracking is allowed only for genuinely short machine-like labels.

**The Two-Voice Rule.** Alumni Sans orients; Albert Sans operates. Never set buttons, dense data, or form labels in the display face.

**The Quiet Tracking Rule.** Display tracking never goes below -0.01em. Wide tracking is limited to the wordmark and short technical labels; ordinary headings and navigation remain naturally spaced.

## 4. Elevation

The system is flat by default. Depth is conveyed with lacquer and graphite tonal layers, 1px translucent rules, and local overlays. Shadows appear only when an element physically floats above the work surface—a popover, menu, toast, or dialog. The current site’s grain and gold-leaf imagery are brand atmosphere, not a repeating application background; use them only on a rare empty or welcome surface and never beneath tables or forms.

### Shadow Vocabulary

- **Popover** (`0 8px 22px oklch(0% 0 0 / 0.32)`): Menus, combobox lists, and tooltips.
- **Dialog** (`0 18px 48px oklch(0% 0 0 / 0.45)`): Blocking dialogs only, paired with a dark backdrop.
- **Inset Control** (`inset 0 1px oklch(100% 0 0 / 0.04)`): Optional top highlight on recessed graphite controls.

**The Flat-at-Rest Rule.** Main panels, tables, file pickers, and cards have no drop shadow. If every surface appears to float, the hierarchy has failed.

## 5. Components

### Buttons

- **Shape:** Precise rectangle with a 2px radius; 52px high for the primary call to action, 44px for ordinary toolbar actions, and 36px for compact actions.
- **Primary:** Kinpaku background with deep-lacquer text, 28px horizontal padding, 500 weight. Use once per task region.
- **Hover:** Pale Kinpaku and `translateY(-1px)` over 180ms with the standard easing curve.
- **Focus:** 2px Patina outline with a 3px offset. Focus must never rely on the hover color.
- **Active:** Rich Kinpaku and return to the resting position. Icon buttons may additionally scale to 0.96.
- **Secondary:** Transparent background, 1px Deep Kinpaku border, gold text; hover adds a low-opacity gold fill.
- **Ghost:** Transparent, no resting border, Champagne text; hover changes text to Kinpaku without moving the layout.
- **Disabled:** Muted text, Rule border, no transform, and `not-allowed` cursor. Preserve a readable label.

### Chips

- **Style:** Status chips are compact pills only when their short shape improves scanning. Default uses Graphite with Muted text; selected or successful uses a low-opacity Kinpaku fill and gold text.
- **State:** Use `aria-pressed` or the appropriate selection semantic. Never communicate status by color alone; include a label or icon.

### Cards / Containers

- **Corner Style:** 4px for work panels and 8px only for large drop zones or dialogs.
- **Background:** Raised Lacquer for the primary workspace; Graphite for nested controls or table headers.
- **Shadow Strategy:** Flat at rest; tonal layering and Rule borders provide separation.
- **Border:** One 1px Rule border. Never pair it with a wide decorative shadow.
- **Internal Padding:** 24px standard, 32px for a spacious empty state, and 16px on mobile.
- **Grid:** Complex workspaces use a 12-column grid with 24px gaps; small repeated modules use `repeat(auto-fit, minmax(280px, 1fr))`. Toolbars use flexbox.

### Inputs / Fields

- **Style:** Graphite background, 1px Rule border, 4px radius, 44px minimum height, Text value, and a fully legible Muted placeholder.
- **Hover:** Border becomes slightly brighter without changing size.
- **Focus:** Patina border plus a 2px Patina focus ring at 35% opacity.
- **Error:** Vermilion border, inline message, and an icon or textual cue. Do not rely on red alone.
- **Disabled:** Raised Lacquer background and Faint text, while the label remains readable.

### Navigation

- **Desktop:** A 62px minimum top bar with the wordmark at the start, primary routes in a horizontal row, and utilities at the end. Use flexible gaps from 22–48px. The current route is Kinpaku with a 2px underline; hover changes text to Kinpaku without shifting position.
- **Mobile (≤760px):** Keep brand and menu button in the first row. The menu expands beneath as a full-width Raised Lacquer panel; links become 48px minimum-height rows separated by subtle rules. The menu button is 36px square and morphs from two lines to a close icon.
- **Focus:** Every route and utility control receives the Patina focus ring. The active route remains identifiable independently of focus.
- **Behavior:** Close the mobile menu after navigation and update `aria-expanded`. The top bar may be sticky, but must not obscure focused content.

### Job Queue

- **Desktop:** Use a real table with stable column alignment, 48px minimum row height, tabular numerals, and a Graphite header. Hover adds a subtle graphite layer; keyboard focus uses an inset Patina outline.
- **Mobile (≤760px):** Convert each row into a labeled record. Preserve filename, status, progress, elapsed time, and actions; never hide an operation merely to make the row fit.
- **Active:** The selected or editable row receives a Patina rule and visible focus. Drag state uses a dashed Kinpaku outline plus a textual reordering announcement for assistive technology.

### File Picker

- **Style:** One large 1px Rule boundary with an 8px radius, icon, concise instruction, accepted format, and the selected filename. It is a functional drop zone, not a decorative card.
- **Hover / Drag over:** Rule changes to Deep Kinpaku; drag-over adds a low-opacity Kinpaku background.
- **Focus:** Patina 2px outline with 3px offset.
- **Invalid:** Vermilion boundary and a persistent inline explanation.

### Progress and Feedback

- **Progress:** Graphite track, Kinpaku value, 4px height, and a numeric label. Animated stripes are optional only for genuinely indeterminate work; reduced motion replaces them with a static fill.
- **Toast:** Deep Lacquer surface, Rule border, 4px radius, and a compact icon. Success uses Kinpaku; informational feedback uses Patina; failure uses Vermilion.
- **Loading:** Prefer stable skeleton rows for queues and metadata. Never replace the whole workspace with a centered spinner.

## 6. Do's and Don'ts

### Do:

- **Do** preserve the supplied reference’s lacquer, Kinpaku, Patina, and narrow-display identity while keeping the task surface operational.
- **Do** use the 8px spacing family and align dense data to a stable grid.
- **Do** keep Kinpaku below roughly 10% of ordinary screens and assign it semantic meaning.
- **Do** provide visible hover, `:focus-visible`, active, disabled, loading, success, and error states for every interactive component.
- **Do** restructure navigation, tables, and action groups at 760px instead of merely shrinking them.
- **Do** respect `prefers-reduced-motion`; state changes must remain understandable without movement.

### Don't:

- **Don't** reproduce the reference website as a marketing hero inside the application; the first screen is the usable tool.
- **Don't** use gold-leaf artwork, grain, gradients, or ambient texture behind tables, forms, or reading data.
- **Don't** use identical icon-heading-text card grids or nested cards as the default layout.
- **Don't** use `border-left` or `border-right` thicker than 1px as a colored accent.
- **Don't** use gradient text, glassmorphism, decorative grid backgrounds, or repeating stripe backgrounds.
- **Don't** combine a 1px border with a wide soft shadow on the same resting component.
- **Don't** round cards or inputs beyond 8px; 999px is reserved for chips and circular utilities.
- **Don't** hide keyboard focus, rely on color alone, or use Faint text for essential information.
