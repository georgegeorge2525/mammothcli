import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'

const SpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const ThinkingSpinner: React.FC = () => {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % SpinnerFrames.length), 80)
    return () => clearInterval(timer)
  }, [])
  return <Text color="#888888">{SpinnerFrames[frame]} </Text>
}

export const AgentStatus: React.FC<{
  isThinking: boolean
  activeTools: string[]
  workflowCount?: number
  memoryFacts?: number
}> = ({ isThinking, activeTools, workflowCount, memoryFacts }) => {
  if (!isThinking && activeTools.length === 0 && !workflowCount && !memoryFacts) return null

  return (
    <Box flexDirection="row" paddingY={1}>
      {isThinking && (
        <Box marginRight={2}>
          <ThinkingSpinner />
          <Text color="#888888">Thinking...</Text>
        </Box>
      )}
      {activeTools.map((tool, i) => (
        <Box key={i} marginRight={1}>
          <Text color="#00ffff" backgroundColor="#333333">
            [{tool}]
          </Text>
        </Box>
      ))}
      {workflowCount != null && workflowCount > 0 && (
        <Box marginRight={1}>
          <Text color="#00ff00" backgroundColor="#333333">
            [{workflowCount}w]
          </Text>
        </Box>
      )}
      {memoryFacts != null && memoryFacts > 0 && (
        <Box marginRight={1}>
          <Text color="#ffff00" backgroundColor="#333333">
            [{memoryFacts}f]
          </Text>
        </Box>
      )}
    </Box>
  )
}
