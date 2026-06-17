import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

// One renderer build serves two windows; the role picks which UI to mount.
if (window.garret.windowRole === 'clipboard') {
  void import('./clipboard/ClipboardPicker').then(({ ClipboardPicker }) =>
    root.render(
      <React.StrictMode>
        <ClipboardPicker />
      </React.StrictMode>
    )
  )
} else {
  void import('./app/App').then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  )
}
