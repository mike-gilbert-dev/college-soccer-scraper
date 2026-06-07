# Design Document

## Overview

This document captures the design system and layout patterns observed across both light and dark theme variants of the interface — a sports scores/results aggregation page (likely a tennis or multi-sport results site such as FlashScore or similar).

---

## Themes

The UI ships two fully realized color modes:

### Light Mode
- **Background**: `#f5f5f5` (near-white grey page background)
- **Surface / Card**: `#ffffff` white panels
- **Text Primary**: `#1a1a1a` dark near-black
- **Text Secondary**: `#666666` medium grey
- **Border / Divider**: `#e0e0e0` light grey hairlines
- **Accent / Active**: `#e8463a` red (used on live indicators, highlights, active tabs)
- **Score Highlight**: Bold black on white, small compact numerals

### Dark Mode
- **Background**: `#1a1a1a` deep charcoal
- **Surface / Card**: `#242424` slightly lighter panel
- **Text Primary**: `#e0e0e0` off-white
- **Text Secondary**: `#888888` muted grey
- **Border / Divider**: `#333333` subtle dark border
- **Accent / Active**: `#e8463a` same red accent (consistent across themes)
- **Score Highlight**: White bold numerals on dark surfaces

---

## Typography

- **Font Family**: System sans-serif stack — likely `"Helvetica Neue", Arial, sans-serif` or a similar compact grotesque
- **Font Sizes**:
  - Navigation / Header labels: `11–12px`, uppercase or sentence case, medium weight
  - Match row team names: `12–13px`, regular weight
  - Scores: `12–13px`, bold/semibold
  - Section headers (competition names): `11px`, uppercase, muted color, letter-spacing ~0.5px
  - Timestamps / metadata: `10–11px`, muted grey
- **Line Height**: Tight — approximately `1.3–1.4` for match rows
- **Font Weight**: 400 (regular) for names, 600–700 (bold) for scores and active states

---

## Layout & Grid

### Page Structure

```
┌─────────────────────────────────────────────────────┐
│  Top Navigation Bar (full width, ~40px tall)         │
├────────────┬───────────────────────────┬─────────────┤
│ Left     │  Main Content Area       │ Right Sidebar  │
│ Sidebar  │  (scores / results list) │ (ads/news)     │
│ ~180px   │  ~560px                  │ ~220px         │
└────────────┴───────────────────────────┴─────────────┘
```

- **Max width**: ~960–1000px centered on wide screens
- **Left sidebar**: Fixed navigation with sport/league filters; icons + labels; collapsible
- **Main area**: Scrollable list of match results grouped by competition
- **Right sidebar**: Promotional banners, news thumbnails, ad units (~220px wide)

### Top Navigation Bar
- Full-width, white (light) / dark (dark) background
- Logo on the far left
- Sport category tabs (text links) centered or left-aligned
- Date navigation (prev/next arrows + date display) in the main content header area
- User actions (login, settings) far right
- Height: ~38–42px

### Left Sidebar
- Width: ~175–185px
- List of sport/category links with small flag or sport icons
- Active state: red accent left border or background highlight
- Sticky on scroll
- Bottom: league/competition quick-access list

---

## Components

### Match Row

Each match is displayed as a compact horizontal row:

```
[Time/Status] [Home Team Flag+Name]  [Score] [Away Team Flag+Name]  [Extra indicators]
```

- Row height: ~28–32px
- Left-aligned team names, score centered or right of names
- Thin bottom border `1px solid #e0e0e0` (light) / `#333` (dark) separating rows
- Hover state: slight background tint (`#f9f9f9` light / `#2a2a2a` dark)
- Live matches: time shown in red; score in red or bold red
- Finished matches: time shown as "FT" or final time in grey

**Match Row Sub-elements:**
- **Country flag**: 14×10px inline image, `border-radius: 1px`
- **Team name**: truncated with ellipsis if too long, max ~160px
- **Score**: fixed-width container, monospaced or tabular numerals, bold
- **Status badge**: small pill for "LIVE", "FT", "Postponed" etc.

### Competition / League Group Header

```
[Country Flag] COMPETITION NAME                    [# matches]
```

- Background: slightly different from row background — `#f0f0f0` (light) / `#1e1e1e` (dark)
- Height: ~26px
- Font: 11px, uppercase, medium weight, muted color
- Collapse/expand toggle on the right (chevron icon)
- Sticky within its scroll group

### Date Navigation Bar (above match list)

- Horizontal scrollable list of date pills: `Mon 2`, `Tue 3`, `Wed 4`…
- Active date: white text on red/dark background pill
- Inactive: grey text, transparent background
- Pill padding: `4px 10px`, `border-radius: 12px`
- Font: 11px

### Right Sidebar Widgets

- **Promo/Ad Banners**: fixed width `~220px`, variable height, `border-radius: 4px`
- **News/Article Cards**: thumbnail image (left, ~60×60px) + headline text (right), `border-bottom` separator
- **Live Score Widget**: compact table with team names and period scores, accent color header

---

## Spacing & Density

The UI is intentionally **information-dense**:

| Element | Value |
|---|---|
| Match row padding (vertical) | `6–8px` |
| Match row padding (horizontal) | `8–12px` |
| Section header padding | `4–6px 8px` |
| Gap between competition groups | `8–12px` |
| Sidebar item padding | `8px 12px` |
| Border radius (cards/panels) | `4px` |
| Border radius (pills/badges) | `12px` |

---

## Iconography

- Small sport icons (~16×16px) in the left sidebar navigation
- Country/team flag images (PNG sprites or individual SVGs), `14×10px`
- Chevron icons (`›`, `‹`) for expand/collapse and navigation
- Simple dot or circle indicator for live status
- Bookmark / favorite star icon on match rows (right-aligned, appears on hover)

---

## Interactive States

| State | Behavior |
|---|---|
| Hover (match row) | Background tint, show favorite icon |
| Active (nav link) | Red left border + slightly bolder text |
| Active (date pill) | Red/dark background, white text |
| Live match | Red score text, animated dot indicator |
| Expanded section | Chevron rotated 90°, rows visible |
| Collapsed section | Chevron pointing right, rows hidden |

---

## Responsive Behavior

- **Desktop (>960px)**: Full three-column layout (sidebar + main + sidebar)
- **Tablet (~768px)**: Right sidebar collapses or moves below main content; left sidebar may become a horizontal tab bar
- **Mobile (<600px)**: Single column; left sidebar becomes a hamburger menu; date picker becomes horizontal scroll strip

---

## Motion & Animation

- Minimal — this is a data-dense sports utility UI, not a marketing site
- Row hover: instant background color change (no transition delay, max `100ms ease`)
- Section collapse/expand: `max-height` transition, `200ms ease-out`
- Live score updates: subtle flash/highlight on score change (`background-color` flash, ~`500ms`)
- Page load: no elaborate entrance animations; content renders immediately

---

## Accessibility

- Sufficient color contrast in both themes (WCAG AA minimum)
- Red accent (`#e8463a`) used only for supplementary status info, not sole conveyor of meaning (score also shown in text)
- Keyboard-navigable match rows and sidebar links
- `aria-label` on icon-only buttons (collapse, favorite)
- Focus rings visible in both themes

---

## Asset Notes

- Logo: top-left, appears to be a stylized brand mark (~120×30px)
- Top promotional banner: full-width leaderboard ad slot (~728×90px equivalent) below the nav
- Right sidebar top: tall promotional/banner unit (~220×350px)
- Thumbnail images in news cards: `60×60px` or `80×60px`, `object-fit: cover`, `border-radius: 3px`
