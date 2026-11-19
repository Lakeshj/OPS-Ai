"use client";

import React, { useEffect, useRef } from "react";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import {
  getVisibleParams,
  valuesWithParamDefaults,
} from "@/modules/workflows/paramDisplayOptions";
import {
  dependentParamsNeedReconcile,
  reconcileDependentOptionParams,
} from "@/modules/workflows/dependentParamCascade";
import {
  applyInstagramCredentialChange,
  applyInstagramInsightsPresetChange,
  applyInstagramPublishOperationChange,
  applyInstagramResourceChange,
} from "@/modules/workflows/instagramDependentCascade";
import { CredentialPicker } from "./CredentialPicker";
import { GoogleResourcePicker } from "./GoogleResourcePicker";
import { HttpAuthField } from "./HttpAuthField";
import { InstagramMediaLocatorField } from "./InstagramMediaLocatorField";
import { InstagramCommentLocatorField } from "./InstagramCommentLocatorField";
import { InstagramPublishMediaField } from "./InstagramPublishMediaField";
import { InstagramInsightsNotice } from "./InstagramInsightsNotice";
import { startInstagramOAuthPopup } from "@/modules/workflows/instagramOAuthPopup";
import { toast } from "sonner";
import { workflowCredentialsApi } from "@/modules/workflows/api";
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
import { CapabilitySettingsField } from "./CapabilitySettingsField";
import { Ga4FilterField } from "./Ga4FilterField";
import { Ga4OrderByField } from "./Ga4OrderByField";
import { DynamicMcpToolField } from "./DynamicMcpToolField";
import { MetaAdAccountField } from "./MetaAdAccountField";
import { MetaAdsFiltersField } from "./MetaAdsFiltersField";
import type { KeywordAssistant, WorkspaceDocument } from "@/modules/shared/types";
import type { GoogleAdsSourceNodeRef } from "@/modules/workflows/googleAdsMcpSource";

export type ParameterRenderContext = {
  workspaceId?: string;
  workflowId?: string;
  nodeId: string | null;
  previewContext?: FieldPreviewContext;
  documents?: WorkspaceDocument[];
  spreadsheetDocs?: WorkspaceDocument[];
  assistants?: KeywordAssistant[];
  workflowNodes?: GoogleAdsSourceNodeRef[];
  uploadingSpreadsheet?: boolean;
  onUploadSpreadsheet?: (file: File | null) => Promise<void>;
};

type Props = {
  schema: ParamDescriptor[];
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  context: ParameterRenderContext;
};

function InstagramInsightsNoticeBridge({
  values,
  workspaceId,
  onChange,
}: {
  values: WorkflowNodeData;
  workspaceId?: string;
  onChange: (patch: WorkflowNodeData) => void;
}) {
  const credentialId = String(values.credentialId || "");
  const [credential, setCredential] = React.useState<
    import("@/modules/workflows/types").WorkflowCredential | null
  >(null);

  React.useEffect(() => {
    if (!workspaceId || !credentialId) {
      setCredential(null);
      return;
    }
    let cancelled = false;
    workflowCredentialsApi
      .list(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setCredential(list.find((c) => c.id === credentialId) || null);
      })
      .catch(() => {
        if (!cancelled) setCredential(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, credentialId]);

  const reconnect = async () => {
    if (!workspaceId || !credentialId) return;
    try {
      const result = await startInstagramOAuthPopup({
        workspaceId,
        name: credential?.name || "Instagram",
        credentialId,
      });
      if (!result.ok) {
        toast.error(result.error || "Reconnect cancelled");
        return;
      }
      onChange(
        applyInstagramCredentialChange(
          values as Record<string, unknown>,
          result.credentialId
        ) as WorkflowNodeData
      );
      toast.success("Instagram reconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reconnect failed");
    }
  };

  return (
    <InstagramInsightsNotice
      credential={credential}
      onReconnect={() => void reconnect()}
    />
  );
}

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
          workflowId={context.workflowId}
          value={String(values[param.name] || "")}
          onChange={(credentialId) => {
            const types = (param.credentialTypes || []).map(String);
            if (types.includes("instagram")) {
              onChange(
                applyInstagramCredentialChange(
                  values as Record<string, unknown>,
                  credentialId
                ) as WorkflowNodeData
              );
              return;
            }
            onChange({ ...values, [param.name]: credentialId });
          }}
          label={param.displayName}
          allowedTypes={param.credentialTypes as import("@/modules/workflows/types").WorkflowCredentialType[] | undefined}
        />
      );
    case "instagramMediaLocator":
      return (
        <InstagramMediaLocatorField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          previewContext={context.previewContext}
        />
      );
    case "instagramCommentLocator":
      return (
        <InstagramCommentLocatorField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          previewContext={context.previewContext}
        />
      );
    case "instagramPublishMedia":
      return (
        <InstagramPublishMediaField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          previewContext={context.previewContext}
        />
      );
    case "instagramInsightsNotice":
      return (
        <InstagramInsightsNoticeBridge
          key={param.name}
          values={values}
          workspaceId={context.workspaceId}
          onChange={onChange}
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
    case "capabilitySettings":
      return (
        <CapabilitySettingsField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
        />
      );
    case "ga4Filter":
      return (
        <Ga4FilterField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
        />
      );
    case "ga4OrderBy":
      return (
        <Ga4OrderByField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
        />
      );
    case "mcpDynamicTool":
      return (
        <DynamicMcpToolField
          key={param.name}
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          workflowId={context.workflowId}
          previewContext={context.previewContext}
        />
      );
    case "googleAdsMcpTool":
      return (
        <DynamicMcpToolField
          key={param.name}
          lockedProvider="google_ads"
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          workflowId={context.workflowId}
          previewContext={context.previewContext}
          workflowNodes={context.workflowNodes}
        />
      );
    case "metaAdsMcpTool":
      return (
        <DynamicMcpToolField
          key={param.name}
          lockedProvider="meta_ads"
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          workflowId={context.workflowId}
          previewContext={context.previewContext}
          workflowNodes={context.workflowNodes}
        />
      );
    case "instagramMcpTool":
      return (
        <DynamicMcpToolField
          key={param.name}
          lockedProvider="instagram"
          values={values}
          onChange={onChange}
          workspaceId={context.workspaceId}
          workflowId={context.workflowId}
          previewContext={context.previewContext}
          workflowNodes={context.workflowNodes}
        />
      );
    case "metaAdAccount":
      return (
        <MetaAdAccountField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
        />
      );
    case "metaAdsFilters":
      return (
        <MetaAdsFiltersField
          key={param.name}
          param={param}
          values={values}
          onChange={onChange}
        />
      );
    case "googleGscSites":
    case "googleGa4Properties":
    case "resourceLocator": {
      const kind = (param.locatorKind ||
        (renderer === "googleGscSites" ? "gscSites" : "ga4Properties")) as
        | "gscSites"
        | "ga4Properties"
        | "gmailLabels"
        | "sheetTabs"
        | "aiModels"
        | "spreadsheetId";
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
        <MultiOptionsParamField
          param={param}
          value={value}
          onChange={onChange}
          parentValues={parentValues}
        />
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
  const reconcilePass = useRef(false);
  const resourceKey = String(rawValues.resource ?? "");
  const operationKey = String(rawValues.operation ?? "");

  // Loaded/saved invalid resource/operation pairs: normalize in the editor.
  useEffect(() => {
    const reconciled = reconcileDependentOptionParams(schema, rawValues);
    if (!dependentParamsNeedReconcile(rawValues, reconciled, schema)) return;
    if (reconcilePass.current) return;
    reconcilePass.current = true;
    onChange({ ...values, ...reconciled } as WorkflowNodeData);
    const timer = window.setTimeout(() => {
      reconcilePass.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resource/operation only
  }, [schema, resourceKey, operationKey]);

  const onFieldChange = (name: string, fieldValue: unknown) => {
    let patched: Record<string, unknown> = { ...rawValues, [name]: fieldValue };
    if (name === "resource") {
      patched = applyInstagramResourceChange(patched, String(fieldValue ?? ""));
    }
    if (name === "operation") {
      patched = applyInstagramPublishOperationChange(
        patched,
        String(fieldValue ?? "")
      );
    }
    if (name === "insightsPreset") {
      patched = applyInstagramInsightsPresetChange(
        patched,
        String(fieldValue ?? "")
      );
    }
    const reconciled =
      name === "resource" || name === "operation" || name === "insightsPreset"
        ? reconcileDependentOptionParams(schema, patched)
        : patched;
    onChange({ ...values, ...reconciled } as WorkflowNodeData);
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
