/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Forms, TextInput, useState } from "@webpack/common";

import { translateWithDeepL } from "../api/deepl";
import { translateBatchWithGemini } from "../api/gemini";
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
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>DeepL API Key</Forms.FormTitle>
            <Forms.FormText>
                Your DeepL API key (ends with :fx for Free Tier)
            </Forms.FormText>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1 }}>
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
                    size={Button.Sizes?.ICON ?? "small"}
                    color={Button.Colors?.PRIMARY ?? "primary"}
                    look={Button.Looks?.FILLED ?? "filled"}
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size={Button.Sizes?.ICON ?? "small"}
                    color={status === "success" ? Button.Colors?.GREEN ?? "green" : (status === "error" ? Button.Colors?.RED ?? "red" : Button.Colors?.BRAND ?? "brand")}
                    look={Button.Looks?.FILLED ?? "filled"}
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
                    API Key is valid and working!
                </div>
            )}
        </div>
        </Forms.FormSection>
    );
}

function GeminiApiKeyInput({ setValue }: { setValue: (val: string) => void }) {
    const { geminiApiKey, geminiModel } = settings.use(["geminiApiKey", "geminiModel"]);
    const [show, setShow] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState<"idle"|"success"|"error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    const handleValidate = async () => {
        if (!geminiApiKey) return;
        setValidating(true);
        setStatus("idle");
        try {
            await translateBatchWithGemini("0", [{ id: "0", text: "hello" }], "ko", geminiApiKey, "gemini", "");
            setStatus("success");
            setErrorMsg("");
        } catch (e: any) {
            setStatus("error");
            setErrorMsg(e.message || "Invalid API Key");
        }
        setValidating(false);
    };

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Gemini API Key</Forms.FormTitle>
            <Forms.FormText>
                Your Gemini API Key
            </Forms.FormText>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1 }}>
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
                    size={Button.Sizes?.ICON ?? "small"}
                    color={Button.Colors?.PRIMARY ?? "primary"}
                    look={Button.Looks?.FILLED ?? "filled"}
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size={Button.Sizes?.ICON ?? "small"}
                    color={status === "success" ? Button.Colors?.GREEN ?? "green" : (status === "error" ? Button.Colors?.RED ?? "red" : Button.Colors?.BRAND ?? "brand")}
                    look={Button.Looks?.FILLED ?? "filled"}
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
                    API Key is valid and working!
                </div>
            )}

            <div style={{ marginTop: "16px", marginBottom: "4px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Model Name
            </div>
            <TextInput
                type="text"
                value={geminiModel}
                onChange={(val: string) => {
                    settings.store.geminiModel = val;
                    setStatus("idle");
                }}
                placeholder="gemini-3.1-flash-lite"
            />
        </div>
        </Forms.FormSection>
    );
}

function DeepSeekApiKeyInput({ setValue }: { setValue: (val: string) => void }) {
    const { deepseekApiKey, deepseekBaseUrl, deepseekModel } = settings.use(["deepseekApiKey", "deepseekBaseUrl", "deepseekModel"]);
    const [show, setShow] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState<"idle"|"success"|"error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    const handleValidate = async () => {
        if (!deepseekApiKey) return;
        setValidating(true);
        setStatus("idle");
        try {
            const Native = VencordNative.pluginHelpers.AlwaysTranslate as import("@utils/types").PluginNative<typeof import("../native")>;
            const endpoint = deepseekBaseUrl || "https://api.deepseek.com/chat/completions";
            const modelName = deepseekModel || "deepseek-v4-flash";

            const res = await Native.batDeepSeekFetch(endpoint, deepseekApiKey.trim(), JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: "hello" }],
                stream: false
            }));

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
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>DeepSeek API Key</Forms.FormTitle>
            <Forms.FormText>
                Your DeepSeek API Key
            </Forms.FormText>
        <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1 }}>
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
                    size={Button.Sizes?.ICON ?? "small"}
                    color={Button.Colors?.PRIMARY ?? "primary"}
                    look={Button.Looks?.FILLED ?? "filled"}
                    onClick={() => setShow(!show)}
                    style={{ height: "40px", minWidth: "80px", padding: "0 16px" }}
                >
                    {show ? "Hide" : "Show"}
                </Button>
                <Button
                    size={Button.Sizes?.ICON ?? "small"}
                    color={status === "success" ? Button.Colors?.GREEN ?? "green" : (status === "error" ? Button.Colors?.RED ?? "red" : Button.Colors?.BRAND ?? "brand")}
                    look={Button.Looks?.FILLED ?? "filled"}
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
                    API Key is valid and working!
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
            <div style={{ marginTop: "16px", marginBottom: "4px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Model Name
            </div>
            <TextInput
                type="text"
                value={deepseekModel}
                onChange={(val: string) => {
                    settings.store.deepseekModel = val;
                    setStatus("idle");
                }}
                placeholder="deepseek-v4-flash"
            />
        </div>
        </Forms.FormSection>
    );
}

export function ApiKeysManager() {
    const [expanded, setExpanded] = useState(false);

    return (
        <div style={{ marginBottom: "24px" }}>
            <div
                onClick={() => setExpanded(!expanded)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: "12px",
                    background: "var(--background-modifier-hover)",
                    borderRadius: "8px",
                    userSelect: "none"
                }}
            >
                <div style={{ marginRight: "12px", fontSize: "12px", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
                    ▶
                </div>
                <Forms.FormTitle style={{ margin: 0, cursor: "pointer" }}>API Keys</Forms.FormTitle>
            </div>

            {expanded && (
                <div style={{ marginTop: "16px", paddingLeft: "16px", borderLeft: "2px solid var(--background-modifier-accent)" }}>
                    <GeminiApiKeyInput setValue={() => {}} />
                    <DeepSeekApiKeyInput setValue={() => {}} />
                    <DeeplApiKeyInput setValue={() => {}} />
                </div>
            )}
        </div>
    );
}
