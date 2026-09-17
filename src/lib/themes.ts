export interface ThemeDef {
  id: string
  name: string
  vars: Record<string, string>
}

// Every color the site uses flows through these tokens — no hardcoded
// whites/blacks/reds anywhere in components. `text` doubles as the "white"
// (primary buttons, pills, badges sit on --text with --on-text ink).
export const THEME_KEYS = [
  '--bg', '--bg-soft', '--surface', '--surface-hover', '--surface-elevated',
  '--border', '--border-strong',
  '--text', '--text-muted', '--text-faint', '--on-text',
  '--accent', '--accent-hover',
  '--warn', '--ok',
  '--scrim', '--shadow',
] as const

function t(bg: string, bgSoft: string, surface: string, surfaceHover: string, surfaceElevated: string,
  border: string, borderStrong: string, text: string, textMuted: string, textFaint: string,
  onText: string, accent: string, accentHover: string, warn: string, ok: string,
  scrim: string, shadow: string): Record<string, string> {
  return {
    '--bg': bg, '--bg-soft': bgSoft, '--surface': surface, '--surface-hover': surfaceHover,
    '--surface-elevated': surfaceElevated, '--border': border, '--border-strong': borderStrong,
    '--text': text, '--text-muted': textMuted, '--text-faint': textFaint, '--on-text': onText,
    '--accent': accent, '--accent-hover': accentHover, '--warn': warn, '--ok': ok,
    '--scrim': scrim, '--shadow': shadow,
  }
}

export const THEMES: ThemeDef[] = [
  { id: 'aeri-dark', name: 'Aeri Dark', vars: t(
    '#000000', '#0a0a0a', '#101010', '#1a1a1a', '#1e1e1e',
    'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.16)',
    '#ffffff', '#a3a3a3', '#6e6e6e', '#000000',
    '#ffffff', '#d4d4d4', '#fbbf24', '#4ade80',
    'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.6)') },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', vars: t(
    '#eff1f5', '#e6e9ef', '#ccd0da', '#bcc0cc', '#acb0be',
    'rgba(76,79,105,0.16)', 'rgba(76,79,105,0.3)',
    '#4c4f69', '#5c5f77', '#8c8fa1', '#eff1f5',
    '#8839ef', '#7c2bd6', '#df8e1d', '#40a02b',
    'rgba(76,79,105,0.45)', 'rgba(76,79,105,0.25)') },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', vars: t(
    '#303446', '#292c3c', '#414559', '#51576d', '#626880',
    'rgba(198,208,245,0.14)', 'rgba(198,208,245,0.28)',
    '#c6d0f5', '#a5adce', '#737994', '#303446',
    '#ca9ee6', '#b68ae0', '#e5c890', '#a6d189',
    'rgba(35,38,52,0.7)', 'rgba(0,0,0,0.5)') },
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', vars: t(
    '#24273a', '#1e2030', '#363a4f', '#494d64', '#5b6078',
    'rgba(202,211,245,0.14)', 'rgba(202,211,245,0.28)',
    '#cad3f5', '#a5adcb', '#8087a2', '#24273a',
    '#c6a0f6', '#b484f0', '#e5c890', '#a6da95',
    'rgba(24,25,38,0.7)', 'rgba(0,0,0,0.5)') },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', vars: t(
    '#1e1e2e', '#181825', '#313244', '#45475a', '#585b70',
    'rgba(205,214,244,0.14)', 'rgba(205,214,244,0.28)',
    '#cdd6f4', '#a6adc8', '#7f849c', '#1e1e2e',
    '#cba6f7', '#b784f5', '#f9e2af', '#a6e3a1',
    'rgba(17,17,27,0.7)', 'rgba(0,0,0,0.5)') },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', vars: t(
    '#282828', '#1d2021', '#3c3836', '#504945', '#665c54',
    'rgba(235,219,178,0.16)', 'rgba(235,219,178,0.32)',
    '#ebdbb2', '#d5c4a1', '#a89984', '#282828',
    '#fabd2f', '#eab308', '#fe8019', '#b8bb26',
    'rgba(29,32,33,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'gruvbox-light', name: 'Gruvbox Light', vars: t(
    '#fbf1c7', '#f2e5bc', '#ebdbb2', '#d5c4a1', '#c9b896',
    'rgba(60,56,54,0.18)', 'rgba(60,56,54,0.34)',
    '#3c3836', '#504945', '#928374', '#fbf1c7',
    '#af3a03', '#9c3303', '#b57614', '#79740e',
    'rgba(60,56,54,0.4)', 'rgba(60,56,54,0.22)') },
  { id: 'dracula', name: 'Dracula', vars: t(
    '#282a36', '#21222c', '#44475a', '#565973', '#6272a4',
    'rgba(248,248,242,0.14)', 'rgba(248,248,242,0.28)',
    '#f8f8f2', '#bfbfbf', '#8a8f9e', '#282a36',
    '#bd93f9', '#a87df0', '#ffb86c', '#50fa7b',
    'rgba(33,34,44,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'nord', name: 'Nord', vars: t(
    '#2e3440', '#292e39', '#3b4252', '#434c5e', '#4c566a',
    'rgba(236,239,244,0.14)', 'rgba(236,239,244,0.28)',
    '#eceff4', '#d8dee9', '#7b8698', '#2e3440',
    '#88c0d0', '#6fb3c8', '#ebcb8b', '#a3be8c',
    'rgba(46,52,64,0.72)', 'rgba(0,0,0,0.45)') },
  { id: 'tokyo-night', name: 'Tokyo Night', vars: t(
    '#1a1b26', '#16161e', '#24283b', '#2f3549', '#414868',
    'rgba(192,202,245,0.14)', 'rgba(192,202,245,0.28)',
    '#c0caf5', '#9aa5ce', '#636b8c', '#1a1b26',
    '#7aa2f7', '#5f86e8', '#e0af68', '#9ece6a',
    'rgba(22,22,30,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'one-dark', name: 'One Dark', vars: t(
    '#282c34', '#21252b', '#353b45', '#3e4451', '#4b5261',
    'rgba(171,178,191,0.16)', 'rgba(171,178,191,0.32)',
    '#abb2bf', '#828997', '#636a78', '#282c34',
    '#61afef', '#4d9ede', '#d19a66', '#98c379',
    'rgba(33,37,43,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'solarized-dark', name: 'Solarized Dark', vars: t(
    '#002b36', '#00212b', '#073642', '#0b4a5a', '#0f5c6e',
    'rgba(131,148,150,0.18)', 'rgba(131,148,150,0.34)',
    '#93a1a1', '#7d8c8d', '#586e75', '#002b36',
    '#2aa198', '#1f8a82', '#b58900', '#859900',
    'rgba(0,33,43,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'solarized-light', name: 'Solarized Light', vars: t(
    '#fdf6e3', '#f5efdc', '#eee8d5', '#e2d9c2', '#d3c9ab',
    'rgba(101,123,131,0.22)', 'rgba(101,123,131,0.38)',
    '#405055', '#56676d', '#93a1a1', '#fdf6e3',
    '#268bd2', '#1d74b3', '#b58900', '#728c00',
    'rgba(101,123,131,0.4)', 'rgba(101,123,131,0.25)') },
  { id: 'rose-pine', name: 'Rosé Pine', vars: t(
    '#191724', '#12111a', '#1f1d2e', '#26233a', '#35315b',
    'rgba(224,222,244,0.14)', 'rgba(224,222,244,0.28)',
    '#e0def4', '#c4c2dd', '#8e8aa8', '#191724',
    '#c4a7e7', '#b28ce0', '#f6c177', '#9ccfd8',
    'rgba(18,17,26,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'everforest-dark', name: 'Everforest Dark', vars: t(
    '#2d353b', '#232a2f', '#3d484d', '#4a555b', '#5a666c',
    'rgba(211,198,170,0.16)', 'rgba(211,198,170,0.32)',
    '#d3c6aa', '#b8ab8d', '#7f8c7a', '#2d353b',
    '#a7c080', '#93b06c', '#dbbc7f', '#83c092',
    'rgba(35,42,47,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'kanagawa', name: 'Kanagawa', vars: t(
    '#1f1f28', '#1a1a22', '#2a2a37', '#363646', '#44475c',
    'rgba(220,215,186,0.14)', 'rgba(220,215,186,0.28)',
    '#dcd7ba', '#b8b29e', '#6e6a58', '#1f1f28',
    '#7e9cd8', '#6890d4', '#dca561', '#98bb6c',
    'rgba(26,26,34,0.72)', 'rgba(0,0,0,0.5)') },
  { id: 'monokai', name: 'Monokai', vars: t(
    '#272822', '#1e1f1c', '#3e3d32', '#49483e', '#5a5947',
    'rgba(248,248,242,0.14)', 'rgba(248,248,242,0.28)',
    '#f8f8f2', '#cfcfc2', '#7a7965', '#272822',
    '#66d9ef', '#4fc9e8', '#fd971f', '#a6e22e',
    'rgba(30,31,28,0.72)', 'rgba(0,0,0,0.5)') },
]

export const DEFAULT_THEME_ID = 'aeri-dark'

export function getThemeById(id: string | null | undefined): ThemeDef {
  return THEMES.find(t => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: string) {
  try {
    const theme = getThemeById(id)
    const root = document.documentElement
    root.dataset.theme = theme.id
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value)
    }
  } catch {}
}
