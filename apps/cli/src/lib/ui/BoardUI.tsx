import React, { useState } from 'react';
import { Box, Text, useApp, useInput, Spacer } from 'ink';

interface BoardSection {
  title: string;
  icon: string;
  tickets: Array<{
    id: string;
    title: string;
    completed: boolean;
    assignee: string;
    priority?: string;
    queue?: string;
  }>;
}

interface BoardUIProps {
  boardTitle: string;
  sections: BoardSection[];
  onEdit?: () => void;
  onOpen?: () => void;
}

export function BoardUI({ boardTitle, sections, onEdit, onOpen }: BoardUIProps) {
  const { exit } = useApp();
  const [selectedSection, setSelectedSection] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      exit();
    }
    if (key.leftArrow) {
      setSelectedSection(prev => Math.max(0, prev - 1));
    }
    if (key.rightArrow) {
      setSelectedSection(prev => Math.min(sections.length - 1, prev + 1));
    }
    if (input === 'e' && onEdit) {
      onEdit();
      exit();
    }
    if (input === 'o' && onOpen) {
      onOpen();
      exit();
    }
  });

  const getPriorityColor = (priority?: string): string => {
    switch (priority) {
      case 'high': return 'red';
      case 'medium': return 'yellow';
      case 'low': return 'green';
      default: return 'gray';
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          📋 {boardTitle}
        </Text>
        <Spacer />
        <Text dimColor>
          ← → Navigate | e: Edit | o: Open in Obsidian | q: Quit
        </Text>
      </Box>

      {/* Board Sections */}
      <Box>
        {sections.map((section, index) => (
          <Box 
            key={section.title}
            flexDirection="column" 
            width="25%"
            marginRight={1}
            borderStyle={selectedSection === index ? 'double' : 'single'}
            borderColor={selectedSection === index ? 'cyan' : 'gray'}
            padding={1}
          >
            {/* Section Title */}
            <Box marginBottom={1}>
              <Text bold color={selectedSection === index ? 'cyan' : 'white'}>
                {section.icon} {section.title}
              </Text>
            </Box>

            {/* Tickets */}
            {section.tickets.length === 0 ? (
              <Text dimColor italic>No tickets</Text>
            ) : (
              section.tickets.map(ticket => (
                <Box key={ticket.id} marginBottom={1}>
                  <Text>
                    {ticket.completed ? '✅' : '☐'} {ticket.id}
                  </Text>
                  <Box marginLeft={2}>
                    <Text wrap="truncate">
                      {ticket.title}
                    </Text>
                  </Box>
                  {(ticket.priority || ticket.queue || ticket.assignee) && (
                    <Box marginLeft={2}>
                      {ticket.priority && (
                        <Text color={getPriorityColor(ticket.priority)}>
                          #{ticket.priority}{' '}
                        </Text>
                      )}
                      {ticket.queue && (
                        <Text color="blue">
                          +{ticket.queue}{' '}
                        </Text>
                      )}
                      {ticket.assignee && (
                        <Text color="magenta">
                          @{ticket.assignee}
                        </Text>
                      )}
                    </Box>
                  )}
                </Box>
              ))
            )}

            {/* Ticket Count */}
            <Box marginTop={1}>
              <Text dimColor>
                {section.tickets.length} ticket{section.tickets.length !== 1 ? 's' : ''}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Summary */}
      <Box marginTop={1}>
        <Text dimColor>
          Total: {sections.reduce((sum, s) => sum + s.tickets.length, 0)} tickets
        </Text>
        <Text dimColor> | </Text>
        <Text color="green">
          Done: {sections.find(s => s.title === 'Done')?.tickets.length || 0}
        </Text>
        <Text dimColor> | </Text>
        <Text color="yellow">
          Active: {
            sections
              .filter(s => ['In Progress', 'In Review', 'Blocked'].includes(s.title))
              .reduce((sum, s) => sum + s.tickets.length, 0)
          }
        </Text>
      </Box>
    </Box>
  );
}