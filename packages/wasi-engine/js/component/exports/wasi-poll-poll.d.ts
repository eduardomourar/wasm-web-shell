export namespace WasiPollPoll {
  export function dropPollable(this: Pollable): void;
  export function pollOneoff(in: Uint32Array): boolean[];
}
export type Pollable = number;
