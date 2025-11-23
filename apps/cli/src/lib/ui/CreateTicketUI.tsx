import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { TextInput, Spinner } from '@inkjs/ui';

interface CreateTicketUIProps {
  initialTitle?: string;
  queues: string[];
  onComplete: (data: {
    title: string;
    priority: 'high' | 'medium' | 'low';
    queue: string;
    description: string;
  }) => void;
}

export function CreateTicketUI({ initialTitle, queues, onComplete }: CreateTicketUIProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<'title' | 'priority' | 'queue' | 'description' | 'done'>(
    initialTitle ? 'priority' : 'title'
  );
  const [title, setTitle] = useState(initialTitle || '');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [queue, setQueue] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
  });

  const priorityItems = [
    { label: '🔴 High', value: 'high' },
    { label: '🟡 Medium', value: 'medium' },
    { label: '🟢 Low', value: 'low' }
  ];

  const queueItems = queues.map(q => ({
    label: `${getQueueIcon(q)} ${q.charAt(0).toUpperCase() + q.slice(1)}`,
    value: q
  }));

  function getQueueIcon(queue: string): string {
    const icons: Record<string, string> = {
      feature: '✨',
      bug: '🐛',
      refactor: '🔧',
      docs: '📚',
      devops: '⚙️',
      research: '🔬'
    };
    return icons[queue.toLowerCase()] || '📋';
  }

  const handleTitleSubmit = (value: string) => {
    if (value.trim()) {
      setTitle(value);
      setStep('priority');
    }
  };

  const handlePrioritySelect = (item: any) => {
    setPriority(item.value);
    setStep('queue');
  };

  const handleQueueSelect = (item: any) => {
    setQueue(item.value);
    setStep('description');
  };

  const handleDescriptionSubmit = (value: string) => {
    setDescription(value || getDefaultDescription());
    setIsSubmitting(true);
    onComplete({
      title,
      priority,
      queue,
      description: value || getDefaultDescription()
    });
    setStep('done');
    setTimeout(() => exit(), 100);
  };

  const getDefaultDescription = () => {
    return `## Description

## Acceptance Criteria
- [ ] 

## Technical Notes
`;
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          🎫 Create New Ticket
        </Text>
      </Box>

      {step === 'title' && (
        <Box flexDirection="column">
          <Text>Enter ticket title:</Text>
          <Box marginTop={1}>
            <Text color="gray">› </Text>
            <TextInput defaultValue={title} onSubmit={handleTitleSubmit} />
          </Box>
        </Box>
      )}

      {step === 'priority' && (
        <Box flexDirection="column">
          <Text>Select priority:</Text>
          <Box marginTop={1}>
            <SelectInput items={priorityItems} onSelect={handlePrioritySelect} />
          </Box>
        </Box>
      )}

      {step === 'queue' && (
        <Box flexDirection="column">
          <Text>Select queue/category:</Text>
          <Box marginTop={1}>
            <SelectInput items={queueItems} onSelect={handleQueueSelect} />
          </Box>
        </Box>
      )}

      {step === 'description' && (
        <Box flexDirection="column">
          <Text>Enter description (optional, press Enter to skip):</Text>
          <Box marginTop={1}>
            <Text color="gray">› </Text>
            <TextInput 
              defaultValue={description}
              onSubmit={handleDescriptionSubmit}
              placeholder="Press Enter to use default template..."
            />
          </Box>
        </Box>
      )}

      {step === 'done' && (
        <Box>
          {isSubmitting ? (
            <Text color="green">
              <Spinner type="dots" /> Creating ticket...
            </Text>
          ) : (
            <Text color="green">✅ Ticket data collected!</Text>
          )}
        </Box>
      )}

      {/* Progress indicator */}
      {step !== 'done' && (
        <Box marginTop={1}>
          <Text dimColor>
            Step: {step === 'title' ? '1/4' : step === 'priority' ? '2/4' : step === 'queue' ? '3/4' : '4/4'}
          </Text>
        </Box>
      )}
    </Box>
  );
}