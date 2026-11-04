/**
 * TypeScript mirror of src/brand/design-tokens.css (cycle 21, 2026-10-30).
 * src/brand/designTokens.test.mjs asserts every value here equals the CSS
 * custom property of the same role, so the two can never drift.
 * Usage: `import { colors, zIndex } from './brand/designTokens.ts'` or read the
 * CSS variable via `cssVar('accent')` → `var(--ui-accent)`.
 */
export const colors = {
  accent: '#3bb795',
  accentHover: '#62c9ac',
  accentActive: '#2e9479',
  accentSubtle: 'rgba(59, 183, 149, 0.14)',
  accentFocus: 'rgba(59, 183, 149, 0.6)',
  onAccent: '#0b0c0d',
  bg: '#0b0c0d',
  surface1: 'rgba(20, 21, 22, 0.94)',
  surface1Solid: '#141516',
  surface2: '#1d1e20',
  surface3: '#27292b',
  border: '#2f3134',
  borderStrong: '#4a4d51',
  textPrimary: '#f2f2f2',
  textSecondary: '#b7b9bc',
  textMuted: '#8a8d91',
  success: '#5bbf7f',
  error: '#e5605a',
} as const;

export const fonts = {
  sans: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const typeScale = { xs: 11, sm: 12, md: 13, lg: 15, xl: 18 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const zIndex = {
  hud: 2,
  mapLabel: 40,
  panel: 100,
  topbar: 120,
  dock: 130,
  composer: 150,
  sheet: 184,
  sheetRaised: 188,
  menu: 195,
  toast: 200,
  loading: 1000,
  tour: 10000,
} as const;

/** Kebab-case CSS custom-property name for a colour role. */
export function cssVar(role: keyof typeof colors): string {
  return `var(--ui-${role.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)})`;
}

export type ColorRole = keyof typeof colors;
