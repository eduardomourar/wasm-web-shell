import * as Comlink from "comlink";
import { main } from "./aws-command.ts";

Comlink.expose(main);
