import { createRoot } from 'react-dom/client'
import { Component, type ReactNode } from 'react'
import App from './App'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './styles/global.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('React crash:', error) }
  render() {
    if (this.state.error) return <pre style={{ padding: 20, color: 'red' }}>{this.state.error.message + '\n' + this.state.error.stack}</pre>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
