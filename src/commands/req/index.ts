import { Command } from 'commander';
import { createIdea, withIdeaFields } from '../idea';
import { SOURCES } from '../idea/input';

/**
 * `good7ob req add "<title>"` — title-only alias of `good7ob idea create` (prd-0088
 * rp-forge-idea-0174). The requirement backlog is gone; requirements are now
 * ideas + structured PRDs. Capture stays at one input: the product comes from
 * GOOD7OB_PRODUCT_ID and the source defaults to `pm`.
 */
export function registerReqCommands(program: Command) {
  const req = program
    .command('req')
    .description('Quick idea capture — alias of `idea create` (only the title is required)');

  withIdeaFields(req.command('add <title...>'))
    .description('Create an idea from just a title (source defaults to pm)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .option('-s, --source <source>', `Source (${SOURCES.join('|')})`, 'pm')
    .option('--json', 'Output as JSON')
    // Variadic so `good7ob req add 想要个导出功能` works without quoting.
    .action((titleParts: string[], o) => createIdea({ ...o, title: titleParts.join(' ') }));

  req.on('command:*', (operands: string[]) => {
    console.error(`✗ good7ob req ${operands[0]} 已下线：需求池已改为「想法 + PRD」，请用 good7ob idea ...（见 good7ob idea --help）`);
    process.exit(1);
  });
}
