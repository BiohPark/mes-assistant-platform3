import { Component, type ReactNode } from 'react'
import { RouteErrorView } from './RouteErrorPage'

interface Props { resetKey: string; children: ReactNode }
interface State { error: unknown; resetKey: string }

/** 화면(탭) 하나의 오류 경계 — 셸과 다른 탭은 그대로 두고 그 화면만 오류 안내로 바꾼다. 위치가 바뀌면 다시 그려 본다 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined, resetKey: this.props.resetKey }
  static getDerivedStateFromError(error: unknown): Partial<State> { return { error } }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: undefined, resetKey: props.resetKey }
  }
  render() { return this.state.error === undefined ? this.props.children : <RouteErrorView error={this.state.error} /> }
}
