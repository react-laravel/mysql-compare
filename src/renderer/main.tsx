import React from 'react'
import ReactDOM from 'react-dom/client'
import './monaco'
import App from './App'
import './index.css'
import { initializeTheme } from './theme'
import { initializeSettings } from './store/settings-store'
import { bootstrapApi } from './lib/api'

initializeTheme()
initializeSettings()

async function main(): Promise<void> {
  await bootstrapApi()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void main()
