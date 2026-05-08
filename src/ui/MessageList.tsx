import React from 'react'
import { Box, Text } from 'ink'
import type { MammothMessage } from './App.js'

const RoleColors: Record<string, string> = {
  user: '#00ff00',
  assistant: '#ffffff',
  system: '#888888',
  tool: '#00ffff',
}

export const MessageList: React.FC<{ messages: MammothMessage[] }> = ({ messages }) => {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column" marginY={1}>
          <Text color={RoleColors[msg.role] || '#ffffff'} bold>
            {msg.role === 'user' ? '> ' : msg.role === 'assistant' ? '' : `[${msg.role}] `}
          </Text>
          <Text>{msg.content}</Text>
          {msg.thinking && (
            <Text color="#666666" italic>
              [think] {msg.thinking.slice(0, 200)}...
            </Text>
          )}
          {msg.toolCalls?.map((tc, j) => (
            <Text key={j} color="#00ffff">
              [tool] {tc.name}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
