import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, fail, parseId } from '../../utils/cliHelpers';
import {
  QUESTION_ERROR_CODES, SOURCES, STATUSES, TYPES, buildAnswerBody, buildCreateBody, buildListParams, questionRunLink,
} from './input';
import { AgentStateStore } from '../agent/state';
import { currentStep } from '../pm/task/spawn';
import {
  AnswerResult, Question, renderAmendOutcome, renderAnswerOutcome, renderQuestionDetail, renderQuestionList,
} from './render';

/**
 * Question (决策请求) commands (/forge/questions, prd-0095): ask a person a choice/text question,
 * answer it, and track it. Answering a question with needsApproval moves it to pending_approval.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the question error codes to readable messages.
 */

const BASE = '/forge/questions';
/** The run step the local `agent listen` slot holds (undefined when idle or unreadable). */
const heldStep = () => currentStep(() => new AgentStateStore().read());
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
    .option('--assignee-employee <id|self>', 'AI employee that confirms it (self = env GOOD7OB_EMPLOYEE_ID); its answer is recorded as an AI decision')
    .option('--run-id <id>', 'Automation run the question belongs to (default: the step `agent listen` holds)')
    .option('--step-id <id>', 'Run step the question belongs to (a step alone names its run)')
    .option('--no-run-link', 'Do not link the question to the run step the local agent holds')
    .option('--decision-key <key>', 'Key that recognises the same decision across forked runs (≤ 120 chars)')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const body = { ...buildCreateBody(o), ...questionRunLink(o, heldStep) };
        const created: Question = await apiClient.post(BASE, body);
        const link = body.runId ? `（运行 #${body.runId}${body.stepId ? ` 步骤 #${body.stepId}` : ''}）` : '';
        emit(o.json, created, () => `✓ Question 已创建: #${created?.id ?? '-'} [${created?.status ?? '-'}] ${created?.title ?? ''}${link}`);
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
    .option('--update', 'Amend the answer of an already answered question (only the answer and its time change)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const qid = parseId(id, 'id');
        const body = buildAnswerBody(o);
        if (o.update) {
          const amended: AnswerResult = await apiClient.put(`${BASE}/${qid}/answer`, body);
          emit(o.json, amended, () => renderAmendOutcome(amended ?? { id: qid }));
          return;
        }
        const result: AnswerResult = await apiClient.post(`${BASE}/${qid}/answer`, body);
        emit(o.json, result, () => renderAnswerOutcome(result ?? { id: qid }));
      } catch (error) {
        fail(o.update ? '修改回答失败' : '回答 Question 失败', error, QUESTION_ERROR_CODES);
      }
    });
}
