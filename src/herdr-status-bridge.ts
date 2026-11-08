import type { ProgramStatus, Terminal } from "@earendil-works/pi-tui";

/** Preserve native status, including blocking reports from other installed wrappers. */
export function attachHerdrStatusBridge(terminal: Pick<Terminal, "setProgramStatus">, initial: ProgramStatus) {
  const original = terminal.setProgramStatus;
  let native = { ...initial };
  let count = 0;
  let approximate = false;
  let disposed = false;
  const effective = (): ProgramStatus => count > 0 && native.state !== "blocked" && native.state !== "clear"
    ? { state: "working", app: "pi", message: `正在工作的 subagent：${approximate ? "≥" : ""}${count}` }
    : { ...native };

  function wrapped(status: ProgramStatus): void {
    if (disposed) { original.call(terminal, status); return; }
    native = { ...status };
    original.call(terminal, count > 0 ? effective() : status);
  }
  terminal.setProgramStatus = wrapped;
  return {
    setActivity(nextCount: number, nextApproximate = false): void {
      if (disposed) return;
      nextCount = Number.isSafeInteger(nextCount) && nextCount >= 0 ? nextCount : 0;
      if (count === nextCount && approximate === nextApproximate) return;
      count = nextCount;
      approximate = nextApproximate;
      // Through the captured chain, not through ourselves or later wrappers:
      // replaying a synthetic report through them would corrupt their native state.
      original.call(terminal, effective());
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (terminal.setProgramStatus === wrapped) terminal.setProgramStatus = original;
      if (count > 0) original.call(terminal, { ...native });
    },
  };
}
