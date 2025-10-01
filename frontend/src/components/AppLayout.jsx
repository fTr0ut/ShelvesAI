const AppLayout = ({ as = 'div', className = '', children, ...rest }) => {
  const ElementTag = as
  const classNames = ['app', className].filter(Boolean).join(' ')
  return (
    <ElementTag className={classNames} {...rest}>
      {children}
    </ElementTag>
  )
}

export default AppLayout
