const COLUMN_CLASSNAMES = {
  1: '',
  2: 'grid-2',
  3: 'grid-3',
}

const Grid = ({ as = 'div', columns = 1, className = '', children, ...rest }) => {
  const ElementTag = as
  const normalizedColumns = Number(columns) || 1
  const columnClass = COLUMN_CLASSNAMES[normalizedColumns] || ''
  const classNames = ['grid', columnClass, className].filter(Boolean).join(' ')

  return (
    <ElementTag className={classNames} {...rest}>
      {children}
    </ElementTag>
  )
}

export default Grid
