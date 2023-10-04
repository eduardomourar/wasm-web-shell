/** @module Interface wasi:cli/environment@0.2.11 **/
export function getEnvironment(): Array<[string, string]>;
export function getArguments(): Array<string>;
