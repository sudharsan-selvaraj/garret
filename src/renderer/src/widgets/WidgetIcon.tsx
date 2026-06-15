import type { WidgetIconType } from '@sdk'

interface Props {
  icon?: WidgetIconType
  size?: number
  className?: string
}

/** Renders a widget icon whether it's an emoji string or a React icon component. */
export function WidgetIcon({ icon, size = 16, className }: Props): JSX.Element | null {
  if (!icon) return null
  if (typeof icon === 'string') {
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {icon}
      </span>
    )
  }
  const Icon = icon
  return <Icon size={size} strokeWidth={1.75} className={className} />
}
