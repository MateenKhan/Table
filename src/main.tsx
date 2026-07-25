import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ToastProvider, ConfirmProvider } from './piranha'

import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Failed to find the root element')

// Provider contract mirrors piranha (§9): MotionConfig honours the user's
// reduced-motion preference for every framer-motion animation (the confirm
// dialog + toasts), then ToastProvider (useToast) and ConfirmProvider
// (useConfirm) so any component under <App/> can reach them without prop
// drilling. At import into piranha these are already mounted app-wide.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  </React.StrictMode>,
)
