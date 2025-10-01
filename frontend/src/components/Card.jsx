const Card = ({
  as = 'div',
  title,
  subtitle,
  actions,
  footer,
  className = '',
  children,
  padding = 'default',
  ...rest
}) => {
  const ElementTag = as
  const classNames = [
    'card',
    padding === 'compact' ? 'card-compact' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <ElementTag className={classNames} {...rest}>
      {(title || subtitle || actions) && (
        <div className="card-header">
          <div className="card-titles">
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p className="label">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      )}
      <div className="card-body">
        {children}
      </div>
      {footer ? <div className="card-footer">{footer}</div> : null}
    </ElementTag>
  )
}

export default Card
