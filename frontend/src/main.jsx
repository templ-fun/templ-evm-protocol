import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Landing from './Landing.jsx'

const shouldRenderLanding = typeof window !== 'undefined' && window.location.pathname === '/'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {shouldRenderLanding ? <Landing /> : <App />}
  </StrictMode>
)
