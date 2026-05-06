# Design Guidelines: Live Møtetranskripsjonsapp

## Design Approach
**Design System**: Material Design 3 with productivity-focused adaptations inspired by Linear and Notion
**Rationale**: Information-dense utility application requiring clarity, scannable content, and efficient interaction patterns

## Typography Hierarchy

**Font Family**: Inter via Google Fonts (clean, readable, optimized for screens)
- Headings: Inter 600 (Semibold)
- Body: Inter 400 (Regular) 
- Labels/UI: Inter 500 (Medium)

**Scale**:
- Page title: text-2xl (24px)
- Section headers: text-lg (18px) 
- Transcript text: text-base (16px)
- Spørsmål: text-sm (14px)
- Metadata/timestamps: text-xs (12px)
- Buttons: text-sm (14px)

## Layout System

**Container**: max-w-7xl centered with px-6 padding

**Spacing Primitives**: Tailwind units 2, 3, 4, 6, 8
- Component padding: p-4, p-6
- Section gaps: gap-6, gap-8
- Tight spacing: space-y-2, space-y-3
- Comfortable spacing: space-y-4

**Grid Structure**:
- Desktop: `grid grid-cols-3 gap-6`
  - Transcript: `col-span-2` (2/3 width)
  - Questions: `col-span-1` (1/3 width)
- Tablet/Mobile: Stack vertically with `grid-cols-1`

## Component Specifications

### Header/Controls
- Fixed top bar with subtle border-b
- Layout: Flexbox with space-between
- Left: "Møtetranskripsjonsapp" (title)
- Center: Timer display (mm:ss format)
- Right: Primary action button

**Start Button**:
- Large, prominent: px-8 py-3
- Text: "Start møte" / "Stopp møte"
- Full rounded (rounded-full)

### Transcript Panel (Venstre)
- Card container: rounded-lg border with subtle shadow
- Header: "Live transkript" with sticky positioning
- Scrollable content area: max-h-[calc(100vh-200px)] overflow-y-auto
- Auto-scroll behavior with manual override

**Transcript Segments**:
- Each segment: mb-4 with subtle bottom border
- Speaker label: text-xs uppercase tracking-wide (e.g., "TALER 1")
- Timestamp: text-xs opacity-60 inline before text
- Text: text-base leading-relaxed

### Question Panel (Høyre)
**Lagrede Spørsmål Box** (Top):
- Prominent border-2 with accent treatment
- Header: "Lagrede spørsmål" text-lg font-semibold
- Empty state: Subtle italic text "Ingen spørsmål lagret ennå"
- Saved items: Compact list with checkmark icon prefix

**Spørsmålsforslag Section**:
- Header: "Forslag" text-lg mb-4
- Grouped by minute with clear dividers

**Minute Groups**:
- Heading: "Minutt 1–2" text-sm font-medium opacity-75
- 3 questions per group with spacing-y-2

**Question Cards**:
- Border rounded-md p-3
- Layout: Flex with text left, buttons right
- Text: text-sm
- Action buttons: Small icons (16px) with minimal styling
  - Checkmark (✓): Success treatment
  - Delete (X): Destructive treatment
- Hover: Subtle background change

### Error/Status Messages
- Toast-style notifications: fixed bottom-right
- Rounded-lg with shadow-lg
- Icons + text for clarity
- Auto-dismiss after 5s

## Visual Rhythm & Spacing

**Vertical Flow**:
- Header: h-16 (64px)
- Main content: py-6
- Section gaps: mb-6 between major blocks
- Card internal: p-4 to p-6

**Horizontal Alignment**:
- Consistent 6-unit gap between columns
- Edge padding: px-6 on containers

## Interaction Patterns

**Buttons**:
- Primary: Solid with full rounded
- Secondary: Outline with rounded
- Icon buttons: Minimal padding (p-2) with hover background
- All include focus rings for accessibility

**Cards/Panels**:
- Subtle borders throughout
- Hover states on interactive items
- Clear visual hierarchy through border weight

**Scrolling**:
- Custom scrollbar styling (thin, subtle)
- Smooth scroll behavior
- Sticky headers where appropriate

## Responsive Breakpoints

- Mobile (< 768px): Single column stack, transcript first
- Tablet (768px - 1024px): Maintain two columns, adjust proportions
- Desktop (> 1024px): Full layout as specified

## Accessibility Standards

- ARIA labels på norsk for all interaktive elementer
- Focus indicators on all controls
- Sufficient contrast ratios (WCAG AA minimum)
- Screen reader announcements for dynamic content
- Keyboard navigation for all features

## Norwegian UI Text Examples

- "Start møte" / "Stopp møte"
- "Live transkript"
- "Lagrede spørsmål"
- "Forslag"
- "Minutt X–Y"
- "Mikrofontilgang nektet"
- "Kunne ikke generere spørsmål for dette minuttet"
- "Laster..."

## Key Design Principles

1. **Clarity First**: Dense information requires exceptional readability
2. **Minimal Distraction**: No animations except loading states
3. **Scannable Hierarchy**: Clear visual weight differences between content types
4. **Immediate Feedback**: Visual confirmation for all user actions
5. **Persistent Context**: Accumulated question history visible throughout session