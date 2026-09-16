export interface ThemeDef {
  id: string
  name: string
  vars: Record<string, string>
}

export const THEMES: ThemeDef[] = [
  { id: 'aeri-dark', name: 'Aeri Dark', vars: { '--bg': '#070708', '--bg-soft': '#0f0f10', '--surface': '#141416', '--surface-elevated': '#1e1e21', '--text': '#f2f2f3', '--text-muted': '#9a9aa0', '--text-faint': '#6b6b70', '--border': 'rgba(255,255,255,0.07)', '--accent': '#e50914' } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', vars: { '--bg': '#eff1f5', '--bg-soft': '#e6e9ef', '--surface': '#ccd0da', '--surface-elevated': '#bcc0cc', '--text': '#4c4f69', '--text-muted': '#6c6f85', '--text-faint': '#8c8fa1', '--border': 'rgba(76,79,105,0.14)', '--accent': '#d20f39' } },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', vars: { '--bg': '#303446', '--bg-soft': '#292c3c', '--surface': '#414559', '--surface-elevated': '#51576d', '--text': '#c6d0f5', '--text-muted': '#a5adce', '--text-faint': '#737994', '--border': 'rgba(198,208,245,0.12)', '--accent': '#e78284' } },
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', vars: { '--bg': '#24273a', '--bg-soft': '#1e2030', '--surface': '#363a4f', '--surface-elevated': '#494d64', '--text': '#cad3f5', '--text-muted': '#a5adcb', '--text-faint': '#8087a2', '--border': 'rgba(202,211,245,0.12)', '--accent': '#ed8796' } },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', vars: { '--bg': '#1e1e2e', '--bg-soft': '#181825', '--surface': '#313244', '--surface-elevated': '#45475a', '--text': '#cdd6f4', '--text-muted': '#a6adc8', '--text-faint': '#7f849c', '--border': 'rgba(205,214,244,0.12)', '--accent': '#f38ba8' } },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', vars: { '--bg': '#282828', '--bg-soft': '#1d2021', '--surface': '#3c3836', '--surface-elevated': '#504945', '--text': '#ebdbb2', '--text-muted': '#d5c4a1', '--text-faint': '#a89984', '--border': 'rgba(235,219,178,0.14)', '--accent': '#fb4934' } },
  { id: 'gruvbox-light', name: 'Gruvbox Light', vars: { '--bg': '#fbf1c7', '--bg-soft': '#f2e5bc', '--surface': '#ebdbb2', '--surface-elevated': '#d5c4a1', '--text': '#3c3836', '--text-muted': '#665c54', '--text-faint': '#928374', '--border': 'rgba(60,56,54,0.14)', '--accent': '#cc241d' } },
  { id: 'dracula', name: 'Dracula', vars: { '--bg': '#282a36', '--bg-soft': '#21222c', '--surface': '#44475a', '--surface-elevated': '#565973', '--text': '#f8f8f2', '--text-muted': '#bfbfbf', '--text-faint': '#6272a4', '--border': 'rgba(248,248,242,0.12)', '--accent': '#ff79c6' } },
  { id: 'nord', name: 'Nord', vars: { '--bg': '#2e3440', '--bg-soft': '#292e39', '--surface': '#3b4252', '--surface-elevated': '#434c5e', '--text': '#eceff4', '--text-muted': '#d8dee9', '--text-faint': '#4c566a', '--border': 'rgba(236,239,244,0.12)', '--accent': '#88c0d0' } },
  { id: 'tokyo-night', name: 'Tokyo Night', vars: { '--bg': '#1a1b26', '--bg-soft': '#16161e', '--surface': '#24283b', '--surface-elevated': '#2f3549', '--text': '#c0caf5', '--text-muted': '#9aa5ce', '--text-faint': '#565f89', '--border': 'rgba(192,202,245,0.12)', '--accent': '#7aa2f7' } },
  { id: 'one-dark', name: 'One Dark', vars: { '--bg': '#282c34', '--bg-soft': '#21252b', '--surface': '#353b45', '--surface-elevated': '#3e4451', '--text': '#abb2bf', '--text-muted': '#828997', '--text-faint': '#5c6370', '--border': 'rgba(171,178,191,0.14)', '--accent': '#61afef' } },
  { id: 'solarized-dark', name: 'Solarized Dark', vars: { '--bg': '#002b36', '--bg-soft': '#00212b', '--surface': '#073642', '--surface-elevated': '#0b4a5a', '--text': '#839496', '--text-muted': '#708183', '--text-faint': '#586e75', '--border': 'rgba(131,148,150,0.16)', '--accent': '#268bd2' } },
  { id: 'solarized-light', name: 'Solarized Light', vars: { '--bg': '#fdf6e3', '--bg-soft': '#f5efdc', '--surface': '#eee8d5', '--surface-elevated': '#e2d9c2', '--text': '#657b83', '--text-muted': '#839496', '--text-faint': '#93a1a1', '--border': 'rgba(101,123,131,0.2)', '--accent': '#268bd2' } },
  { id: 'rose-pine', name: 'Rosé Pine', vars: { '--bg': '#191724', '--bg-soft': '#12111a', '--surface': '#1f1d2e', '--surface-elevated': '#26233a', '--text': '#e0def4', '--text-muted': '#c4c2dd', '--text-faint': '#908caa', '--border': 'rgba(224,222,244,0.12)', '--accent': '#eb6f92' } },
  { id: 'everforest-dark', name: 'Everforest Dark', vars: { '--bg': '#2d353b', '--bg-soft': '#232a2f', '--surface': '#3d484d', '--surface-elevated': '#4a555b', '--text': '#d3c6aa', '--text-muted': '#b8ab8d', '--text-faint': '#859289', '--border': 'rgba(211,198,170,0.14)', '--accent': '#e67e80' } },
  { id: 'kanagawa', name: 'Kanagawa', vars: { '--bg': '#1f1f28', '--bg-soft': '#1a1a22', '--surface': '#2a2a37', '--surface-elevated': '#363646', '--text': '#dcd7ba', '--text-muted': '#b8b29e', '--text-faint': '#727169', '--border': 'rgba(220,215,186,0.12)', '--accent': '#7e9cd8' } },
  { id: 'monokai', name: 'Monokai', vars: { '--bg': '#272822', '--bg-soft': '#1e1f1c', '--surface': '#3e3d32', '--surface-elevated': '#49483e', '--text': '#f8f8f2', '--text-muted': '#cfcfc2', '--text-faint': '#75715e', '--border': 'rgba(248,248,242,0.12)', '--accent': '#f92672' } },
]

export const DEFAULT_THEME_ID = 'aeri-dark'

export function getThemeById(id: string | null | undefined): ThemeDef {
  return THEMES.find(t => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: string) {
  try {
    const theme = getThemeById(id)
    document.documentElement.dataset.theme = theme.id
  } catch {}
}
