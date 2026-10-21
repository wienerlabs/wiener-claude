import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/sora'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { DEMO } from './lib/demo.ts'
import { useLang } from './lib/i18n.ts'
import { registerApp } from './lib/install.ts'

if (import.meta.env.PROD && !DEMO) registerApp()

/** A language change remounts the app: every text, number and fetched answer follows it. */
function Root() {
  const lang = useLang()
  return <App key={lang} />
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
