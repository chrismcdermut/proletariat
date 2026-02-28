import { expect } from 'chai';
import {
  parseQuestions,
  rewriteDescription,
  QUESTION_REGEX,
  ANSWER_REGEX,
} from '../../src/commands/ticket/resolve.js';

describe('Ticket Resolve - Question Parsing', () => {
  describe('QUESTION_REGEX', () => {
    it('matches bold question format **Q1:** text', () => {
      const match = '**Q1:** What should the timeout be?'.match(QUESTION_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('1');
      expect(match![2]).to.equal('What should the timeout be?');
    });

    it('matches plain question format Q1: text', () => {
      const match = 'Q1: What should the timeout be?'.match(QUESTION_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('1');
      expect(match![2]).to.equal('What should the timeout be?');
    });

    it('matches multi-digit question numbers', () => {
      const match = '**Q12:** Should we use REST?'.match(QUESTION_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('12');
      expect(match![2]).to.equal('Should we use REST?');
    });

    it('does not match non-question lines', () => {
      expect('Some regular text'.match(QUESTION_REGEX)).to.be.null;
      expect('## Requirements'.match(QUESTION_REGEX)).to.be.null;
      expect('- A list item'.match(QUESTION_REGEX)).to.be.null;
    });

    it('matches with period separator', () => {
      const match = '**Q1.** What about this?'.match(QUESTION_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('1');
    });
  });

  describe('ANSWER_REGEX', () => {
    it('matches bold answer format **A1:** text', () => {
      const match = '**A1:** Use 30 minute timeout'.match(ANSWER_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('1');
      expect(match![2]).to.equal('Use 30 minute timeout');
    });

    it('matches plain answer format A1: text', () => {
      const match = 'A1: Use 30 minute timeout'.match(ANSWER_REGEX);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('1');
      expect(match![2]).to.equal('Use 30 minute timeout');
    });
  });

  describe('parseQuestions', () => {
    it('returns empty array for empty description', () => {
      expect(parseQuestions('')).to.deep.equal([]);
    });

    it('returns empty array for description with no questions', () => {
      const desc = `## Description
This is a normal ticket description.

## Requirements
- R1: Do something
- R2: Do something else`;
      expect(parseQuestions(desc)).to.deep.equal([]);
    });

    it('parses single question', () => {
      const desc = `## Description
Some context.

**Q1:** Should we use REST or GraphQL?`;

      const questions = parseQuestions(desc);
      expect(questions).to.have.lengthOf(1);
      expect(questions[0].number).to.equal(1);
      expect(questions[0].text).to.equal('Should we use REST or GraphQL?');
      expect(questions[0].answered).to.be.false;
    });

    it('parses multiple questions', () => {
      const desc = `## Description
Some context.

**Q1:** Should we use REST or GraphQL?
**Q2:** What is the expected timeout?
**Q3:** Should this be behind a feature flag?`;

      const questions = parseQuestions(desc);
      expect(questions).to.have.lengthOf(3);
      expect(questions[0].number).to.equal(1);
      expect(questions[1].number).to.equal(2);
      expect(questions[2].number).to.equal(3);
    });

    it('detects already answered questions', () => {
      const desc = `## Description
Some context.

**Q1:** Should we use REST or GraphQL?
**A1:** Use GraphQL since the project already uses it.
**Q2:** What is the expected timeout?`;

      const questions = parseQuestions(desc);
      expect(questions).to.have.lengthOf(2);
      expect(questions[0].answered).to.be.true;
      expect(questions[1].answered).to.be.false;
    });

    it('handles mixed bold and plain formats', () => {
      const desc = `**Q1:** Should we use REST?
Q2: What about timeouts?`;

      const questions = parseQuestions(desc);
      expect(questions).to.have.lengthOf(2);
      expect(questions[0].text).to.equal('Should we use REST?');
      expect(questions[1].text).to.equal('What about timeouts?');
    });

    it('preserves line indices', () => {
      const desc = `Line 0
Line 1
**Q1:** First question
Line 3
**Q2:** Second question`;

      const questions = parseQuestions(desc);
      expect(questions[0].lineIndex).to.equal(2);
      expect(questions[1].lineIndex).to.equal(4);
    });
  });

  describe('rewriteDescription', () => {
    it('returns original description when no answers', () => {
      const desc = '**Q1:** Test question?';
      expect(rewriteDescription(desc, new Map())).to.equal(desc);
    });

    it('returns original description when empty', () => {
      expect(rewriteDescription('', new Map([[1, 'answer']]))).to.equal('');
    });

    it('inserts answer after question', () => {
      const desc = `## Description
Some context.

**Q1:** Should we use REST or GraphQL?

## Next section`;

      const answers = new Map([[1, 'Use GraphQL']]);
      const result = rewriteDescription(desc, answers);

      expect(result).to.contain('**Q1:** Should we use REST or GraphQL?');
      expect(result).to.contain('**A1:** Use GraphQL');
      // Answer should be between the question and the next section
      const lines = result.split('\n');
      const q1Index = lines.findIndex(l => l.includes('**Q1:**'));
      const a1Index = lines.findIndex(l => l.includes('**A1:**'));
      expect(a1Index).to.equal(q1Index + 1);
    });

    it('inserts answers for multiple questions', () => {
      const desc = `**Q1:** First question?
**Q2:** Second question?
**Q3:** Third question?`;

      const answers = new Map([
        [1, 'Answer 1'],
        [2, 'Answer 2'],
        [3, 'Answer 3'],
      ]);
      const result = rewriteDescription(desc, answers);

      expect(result).to.contain('**A1:** Answer 1');
      expect(result).to.contain('**A2:** Answer 2');
      expect(result).to.contain('**A3:** Answer 3');
    });

    it('replaces existing answers', () => {
      const desc = `**Q1:** Should we use REST?
**A1:** Old answer
**Q2:** What timeout?`;

      const answers = new Map([[1, 'New answer']]);
      const result = rewriteDescription(desc, answers);

      expect(result).to.contain('**A1:** New answer');
      expect(result).to.not.contain('Old answer');
    });

    it('preserves structure around questions', () => {
      const desc = `## Description
Some context here.

### Open Questions
**Q1:** Should we use REST or GraphQL?

### Requirements
- R1: Something
- R2: Something else`;

      const answers = new Map([[1, 'Use GraphQL']]);
      const result = rewriteDescription(desc, answers);

      expect(result).to.contain('## Description');
      expect(result).to.contain('Some context here.');
      expect(result).to.contain('### Open Questions');
      expect(result).to.contain('### Requirements');
      expect(result).to.contain('- R1: Something');
      expect(result).to.contain('**A1:** Use GraphQL');
    });

    it('handles partial answer set (skip some questions)', () => {
      const desc = `**Q1:** First?
**Q2:** Second?
**Q3:** Third?`;

      const answers = new Map([[1, 'Answer 1'], [3, 'Answer 3']]);
      const result = rewriteDescription(desc, answers);

      expect(result).to.contain('**A1:** Answer 1');
      expect(result).to.not.contain('**A2:**');
      expect(result).to.contain('**A3:** Answer 3');
    });

    it('handles question followed immediately by another question', () => {
      const desc = `**Q1:** First?
**Q2:** Second?`;

      const answers = new Map([[1, 'Answer 1']]);
      const result = rewriteDescription(desc, answers);

      const lines = result.split('\n');
      expect(lines[0]).to.equal('**Q1:** First?');
      expect(lines[1]).to.equal('**A1:** Answer 1');
      expect(lines[2]).to.equal('**Q2:** Second?');
    });
  });
});
