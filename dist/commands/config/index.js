"use strict";
/**
 * Configuration Commands
 *
 * Supports local CLI configuration under ~/.good7ob/config.json.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConfigCommands = void 0;
const ConfigService_1 = __importDefault(require("../../services/ConfigService"));
const KEY_ALIASES = {
    'api-url': 'apiUrl',
    apiurl: 'apiUrl',
    apiUrl: 'apiUrl',
    'api-key': 'apiKey',
    apikey: 'apiKey',
    apiKey: 'apiKey',
    'user-id': 'userId',
    userid: 'userId',
    userId: 'userId',
    theme: 'theme',
};
const SENSITIVE_KEYS = new Set(['apiKey']);
function normalizeKey(input) {
    const normalized = KEY_ALIASES[input];
    if (!normalized) {
        throw new Error(`Unsupported config key: ${input}`);
    }
    return normalized;
}
function formatValue(key, value) {
    if (SENSITIVE_KEYS.has(key)) {
        const text = String(value || '');
        if (!text)
            return '(not set)';
        if (text.length <= 8)
            return '********';
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }
    if (value === undefined || value === null || value === '') {
        return '(not set)';
    }
    return String(value);
}
function registerConfigCommands(program) {
    const configCommand = program
        .command('config')
        .description('Manage local CLI configuration');
    configCommand
        .command('set <key> <value>')
        .description('Set a configuration value')
        .action((key, value) => {
        try {
            const normalizedKey = normalizeKey(key);
            const parsedValue = normalizedKey === 'userId' ? parseInt(value, 10) : value;
            if (normalizedKey === 'userId' && Number.isNaN(parsedValue)) {
                throw new Error('user-id must be a number');
            }
            ConfigService_1.default.set(normalizedKey, parsedValue);
            console.log(`✓ Config updated: ${normalizedKey} = ${formatValue(normalizedKey, parsedValue)}`);
        }
        catch (error) {
            console.error('✗ Failed to update config:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    configCommand
        .command('get <key>')
        .description('Get a configuration value')
        .action((key) => {
        try {
            const normalizedKey = normalizeKey(key);
            const value = ConfigService_1.default.get(normalizedKey);
            console.log(`${normalizedKey}=${formatValue(normalizedKey, value)}`);
        }
        catch (error) {
            console.error('✗ Failed to read config:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    configCommand
        .command('list')
        .description('List current configuration')
        .action(() => {
        const config = ConfigService_1.default.getAll();
        console.log('Current configuration:');
        console.log(`  apiUrl: ${formatValue('apiUrl', config.apiUrl)}`);
        console.log(`  apiKey: ${formatValue('apiKey', config.apiKey)}`);
        console.log(`  userId: ${formatValue('userId', config.userId)}`);
        console.log(`  theme: ${formatValue('theme', config.theme)}`);
    });
    configCommand
        .command('reset')
        .description('Reset configuration to defaults')
        .action(() => {
        ConfigService_1.default.reset();
        console.log('✓ Configuration reset to defaults');
    });
    configCommand
        .command('clear-credentials')
        .description('Remove stored API key')
        .action(() => {
        ConfigService_1.default.clearCredentials();
        console.log('✓ Stored API key removed');
    });
    return configCommand;
}
exports.registerConfigCommands = registerConfigCommands;
//# sourceMappingURL=index.js.map