"use client";

import React from "react";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import {
  getVisibleParams,
  valuesWithParamDefaults,
} from "@/modules/workflows/paramDisplayOptions";
import { CredentialPicker } from "./CredentialPicker";
import { GoogleResourcePicker } from "./GoogleResourcePicker";
import { HttpAuthField } from "./HttpAuthField";
import {
  BooleanParamField,
  CodeParamField,
  FieldPreviewContext,
  FixedCollectionParamField,
  CollectionParamField,
  MultiOptionsParamField,
  HttpPaginationField,
  JsonParamField,
  NoticeParamField,
  NumberParamField,
  OptionsParamField,
  QueryParamsField,
  StringParamField,
} from "./ParamFields";
import { ScheduleRulesEditor } from "../ScheduleRulesEditor";
import { BotAssistantField } from "./special/BotAssistantField";
import { DocumentPickerField } from "./special/DocumentPickerField";
import { SpreadsheetPickerField } from "./special/SpreadsheetPickerField";
import { WorkflowPickerField } from "./special/WorkflowPickerField";
import type { KeywordAssistant, WorkspaceDocument } from "@/modules/shared/types";

export type ParameterRenderContext = {
  workspaceId?: string;
  workflowId?: string;
  nodeId: string | null;
  previewContext?: FieldPreviewContext;
  documents?: WorkspaceDocument[];
  spreadsheetDocs?: WorkspaceDocument[];
  assistants?: KeywordAssistant[];
  uploadingSpreadsheet?: boolean;
  onUploadSpreadsheet?: (file: File | null) => Promise<void>;
};

type Props = {
  schema: ParamDescriptor[];
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  context: ParameterRenderContext;
};

function renderSpecial(
  param: ParamDescriptor,
  values: WorkflowNodeData,
  onChange: (patch: WorkflowNodeData) => void,
  context: ParameterRenderContext
): React.ReactNode {
  const renderer = param.customRenderer;
  if (!renderer) return null;

  switch (renderer) {
    case "credential":
      return (
        <CredentialPicker
          key={param.name}
          workspaceId={context.workspaceId}
          value={String(values[param.name] || "")}
          onChange={(credentialId) =>
            onChange({ ...values, [param.name]: credentialId })
          }
          label={param.displayName}
          allowedTypes={param.credentialTypes as import("@/modules/workflows/types").WorkflowCredentialType[] | undefined}
        />
      );
    case "httpAuth":
      return (
        <HttpAuthField
          key={param.name}
          workspaceId={context.workspaceId}
          values={values}
          onChange={onChange}
        />
      );
    case "googleGscSites":
    case "googleGa4Properties":
    case "resourceLocator": {
      const kind =
        param.locatorKind ||
        (renderer === "googleGscSites" ? "gscSites" : "ga4Properties");
      const modeField = param.locatorModeField || `${param.name}Mode`;
      const labelField = param.locatorLabelField;
      return (
        <GoogleResourcePicker
          key={param.name}
          kind={kind}
          workspaceId={context.workspaceId}
          credentialId={String(values.credentialId || "")}
          value={values[param.name]}
          mode={String(values[modeField] || "")}
          displayName={labelField ? String(values[labelField] || "") : undefined}
          displayNameField={labelField}
          multi={Boolean(param.locatorMulti)}
          spreadsheetId={String(values.spreadsheetId || "")}
          provider={String(values.provider || "openai")}
          modes={param.locatorModes}
          accountModeLabel={kind === "aiModels" ? "From provider" : "From account"}
          manualModeLabel={kind === "ga4Properties" ? "Property ID" : "Manual"}
          previewContext={context.previewContext}
          onChange={(next, extra) => {
            const patch: WorkflowNodeData = {
              ...values,
              [param.name]: next,
            };
            if (extra?.mode != null) patch[modeField] = extra.mode;
            if (labelField && extra?.[labelField] != null) {
              patch[labelField] = extra[labelField];
            }
            onChange(patch);
          }}
          label={param.displayName}
          placeholder={param.placeholder}
        />
      );
    }
    case "scheduleRules":
      return (
        <ScheduleRulesEditor
          key={param.name}
          rules={values.scheduleRules || []}
          timezone={String(values.timezone || "UTC")}
          legacyCron={String(values.cron || "")}
          workflowId={context.workflowId}
          nodeId={context.nodeId || undefined}
          onChange={(scheduleRules) => onChange({ ...values, scheduleRules })}
          onTimezoneChange={(timezone) => onChange({ ...values, timezone })}
        />
      );
    case "queryParams":
      return (
        <QueryParamsField
          key={param.name}
          value={values.queryParams}
          onChange={(queryParams) => onChange({ ...values, queryParams })}
          previewContext={context.previewContext}
        />
      );
    case "httpPagination":
      return (
        <HttpPaginationField
          key={param.name}
          data={values}
          onPatch={(patch) => onChange({ ...values, ...patch })}
        />
      );
    case "botAssistant":
      return (
        <BotAssistantField
          key={param.name}
          data={values}
          assistants={context.assistants || []}
          onChange={onChange}
        />
      );
    case "documentPicker":
      return (
        <DocumentPickerField
          key={param.name}
          data={values}
          documents={context.documents || []}
          nodeId={context.nodeId}
          onChange={onChange}
        />
      );
    case "spreadsheetPicker":
      return (
        <SpreadsheetPickerField
          key={param.name}
          data={values}
          spreadsheetDocs={context.spreadsheetDocs || []}
          nodeId={context.nodeId}
          workspaceId={context.workspaceId}
          uploading={context.uploadingSpreadsheet}
          onUpload={context.onUploadSpreadsheet}
          onChange={onChange}
        />
      );
    case "workflowPicker":
      return (
        <WorkflowPickerField
          key={param.name}
          data={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          currentWorkflowId={context.workflowId}
          nodeId={context.nodeId}
        />
      );
    default:
      return null;
  }
}

function renderPrimitive(
  param: ParamDescriptor,
  value: unknown,
  onFieldChange: (name: string, value: unknown) => void,
  previewContext?: FieldPreviewContext,
  parentValues?: Record<string, unknown>
): React.ReactNode {
  const onChange = (v: unknown) => onFieldChange(param.name, v);

  switch (param.type) {
    case "hidden":
      return null;
    case "notice":
      return <NoticeParamField param={param} />;
    case "boolean":
      return (
        <BooleanParamField param={param} value={value} onChange={onChange} />
      );
    case "number":
      return (
        <NumberParamField param={param} value={value} onChange={onChange} />
      );
    case "options":
      return (
        <OptionsParamField
          param={param}
          value={value}
          onChange={onChange}
          parentValues={parentValues}
        />
      );
    case "multiOptions":
      return (
        <MultiOptionsParamField param={param} value={value} onChange={onChange} />
      );
    case "collection":
      return (
        <CollectionParamField
          param={param}
          value={value}
          onChange={onChange}
          previewContext={previewContext}
        />
      );
    case "code":
      return <CodeParamField param={param} value={value} onChange={onChange} />;
    case "json":
      return (
        <JsonParamField
          param={param}
          value={value}
          onChange={onChange}
          previewContext={previewContext}
        />
      );
    case "fixedCollection":
      return (
        <FixedCollectionParamField
          param={param}
          value={value}
          onChange={onChange}
          previewContext={previewContext}
        />
      );
    case "string":
    default:
      return (
        <StringParamField
          param={param}
          value={value}
          onChange={onChange}
          previewContext={previewContext}
        />
      );
  }
}

export function NodeParameterRenderer({
  schema,
  values,
  onChange,
  context,
}: Props) {
  const rawValues = values as Record<string, unknown>;
  const resolvedValues = valuesWithParamDefaults(schema, rawValues);
  const visible = getVisibleParams(schema, rawValues);

  const onFieldChange = (name: string, fieldValue: unknown) => {
    onChange({ ...values, [name]: fieldValue });
  };

  return (
    <div className="space-y-4">
      {visible.map((param) => {
        if (param.customRenderer) {
          const special = renderSpecial(param, values, onChange, context);
          if (special) return special;
        }
        return (
          <React.Fragment key={param.name}>
            {renderPrimitive(
              param,
              values[param.name],
              onFieldChange,
              context.previewContext,
              resolvedValues
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
