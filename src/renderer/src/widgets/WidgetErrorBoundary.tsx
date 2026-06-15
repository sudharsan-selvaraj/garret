import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  widgetName: string
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Isolates a misbehaving widget so one crash never takes down the whole board. */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[widget:${this.props.widgetName}] crashed`, error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="widget-error">
          <strong>{this.props.widgetName} failed to render</strong>
          <code>{this.state.error.message}</code>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}
