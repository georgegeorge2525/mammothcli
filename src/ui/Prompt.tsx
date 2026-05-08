import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

export const MammothPrompt: React.FC<{
  onSubmit: (value: string) => void
  isDisabled: boolean
}> = ({ onSubmit, isDisabled }) => {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (isDisabled) return

    if (key.return && value.trim()) {
      onSubmit(value.trim())
      setValue('')
      setCursor(0)
    } else if (key.backspace || key.delete) {
      setValue(prev => {
        const before = prev.slice(0, cursor - 1)
        const after = prev.slice(cursor)
        setCursor(Math.max(0, cursor - 1))
        return before + after
      })
    } else if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1))
    } else if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1))
    } else if (input && !key.ctrl && !key.meta) {
      setValue(prev => {
        const before = prev.slice(0, cursor)
        const after = prev.slice(cursor)
        setCursor(cursor + input.length)
        return before + input + after
      })
    }
  })

  if (isDisabled) {
    return (
      <Box paddingTop={1}>
        <Text color="#666666">Processing...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" paddingTop={1}>
      <Text color="#00ff00" bold>{'> '}</Text>
      <Text>{value.slice(0, cursor)}</Text>
      <Text backgroundColor="#ffffff" color="#000000">{value[cursor] || ' '}</Text>
      <Text>{value.slice(cursor + 1)}</Text>
    </Box>
  )
}
