"use client";

import React from "react";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { getVisibleParams } from "@/modules/workflows/paramDisplayOptions";
import { CredentialPicker } from "./CredentialPicker";
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
        />
      );
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
    default:
      return null;
  }
}

function renderPrimitive(
  param: ParamDescriptor,
  value: unknown,
  onFieldChange: (name: string, value: unknown) => void,
  previewContext?: FieldPreviewContext
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
        <OptionsParamField param={param} value={value} onChange={onChange} />
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
  const visible = getVisibleParams(schema, values as Record<string, unknown>);

  const onFieldChange = (name: string, fieldValue: unknown) => {
    onChange({ ...values, [name]: fieldValue });
  };

  return (
    <div className="space-y-3">
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
              context.previewContext
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
