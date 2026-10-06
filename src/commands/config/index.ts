/**
 * Configuration Commands
 *
 * Supports local CLI configuration under ~/.good7ob/config.json.
 */

import { Command } from 'commander';
import configService from '../../services/ConfigService';
import { AGENT_KEYS, getAgentValue, withAgentValue } from '../agent/config';

const KEY_ALIASES: Record<string, 'apiUrl' | 'apiKey' | 'userId' | 'orgId' | 'theme'> = {
  'api-url': 'apiUrl',
  apiurl: 'apiUrl',
  apiUrl: 'apiUrl',
  'api-key': 'apiKey',
  apikey: 'apiKey',
  apiKey: 'apiKey',
  'user-id': 'userId',
  userid: 'userId',
  userId: 'userId',
  'org-id': 'orgId',
  orgid: 'orgId',
  orgId: 'orgId',
  theme: 'theme',
};

const SENSITIVE_KEYS = new Set(['apiKey', 'agent.forward.secret']);
const AGENT_PREFIX = 'agent.';

function normalizeKey(input: string): 'apiUrl' | 'apiKey' | 'userId' | 'orgId' | 'theme' {
  const normalized = KEY_ALIASES[input];
  if (!normalized) {
    throw new Error(`Unsupported config key: ${input}`);
  }
  return normalized;
}

function formatValue(key: string, value: unknown): string {
  if (SENSITIVE_KEYS.has(key)) {
    const text = String(value || '');
    if (key === 'agent.forward.secret') return text ? '(set)' : '(not set)';
    if (!text) return '(not set)';
    if (text.length <= 8) return '********';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  if (value === undefined || value === null || value === '') {
    return '(not set)';
  }

  return String(value);
}

export function registerConfigCommands(program: Command) {
  const configCommand = program
    .command('config')
    .description('Manage local CLI configuration');

  configCommand
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key, value) => {
      try {
        if (key.startsWith(AGENT_PREFIX)) {
          const agentKey = key.slice(AGENT_PREFIX.length);
          configService.set('agent', withAgentValue(configService.get('agent'), agentKey, value));
          console.log(`✓ Config updated: ${key} = ${formatValue(key, getAgentValue(configService.get('agent'), agentKey))}`);
          return;
        }
        const normalizedKey = normalizeKey(key);
        const isNumeric = normalizedKey === 'userId' || normalizedKey === 'orgId';
        const parsedValue = isNumeric ? parseInt(value, 10) : value;

        if (isNumeric && Number.isNaN(parsedValue)) {
          throw new Error(`${normalizedKey === 'orgId' ? 'org-id' : 'user-id'} must be a number`);
        }

        configService.set(normalizedKey, parsedValue);
        console.log(`✓ Config updated: ${normalizedKey} = ${formatValue(normalizedKey, parsedValue)}`);
      } catch (error) {
        console.error('✗ Failed to update config:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  configCommand
    .command('get <key>')
    .description('Get a configuration value')
    .action((key) => {
      try {
        if (key.startsWith(AGENT_PREFIX)) {
          console.log(`${key}=${formatValue(key, getAgentValue(configService.get('agent'), key.slice(AGENT_PREFIX.length)))}`);
          return;
        }
        const normalizedKey = normalizeKey(key);
        const value = configService.get(normalizedKey);
        console.log(`${normalizedKey}=${formatValue(normalizedKey, value)}`);
      } catch (error) {
        console.error('✗ Failed to read config:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  configCommand
    .command('list')
    .description('List current configuration')
    .action(() => {
      const config = configService.getAll();
      console.log('Current configuration:');
      console.log(`  apiUrl: ${formatValue('apiUrl', config.apiUrl)}`);
      console.log(`  apiKey: ${formatValue('apiKey', config.apiKey)}`);
      console.log(`  userId: ${formatValue('userId', config.userId)}`);
      console.log(`  orgId: ${formatValue('orgId', config.orgId)}`);
      console.log(`  theme: ${formatValue('theme', config.theme)}`);
      AGENT_KEYS.forEach((k) => {
        const key = `${AGENT_PREFIX}${k}`;
        console.log(`  ${key}: ${formatValue(key, getAgentValue(config.agent, k))}`);
      });
    });

  configCommand
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      configService.reset();
      console.log('✓ Configuration reset to defaults');
    });

  configCommand
    .command('clear-credentials')
    .description('Remove stored API key')
    .action(() => {
      configService.clearCredentials();
      console.log('✓ Stored API key removed');
    });

  return configCommand;
}