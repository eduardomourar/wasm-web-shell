/** @module Interface component:aws-cli/providers **/
/**
 * @throws {CredentialsError} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
 */
export function provideCredentials(serviceId: string | undefined): Promise<Credentials> | Credentials;
export function provideRegion(region: Region | undefined): Promise<Region | undefined> | Region | undefined;
export interface Credentials {
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
  expiresAfter?: bigint,
  accountId?: string,
}
export interface Timeout {
  duration: bigint,
}
export type CredentialsError = CredentialsErrorCredentialsNotLoaded | CredentialsErrorProviderTimedOut | CredentialsErrorInvalidConfiguration | CredentialsErrorProviderError | CredentialsErrorUnhandled;
export interface CredentialsErrorCredentialsNotLoaded {
  tag: 'credentials-not-loaded',
}
export interface CredentialsErrorProviderTimedOut {
  tag: 'provider-timed-out',
  val: Timeout,
}
export interface CredentialsErrorInvalidConfiguration {
  tag: 'invalid-configuration',
}
export interface CredentialsErrorProviderError {
  tag: 'provider-error',
}
export interface CredentialsErrorUnhandled {
  tag: 'unhandled',
}
export type Region = string;
