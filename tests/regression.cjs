// Run from a Vencord checkout with: node src/userplugins/alwaysTranslate/tests/regression.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require(process.env.ALWAYS_TRANSLATE_TYPESCRIPT || "typescript");
const root = path.resolve(__dirname, "..");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("API errors distinguish credentials, permissions, balance, quota, service and malformed responses", () => {
    const { describeApiError, httpError } = environment().load("api/errors.ts");
    assert.match(describeApiError(403, null, "Permission denied"), /Access denied/);
    assert.match(describeApiError(400, "API_KEY_INVALID", "Bad key"), /Invalid API key/);
    assert.match(describeApiError(402, null, ""), /balance/);
    assert.match(describeApiError(404, null, ""), /Model or API endpoint/);
    assert.match(describeApiError(429, null, ""), /rate limit/);
    assert.match(describeApiError(456, null, ""), /quota/);
    assert.match(describeApiError(503, null, ""), /server/);
    assert.match(describeApiError(-1, null, "fetch failed"), /Network/);
    assert.match(describeApiError(null, null, "missing content"), /no translation/);
    assert.match(describeApiError(null, null, "Failed to parse JSON"), /Invalid API response/);
    assert.match(describeApiError(null, null, "Translation timed out (20s)"), /timed out/);
    const error = httpError(403, '{"error":{"message":"Forbidden"}}');
    assert.equal(error.status, 403); assert.match(error.message, /Access denied/);
});

test("indefinite economy mode dispatches after 10 seconds", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = environment(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { calls++; return [{ id: "deadline", text: "translated" }]; };
    const { AiChannelWorker, aiWorkers } = e.load("api/worker.ts");
    const worker = new AiChannelWorker("123"); aiWorkers.set("123", worker);
    const job = task("deadline"); worker.enqueue(job);
    t.mock.timers.tick(9999); assert.equal(worker.registry.size, 1);
    assert.equal(calls, 0); t.mock.timers.tick(2); assert.equal(await job.result, "translated"); await tick();
    assert.equal(worker.registry.size, 0); assert.equal(aiWorkers.size, 0); assert.equal(calls, 1);
});

test("hung AI requests abort at the task deadline and ignore late completion", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const engine of ["gemini", "deepseek"]) {
        const e = environment(); const pending = deferred(); let signal;
        e.mocks["api/" + engine + ".ts"][engine === "gemini" ? "translateBatchWithGemini" : "translateBatchWithDeepSeek"] = (...args) => { signal = args[6]; return pending.promise; };
        const workers = e.load("api/worker.ts");
        const worker = new workers.AiChannelWorker("123");
        const job = task(engine); job.engine = engine; worker.enqueue(job); worker.flushNow(); await tick();
        t.mock.timers.tick(20000); assert.equal(await job.result, ""); assert.ok(signal.aborted);
        pending.resolve([{ id: engine, text: "late" }]);
        await tick(); assert.equal(worker.registry.size, 0); assert.equal(worker.state, "IDLE");
    }
});

test("native IPC hangs are bounded and cancellation is forwarded", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = environment(); const cancelled = [];
    e.native.batCancelRequest = async id => cancelled.push(id);
    const { nativeRequest } = e.load("api/nativeRequest.ts");
    let id;
    const promise = nativeRequest(requestId => { id = requestId; return new Promise(() => {}); });
    const rejection = assert.rejects(promise, /timed out/);
    t.mock.timers.tick(20000); await rejection;
    assert.deepEqual(cancelled, [id]);
});

function environment(extra = {}) {
    const store = { APIEcoModeThreshold: 100, APIMaxBatchWait: 0, geminiModel: "gemini-a", deepseekModel: "deepseek-a", deepseekBaseUrl: "https://example.test", channelList: [], ...extra };
    const native = { batCacheLoad: async () => null, batCacheSave: async () => true };
    const mocks = {
        "settings.ts": { settings: { store }, getChannelConfig: id => ({ allowed: true, config: store.channelList.find(c => c.id === id) }) },
        "utils/logger.ts": { Logger: { warn() {}, error() {}, info() {} } },
        "api/breaker.ts": { APIBreaker: { reportError: () => false }, getGeminiActiveQuotaLock: () => null, showApiToast() {}, setGeminiQuotaLock() {}, showGeminiQuotaToast() {} },
        "api/gemini.ts": { translateBatchWithGemini: async (_, messages) => messages.map(m => ({ id: m.id, text: "translated:" + m.text })) },
        "api/deepseek.ts": { translateBatchWithDeepSeek: async (_, messages) => messages.map(m => ({ id: m.id, text: "translated:" + m.text })) },
        "@webpack/common": {},
        "electron": { app: { getPath: () => "/unused" } }
    };
    const modules = new Map();
    const window = new EventTarget();
    const document = { documentElement: { lang: "ko" }, body: { classList: { add() {}, remove() {} } } };
    function load(file) {
        if (mocks[file]) return mocks[file];
        if (modules.has(file)) return modules.get(file).exports;
        const module = { exports: {} }; modules.set(file, module);
        const filename = path.join(root, file);
        const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
        function localRequire(id) {
            if (mocks[id]) return mocks[id];
            if (!id.startsWith(".")) return require(id);
            let relative = path.relative(root, path.resolve(path.dirname(filename), id)).replaceAll("\\", "/");
            if (!path.extname(relative)) relative += ".ts";
            return load(relative);
        }
        new Function("require", "module", "exports", "window", "VencordNative", "document", code)(localRequire, module, module.exports, window, { pluginHelpers: { AlwaysTranslate: native } }, document);
        return module.exports;
    }
    return { store, native, mocks, load };
}

function task(id, text = id, messageId = "123456789012345678") {
    const result = deferred();
    return { id, text, messageId, channelId: "123", targetLang: "ko", apiKey: "key", engine: "gemini", dmPrompt: "", resolve: result.resolve, result: result.promise };
}

test("AI requests sharing a message ID, including outgoing messages, all settle", async () => {
    const e = environment(); const { AiChannelWorker } = e.load("api/worker.ts");
    const w = new AiChannelWorker("123");
    const tasks = [task("a"), task("b"), task("c", "outgoing", ""), task("d", "another", "")];
    tasks.forEach(t => w.enqueue(t)); w.flushNow();
    assert.deepEqual(await Promise.all(tasks.map(t => t.result)), tasks.map(t => "translated:" + t.text));
    assert.equal(w.registry.size, 0);
});

test("reset cancels a worker waiting for a request slot without sending", async () => {
    const e = environment(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { calls++; return []; };
    const { AiChannelWorker } = e.load("api/worker.ts");
    const { aiRequestLimiters } = e.load("api/requestLimiter.ts");
    const releases = await Promise.all([aiRequestLimiters.gemini.acquire(), aiRequestLimiters.gemini.acquire()]);
    const w = new AiChannelWorker("123"); const t = task("a"); w.enqueue(t); w.flushNow(); w.reset(); releases.forEach(release => release());
    assert.equal(await t.result, ""); await tick(); assert.equal(calls, 0);
});

test("reset aborts an active request and suppresses remaining chunks", async () => {
    const e = environment(); e.mocks["constants.ts"] = { GEMINI_BATCH_SIZE: 1, BATCH_ACCUMULATION_TIME_GEMINI: 200 };
    let signal, calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => { calls++; signal = args[6]; return new Promise(() => {}); };
    const { AiChannelWorker } = e.load("api/worker.ts");
    const w = new AiChannelWorker("123"); const a = task("a"), b = task("b"); w.enqueue(a); w.enqueue(b); w.flushNow();
    await tick(); w.reset(); assert.equal(signal.aborted, true);
    assert.deepEqual(await Promise.all([a.result, b.result]), ["", ""]); await tick(); assert.equal(calls, 1);
});

test("cache keys isolate engines, channels, models, prompts, source language and text-processing options", async () => {
    const e = environment(); const { getCacheKey } = e.load("utils/hash.ts");
    const key = (channel = "1", engine = "gemini", source = "auto") => getCacheKey(channel, "123", engine, source, "ko", "hello");
    const original = key();
    assert.notEqual(original, key("2")); assert.notEqual(original, key("1", "deepseek")); assert.notEqual(original, key("1", "gemini", "en"));
    e.store.geminiModel = "gemini-b"; assert.notEqual(original, key()); e.store.geminiModel = "gemini-a";
    e.store.channelList = [{ id: "1", aiCustomPrompt: "formal" }]; assert.notEqual(original, key()); e.store.channelList = [];
    e.store.hideEmojis = true; assert.notEqual(original, key());
});

test("channel clear removes AI, outgoing and pending entries without affecting other channels", async () => {
    const e = environment(); const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    cache.set("v3:1:ai", "AI", "gemini"); cache.set("v3:1:deepseek", "DeepSeek", "deepseek"); cache.set("v3:2:ai", "Other", "gemini");
    cache.setOutgoing("1", "sent", "original"); cache.setOutgoing("2", "sent", "other original");
    cache.setPending("v3:1:pending", "source", Promise.resolve("result"));
    const generation = cache.getGeneration("v3:1:ai"), otherGeneration = cache.getGeneration("v3:2:ai");
    cache.clearChannel("1");
    assert.equal(cache.getChannelCount("1"), 0); assert.equal(cache.peek("v3:2:ai"), "Other");
    assert.equal(cache.getOutgoing("1", "sent"), undefined); assert.equal(cache.getOutgoing("2", "sent"), "other original");
    assert.equal(cache.getPending("v3:1:pending", "source"), undefined);
    assert.notEqual(cache.getGeneration("v3:1:ai"), generation); assert.equal(cache.getGeneration("v3:2:ai"), otherGeneration);
    await cache.flush();
});

test("cache clear invalidates in-flight results and rejected pending requests are cleaned", async () => {
    const e = environment(); const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    const generation = cache.getGeneration("v3:1:key"); cache.clearAll(); assert.notEqual(cache.getGeneration("v3:1:key"), generation);
    const rejected = Promise.reject(Error("network")); cache.setPending("v3:1:key", "source", rejected);
    await tick(); assert.equal(cache.getPending("v3:1:key", "source"), undefined); await cache.flush();
});

test("cache failed saves remain dirty and can be retried", async () => {
    const e = environment(); let calls = 0, saved;
    e.native.batCacheSave = async value => { saved = value; return ++calls > 1; };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:key", "translation", "gemini");
    await cache.flush(); await cache.flush(); assert.equal(calls, 2); assert.equal(JSON.parse(saved).version, 3);
});

test("legacy caches are not reused; version 3 survives reload", async () => {
    for (const version of [2, 3]) {
        const e = environment(); e.native.batCacheLoad = async () => JSON.stringify({ version, entries: { "v3:1:key": "saved" } });
        const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); await cache.init();
        assert.equal(cache.peek("v3:1:key"), version === 3 ? "saved" : undefined);
    }
});

test("native cancellation aborts HTTP and is scoped to the requesting renderer", async () => {
    const e = environment(); const native = e.load("native.ts"); const previous = global.fetch; let signal;
    global.fetch = (_, options) => new Promise((resolve, reject) => {
        signal = options.signal; signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
    });
    try {
        const request = native.batGeminiFetch({ sender: { id: 1 } }, "https://example.test", "key", "{}", "request");
        await native.batCancelRequest({ sender: { id: 2 } }, "request"); assert.equal(signal.aborted, false);
        await native.batCancelRequest({ sender: { id: 1 } }, "request"); assert.equal(signal.aborted, true);
        assert.equal((await request).ok, false);
    } finally { global.fetch = previous; }
});

test("queued requests retain their model and complete custom prompt after settings change", async () => {
    const e = environment({ channelList: [{ id: "123", aiCustomPrompt: "formal|||keep names" }] }); let received;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => { received = args; return args[1].map(m => ({ id: m.id, text: "result" })); };
    const { translate } = e.load("api/translate.ts");
    const result = translate("123", "123456789012345678", "hello", "auto", "ko", "gemini", { gemini: "key", deepseek: "" });
    e.store.geminiModel = "changed-model";
    e.load("api/worker.ts").aiWorkers.get("123").flushNow();
    assert.equal(await result, "result"); assert.equal(received[4], "formal|||keep names"); assert.equal(received[5], "gemini-a");
});

test("incoming and outgoing prompts stay separate across channels, including blank outgoing prompts", async () => {
    const e = environment({ channelList: [
        { id: "123", aiCustomPrompt: "incoming A", outgoingCustomPrompt: "outgoing A" },
        { id: "456", aiCustomPrompt: "incoming B", outgoingCustomPrompt: "" }
    ] });
    const received = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => {
        received.push(args[4]);
        return args[1].map(m => ({ id: m.id, text: "result" }));
    };
    const { translate } = e.load("api/translate.ts");
    for (const channel of e.store.channelList) {
        await translate(channel.id, "", "hello", "auto", "ko", "gemini", { gemini: "key", deepseek: "" });
        await translate(channel.id, "", "hello", "auto", "en", "gemini", { gemini: "key", deepseek: "" }, channel.outgoingCustomPrompt);
    }
    assert.deepEqual(received, ["incoming A", "outgoing A", "incoming B", ""]);
});

test("concurrent initialization waits for the same cache load", async () => {
    for (const [file, name, method] of [["utils/cache.ts", "TranslationCache", "batCacheLoad"]]) {
        const e = environment(); const loading = deferred(); let calls = 0;
        e.native[method] = () => { calls++; return loading.promise; };
        const instance = e.load(file)[name].getInstance();
        const a = instance.init(), b = instance.init(); assert.equal(a, b); assert.equal(calls, 1);
        loading.resolve(null); await Promise.all([a, b]);
    }
});


test("translation ignores legacy glossary settings and preserves tokens and custom prompts", async () => {
    const e = environment({ customDictionary: { hello: "replacement" }, dictionaryCaseSensitive: false });
    const received = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => {
        received.push({ text: args[1][0].text, prompt: args[4] });
        return args[1].map(m => ({ id: m.id, text: "translated:" + m.text }));
    };
    e.mocks["api/deepseek.ts"].translateBatchWithDeepSeek = e.mocks["api/gemini.ts"].translateBatchWithGemini;
    const { safeTranslate } = e.load("api/translate.ts");
    const text = "hello <@123> https://example.test \u0060code\u0060";
    for (const engine of ["gemini", "deepseek"]) {
        assert.equal(await safeTranslate(text, "auto", "ko", engine, { gemini: "key", deepseek: "" }, "123", "", "keep tone"), "translated:" + text);
    }
    assert.deepEqual(received, [
        { text: "hello [token0] [token1] [token2]", prompt: "keep tone" },
        { text: "hello [token0] [token1] [token2]", prompt: "keep tone" }
    ]);
});


test("AI engines have separate bounded concurrency and cancelled waiters release their place", async () => {
    const e = environment();
    const { AiChannelWorker } = e.load("api/worker.ts");
    const held = deferred(); let geminiActive = 0, peak = 0, deepseekCalls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        peak = Math.max(peak, ++geminiActive); await held.promise; geminiActive--;
        return messages.map(m => ({ id: m.id, text: "done" }));
    };
    e.mocks["api/deepseek.ts"].translateBatchWithDeepSeek = async (_, messages) => {
        deepseekCalls++; return messages.map(m => ({ id: m.id, text: "independent" }));
    };
    const workers = ["1", "2", "3", "4"].map(id => new AiChannelWorker(id));
    const jobs = workers.map((w, i) => { const job = task("job" + i); w.enqueue(job); w.flushNow(); return job; });
    await tick(); assert.equal(geminiActive, 2);
    workers[2].reset(); assert.equal(await jobs[2].result, "");
    const separate = new AiChannelWorker("5"), other = task("deepseek"); other.engine = "deepseek";
    separate.enqueue(other); separate.flushNow(); assert.equal(await other.result, "independent"); assert.equal(deepseekCalls, 1);
    held.resolve(); assert.deepEqual(await Promise.all(jobs.map(j => j.result)), ["done", "done", "", "done"]);
    assert.equal(peak, 2); await tick(); assert.equal(geminiActive, 0);
});

test("AI APIs reject missing, duplicate, unknown and malformed translation entries", async () => {
    const messages = [{ id: "a", text: "hello" }, { id: "b", text: "world" }];
    const valid = [{ id: "b", text: "two" }, { id: "a", text: "one" }];
    const invalid = [null, [], [{ id: "a", text: "one" }],
        [{ id: "a", text: "one" }, { id: "a", text: "again" }],
        [{ id: "a", text: "one" }, { id: "c", text: "unknown" }],
        [{ id: "a", text: "one" }, { id: "b", text: 123 }],
        [{ id: "a", text: "one" }, { id: "b", text: " " }]];
    for (const engine of ["gemini", "deepseek"]) {
        const e = environment(); delete e.mocks["api/" + engine + ".ts"];
        let response;
        if (engine === "gemini") e.native.batGeminiFetch = async () => ({ ok: true, data: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) });
        else e.native.batDeepSeekFetch = async () => ({ ok: true, data: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }) });
        const api = e.load("api/" + engine + ".ts");
        const call = () => engine === "gemini"
            ? api.translateBatchWithGemini("123", messages, "ko", "key", "", "model")
            : api.translateBatchWithDeepSeek("123", messages, "ko", "key", "", "model");
        response = valid; assert.deepEqual(await call(), [{ id: "a", text: "one" }, { id: "b", text: "two" }]);
        for (response of invalid) await assert.rejects(call(), /response|parse|translation/i);
        if (engine === "deepseek") {
            response = { b: "two", a: "one" }; assert.equal((await call())[0].text, "one");
            response = { a: "one" }; await assert.rejects(call(), /missing translations/);
        }
    }
});

function outgoingEnvironment() {
    const e = environment({ translateOutgoing: true, previewOutgoing: true, targetLang: "ko", translationEngine: "gemini", channelList: [{ id: "123", lang: "en" }] });
    let selected = "123", draft = "안녕하세요", calls = 0, notices = [];
    const actions = [], requests = [], pending = deferred();
    Object.assign(e.mocks["@webpack/common"], {
        SelectedChannelStore: { getChannelId: () => selected },
        DraftType: { ChannelMessage: 0 }, DraftStore: { getDraft: () => draft },
        ReactDOM: { flushSync: fn => fn() },
        ComponentDispatch: { dispatchToLastSubscribed: (event, data) => {
            actions.push([event, data]); draft = event === "CLEAR_TEXT" ? "" : draft + data.rawText;
        } }
    });
    e.mocks["api/translate.ts"] = { safeTranslate: (...args) => { calls++; requests.push(args); return pending.promise; } };
    e.mocks["utils/toast.ts"] = { showTranslationToast: text => notices.push(text) };
    e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({ setOutgoing() {} }) } };
    const handler = e.load("api/outgoing.ts");
    return { ...e, ...handler, pending, actions, requests, notices, get draft() { return draft; }, get calls() { return calls; },
        select: channel => { selected = channel; }, edit: text => { draft = text; } };
}

test("preview cancels the send, preserves attachments and sends reviewed text without translating again", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = outgoingEnvironment();
    const message = { content: "안녕하세요", attachments: [{ id: "file" }] };
    const result = e.handleOutgoingTranslation("123", message, () => true);
    assert.deepEqual(await e.handleOutgoingTranslation("123", message, () => true), { cancel: true });
    assert.equal(e.calls, 1); e.pending.resolve("Hello"); assert.deepEqual(await result, { cancel: true });
    assert.equal(message.content, "안녕하세요"); assert.equal(message.attachments.length, 1);
    t.mock.timers.tick(1); assert.equal(e.draft, "Hello");
    assert.deepEqual(e.actions.map(a => a[0]), ["CLEAR_TEXT", "INSERT_TEXT"]);
    assert.equal(await e.handleOutgoingTranslation("123", { content: "Hello" }, () => true), undefined);
    assert.equal(e.calls, 1);
});

test("preview never overwrites a different channel, changed draft or stopped plugin", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const change of ["channel", "draft", "stop"]) {
        const e = outgoingEnvironment(); let active = true;
        const result = e.handleOutgoingTranslation("123", { content: "안녕하세요" }, () => active);
        e.pending.resolve("Hello"); assert.deepEqual(await result, { cancel: true });
        if (change === "channel") e.select("456");
        if (change === "draft") e.edit("새 메시지");
        if (change === "stop") active = false;
        t.mock.timers.tick(1); assert.equal(e.actions.length, 0);
        assert.equal(e.draft, change === "draft" ? "새 메시지" : "안녕하세요");
    }
});

test("outgoing translation cancels on failure or stop; preview-off replaces text for sending", async () => {
    for (const mode of ["empty", "error", "stop", "send"]) {
        const e = outgoingEnvironment(); e.store.previewOutgoing = false; let active = true;
        const message = { content: "안녕하세요" };
        const result = e.handleOutgoingTranslation("123", message, () => active);
        if (mode === "stop") active = false;
        if (mode === "error") e.pending.resolve(Promise.reject(Error("network")));
        else e.pending.resolve(mode === "empty" ? null : "Hello");
        assert.deepEqual(await result, mode === "send" ? undefined : { cancel: true });
        assert.equal(message.content, mode === "send" ? "Hello" : "안녕하세요");
    }
});


test("automatic rendering follows channel engines and scope and retains own outgoing originals", () => {
    const e = environment({ translationEngine: "deepseek", targetLang: "ko", skipOwnMessages: true,
        manualTranslationEngine: "gemini", channelList: [] });
    let execution, allowed = true, engine;
    e.mocks["settings.ts"].settings.use = () => e.store;
    e.mocks["settings.ts"].getChannelConfig = () => ({ allowed, config: engine ? { engine } : null });
    e.mocks["@components/ErrorBoundary"] = { wrap: fn => fn };
    e.mocks["@webpack"] = { findCssClassesLazy: () => ({ markup: "markup" }) };
    e.mocks["react/jsx-runtime"] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    e.mocks["@webpack/common"].UserStore = { getCurrentUser: () => ({ id: "me" }) };
    e.mocks["@webpack/common"].Parser = { parse: text => text };
    e.mocks["index.ts"] = { pluginStarted: true };
    e.mocks["components/LoadingIndicator.ts"] = { LoadingIndicator() {} };
    e.mocks["hooks/useMessageVisibility.ts"] = { useMessageVisibility() {} };
    e.mocks["hooks/useTranslationExecution.ts"] = { useTranslationExecution: props => {
        execution = props; return { translatedText: props.cachedTranslated ?? "translated", isTranslating: false };
    } };
    e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({
        peek: key => key.includes('"gemini"') ? "old manual translation" : undefined,
        getOutgoing: () => "my original message"
    }) } };
    const { TranslationAccessory } = e.load("components/TranslationAccessory.tsx");
    const message = { id: "123456789012345678", channel_id: "123", content: "hello", author: { id: "other" } };
    assert.ok(TranslationAccessory({ message })); assert.equal(execution.currentEngine, "deepseek"); assert.equal(execution.cachedTranslated, undefined);
    engine = "gemini"; TranslationAccessory({ message }); assert.equal(execution.currentEngine, "gemini");
    engine = "default"; TranslationAccessory({ message }); assert.equal(execution.currentEngine, "deepseek");
    engine = "disable"; assert.equal(TranslationAccessory({ message }), null);
    engine = "deepseek"; allowed = false; assert.equal(TranslationAccessory({ message }), null); assert.equal(execution.allowed, false);
    allowed = true; message.author.id = "me"; assert.ok(TranslationAccessory({ message }));
    assert.equal(execution.skipMessage, true); assert.equal(execution.cachedTranslated, "my original message");
});

test("automatic execution skips excluded channels and disabled engines and shares pending work", async () => {
    for (const mode of ["excluded", "disabled", "pending", "translate"]) {
        const e = environment(); const effects = [], writes = [], states = [];
        let calls = 0;
        const result = deferred();
        e.mocks["@webpack/common"].useState = value => [value, next => states.push(next)];
        e.mocks["@webpack/common"].useEffect = fn => effects.push(fn);
        e.mocks["api/translate.ts"] = { safeTranslate: () => { calls++; return result.promise; } };
        e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({
            getGeneration: () => "0", getPending: () => mode === "pending" ? result.promise : undefined,
            setPending() {}, set: (...args) => writes.push(args)
        }) } };
        const { useTranslationExecution } = e.load("hooks/useTranslationExecution.ts");
        useTranslationExecution({ messageId: "123456789012345678", channelId: "123", content: "hello", cacheKey: "key",
            currentEngine: mode === "disabled" ? "disable" : "gemini", sourceLang: "auto", resolvedTarget: "ko",
            shouldTranslateContent: true, allowed: mode !== "excluded", skipMessage: false, cachedTranslated: undefined, cacheRevision: 0 });
        effects.forEach(fn => fn());
        assert.equal(calls, mode === "translate" ? 1 : 0);
        result.resolve("translated"); await tick();
        assert.equal(writes.length, ["pending", "translate"].includes(mode) ? 1 : 0);
        if (writes.length) assert.ok(states.includes("translated"));
    }
});


function languageEnvironment() {
    const e = environment({ geminiApiKey: "gemini-key", deepseekApiKey: "deepseek-key" });
    const messages = { _array: [], _after: { _messages: [] }, hasMoreAfter: false };
    e.mocks["@webpack/common"].MessageStore = { getMessages: channel => { assert.equal(channel, "123"); return messages; } };
    e.mocks["@webpack/common"].UserStore = { getCurrentUser: () => ({ id: "me" }) };
    return { ...e, messages };
}

test("Auto language sample picks the newest meaningful message from another person", () => {
    const e = languageEnvironment();
    const message = (id, content, author = { id: "other" }, type = 0) => ({ id, content, author, type });
    e.messages._array = [message("100", "古いメッセージ"), message("600", "my own text", { id: "me" }),
        message("200", "最近のメッセージ"), message("300", "https://example.test <@123> 😀"),
        message("400", "system notice", { id: "other" }, 7), message("500", "bot message", { id: "bot", bot: true }),
        message("700", "\u0060\u0060\u0060const example = true;\u0060\u0060\u0060")];
    const { getRecentLanguageSample } = e.load("api/detectLanguage.ts");
    assert.deepEqual(getRecentLanguageSample("123"), { id: "200", text: "最近のメッセージ" });
    e.messages._after._messages.push(message("800", "最新の返信", { id: "other" }, 19));
    assert.equal(getRecentLanguageSample("123").id, "800");
    e.messages.hasMoreAfter = true; assert.equal(getRecentLanguageSample("123"), null);
    e.messages.hasMoreAfter = false; e.messages._array = []; e.messages._after._messages = [];
    assert.equal(getRecentLanguageSample("123"), null);
});

test("Auto language detection supports all engines and reuses only the current sample", async () => {
    for (const engine of ["gemini", "deepseek"]) {
        const e = languageEnvironment(); let calls = 0;
        e.messages._array = [{ id: "100", content: "こんにちは、元気ですか", author: { id: "other" } }];
        e.mocks["api/gemini.ts"].fetchGeminiAPI = async payload => {
            calls++; assert.match(payload.contents[0].parts[0].text, /こんにちは/);
            return JSON.stringify({ language: "ja", confident: true });
        };
        e.native.batDeepSeekFetch = async () => {
            calls++; return { ok: true, data: JSON.stringify({ choices: [{ message: { content: '{"language":"ja","confident":true}' } }] }) };
        };
        const { detectOutgoingLanguage, clearDetectedLanguages } = e.load("api/detectLanguage.ts");
        const signal = new AbortController().signal;
        assert.equal(await detectOutgoingLanguage("123", engine, signal), "ja");
        assert.equal(await detectOutgoingLanguage("123", engine, signal), "ja"); assert.equal(calls, 1);
        e.messages._array[0].content += "？";
        assert.equal(await detectOutgoingLanguage("123", engine, signal), "ja"); assert.equal(calls, 2);
        clearDetectedLanguages(); assert.equal(await detectOutgoingLanguage("123", engine, signal), "ja"); assert.equal(calls, 3);
    }
});

test("Auto detection rejects uncertain and unsupported languages and normalizes supported codes", async () => {
    const e = languageEnvironment(); let response;
    e.messages._array = [{ id: "100", content: "some words", author: { id: "other" } }];
    e.mocks["api/gemini.ts"].fetchGeminiAPI = async () => JSON.stringify(response);
    const { detectOutgoingLanguage, clearDetectedLanguages } = e.load("api/detectLanguage.ts");
    for (const [language, confident, expected] of [["en", false, null], ["unknown", true, null], ["xx", true, null],
        [123, true, null], ["EN-US", true, "en"], ["ZH", true, "zh-CN"], ["zh-TW", true, "zh-TW"]]) {
        clearDetectedLanguages(); response = { language, confident };
        assert.equal(await detectOutgoingLanguage("123", "gemini", new AbortController().signal), expected);
    }
});

test("Auto outgoing targets the detected language instead of the reading language", async () => {
    const e = outgoingEnvironment(); e.store.previewOutgoing = false; e.store.channelList[0].lang = "auto";
    let detected = 0;
    e.load("api/detectLanguage.ts").detectOutgoingLanguage = async (channel, engine) => {
        detected++; assert.equal(channel, "123"); assert.equal(engine, "gemini"); return "ja";
    };
    const message = { content: "안녕하세요" };
    const sending = e.handleOutgoingTranslation("123", message, () => true); await tick();
    assert.equal(e.requests[0][2], "ja"); e.pending.resolve("こんにちは");
    assert.equal(await sending, undefined); assert.equal(message.content, "こんにちは"); assert.equal(detected, 1);
});

test("Auto outgoing blocks an undetected language; explicit languages bypass detection", async () => {
    const e = outgoingEnvironment(); let detected = 0;
    e.load("api/detectLanguage.ts").detectOutgoingLanguage = async () => { detected++; return null; };
    e.store.channelList[0].lang = "auto"; const message = { content: "안녕하세요" };
    assert.deepEqual(await e.handleOutgoingTranslation("123", message, () => true), { cancel: true });
    assert.equal(e.calls, 0); assert.equal(message.content, "안녕하세요"); assert.match(e.notices[0], /Set a channel language/);
    e.store.channelList[0].lang = "en"; e.store.previewOutgoing = false;
    const sending = e.handleOutgoingTranslation("123", message, () => true);
    e.pending.resolve("Hello"); assert.equal(await sending, undefined); assert.equal(detected, 1);
    assert.equal(e.requests[0][2], "en");
});

test("stopping or timing out Auto detection cancels the send and the detection request", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const stop of [true, false]) {
        const e = outgoingEnvironment(); e.store.channelList[0].lang = "auto"; let signal, active = true;
        e.load("api/detectLanguage.ts").detectOutgoingLanguage = (_, __, requestSignal) => {
            signal = requestSignal; return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }));
        };
        const sending = e.handleOutgoingTranslation("123", { content: "안녕하세요" }, () => active);
        if (stop) { active = false; e.resetOutgoingTranslations(); } else t.mock.timers.tick(20000);
        assert.deepEqual(await sending, { cancel: true }); assert.equal(signal.aborted, true); assert.equal(e.calls, 0);
    }
});


test("Auto sends emoji and link-only messages without detecting a language", async () => {
    const e = outgoingEnvironment(); e.store.channelList[0].lang = "auto";
    e.load("api/detectLanguage.ts").detectOutgoingLanguage = async () => { throw Error("detection should not run"); };
    for (const content of ["👍", "https://example.test", "<@123>"]) {
        const message = { content };
        assert.equal(await e.handleOutgoingTranslation("123", message, () => true), undefined);
        assert.equal(message.content, content);
    }
    assert.equal(e.calls, 0); assert.equal(e.notices.length, 0);
});


test("removed engine settings become Off while channel preferences and AI engines are preserved", () => {
    const e = environment({ translationEngine: "removed-engine", channelList: [
        { id: "1", engine: "removed-engine", lang: "ja", outgoingCustomPrompt: "casual" },
        { id: "2", engine: "gemini" }, { id: "3", engine: "deepseek" }, { id: "4", engine: "default" }
    ] });
    delete e.mocks["settings.ts"];
    e.mocks["@api/Settings"] = { definePluginSettings: def => ({ def, store: e.store }) };
    e.mocks["@utils/types"] = { OptionType: {} };
    const { normalizeTranslationEngines } = e.load("settings.ts"); normalizeTranslationEngines();
    assert.equal(e.store.translationEngine, "disable");
    assert.deepEqual(e.store.channelList[0], { id: "1", engine: "disable", lang: "ja", outgoingCustomPrompt: "casual" });
    assert.deepEqual(e.store.channelList.slice(1).map(c => c.engine), ["gemini", "deepseek", "default"]);
    e.store.translationEngine = "deepseek"; normalizeTranslationEngines(); assert.equal(e.store.translationEngine, "deepseek");
});

test("AI workers serialize arrivals within a channel while an earlier request is running", async () => {
    const e = environment(); const first = deferred(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        calls++; if (calls === 1) await first.promise;
        return messages.map(m => ({ id: m.id, text: m.text }));
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const a = task("a"), b = task("b"); worker.enqueue(a); worker.flushNow(); await tick();
    worker.enqueue(b); worker.flushNow(); await tick(); assert.equal(calls, 1);
    first.resolve(); assert.equal(await a.result, "a"); await tick();
    worker.flushNow(); assert.equal(await b.result, "b"); await tick(); assert.equal(calls, 2); assert.equal(worker.registry.size, 0);
});
