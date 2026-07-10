import React from 'react'
import ReactDOM from 'react-dom/client'
import './monaco'
import App from './App'
import './index.css'
import { initializeTheme } from './theme'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
