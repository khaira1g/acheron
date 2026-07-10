import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';

const MAX_ROUNDS = 3;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const ScrollView = ({ text, maxLines, placeholder, scrollOffset }: { text: string; maxLines: number; placeholder: string; scrollOffset: number }) => {
  if (!text) {
    return <Text color="dim">{placeholder}</Text>;
  }
  
  const lines = text.split('\n');
  const maxOffset = Math.max(0, lines.length - maxLines);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  
  const start = Math.max(0, lines.length - maxLines - clampedOffset);
  const end = lines.length - clampedOffset;
  const visibleLines = lines.slice(start, end);

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => {
        const isThought = line.includes('<thought>') || line.includes('</thought>') || line.startsWith('//') || line.startsWith('[');
        return (
          <Text key={i} wrap="wrap" color={isThought ? 'gray' : 'white'}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
};

const App = () => {
  const [input, setInput] = useState('');
  const [agentAOutput, setAgentAOutput] = useState('');
  const [agentBOutput, setAgentBOutput] = useState('');
  const [finalOutput, setFinalOutput] = useState('');
  const [currentRound, setCurrentRound] = useState(0);
  const [systemLogs, setSystemLogs] = useState<string[]>(['Core engine online. Standing by for instructions.']);
  const [isStreaming, setIsStreaming] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [scrollOffsets, setScrollOffsets] = useState({ executor: 0, critic: 0, final: 0 });
  
  const [agentAStatus, setAgentAStatus] = useState<'idle' | 'vram_load' | 'streaming'>('idle');
  const [agentBStatus, setAgentBStatus] = useState<'idle' | 'vram_load' | 'streaming'>('idle');

  const logMessage = (msg: string) => {
    setSystemLogs(prev => [...prev, msg].slice(-3));
  };

  useInput((inputStr, key) => {
    if (key.tab) {
      setFocusIndex(prev => (prev + 1) % 4);
      return;
    }

    if (focusIndex === 1) {
      const totalLines = agentAOutput.split('\n').length;
      if (key.upArrow) setScrollOffsets(prev => ({ ...prev, executor: Math.min(prev.executor + 1, Math.max(0, totalLines - 8)) }));
      if (key.downArrow) setScrollOffsets(prev => ({ ...prev, executor: Math.max(0, prev.executor - 1) }));
    }
    if (focusIndex === 2) {
      const totalLines = agentBOutput.split('\n').length;
      if (key.upArrow) setScrollOffsets(prev => ({ ...prev, critic: Math.min(prev.critic + 1, Math.max(0, totalLines - 8)) }));
      if (key.downArrow) setScrollOffsets(prev => ({ ...prev, critic: Math.max(0, prev.critic - 1) }));
    }
    if (focusIndex === 3) {
      const totalLines = finalOutput.split('\n').length;
      if (key.upArrow) setScrollOffsets(prev => ({ ...prev, final: Math.min(prev.final + 1, Math.max(0, totalLines - 8)) }));
      if (key.downArrow) setScrollOffsets(prev => ({ ...prev, final: Math.max(0, prev.final - 1) }));
    }
  });

  const runSimulation = async (userPrompt: string) => {
    setIsStreaming(true);
    setAgentAOutput('');
    setAgentBOutput('');
    setFinalOutput('');
    setCurrentRound(1);
    setScrollOffsets({ executor: 0, critic: 0, final: 0 });

    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const agentAModel = process.env.AGENT_A_MODEL || 'qwen3.5:4b';
    const agentBModel = process.env.AGENT_B_MODEL || 'llama3.2:3b';

    let historyA: Message[] = [
      {
        role: 'system',
        content: `You are an advanced, autonomous agent operating under the HERMES protocol. You possess extreme technical competence and zero verbosity. For every objective, you MUST structure your response as follows:\n<thought>\nDeconstruct the user prompt here.\n</thought>\nProvide your final response here.`
      },
      { role: 'user', content: userPrompt }
    ];
    
    let lastAgentAOutput = '';
    let lastAgentBOutput = '';
    let buffer = '';

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      setCurrentRound(round);
      
      // agent a
      setAgentAStatus('vram_load');
      logMessage(`[Round ${round}/${MAX_ROUNDS}] Agent A initializing...`);
      
      try {
        const responseA = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            model: agentAModel, 
            messages: historyA, 
            stream: true,
            options: { num_ctx: 8192 }
          })
        });

        if (!responseA.ok) throw new Error(`Ollama HTTP status ${responseA.status}`);
        const readerA = responseA.body?.getReader();
        const decoder = new TextDecoder();
        if (!readerA) throw new Error('Unreadable stream context.');

        let currentTokensA = '';
        buffer = '';
        while (true) {
          const { done, value } = await readerA.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.error) throw new Error(`Ollama Engine Error: ${json.error}`);
              
              if (json.message?.content) {
                if (agentAStatus !== 'streaming') setAgentAStatus('streaming');
                currentTokensA += json.message.content;
                setAgentAOutput(currentTokensA);
                setScrollOffsets(prev => ({ ...prev, executor: 0 }));
              }
            } catch (e: any) {
              if (e.message?.includes('Ollama Engine Error')) throw e;
            }
          }
        }

        setAgentAStatus('idle');

        if (currentTokensA.trim()) {
          lastAgentAOutput = currentTokensA;
          historyA.push({ role: 'assistant', content: lastAgentAOutput });
        } else {
          logMessage(`[Warning] Agent A round ${round} returned an empty token frame.`);
        }
        
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setAgentAStatus('idle');
        logMessage(`[Fatal Error A]: ${errMsg}`);
        setIsStreaming(false);
        return;
      }

      if (round === MAX_ROUNDS) break;

      // agent b
      setAgentBStatus('vram_load');
      logMessage(`[Round ${round}/${MAX_ROUNDS}] Agent B initializing...`);
      
      try {
        const responseB = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: agentBModel,
            messages: [
              { role: 'system', content: 'You are the Critic. Analyze the Executor\'s output. Look past their <thought> process and stress-test their actual logic.' },
              { role: 'user', content: `Target Goal: "${userPrompt}"\n\nExecutor's Current Build:\n${lastAgentAOutput}` }
            ],
            stream: true,
            options: { num_ctx: 8192 }
          })
        });

        if (!responseB.ok) throw new Error(`Ollama HTTP status ${responseB.status}`);
        const readerB = responseB.body?.getReader();
        const decoder = new TextDecoder();
        if (!readerB) throw new Error('Unreadable stream context.');

        let currentTokensB = '';
        buffer = '';
        while (true) {
          const { done, value } = await readerB.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.error) throw new Error(`Ollama Engine Error: ${json.error}`);
              
              if (json.message?.content) {
                if (agentBStatus !== 'streaming') setAgentBStatus('streaming');
                currentTokensB += json.message.content;
                setAgentBOutput(currentTokensB);
                setScrollOffsets(prev => ({ ...prev, critic: 0 }));
              }
            } catch (e: any) {
              if (e.message?.includes('Ollama Engine Error')) throw e;
            }
          }
        }

        setAgentBStatus('idle');

        if (currentTokensB.trim()) {
          lastAgentBOutput = currentTokensB;
          historyA.push({ 
            role: 'user', 
            content: `CRITIQUE PACKET RECEIVED:\n${lastAgentBOutput}\n\nRe-enter your scratchpad loop, resolve these flaws, and optimize the build.` 
          });
        }

      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setAgentBStatus('idle');
        logMessage(`[Fatal Error B]: ${errMsg}`);
        setIsStreaming(false);
        return;
      }
    }

    logMessage('All iterations compiled. Output finalized.');
    const cleanFinal = lastAgentAOutput.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
    setFinalOutput(cleanFinal || lastAgentAOutput);
    setScrollOffsets(prev => ({ ...prev, final: 0 }));
    setIsStreaming(false);
  };

  const handleSubmit = (value: string) => {
    if (isStreaming || !value.trim()) return;
    logMessage(`Task Queued: ${value.trim()}`);
    setInput('');
    runSimulation(value.trim());
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Real-time Subsystem Monitors */}
      <Box height={12} flexDirection="row" marginBottom={1}>
        <Box borderStyle="round" borderColor={focusIndex === 1 ? 'green' : 'dim'} flexGrow={1} marginRight={1} flexDirection="column" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={focusIndex === 1 ? 'greenBright' : 'cyan'}>
              {focusIndex === 1 ? '▶ ' : '  '}HERMES_EXEC_CORE {isStreaming && `[R-${currentRound}]`}
            </Text>
            {agentAStatus === 'vram_load' && <Text color="yellow">⚙ [VRAM SWAP]</Text>}
            {agentAStatus === 'streaming' && <Text color="greenBright">⚡ [STREAMING]</Text>}
          </Box>
          <Box marginTop={1}>
            <ScrollView text={agentAOutput} maxLines={8} placeholder="Awaiting handshake..." scrollOffset={scrollOffsets.executor} />
          </Box>
        </Box>
        
        <Box borderStyle="round" borderColor={focusIndex === 2 ? 'green' : 'dim'} flexGrow={1} marginLeft={1} flexDirection="column" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={focusIndex === 2 ? 'greenBright' : 'magenta'}>
              {focusIndex === 2 ? '▶ ' : '  '}CRITIC_STRESS_MONITOR {isStreaming && `[R-${currentRound}]`}
            </Text>
            {agentBStatus === 'vram_load' && <Text color="yellow">⚙ [VRAM SWAP]</Text>}
            {agentBStatus === 'streaming' && <Text color="greenBright">⚡ [STREAMING]</Text>}
          </Box>
          <Box marginTop={1}>
            <ScrollView text={agentBOutput} maxLines={8} placeholder="Monitoring stream matrices..." scrollOffset={scrollOffsets.critic} />
          </Box>
        </Box>
      </Box>

      {/* Pristine Final Sandbox Output Block */}
      <Box borderStyle="round" borderColor={focusIndex === 3 ? 'green' : 'dim'} height={12} flexDirection="column" paddingX={1} marginBottom={1}>
        <Text bold color={focusIndex === 3 ? 'greenBright' : 'white'}>
          {focusIndex === 3 ? '▶ ' : '  '}PRISTINE_FINAL_BUILD {scrollOffsets.final > 0 && `(^${scrollOffsets.final})`}
        </Text>
        <Box marginTop={1}>
          <ScrollView text={finalOutput} maxLines={8} placeholder="Awaiting sandbox compiler loop..." scrollOffset={scrollOffsets.final} />
        </Box>
      </Box>

      {/* Framework Log Activity */}
      <Box borderStyle="single" borderColor="yellow" height={5} flexDirection="column" paddingX={1}>
        {systemLogs.map((log, i) => (
          <Text key={i} color="gray" wrap="truncate">⌁ {log}</Text>
        ))}
      </Box>

      {/* Dynamic Terminal Input and Toolbar */}
      <Box marginTop={1} height={1} flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold color={focusIndex === 0 ? 'greenBright' : 'white'}>$ </Text>
          {isStreaming ? (
            <Text color="yellow">Executing Pipeline Vectors...</Text>
          ) : (
            <TextInput focus={focusIndex === 0} value={input} onChange={setInput} onSubmit={handleSubmit} />
          )}
        </Box>
        <Text color="dim">[TAB] Navigate | [▲/▼] Scroll Viewport</Text>
      </Box>
    </Box>
  );
};

export default App;