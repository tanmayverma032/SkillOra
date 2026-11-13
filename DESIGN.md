# SkillOra design system (as built)

Recorded from the shipped code (`styles.css` + `theme.css` + `theme.js`), not from plans.
Surface mode: **Persuade** on the public pages (home, colleges, jobs, auth, contact). Portals, dashboard and admin are **Operate**: they inherit the tokens but were not redesigned.

## Idea
Wayfinding. Hospitals and hotels share one graphic language of calm signage with colour-coded zones, big plain type and clear arrows. SkillOra points students toward a college or a job, so the site borrows it: zone colours, a directory board, a zone stripe that acts as the legend.

## Colour (roles, not decoration)
| Role | Value | Notes |
|---|---|---|
| Ink (text, board) | `#0E2742` | tinted toward the brand blue, never pure black |
| Ink soft (secondary text) | `#3B5673` | 7:1 on white |
| Muted text | `#546C86` | was `#728DA9` at 3.4:1; now 5.4:1 |
| Brand blue (actions, links) | `#0A68DC` | was `#087BFF` (3.97:1 with white text); 5.2:1 now |
| Zone: Healthcare | `#0B7A63` | white text 5.3:1 |
| Zone: Hospitality | `#F0A030` | dark ink text on it (7:1), never white |
| Zone: Sales | `#CC4630` | white text 4.7:1 |
| Zone: Language | `#1B63C6` | white text 5.8:1 |
| Paper / hero ground | `#F3F6FA` / `#E6F0FB` | hero carries a faint grain texture |
Rule: one zone colour = one sector, everywhere. Do not reuse a zone colour for decoration.

## Type
- Display: **Bricolage Grotesque** 600-800, tracking -0.015em (hero -0.03em), `text-wrap: balance`. Hero is `clamp(38px, 4.6vw, 62px)`.
- Body/UI: **Figtree** 400-800. Numbers use tabular figures.
- Minimum text size on public pages: 12px. Body measure stays under 75ch.
- Both fonts load from Google Fonts (`<link>` in each page head); fallback is Arimo/system sans.

## Depth (one light source, top-left)
- Raised key (primary button): `inset` top highlight + `inset` bottom shade + soft drop shadow. Pressed: inset shadow, 1px down.
- Quiet key (secondary button): white with a hairline border and a faint bottom shade.
- Panels: 1px edge ring + one soft shadow. No stacked decoration.
- Hero photo: a stack of prints in CSS 3D that follows the pointer a few degrees (`theme.js`). This is the page's single authored motion, plus a one-time settle on load. Off for `prefers-reduced-motion` and on touch devices.

## Components
- **Directory board**: the four category cards are one dark board with hairline dividers; each row has a zone-coloured disc, a title, one line of sub-text, and a drawn arrow. Desktop 4 columns, tablet 2, phone 1.
- **Zone stripe**: 6px, four equal segments in zone order, under the hero. It is the legend for the board.
- **Hero stats**: one quiet line of text (`3 Verified Colleges | 3 Accredited Courses | 2 Active Vacancies`), never tiles.
- **Icons**: drawn SVG masks (`.ic .ic-*`), one 2px stroke, take the text colour. No emoji as icons on public pages.
- **Browser surfaces**: themed selection, scrollbars, caret, accent colour, focus ring (3px amber, always visible).

## Do
- Keep text on zone fills at the contrast listed above.
- Add new icons to the `.ic-*` set rather than using emoji.
- Keep one primary action per viewport.

## Not canonized (defects the build still carries, not rules to copy)
- Three same-size icon+heading+text cards in "Grow with SkillOra" (a banned scaffold, left as built).
- Typed arrows ("→") remain in some link text.
- Emoji still appear on dashboard, admin, portals and some mobile menus (Operate surfaces and secondary pages were out of scope).
- Bevels, embossed coin icons and the print stack are CSS-imitated depth, kept because the owner asked for "a little 3D"; they are not a licence to add more fake materials.

Not produced: `.impeccable/design.json` (the Impeccable engine could not be downloaded without network access).
