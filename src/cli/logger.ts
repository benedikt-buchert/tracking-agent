export type Verbosity = "quiet" | "normal" | "verbose";

type WriteFn = (s: string) => void;

export interface Logger {
  verbosity: Verbosity;
  /** Key milestones — shown in normal and verbose modes. */
  info(msg: string): void;
  /** Detailed progress — shown only in verbose mode. */
  verbose(msg: string): void;
  /** Warnings — always shown except never. */
  warn(msg: string): void;
  /** Errors — always shown. */
  error(msg: string): void;
}

const defaultWrite: WriteFn = (s) => process.stderr.write(s);

export function createLogger(
  verbosity: Verbosity = "normal",
  writeFn: WriteFn = defaultWrite,
): Logger {
  const noop = () => {};
  return {
    verbosity,
    info: verbosity === "quiet" ? noop : (msg) => writeFn(msg),
    verbose: verbosity === "verbose" ? (msg) => writeFn(msg) : noop,
    warn: (msg) => writeFn(msg),
    error: (msg) => writeFn(msg),
  };
}
