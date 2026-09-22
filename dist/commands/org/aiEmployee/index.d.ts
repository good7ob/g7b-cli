import { Command } from 'commander';
import { ApiDate } from '../../../utils/cliHelpers';
import { KeyAction } from './input';
interface IssuedKey {
    rawKey?: string | null;
    keyPrefix?: string | null;
    status?: string | null;
    createdAt?: ApiDate;
}
interface Capability {
    code?: string | null;
    label?: string | null;
    description?: string | null;
    managerOnly?: boolean | null;
}
export declare function renderIssuedKey(employeeId: number, action: KeyAction, key: IssuedKey): string;
export declare function renderCapabilities(items: Capability[]): string;
export declare function registerAiEmployeeCommands(orgCommand: Command): void;
export {};
//# sourceMappingURL=index.d.ts.map