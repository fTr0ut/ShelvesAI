import { forwardRef } from 'react'

const VARIANT_CLASSNAMES = {
  default: '',
  primary: 'primary',
  ghost: 'ghost',
  danger: 'danger',
}

/**
 * Versatile button component backing the reusable design system.
 * Supports semantic buttons, anchor links, or custom render targets via the `as` prop.
 */
const Button = forwardRef(function Button({
  as: Component,
  variant = 'default',
  startIcon,
  endIcon,
  fullWidth = false,
  className = '',
  children,
  href,
  ...rest
}, ref) {
  const classNames = [
    'btn',
    VARIANT_CLASSNAMES[variant] || '',
    fullWidth ? 'full-width' : '',
    className,
  ].filter(Boolean).join(' ')

  const Element = Component || (href ? 'a' : 'button')

  const elementProps = {
    className: classNames,
    href,
    ...rest,
  }

  if (!Component && !href && elementProps.type === undefined) {
    elementProps.type = 'button'
  }

  return (
    <Element
      ref={ref}
      {...elementProps}
    >
      {startIcon ? <span className="btn-icon start">{startIcon}</span> : null}
      <span className="btn-content">{children}</span>
      {endIcon ? <span className="btn-icon end">{endIcon}</span> : null}
    </Element>
  )
})

export default Button
