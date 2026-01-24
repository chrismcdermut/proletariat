import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { TextInput, Spinner } from '@inkjs/ui';

interface Ticket {
  id: string;
  title: string;
  assignee: string;
}

interface ClaimTicketUIProps {
  tickets: Ticket[];
  needsAgentName: boolean;
  defaultAgentName?: string;
  onComplete: (data: { ticketId: string; agentName: string }) => void;
}

export function ClaimTicketUI({ 
  tickets, 
  needsAgentName, 
  defaultAgentName = '', 
  onComplete 
}: ClaimTicketUIProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<'select' | 'agent' | 'done'>(
    tickets.length === 0 ? 'done' : 'select'
  );
  const [selectedTicket, setSelectedTicket] = useState('');
  const [agentName, setAgentName] = useState(defaultAgentName);

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
  });

  if (tickets.length === 0) {
    return (
      <Box padding={1}>
        <Text color="yellow">No tickets available in backlog.</Text>
      </Box>
    );
  }

  const ticketItems = tickets.map(ticket => ({
    label: `${ticket.id} - ${ticket.title}`,
    value: ticket.id
  }));

  const handleTicketSelect = (item: { label: string; value: string }) => {
    setSelectedTicket(item.value);
    if (needsAgentName && !defaultAgentName) {
      setStep('agent');
    } else {
      onComplete({ ticketId: item.value, agentName: agentName || defaultAgentName });
      setStep('done');
      setTimeout(() => exit(), 100);
    }
  };

  const handleAgentSubmit = (value: string) => {
    if (value.trim()) {
      setAgentName(value);
      onComplete({ ticketId: selectedTicket, agentName: value });
      setStep('done');
      setTimeout(() => exit(), 100);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          🎯 Claim Ticket
        </Text>
      </Box>

      {step === 'select' && (
        <Box flexDirection="column">
          <Text>Select ticket to claim:</Text>
          <Box marginTop={1}>
            <SelectInput items={ticketItems} onSelect={handleTicketSelect} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} available
            </Text>
          </Box>
        </Box>
      )}

      {step === 'agent' && (
        <Box flexDirection="column">
          <Text>Enter agent name:</Text>
          <Box marginTop={1}>
            <Text color="gray">› </Text>
            <TextInput 
              defaultValue={agentName}
              onSubmit={handleAgentSubmit}
              placeholder={process.env.USER || 'agent'}
            />
          </Box>
        </Box>
      )}

      {step === 'done' && (
        <Box>
          <Text color="green">
            <Spinner type="dots" /> Claiming ticket...
          </Text>
        </Box>
      )}
    </Box>
  );
}