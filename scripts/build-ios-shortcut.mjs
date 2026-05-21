import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workflowName = "Save with AlmightyDLP";
const outputPath = path.resolve("public", "save-with-almightydlp.shortcut");
const baseUrl = "https://almightydlp.com";
const objectReplacementCharacter = "\uFFFC";

const shortcutInputUuid = uuid();
const endpointUuid = uuid();
const downloadUuid = uuid();

const workflow = {
  WFWorkflowActions: [
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.urlencode",
      WFWorkflowActionParameters: {
        WFInput: variableAttachment({
          Type: "ExtensionInput",
          Aggrandizements: [
            {
              Type: "WFCoercionVariableAggrandizement",
              CoercionItemClass: "WFStringContentItem"
            }
          ]
        }),
        UUID: shortcutInputUuid
      }
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
      WFWorkflowActionParameters: {
        WFTextActionText: tokenString(`${baseUrl}/api/shortcut/download?url=${objectReplacementCharacter}`, {
          "{52, 1}": {
            OutputUUID: shortcutInputUuid,
            Type: "ActionOutput",
            OutputName: "URL Encoded Text"
          }
        }),
        UUID: endpointUuid
      }
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {
        WFURL: variableAttachment({
          OutputUUID: endpointUuid,
          Type: "ActionOutput",
          OutputName: "Text"
        }),
        Advanced: false,
        UUID: downloadUuid
      }
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.savetocameraroll",
      WFWorkflowActionParameters: {
        WFInput: variableAttachment({
          OutputUUID: downloadUuid,
          Type: "ActionOutput",
          OutputName: "Contents of URL"
        })
      }
    }
  ],
  WFWorkflowClientVersion: "3030.0.3",
  WFWorkflowHasShortcutInputVariables: true,
  WFWorkflowIcon: {
    WFWorkflowIconGlyphNumber: 61440,
    WFWorkflowIconStartColor: 431817727
  },
  WFWorkflowImportQuestions: [],
  WFWorkflowInputContentItemClasses: [
    "WFURLContentItem",
    "WFSafariWebPageContentItem"
  ],
  WFWorkflowMinimumClientVersion: 900,
  WFWorkflowName: workflowName,
  WFWorkflowOutputContentItemClasses: [],
  WFWorkflowTypes: ["ActionExtension"]
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "almightydlp-shortcut-"));
const jsonPath = path.join(tempDir, "workflow.json");
const unsignedPath = path.join(tempDir, "workflow.shortcut");
const signedPath = path.join(tempDir, "signed.shortcut");

try {
  await fs.writeFile(jsonPath, JSON.stringify(workflow, null, 2));
  await execFileAsync("plutil", ["-convert", "binary1", "-o", unsignedPath, jsonPath]);
  await execFileAsync("shortcuts", [
    "sign",
    "--mode",
    "anyone",
    "--input",
    unsignedPath,
    "--output",
    signedPath
  ]);
  await fs.copyFile(signedPath, outputPath);
  await fs.chmod(outputPath, 0o644);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

function variableAttachment(value) {
  return {
    Value: value,
    WFSerializationType: "WFTextTokenAttachment"
  };
}

function tokenString(string, attachmentsByRange = {}) {
  return {
    Value: {
      string,
      attachmentsByRange
    },
    WFSerializationType: "WFTextTokenString"
  };
}
