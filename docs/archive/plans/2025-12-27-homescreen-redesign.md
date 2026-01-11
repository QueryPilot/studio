# HomeScreen Redesign

**Date**: 2025-12-27
**Status**: Approved for implementation

## Design Goals

Achieve a balance of three qualities:
1. **Professional & Trustworthy** - Clean lines, consistent spacing, subtle colors
2. **Fast & Modern** - Sharp interactions, minimal chrome, efficient space use
3. **Warm & Approachable** - Friendly colors, inviting, not cold/sterile

Additional requirements:
- **Dense but breathable** - Show more at once without feeling cramped
- **Keyboard navigation** - Arrow keys must work throughout main content area

---

## 1. Color System Refinements

### Problem
Current `secondary`, `muted`, and `accent` all use identical values (`oklch(0.94 0.008 80)`). Everything blends together with no visual hierarchy.

### Solution

Update `src/styles/globals.css`:

```css
:root {
  /* Background layers - create depth */
  --background: oklch(0.98 0.005 80);      /* Main content - warm off-white */
  --sidebar: oklch(0.95 0.015 75);         /* Sidebar - slightly darker, more saturated */
  --card: oklch(1 0 0);                    /* Cards - pure white, will pop */

  /* Borders - more visible */
  --border: oklch(0.88 0.02 80);           /* Was 0.82, now more visible */

  /* Primary - richer amber */
  --primary: oklch(0.75 0.16 70);          /* Was 0.79/0.145/77, now richer */

  /* Secondary/Muted/Accent - differentiate them */
  --secondary: oklch(0.96 0.01 80);        /* Lighter than sidebar */
  --muted: oklch(0.94 0.008 80);           /* Keep for muted backgrounds */
  --accent: oklch(0.92 0.02 75);           /* Warmer, for hover states */

  /* Muted foreground - slightly darker for better readability */
  --muted-foreground: oklch(0.40 0.01 80); /* Was 0.45 */
}
```

Dark mode values should follow the same principles (maintain relative differences).

---

## 2. Layout Structure

### Sidebar - Navigation Hub (280px)

Restructure `ActionBar` to be a true navigation hub:

```
┌─────────────────────────────┐
│  [Logo] Query Pilot         │  Header - compact
│         v0.11.0             │  Version shown subtly
├─────────────────────────────┤
│  🔍 Search connections...   │  Search - moved here
├─────────────────────────────┤
│  ⭐ FAVORITES (3)           │  Favorites section
│    • Production DB          │  - Collapsible
│    • Staging API            │  - Top 5 max
│    • Local Dev              │  - Compact list items
├─────────────────────────────┤
│  🕐 RECENT                  │  Recent section
│    • MySQL Local     5m     │  - Last 4 used
│    • Postgres Prod   2h     │  - Compact with time
├─────────────────────────────┤
│  ENVIRONMENT                │  Filter section
│  ● All  ● Local  ● Dev      │  - Existing filters
│  ● Staging ● UAT ● Prod     │  - Refined styling
├─────────────────────────────┤
│        [spacer]             │
├─────────────────────────────┤
│  ⚙ Settings     ? Help      │  Footer
└─────────────────────────────┘
```

### Main Content Area

With search and recent moved to sidebar:
- Remove `SearchBar` from main content
- Remove `RecentConnections` section
- Main area focuses on **All Connections** with hybrid view
- More vertical space for connections

---

## 3. Hybrid Connection View

### Structure

```
┌──────────────────────────────────────────────────────────────┐
│  Connections (24)                      [+ New] [▦ Grid│☰ List] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Card 1       │ │ Card 2       │ │ Card 3       │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Card 4       │ │ Card 5       │ │ Card 6       │  Top 6  │
│  └──────────────┘ └──────────────┘ └──────────────┘  cards  │
│                                                              │
│  ──────────────── More Connections (18) ────────────────    │
│                                                              │
│  🐘  Analytics DB          prod    analytics.corp    3d     │
│  🐬  Legacy MySQL          uat     legacy.int        1w     │ Dense
│  🐘  Reporting Slave       prod    replica.corp      2w     │ list
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

### View Toggle
- Grid view: All cards (current behavior)
- List view: All dense rows
- Hybrid (default): 6 cards + remaining as list

---

## 4. Refined Card Design

### Current Problems
- 10px fonts too small
- Env badge competes with name
- Host:port and timestamp crammed
- No clear hierarchy

### New Card Structure

```
┌─────────────────────────────────────────┐
│▌  ┌────┐                            ⭐  │
│▌  │ 🐘 │  Production Database           │
│▌  └────┘  PostgreSQL                    │
│▌                                        │
│▌  db.company.com:5432                   │
│▌  myapp_production                      │
│▌                                        │
│▌  2 hours ago                           │
└─────────────────────────────────────────┘
 ▲
 └─ 3px colored left border (env indicator)
```

### Specifications

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Left border | 3px | - | env color (blue/yellow/red/etc) |
| DB Icon | 24x24px | - | with subtle bg circle |
| Name | 14px | semibold | foreground |
| DB Type | 12px | normal | muted-foreground |
| Host:port | 12px | normal | muted-foreground |
| Database | 12px | normal | muted-foreground |
| Timestamp | 11px | normal | muted-foreground |
| Favorite star | 16px | - | amber (active) / gray outline |

### Card Interactions

| State | Effect |
|-------|--------|
| Default | White bg, subtle border |
| Hover | Slight lift (shadow), amber border tint |
| Focus (keyboard) | 2px amber ring |
| Active/Pressed | Slightly darker bg |

### Spacing
- Card padding: 16px
- Gap between cards: 12px
- Grid: 3 columns on large screens, 2 on medium

---

## 5. Dense List Row Design

For connections below the card section:

```
│ 🐘 │ Analytics Database    │ prod │ analytics.company.com:5432 │ 3 days ago │
```

### Specifications
- Row height: 40px
- Icon: 16x16px
- Name: 13px semibold, flex-1
- Env tag: Small pill badge
- Host: 12px muted
- Timestamp: 12px muted, right-aligned

### Row Interactions
- Hover: subtle bg highlight
- Focus: amber ring
- Click: opens connection

---

## 6. Keyboard Navigation

### Requirements
- Arrow keys navigate through all connections (cards + list)
- Navigation flows naturally from cards grid → list rows
- Visible focus indicator (amber ring)

### Key Bindings

| Key | Action |
|-----|--------|
| `↑` `↓` `←` `→` | Navigate connections |
| `Enter` | Connect to focused connection |
| `e` | Edit focused connection |
| `f` | Toggle favorite |
| `Delete` | Delete (with confirmation) |
| `Home` | Jump to first |
| `End` | Jump to last |
| `/` | Focus search (in sidebar) |

### Implementation
- Use `tabIndex` and `onKeyDown` on connection container
- Track `selectedIndex` in state
- `useEffect` to scroll focused item into view

---

## 7. Files to Modify

### Core Changes
1. `src/styles/globals.css` - Color system updates
2. `src/screens/home/components/ActionBar/ActionBar.tsx` - New structure
3. `src/screens/home/components/ActionBar/EnvFilter.tsx` - Already refined
4. `src/screens/home/components/MainContent/MainContent.tsx` - Remove search/recent
5. `src/screens/home/components/MainContent/ConnectionsSection.tsx` - Hybrid view
6. `src/screens/home/components/shared/ConnectionCard.tsx` - New card design

### New Components
7. `src/screens/home/components/ActionBar/SidebarSearch.tsx` - Search in sidebar
8. `src/screens/home/components/ActionBar/SidebarFavorites.tsx` - Favorites section
9. `src/screens/home/components/ActionBar/SidebarRecent.tsx` - Recent section
10. `src/screens/home/components/shared/ConnectionRow.tsx` - Dense list row

### Remove/Deprecate
- `src/screens/home/components/MainContent/SearchBar.tsx` - Moved to sidebar
- `src/screens/home/components/MainContent/RecentConnections.tsx` - Moved to sidebar

---

## 8. Implementation Order

1. **Phase 1: Colors** - Update globals.css, see immediate visual improvement
2. **Phase 2: Sidebar structure** - Reorganize ActionBar with new sections
3. **Phase 3: Card redesign** - Update ConnectionCard with new styling
4. **Phase 4: Hybrid view** - Add list rows, implement view toggle
5. **Phase 5: Keyboard nav** - Add arrow key support throughout
6. **Phase 6: Polish** - Animations, transitions, edge cases

---

## 9. Success Criteria

- [ ] Colors create clear visual hierarchy (sidebar vs main vs cards)
- [ ] Sidebar feels like a navigation hub with useful quick-access sections
- [ ] Cards are readable and scannable at a glance
- [ ] Hybrid view shows more connections without feeling overwhelming
- [ ] Arrow keys navigate all connections fluidly
- [ ] Overall feel: professional, modern, warm
