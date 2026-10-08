import { InputError } from "../errors.js";
import { locateJsonError } from "./json-error.js";

/** JSON.parse that throws the located InputError every /json function shares. */
export function parseJsonOrThrow(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const located = locateJsonError(input, error);
    throw new InputError(located.message, located.detail);
  }
}
