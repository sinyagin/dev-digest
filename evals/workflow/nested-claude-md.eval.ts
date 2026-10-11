import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./nested-claude-md.cases.js";

describeWorkflow("nested-claude-md", () => runWorkflowCases(cases));
