import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Supergrain',
  description: 'A reactive store library with super fine-grained reactivity',
  base: '/supergrain/',
  ignoreDeadLinks: true,
  
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      {
        text: 'Design Directions',
        items: [
          { text: 'A — Minimal Precision', link: '/direction-a' },
          { text: 'B — Signal Flow', link: '/direction-b' },
          { text: 'C — Code Pulse', link: '/direction-c' }
        ]
      },
      { text: 'GitHub', link: 'https://github.com/commoncurriculum/supergrain' }
    ],
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/commoncurriculum/supergrain' }
    ],
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024'
    }
  }
})
