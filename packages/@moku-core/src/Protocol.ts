/** Schemas and types from the marimo host protocol. @module */
import * as S from "@marimo-team/host-protocol/Schemas";
import * as Analysis from "@marimo-team/host-protocol/experimental/Analysis";
import * as Problems from "@marimo-team/host-protocol/Problems";
export * from "@marimo-team/host-protocol/Schemas";
export * from "@marimo-team/host-protocol/Problems";
export {
  Analysis,
  CellAnalysis,
} from "@marimo-team/host-protocol/experimental/Analysis";
/** Decoded Cell record. */
export type CellOutput = typeof S.Cell.Type;
/** Decoded CellConfig record. */
export type CellConfigOutput = typeof S.CellConfig.Type;
/** Decoded CellInput record. */
export type CellInputOutput = typeof S.CellInput.Type;
/** Decoded Change record. */
export type ChangeOutput = typeof S.Change.Type;
/** Decoded Console record. */
export type ConsoleOutput = typeof S.Console.Type;
/** Decoded Display record. */
export type DisplayOutput = typeof S.Display.Type;
/** Decoded DisplayData record. */
export type DisplayDataOutput = typeof S.DisplayData.Type;
/** Decoded Document record. */
export type DocumentOutput = typeof S.Document.Type;
/** Decoded EditRequest record. */
export type EditRequestOutput = typeof S.EditRequest.Type;
/** Decoded EditResponse record. */
export type EditResponseOutput = typeof S.EditResponse.Type;
/** Decoded Error record. */
export type ErrorOutput = typeof S.Error.Type;
/** Decoded Execution record. */
export type ExecutionOutput = typeof S.Execution.Type;
/** Decoded HostRecord record. */
export type HostRecordOutput = typeof S.HostRecord.Type;
/** Decoded Input record. */
export type InputOutput = typeof S.Input.Type;
/** Decoded Notebook record. */
export type NotebookOutput = typeof S.Notebook.Type;
/** Decoded Outcome record. */
export type OutcomeOutput = typeof S.Outcome.Type;
/** Decoded Run record. */
export type RunOutput = typeof S.Run.Type;
/** Decoded RunRequest record. */
export type RunRequestOutput = typeof S.RunRequest.Type;
/** Decoded Runtime record. */
export type RuntimeOutput = typeof S.Runtime.Type;
/** Decoded SaveRequest record. */
export type SaveRequestOutput = typeof S.SaveRequest.Type;
/** Decoded StartRuntimeRequest record. */
export type StartRuntimeRequestOutput = typeof S.StartRuntimeRequest.Type;
/** Decoded Variable record. */
export type VariableOutput = typeof S.Variable.Type;
/** Decoded Host record. */
export type HostOutput = typeof S.Host.Type;
/** Decoded Project record. */
export type ProjectOutput = typeof S.Project.Type;
/** Decoded Attachment record. */
export type AttachmentOutput = typeof S.Attachment.Type;
export type CellInput = typeof S.CellInput.Type;
export type Change = typeof S.Change.Type;
export type EditRequest = typeof S.EditRequest.Type;
export type RunRequest = typeof S.RunRequest.Type;
export type SaveRequest = typeof S.SaveRequest.Type;
export type StartRuntimeRequest = typeof S.StartRuntimeRequest.Type;
export type CellId = typeof S.CellId.Type;
export type AnalysisOutput = typeof Analysis.Analysis.Type;
export type EventOutput = Analysis.NotebookEvent;
export type ProblemOutput = typeof Problems.Problem.Type;
export {
  CellInput,
  Change,
  EditRequest,
  RunRequest,
  SaveRequest,
  StartRuntimeRequest,
  CellId,
} from "@marimo-team/host-protocol/Schemas";
