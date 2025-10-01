const Hero = ({
  as = 'div',
  title,
  description,
  eyebrow,
  actions,
  className = '',
  children,
  ...rest
}) => {
  const ElementTag = as
  const classNames = ['hero', className].filter(Boolean).join(' ')
  return (
    <ElementTag className={classNames} {...rest}>
      {eyebrow ? <span className="hero-eyebrow label">{eyebrow}</span> : null}
      {title ? <h1>{title}</h1> : null}
      {description ? <p className="label">{description}</p> : null}
      {children}
      {actions ? <div className="hero-actions">{actions}</div> : null}
    </ElementTag>
  )
}

export default Hero
