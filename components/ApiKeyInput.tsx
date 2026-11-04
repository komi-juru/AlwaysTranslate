import { Button } from "@components/Button";
import { Heading as FormTitle } from "@components/Heading";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TextInput, useEffect, useState } from "@webpack/common";

import { translateWithDeepL } from "../api/deepl";
import { translateBatchWithGemini } from "../api/gemini";
import { nativeRequest } from "../api/nativeRequest";
import { settings } from "../settings";

function DeeplApiKeyInput({ setValue }: { setValue: (val: string) => void }) {
    const { deeplApiKey } = settings.use(["deeplApiKey"]);
    const [show, setShow] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState<"idle"|"success"|"error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    const handleValidate = async () => {
        if (!deeplApiKey) return;
        setValidating(true);
        setStatus("idle");
        try {
            // Send a test translation request
            await translateWithDeepL(["test"], "auto", "en", deeplApiKey);

            setStatus("success");
            setErrorMsg("");
        } catch (e: any) {
            setStatus("error");
            setErrorMsg(e.message || "Invalid API Key");
        }
        setValidating(false);
    };

    return (
        <section style={{ marginBottom: "20px" }}>
            <FormTitle>DeepL API Key</FormTitle>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <TextInput
                        type={show ? "text" : "password"}
                        value={deeplApiKey}
                        onChange={(val: string) => {
                            settings.store.deeplApiKey = val;
                            setValue(val);
                            setStatus("idle");
                        }}
                        placeholder="Enter API Key..."
                    />
                </div>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size="small"
                    variant={status === "success" ? "positive" : status === "error" ? "dangerPrimary" : "primary"}
                    onClick={handleValidate}
                    disabled={validating || !deeplApiKey}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {validating ? "Testing..." : (status === "success" ? "Valid!" : (status === "error" ? "Failed" : "Test Key"))}
                </Button>
            </div>
            {status === "error" && (
                <div style={{ marginTop: "8px", color: "var(--text-danger)" }}>
                    {errorMsg}
                </div>
            )}
            {status === "success" && (
                <div style={{ marginTop: "8px", color: "var(--text-positive)" }}>
                    Key verified.
                </div>
            )}
        </div>
        </section>
    );
}

function GeminiApiKeyInput({ setValue }: { setValue: (val: string) => void }) {
    const { geminiApiKey, geminiModel } = settings.use(["geminiApiKey", "geminiModel"]);
    const [show, setShow] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState<"idle"|"success"|"error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    useEffect(() => setStatus("idle"), [geminiModel]);

    const handleValidate = async () => {
        if (!geminiApiKey) return;
        setValidating(true);
        setStatus("idle");
        try {
            await translateBatchWithGemini("0", [{ id: "0", text: "hello" }], "ko", geminiApiKey, "", geminiModel);
            setStatus("success");
            setErrorMsg("");
        } catch (e: any) {
            setStatus("error");
            setErrorMsg(e.message || "Invalid API Key");
        }
        setValidating(false);
    };

    return (
        <section style={{ marginBottom: "20px" }}>
            <FormTitle>Gemini API Key</FormTitle>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <TextInput
                        type={show ? "text" : "password"}
                        value={geminiApiKey}
                        onChange={(val: string) => {
                            settings.store.geminiApiKey = val;
                            setValue(val);
                            setStatus("idle");
                        }}
                        placeholder="Enter API Key..."
                    />
                </div>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size="small"
                    variant={status === "success" ? "positive" : status === "error" ? "dangerPrimary" : "primary"}
                    onClick={handleValidate}
                    disabled={validating || !geminiApiKey}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {validating ? "Testing..." : (status === "success" ? "Valid!" : (status === "error" ? "Failed" : "Test Key"))}
                </Button>
            </div>
            {status === "error" && (
                <div style={{ marginTop: "8px", color: "var(--text-danger)" }}>
                    {errorMsg}
                </div>
            )}
            {status === "success" && (
                <div style={{ marginTop: "8px", color: "var(--text-positive)" }}>
                    Key verified.
                </div>
            )}


        </div>
        </section>
    );
}

function DeepSeekApiKeyInput({ setValue }: { setValue: (val: string) => void }) {
    const { deepseekApiKey, deepseekBaseUrl, deepseekModel } = settings.use(["deepseekApiKey", "deepseekBaseUrl", "deepseekModel"]);
    const [show, setShow] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState<"idle"|"success"|"error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    useEffect(() => setStatus("idle"), [deepseekModel]);

    const handleValidate = async () => {
        if (!deepseekApiKey) return;
        setValidating(true);
        setStatus("idle");
        try {
            const Native = VencordNative.pluginHelpers.AlwaysTranslate as import("@utils/types").PluginNative<typeof import("../native")>;
            const endpoint = deepseekBaseUrl || "https://api.deepseek.com/chat/completions";
            const modelName = deepseekModel || "deepseek-v4-flash";

            const res = await nativeRequest(id => Native.batDeepSeekFetch(endpoint, deepseekApiKey.trim(), JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: "hello" }],
                stream: false
            }), id));

            if (!res.ok) {
                let errorDetails = "Invalid API Key";
                try {
                    const parsed = JSON.parse(res.data);
                    if (parsed.error?.message) {
                        errorDetails = parsed.error.message;
                    }
                } catch (e) {}
                throw new Error(errorDetails);
            }

            setStatus("success");
            setErrorMsg("");
        } catch (e: any) {
            setStatus("error");
            setErrorMsg(e.message || "Invalid API Key");
        }
        setValidating(false);
    };

    return (
        <section style={{ marginBottom: "20px" }}>
            <FormTitle>DeepSeek API Key</FormTitle>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <TextInput
                        type={show ? "text" : "password"}
                        value={deepseekApiKey}
                        onChange={(val: string) => {
                            settings.store.deepseekApiKey = val;
                            setValue(val);
                            setStatus("idle");
                        }}
                        placeholder="Enter API Key..."
                    />
                </div>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size="small"
                    variant={status === "success" ? "positive" : status === "error" ? "dangerPrimary" : "primary"}
                    onClick={handleValidate}
                    disabled={validating || !deepseekApiKey}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {validating ? "Testing..." : (status === "success" ? "Valid!" : (status === "error" ? "Failed" : "Test Key"))}
                </Button>
            </div>
            {status === "error" && (
                <div style={{ marginTop: "8px", color: "var(--text-danger)" }}>
                    {errorMsg}
                </div>
            )}
            {status === "success" && (
                <div style={{ marginTop: "8px", color: "var(--text-positive)" }}>
                    Key verified.
                </div>
            )}

            <div style={{ marginTop: "16px", marginBottom: "4px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Base URL
            </div>
            <TextInput
                type="text"
                value={deepseekBaseUrl}
                onChange={(val: string) => {
                    settings.store.deepseekBaseUrl = val;
                    setStatus("idle");
                }}
                placeholder="https://api.deepseek.com/chat/completions"
            />

        </div>
        </section>
    );
}

export function ApiKeysManager() {
    const [expanded, setExpanded] = useState(false);
    const { geminiModel, deepseekModel } = settings.use(["geminiModel", "deepseekModel"]);
    const engines = [
        { name: "Gemini", model: geminiModel, setModel: (value: string) => { settings.store.geminiModel = value; }, Input: GeminiApiKeyInput },
        { name: "DeepSeek", model: deepseekModel, setModel: (value: string) => { settings.store.deepseekModel = value; }, Input: DeepSeekApiKeyInput },
        { name: "DeepL", model: "", setModel: undefined, Input: DeeplApiKeyInput }
    ];

    return (
        <section className="bat-settings-section" aria-label="API keys">
            <Button size="small" variant="secondary"
                aria-expanded={expanded} aria-controls="bat-api-keys"
                onClick={() => setExpanded(value => !value)}>
                {expanded ? "▾ API keys" : "▸ API keys"}
            </Button>
            <div id="bat-api-keys" hidden={!expanded}>
                {engines.map(({ name, model, setModel, Input }) => (
                    <section key={name} style={{ padding: "16px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                        <Input setValue={() => {}} />
                        {setModel && (
                            <div>
                                <FormTitle>Model</FormTitle>
                                <TextInput value={model} onChange={setModel} placeholder="Model ID" />
                            </div>
                        )}
                    </section>
                ))}
            </div>
        </section>
    );
}
