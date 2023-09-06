export namespace WasiPollPoll {
  export function dropPollable(this_: Pollable): void;
  export function pollOneoff(in_: Uint32Array): boolean[];
}
export type Pollable = number;
