import React from 'react'
import { StyleSheet, View } from 'react-native'
import { spacing } from '../../../../shared/theme/tokens'

export default function Grid({ columns = 1, children, style, gap = spacing.md }) {
  const itemWidth = 100 / Math.max(1, Math.min(3, columns))
  return (
    <View style={[styles.grid, { marginHorizontal: -(gap / 2) }, style]}>
      {React.Children.map(children, (child, index) => (
        <View key={index} style={[styles.cell, { width: `${itemWidth}%`, padding: gap / 2 }]}>
          {child}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    alignSelf: 'stretch',
  },
})
