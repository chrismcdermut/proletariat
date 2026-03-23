import { Args, Flags } from '@oclif/core';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { Ticket } from '../../lib/pmo/types.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

/**
 * Canonical question format regex for parsing Q1/Q2/etc from descriptions.
 *
 * Matches patterns like:
 *   **Q1:** What should the timeout be?
 *   **Q2:** Should we use REST or GraphQL?
 *   Q1: What should the timeout be?
 *   Q3: How should errors be handled?
 *
 * Captures:
 *   - Group 1: Question number (e.g., "1", "2")
 *   - Group 2: Question text
 */
export const QUESTION_REGEX = /^\*{0,2}Q(\d+)[.:]\*{0,2}\s*(.+)$/;

/**
 * Canonical answer format for resolved questions.
 *
 * Matches patterns like:
 *   **A1:** Use 30 minute timeout
 *   A1: Use 30 minute timeout
 */
export const ANSWER_REGEX = /^\*{0,2}A(\d+)[.:]\*{0,2}\s*(.+)$/;

export interface ParsedQuestion {
  /** Question number (e.g., 1, 2, 3) */
  number: number;
  /** The question text */
  text: string;
  /** Line index in the description where the question appears */
  lineIndex: number;
  /** Whether this question already has an answer */
  answered: boolean;
}

/**
 * Parse questions (Q1/Q2/etc) from a ticket description.
 *
 * @param description - The ticket description markdown
 * @returns Array of parsed questions
 */
export function parseQuestions(description: string): ParsedQuestion[] {
  if (!description) return [];

  const lines = description.split('\n');
  const questions: ParsedQuestion[] = [];

  // First pass: find all questions
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(QUESTION_REGEX);
    if (match) {
      questions.push({
        number: parseInt(match[1], 10),
        text: match[2].trim(),
        lineIndex: i,
        answered: false,
      });
    }
  }

  // Second pass: check which questions already have answers
  for (const question of questions) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(ANSWER_REGEX);
      if (match && parseInt(match[1], 10) === question.number) {
        question.answered = true;
        break;
      }
    }
  }

  return questions;
}

/**
 * Rewrite a ticket description by injecting answers below each question.
 *
 * For each answered question, inserts a line like:
 *   **A1:** The answer text
 *
 * If an answer already exists for that question, it is replaced.
 *
 * @param description - The original ticket description
 * @param answers - Map of question number to answer text
 * @returns The rewritten description
 */
export function rewriteDescription(
  description: string,
  answers: Map<number, string>
): string {
  if (!description || answers.size === 0) return description;

  const lines = description.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Check if this line is an existing answer that we're replacing
    const answerMatch = trimmed.match(ANSWER_REGEX);
    if (answerMatch) {
      const answerNum = parseInt(answerMatch[1], 10);
      if (answers.has(answerNum)) {
        // Replace this existing answer with the new one
        result.push(`**A${answerNum}:** ${answers.get(answerNum)}`);
        answers.delete(answerNum); // Mark as handled
        continue;
      }
    }

    // Check if this line is a question
    const questionMatch = trimmed.match(QUESTION_REGEX);
    if (questionMatch) {
      const questionNum = parseInt(questionMatch[1], 10);
      result.push(lines[i]); // Keep the question line as-is

      // Check if the next line is already an answer for this question
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const nextAnswerMatch = nextLine.match(ANSWER_REGEX);
      if (nextAnswerMatch && parseInt(nextAnswerMatch[1], 10) === questionNum) {
        // Next line is the answer - it will be handled in the next iteration
        continue;
      }

      // Insert answer if we have one and it hasn't been handled yet
      if (answers.has(questionNum)) {
        result.push(`**A${questionNum}:** ${answers.get(questionNum)}`);
        answers.delete(questionNum);
      }
      continue;
    }

    result.push(lines[i]);
  }

  return result.join('\n');
}

export default class TicketResolve extends PMOCommand {
  static description = 'Resolve ambiguity questions on tickets flagged by groom';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %>  # Interactive picker for needs-clarification tickets',
  ];

  static strict = false;

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to resolve - prompts with picker if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(TicketResolve);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket resolve', flags));
        return
      }
      this.error(message);
    };

    // Collect ticket IDs from argv (supports multiple args)
    let ticketIds: string[] = (argv as string[]).filter(a => !a.startsWith('-'));

    if (ticketIds.length === 0) {
      // No tickets specified - show picker of needs-clarification tickets
      const allTickets = await this.storage.listTickets(projectId);
      const clarificationTickets = allTickets.filter(
        (t) =>
          t.labels.includes('needs-clarification') ||
          t.statusName?.toLowerCase() === 'needs clarification'
      );

      if (clarificationTickets.length === 0) {
        return handleError(
          'NO_TICKETS',
          'No tickets need clarification. Run "prlt work start --action groom" to groom tickets first.'
        );
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to resolve:',
        items: clarificationTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) =>
          `prlt ticket resolve ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket resolve' } : null,
      });

      if (!selected) {
        return;
      }
      ticketIds = [selected];
    }

    // Process each ticket
    for (const ticketId of ticketIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.resolveTicket(ticketId, jsonMode, flags);
    }
  }

  private async resolveTicket(
    ticketId: string,
    jsonMode: boolean,
    flags: Record<string, unknown>
  ): Promise<void> {
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket resolve', flags));
        return
      }
      this.error(message);
    };

    // Fetch the ticket
    const ticket = await this.storage.getTicket(ticketId);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
    }
    // Use resolved internal ID for all subsequent operations (external keys like PRLT-xxx resolve to TKT-xxx)
    ticketId = ticket.id;

    // Parse questions from description
    const questions = parseQuestions(ticket.description || '');
    const unanswered = questions.filter((q) => !q.answered);

    if (unanswered.length === 0) {
      if (questions.length === 0) {
        this.log(
          styles.warning(
            `\nNo questions found in ${styles.emphasis(ticketId)}. Nothing to resolve.`
          )
        );
      } else {
        this.log(
          styles.success(
            `\nAll questions in ${styles.emphasis(ticketId)} are already answered.`
          )
        );
      }
      return;
    }

    // JSON mode: output all questions for agent interaction
    if (jsonMode) {
      const questionData = unanswered.map((q) => ({
        number: q.number,
        text: q.text,
        flag: `--a${q.number}`,
      }));

      outputSuccessAsJson(
        {
          ticketId,
          title: ticket.title,
          questions: questionData,
          hint: `Answer questions by running: prlt ticket resolve ${ticketId} --json and providing answers interactively, or use prlt ticket edit to update the description directly.`,
        },
        createMetadata('ticket resolve', flags)
      );
      return;
    }

    this.log(
      styles.title(
        `\nResolving ${unanswered.length} question(s) for ${styles.emphasis(
          ticketId
        )} - ${ticket.title}\n`
      )
    );

    // Interactive mode: prompt for each answer
    const answers = new Map<number, string>();
    let cancelled = false;

    for (const question of unanswered) {
      this.log(styles.emphasis(`  Q${question.number}: ${question.text}`));

      // eslint-disable-next-line no-await-in-loop
      const { answer } = await this.prompt<{ answer: string }>([
        {
          type: 'input',
          name: 'answer',
          message: `  A${question.number}:`,
          validate: (input: unknown) => {
            if (!String(input).trim()) return 'Please provide an answer (or type "skip" to skip)';
            return true;
          },
        },
      ], null);

      if (answer.toLowerCase() === 'cancel') {
        cancelled = true;
        this.log(styles.warning('\nResolution cancelled.'));
        break;
      }

      if (answer.toLowerCase() !== 'skip') {
        answers.set(question.number, answer.trim());
      }

      this.log(''); // Blank line between questions
    }

    if (cancelled || answers.size === 0) {
      if (!cancelled) {
        this.log(styles.muted('\nNo answers provided. Nothing changed.'));
      }
      return;
    }

    // Rewrite description with answers
    const newDescription = rewriteDescription(ticket.description || '', answers);

    // Update the ticket description
    await this.storage.updateTicket(ticketId, { description: newDescription });

    // Label management: remove needs-clarification, add ready
    const currentLabels = [...ticket.labels];
    const updatedLabels = currentLabels.filter((l) => l !== 'needs-clarification');
    const allAnswered = answers.size === unanswered.length;
    if (allAnswered && !updatedLabels.includes('ready')) {
      updatedLabels.push('ready');
    }
    if (JSON.stringify(updatedLabels) !== JSON.stringify(currentLabels)) {
      await this.storage.updateTicket(ticketId, { labels: updatedLabels } as Partial<Ticket>);
    }

    // Move to Ready column if all questions answered and ticket has a project
    if (allAnswered && ticket.projectId) {
      try {
        const project = await this.storage.getProject(ticket.projectId);
        if (project?.workflowId) {
          const statuses = await this.storage.listStatuses(project.workflowId);
          // Find the "Ready" status (or first unstarted status that isn't "Needs Clarification")
          const readyStatus = statuses.find(
            (s) =>
              s.name.toLowerCase() === 'ready' ||
              (s.category === 'unstarted' && s.name.toLowerCase() !== 'needs clarification')
          );
          if (readyStatus && readyStatus.name !== ticket.statusName) {
            await this.storage.moveTicket(
              ticket.projectId,
              ticketId,
              readyStatus.name
            );
            this.log(
              styles.muted(
                `   Moved to column: ${readyStatus.name}`
              )
            );
          }
        }
      } catch {
        // Non-fatal: column move is best-effort
      }
    }

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) =>
      this.log(styles.muted(msg))
    );

    this.log(
      styles.success(
        `\n✅ Resolved ${answers.size}/${unanswered.length} question(s) on ${styles.emphasis(
          ticketId
        )}`
      )
    );
    if (allAnswered) {
      this.log(styles.muted('   Label: needs-clarification → ready'));
    }
  }
}
