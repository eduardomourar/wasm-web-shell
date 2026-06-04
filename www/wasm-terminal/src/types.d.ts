declare module "shell-quote" {
  export function parse(
    cmd: string,
    env?: (key: string) => string | undefined
  ): Array<string | { op: string }>;
  export function quote(args: string[]): string;
}
