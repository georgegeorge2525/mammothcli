import React, { useState } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { MessageList } from './MessageList.js'
import { MammothPrompt } from './Prompt.js'
import { AgentStatus } from './AgentStatus.js'

export interface MammothMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
}

export const MammothApp: React.FC<{
  onSend: (
    prompt: string,
    addMsg: (msg: MammothMessage) => void,
    setTools: (tools: string[]) => void
  ) => Promise<void>
  onExit: () => void
}> = ({ onSend, onExit }) => {
  const [messages, setMessages] = useState<MammothMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const { exit } = useApp()

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit()
      exit()
    }
  })

  const addMessage = (msg: MammothMessage) => {
    setMessages(prev => [...prev, msg])
  }

  const setTools = (tools: string[]) => {
    setActiveTools(tools)
  }

  const handleSend = async (prompt: string) => {
    const userMsg: MammothMessage = { role: 'user', content: prompt }
    setMessages(prev => [...prev, userMsg])
    setIsThinking(true)
    try {
      await onSend(prompt, addMessage, setTools)
    } finally {
      setIsThinking(false)
      setActiveTools([])
    }
  }

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <MessageList messages={messages} />
      </Box>
      <AgentStatus isThinking={isThinking} activeTools={activeTools} />
      <MammothPrompt onSubmit={handleSend} isDisabled={isThinking} />
    </Box>
  )
}