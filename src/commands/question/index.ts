import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, fail, parseId } from '../../utils/cliHelpers';
import {
  QUESTION_ERROR_CODES, SOURCES, STATUSES, TYPES, buildAnswerBody, buildCreateBody, buildListParams,
} from './input';
import {
  AnswerResult, Question, renderAnswerOutcome, renderQuestionDetail, renderQuestionList,
} from './render';

/**
 * Question (决策请求) commands (/forge/questions, prd-0095): ask a person a choice/text question,
 * answer it, and track it. Answering a question with needsApproval moves it to pending_approval.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the question error codes to readable messages.
 */

const BASE = '/forge/questions';
const oneOf = (values: readonly string[]) => values.join('|');

export function registerQuestionCommands(program: Command) {
  const question = program
    .command('question')
    .description('Question — ask a decision question (choice/text), answer it, track its status');

  question
    .command('create')
    .description('Create a question (always starts as open)')
    .requiredOption('--title <text>', 'Title (max 200 chars)')
    .requiredOption('--type <type>', `Question type (${oneOf(TYPES)})`)
    .requiredOption('--source <source>', `Source (${oneOf(SOURCES)})`)
    .option('--description <text>', 'Background')
    .option('--option <key=label[|desc]>', 'Choice option, repeat for each (choice needs ≥2)', collect)
    .option('--product <id>', 'Product id')
    .option('--project <id>', 'Project id')
    .option('--task <id>', 'Task id (assignee defaults to the task responsible when --assignee is omitted)')
    .option('--assignee <id>', 'User id who should answer')
    .option('--needs-approval', 'Require an approval after it is answered')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const created: Question = await apiClient.post(BASE, buildCreateBody(o));
        emit(o.json, created, () => `✓ Question 已创建: #${created?.id ?? '-'} [${created?.status ?? '-'}] ${created?.title ?? ''}`);
      } catch (error) {
        fail('创建 Question 失败', error, QUESTION_ERROR_CODES);
      }
    });

  question
    .command('list')
    .description('List questions (filter by assignee / product / project / task / status)')
    .option('--assignee <id>', 'Assignee user id')
    .option('--product <id>', 'Product id')
    .option('--project <id>', 'Project id')
    .option('--task <id>', 'Task id')
    .option('--status <status>', `Status (${oneOf(STATUSES)})`)
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const params = buildListParams(o);
        const result = await apiClient.get(BASE, params);
        emit(o.json, result, () => renderQuestionList(result, Number(params.page), Number(params.pageSize)));
      } catch (error) {
        fail('获取 Question 列表失败', error, QUESTION_ERROR_CODES);
      }
    });

  question
    .command('get <id>')
    .description('Show a question with options and answer')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const detail: Question = await apiClient.get(`${BASE}/${parseId(id, 'id')}`);
        emit(o.json, detail, () => renderQuestionDetail(detail));
      } catch (error) {
        fail('获取 Question 失败', error, QUESTION_ERROR_CODES);
      }
    });

  question
    .command('answer <id>')
    .description('Answer a question: --option <key> for choice, --text for text (or as a note on choice)')
    .option('--option <key>', 'Chosen option key (choice)')
    .option('--text <text>', 'Answer text (text) or supplementary note (choice)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const qid = parseId(id, 'id');
        const body = buildAnswerBody(o);
        const result: AnswerResult = await apiClient.post(`${BASE}/${qid}/answer`, body);
        emit(o.json, result, () => renderAnswerOutcome(result ?? { id: qid }));
      } catch (error) {
        fail('回答 Question 失败', error, QUESTION_ERROR_CODES);
      }
    });
}
