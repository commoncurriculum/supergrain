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
          { text: 'A — Golden Harvest', link: '/direction-a' },
          { text: 'B — Super Grain', link: '/direction-b' },
          { text: 'C — Grain Field', link: '/direction-c' }
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
