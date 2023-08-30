interface AwsCredentials {
  apiKey: string;
}

const EXAMPLE_CREDENTIALS: AwsCredentials = {
  apiKey: "api-key",
};

const parseCookie = (str: string): { credentials_aws: string | undefined } =>
  str
    .split(";")
    .map((v) => v.split("="))
    .reduce((acc, v) => {
      if (v[0] && v[1]) {
        // @ts-ignore
        acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
      }
      return acc;
    }, { credentials_aws: undefined });

export const retrieveCredentials = (): AwsCredentials => {
  let cookie = parseCookie(document.cookie || "");
  return cookie.credentials_aws
    ? JSON.parse(cookie.credentials_aws)
    : EXAMPLE_CREDENTIALS;
};

export const setCredentials = (value: AwsCredentials = EXAMPLE_CREDENTIALS) => {
  const credentials = encodeURIComponent(
    JSON.stringify(value)
  );
  document.cookie = `credentials_aws=${credentials}; max-age=43200; path=/;`;
};
