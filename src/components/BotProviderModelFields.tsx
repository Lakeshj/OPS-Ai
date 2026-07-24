"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_CAPABILITIES,
  getModelsForProvider,
  getProvidersForCapability,
  groupModels,
  normalizeSelection,
  resolveDefaultSelection,
  type AiCapabilityKey,
  type AiProviderKey,
} from "@/modules/assistants/aiProviders";
import {
  adminAiLogsApi,
  type AiModelStatusRow,
} from "@/modules/adminAiLogs/api";

type BotProviderModelFieldsProps = {
  idPrefix?: string;
  capabilityType: string;
  provider: string;
  model: string;
  onChange: (next: {
    capabilityType: AiCapabilityKey;
    provider: AiProviderKey;
    model: string;
  }) => void;
};

export function BotProviderModelFields({
  idPrefix = "bot",
  capabilityType,
  provider,
  model,
  onChange,
}: BotProviderModelFieldsProps) {
  const [statusRows, setStatusRows] = useState<AiModelStatusRow[]>([]);

  useEffect(() => {
    let alive = true;
    adminAiLogsApi
      .listModels()
      .then((rows) => {
        if (alive) setStatusRows(rows);
      })
      .catch(() => {
        if (alive) setStatusRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const unavailable = useMemo(() => {
    const map = new Map<string, AiModelStatusRow>();
    for (const row of statusRows) {
      if (!row.available) map.set(`${row.provider}::${row.id}`, row);
    }
    return map;
  }, [statusRows]);

  const selection = normalizeSelection({
    capabilityType,
    provider,
    model,
  });
  const providers = getProvidersForCapability(selection.capabilityType);
  const models = getModelsForProvider(
    selection.provider,
    selection.capabilityType
  );
  const grouped = groupModels(models);

  useEffect(() => {
    if (
      selection.capabilityType !== capabilityType ||
      selection.provider !== provider ||
      selection.model !== model
    ) {
      onChange(selection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilityType, provider, model, selection.capabilityType, selection.provider, selection.model]);

  useEffect(() => {
    const key = `${selection.provider}::${selection.model}`;
    if (!unavailable.has(key)) return;
    const firstOk = models.find(
      (item) => !unavailable.has(`${selection.provider}::${item.id}`)
    );
    if (firstOk && firstOk.id !== selection.model) {
      onChange({
        capabilityType: selection.capabilityType,
        provider: selection.provider,
        model: firstOk.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable, selection.provider, selection.model, selection.capabilityType, models]);

  const setCapability = (nextCapability: string) => {
    const next = resolveDefaultSelection(nextCapability, selection.provider);
    onChange({
      capabilityType: next.capability,
      provider: next.provider,
      model: next.model,
    });
  };

  const setProvider = (nextProvider: string) => {
    const next = resolveDefaultSelection(
      selection.capabilityType,
      nextProvider
    );
    onChange({
      capabilityType: next.capability,
      provider: next.provider,
      model: next.model,
    });
  };

  const setModel = (nextModel: string) => {
    onChange(
      normalizeSelection({
        capabilityType: selection.capabilityType,
        provider: selection.provider,
        model: nextModel,
      })
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-capability`}>Capability</Label>
        <Select
          value={selection.capabilityType}
          onValueChange={setCapability}
        >
          <SelectTrigger id={`${idPrefix}-capability`}>
            <SelectValue placeholder="Select capability" />
          </SelectTrigger>
          <SelectContent>
            {AI_CAPABILITIES.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-provider`}>AI brand</Label>
        <Select
          value={selection.provider}
          onValueChange={setProvider}
          disabled={providers.length === 0}
        >
          <SelectTrigger id={`${idPrefix}-provider`}>
            <SelectValue placeholder="Select brand" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <Select
          value={selection.model}
          onValueChange={setModel}
          disabled={models.length === 0}
        >
          <SelectTrigger id={`${idPrefix}-model`}>
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {grouped.map((section) => (
              <SelectGroup key={section.group}>
                <SelectLabel>{section.group}</SelectLabel>
                {section.models.map((item) => {
                  const status = unavailable.get(
                    `${selection.provider}::${item.id}`
                  );
                  const disabled = Boolean(status);
                  const tags =
                    item.tags?.length > 0 ? ` · ${item.tags.join(", ")}` : "";
                  return (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      disabled={disabled}
                      title={status?.lastError || item.id}
                    >
                      {item.label}
                      {tags}
                      {disabled ? " (unavailable)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Image: OpenAI GPT Image or Gemini Flash Image. Video: OpenAI Sora or
          Gemini Veo (real MP4, can take ~1 min). Failed models show unavailable.
        </p>
        {selection.capabilityType === "image" ? (
          <p className="text-xs text-muted-foreground">
            Prefer GPT Image 1 / Gemini 2.5 Flash Image. DALL·E and Imagen are
            often blocked on current API keys.
          </p>
        ) : null}
        {selection.capabilityType === "video" ? (
          <p className="text-xs text-muted-foreground">
            Use Sora (OpenAI) or Veo (Gemini) only — these return a real MP4.
            Chat/text models are not listed here and cannot generate video files.
          </p>
        ) : null}
      </div>
    </div>
  );
}
