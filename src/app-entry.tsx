// The planner (React). Loaded only on #/dashboard, so its styles never mix with the 3D scenes'.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
