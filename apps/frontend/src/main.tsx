import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import 'material-symbols/outlined.css'
import './index.css'

// Service worker is scaffolded but push logic is not yet implemented.
// Uncomment when VAPID keys and push handler are added.
// if ('serviceWorker' in navigator) {
//   void navigator.serviceWorker.register('/sw.js')
// }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
