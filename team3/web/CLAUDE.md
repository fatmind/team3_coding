@AGENTS.md

# Project Type: Desktop Collaboration Tool

- Type: desktop-app
- Min width: 900px
- This is NOT a mobile dashboard. Skip mobile-only rules:
  - Rule 13 (430px width) → full-width desktop layout
  - Rule 14 (mx-6/px-6 mobile rhythm) → desktop uses larger spacing
  - Touch targets → 32px minimum (mouse precision), not 44px
- Sidebar is fixed 220px, never collapses

# UI Development Principle

交互草稿图是概要方向和主交互动线。很多细节交互，AI 应自主发挥、自主思考，做出合理的默认决策。不要只做明确要求的，要主动补充合理的交互细节（如：列表折叠/展开、连续同作者消息折叠、@mention 弹出下拉、空状态引导、键盘快捷键、hover/focus 反馈等）。

# StyleSeed Design Engine

@DESIGN-LANGUAGE.md

## Brand: Mintlify

Visual style: clean, light, developer-friendly documentation tool aesthetic.
- Primary brand color: Mintlify green (#00d4a4)
- Background: white/light gray
- Typography: Inter (body) + JetBrains Mono (code)
- Aesthetic: generous whitespace, minimal shadows, subtle borders

## Key StyleSeed Rules

- All content inside cards — never on bare page background
- Single accent color (brand green) — everything else grayscale
- Semantic tokens only — never hardcode hex in components
- Use `cn()` for className composition (no template literals)
- Use `data-slot` attribute on all components
- After major changes → run /ss-lint to verify compliance

## CSS Architecture

- `src/styles/theme.css` — brand tokens (colors, spacing, shadows)
- `src/styles/base.css` — reset and base element styles
- `src/styles/fonts.css` — font imports
- Components use semantic token classes, not hardcoded values

## Tech Notes (Next.js specific)

- This project uses Next.js App Router, NOT Tailwind CSS
- Styling is via CSS custom properties (semantic tokens) + plain CSS
- Do NOT add tailwindcss — we use StyleSeed tokens via CSS variables directly
- Components use `className` with semantic CSS classes referencing token variables
