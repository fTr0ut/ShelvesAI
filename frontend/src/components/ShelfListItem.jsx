import Button from './Button.jsx'

const ShelfListItem = ({
  as = 'li',
  name,
  typeLabel,
  visibilityLabel,
  description,
  href,
  actions,
  className = '',
  children,
  onClick,
  ...rest
}) => {
  const ElementTag = as
  const classNames = ['shelf-list-item', className].filter(Boolean).join(' ')
  const content = (
    <div className="shelf-list-content" onClick={onClick}>
      <div className="shelf-list-header">
        {name ? <span className="shelf-list-name">{name}</span> : null}
        {typeLabel ? <span className="pill">{typeLabel}</span> : null}
        {visibilityLabel ? <span className="pill visibility">{visibilityLabel}</span> : null}
      </div>
      {description ? <p className="label">{description}</p> : null}
      {children}
    </div>
  )

  return (
    <ElementTag className={classNames} {...rest}>
      {href ? <a className="item-link" href={href}>{content}</a> : content}
      {actions ? (
        <div className="shelf-list-actions">
          {Array.isArray(actions) ? actions.map((action, index) => (
            <span key={index} className="shelf-list-action">
              {action}
            </span>
          )) : actions}
        </div>
      ) : null}
    </ElementTag>
  )
}

ShelfListItem.ActionButton = Button

export default ShelfListItem
