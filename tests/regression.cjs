// Run from a Vencord checkout with: node src/userplugins/alwaysTranslate/tests/regression.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require(process.env.ALWAYS_TRANSLATE_TYPESCRIPT || "typescript");
const root = path.resolve(__dirname, "..");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };

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
        "@webpack/common": { useRef: value => ({ current: value }) },
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

test("reset aborts active requests and cancels chunks waiting for a slot", async () => {
    const e = environment(); e.mocks["constants.ts"] = { GEMINI_BATCH_SIZE: 1, MAX_TRANSLATION_CHARS: 6000, BATCH_ACCUMULATION_TIME_GEMINI: 200 };
    const signals = []; let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => { calls++; signals.push(args[6]); return new Promise(() => {}); };
    const { AiChannelWorker } = e.load("api/worker.ts");
    const worker = new AiChannelWorker("123"), jobs = [task("a"), task("b"), task("c")];
    jobs.forEach(job => worker.enqueue(job)); worker.flushNow();
    await tick(); assert.equal(calls, 2); worker.reset(); assert.ok(signals.every(signal => signal.aborted));
    assert.deepEqual(await Promise.all(jobs.map(job => job.result)), ["", "", ""]); await tick(); assert.equal(calls, 2);
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
    const generation = cache.watchGeneration("v3:1:ai"), otherGeneration = cache.watchGeneration("v3:2:ai");
    cache.clearChannel("1");
    assert.equal(cache.getChannelCount("1"), 0); assert.equal(cache.peek("v3:2:ai"), "Other");
    assert.equal(cache.getOutgoing("1", "sent"), undefined); assert.equal(cache.getOutgoing("2", "sent"), "other original");
    assert.equal(cache.getPending("v3:1:pending", "source"), undefined);
    assert.equal(generation.isCurrent(), false); assert.equal(otherGeneration.isCurrent(), true); generation.release(); otherGeneration.release();
    await cache.flush();
});

test("cache clear invalidates in-flight results and rejected pending requests are cleaned", async () => {
    const e = environment(); const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    const generation = cache.watchGeneration("v3:1:key"); cache.clearAll(); assert.equal(generation.isCurrent(), false); generation.release();
    const rejected = Promise.reject(Error("network")); cache.setPending("v3:1:key", "source", rejected);
    await tick(); assert.equal(cache.getPending("v3:1:key", "source"), undefined); await cache.flush();
});

test("cache failed saves remain dirty and can be retried", async () => {
    const e = environment(); let calls = 0, saved;
    e.native.batCacheSave = async value => { saved = value; return ++calls > 1; };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:key", "translation", "gemini");
    await cache.flush(); await cache.flush(); assert.equal(calls, 2); assert.equal(saved.version, 3);
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
        DraftType: { ChannelMessage: 0 }, DraftStore: { getDraft: () => draft, addChangeListener() {}, removeChangeListener() {} },
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
    let execution, allowed = true, engine, failure = null, retries = 0;
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
        execution = props; return { translatedText: failure ? null : props.cachedTranslated ?? "translated", isTranslating: false, error: failure, retry: () => { retries++; } };
    } };
    e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({
        getDisplayed: () => undefined,
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
    message.author.id = "other"; failure = "API rate limit exceeded";
    const retryButton = TranslationAccessory({ message });
    assert.equal(retryButton.type, "button"); assert.equal(retryButton.props.title, failure);
    assert.equal(retryButton.props.className, "bat-translation-retry"); retryButton.props.onClick(); assert.equal(retries, 1);
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
            watchGeneration: () => ({ isCurrent: () => true, release() {} }), getPending: () => mode === "pending" ? result.promise : undefined,
            setPending() {}, rememberDisplayed() {}, set: (...args) => writes.push(args)
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


function translationHookRunner(e, initialProps) {
    const slots = []; let cursor = 0, effects = [], props = initialProps;
    Object.assign(e.mocks["@webpack/common"], {
        useState: initial => {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
            return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
        },
        useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
        useEffect: (effect, deps) => {
            const i = cursor++, previous = slots[i];
            if (!previous || deps.some((value, index) => value !== previous.deps[index])) effects.push(() => {
                previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
            });
        }
    });
    const { useTranslationExecution } = e.load("hooks/useTranslationExecution.ts");
    return {
        render: (updates = {}) => {
            props = { ...props, ...updates }; cursor = 0; effects = [];
            const result = useTranslationExecution(props); effects.forEach(effect => effect()); return result;
        },
        unmount: () => slots.forEach(slot => slot?.cleanup?.())
    };
}

function translationHookProps() {
    return { messageId: "123456789012345678", channelId: "123", content: "hello", cacheKey: "v3:123:key",
        currentEngine: "gemini", sourceLang: "auto", resolvedTarget: "ko", shouldTranslateContent: true,
        allowed: true, skipMessage: false, cachedTranslated: undefined, cacheRevision: 0 };
}

test("failed messages retry once per click and replace their error with a successful translation", async () => {
    const e = environment(), first = deferred(), second = deferred(), requests = [];
    e.mocks["api/translate.ts"] = { safeTranslate: (...args) => { requests.push(args); return requests.length === 1 ? first.promise : second.promise; } };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    cache.set("v3:123:other", "already translated", "gemini");
    const runner = translationHookRunner(e, translationHookProps()); runner.render();
    assert.equal(runner.render().isTranslating, true);
    first.reject(Error("API rate limit exceeded")); await tick();
    const failed = runner.render(); assert.equal(failed.error, "API rate limit exceeded"); assert.equal(failed.isTranslating, false);
    failed.retry(); failed.retry(); runner.render(); assert.equal(requests.length, 2);
    const loading = runner.render(); assert.equal(loading.error, null); assert.equal(loading.isTranslating, true);
    second.resolve("안녕하세요"); await tick();
    const succeeded = runner.render(); assert.equal(succeeded.error, null); assert.equal(succeeded.translatedText, "안녕하세요");
    succeeded.retry(); runner.render(); assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(args => args[6]), ["123456789012345678", "123456789012345678"]);
    assert.equal(cache.peek("v3:123:other"), "already translated"); await cache.flush(); runner.unmount();
});

test("cancellation and unchanged translations show no retry error; late failures never affect a new message", async () => {
    const e = environment(), first = deferred(); let calls = 0;
    e.mocks["api/translate.ts"] = { safeTranslate: () => ++calls === 1 ? first.promise : Promise.resolve(null) };
    const runner = translationHookRunner(e, translationHookProps()); runner.render();
    runner.render({ cacheKey: "v3:123:edited", content: "edited" });
    first.reject(Error("old request failed")); await tick();
    const current = runner.render(); assert.equal(current.error, null); assert.equal(current.translatedText, null);
    runner.render({ allowed: false }); const disabled = runner.render(); disabled.retry(); runner.render(); assert.equal(calls, 2);
    runner.unmount();
});

test("API failures propagate through the worker to message retries, including reported errors", async () => {
    for (const handled of [false, true]) {
        const e = environment(); e.mocks["api/breaker.ts"].APIBreaker.reportError = () => handled;
        e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { throw Error("Invalid API key"); };
        const { safeTranslate } = e.load("api/translate.ts");
        await assert.rejects(safeTranslate("hello", "auto", "ko", "gemini", { gemini: "key", deepseek: "" }, "123", ""), /Invalid API key/);
        await tick(); assert.equal(e.load("api/worker.ts").aiWorkers.size, 0);
        e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => messages.map(m => ({ id: m.id, text: "translated" }));
        assert.equal(await safeTranslate("hello", "auto", "ko", "gemini", { gemini: "key", deepseek: "" }, "123", ""), "translated");
    }
});

test("worker deadlines expose a timeout reason and release the request slot", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = environment(); let signal;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (...args) => { signal = args[6]; return new Promise(() => {}); };
    const { safeTranslate } = e.load("api/translate.ts");
    const translating = safeTranslate("hello", "auto", "ko", "gemini", { gemini: "key", deepseek: "" }, "123", "");
    const rejected = assert.rejects(translating, /timed out/); await tick();
    t.mock.timers.tick(20000); await rejected; await tick(); assert.equal(signal.aborted, true);
    assert.equal(e.load("api/worker.ts").aiWorkers.size, 0);
});


test("text splitting preserves paragraph and sentence separators, Unicode and protected tokens", () => {
    const { splitTranslationText } = environment().load("utils/batching.ts");
    const paragraph = "a".repeat(3000) + "\n\n" + "b".repeat(3500);
    const sentence = "a".repeat(3500) + ". " + "b".repeat(3500);
    const cases = [paragraph, sentence, "a".repeat(5999) + "😀" + "b".repeat(1000),
        "a".repeat(5997) + "[token0]" + "b".repeat(1000), "x".repeat(13000), " ".repeat(8000) + "text", "short"];
    for (const text of cases) {
        const pieces = splitTranslationText(text);
        assert.equal(pieces.map(p => p.text + p.separator).join(""), text);
        assert.ok(pieces.every(p => p.text.length <= 6000));
        assert.ok(pieces.every(p => !/[\uD800-\uDBFF]$/.test(p.text) && !/^[\uDC00-\uDFFF]/.test(p.text)));
    }
    assert.equal(splitTranslationText(paragraph)[0].separator, "\n\n");
    assert.equal(splitTranslationText(sentence)[0].text, "a".repeat(3500) + ".");
    assert.equal(splitTranslationText(cases[3])[1].text.startsWith("[token0]"), true);
});

test("batch packing respects both total characters and message count without splitting short messages", () => {
    const { batchTranslationTasks } = environment().load("utils/batching.ts");
    const tasks = [3000, 3000, 1, 5999, 6000].map((length, id) => ({ id, text: "x".repeat(length) }));
    const batches = batchTranslationTasks(tasks);
    assert.deepEqual(batches.map(b => b.length), [2, 2, 1]); assert.deepEqual(batches.flat(), tasks);
    assert.ok(batches.every(b => b.reduce((total, task) => total + task.text.length, 0) <= 6000));
    assert.deepEqual(batchTranslationTasks(tasks, 6000, 1).map(b => b.length), [1, 1, 1, 1, 1]);
});

test("workers cap each API batch at 6000 characters for both AI engines", async () => {
    for (const engine of ["gemini", "deepseek"]) {
        const e = environment(), requests = [];
        e.mocks["api/" + engine + ".ts"][engine === "gemini" ? "translateBatchWithGemini" : "translateBatchWithDeepSeek"] = async (_, messages) => {
            requests.push(messages); return messages.map(m => ({ id: m.id, text: "done" }));
        };
        const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
        const tasks = [task("a", "a".repeat(4000)), task("b", "b".repeat(4000)), task("c", "c".repeat(4000))];
        tasks.forEach(job => { job.engine = engine; worker.enqueue(job); }); worker.flushNow();
        assert.deepEqual(await Promise.all(tasks.map(job => job.result)), ["done", "done", "done"]);
        assert.equal(requests.length, 3); assert.ok(requests.every(batch => batch.reduce((sum, m) => sum + m.text.length, 0) <= 6000));
    }
});

test("long message translations reassemble in source order and retain code and links", async () => {
    for (const engine of ["gemini", "deepseek"]) {
        const e = environment(), batches = [];
        e.mocks["api/" + engine + ".ts"][engine === "gemini" ? "translateBatchWithGemini" : "translateBatchWithDeepSeek"] = async (_, messages, target, key, prompt) => {
            assert.equal(target, "ko"); assert.equal(prompt, "keep tone"); batches.push(messages);
            return messages.map(m => ({ id: m.id, text: m.text.toUpperCase() }));
        };
        const { safeTranslate } = e.load("api/translate.ts");
        const text = "a".repeat(3500) + "\n\n" + "b".repeat(3500) + "\n" + "c".repeat(3500) + " \u0060code stays lowercase\u0060 https://example.test/path";
        const result = await safeTranslate(text, "auto", "ko", engine, { gemini: "key", deepseek: "key" }, "123", "", "keep tone");
        const expected = "A".repeat(3500) + "\n\n" + "B".repeat(3500) + "\n" + "C".repeat(3500) + " \u0060code stays lowercase\u0060 https://example.test/path";
        assert.equal(result, expected); assert.ok(batches.length >= 2);
        assert.ok(batches.every(batch => batch.reduce((sum, m) => sum + m.text.length, 0) <= 6000));
    }
});

test("a failed long-message fragment rejects the complete translation without returning partial text", async () => {
    const e = environment(); let calls = 0;
    e.mocks["api/breaker.ts"].APIBreaker.reportError = () => true;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        if (++calls === 2) throw Error("second fragment failed");
        return messages.map(m => ({ id: m.id, text: "partial translation" }));
    };
    const { safeTranslate } = e.load("api/translate.ts");
    await assert.rejects(safeTranslate("a".repeat(4000) + "\n\n" + "b".repeat(4000), "auto", "ko", "gemini",
        { gemini: "key", deepseek: "" }, "123", ""), /second fragment failed/);
    assert.equal(calls, 2); await tick(); assert.equal(e.load("api/worker.ts").aiWorkers.size, 0);
});


test("expired active requests abort even when newer work is queued", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const e = environment(); let firstSignal, calls = 0;
    e.mocks["api/breaker.ts"].APIBreaker.reportError = () => true;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (_, messages, ...args) => {
        if (++calls > 1) return Promise.resolve(messages.map(m => ({ id: m.id, text: "new result" })));
        firstSignal = args[4];
        return new Promise((resolve, reject) => firstSignal.addEventListener("abort", () => reject(Error("aborted")), { once: true }));
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const old = task("old"); worker.enqueue(old);
    t.mock.timers.tick(10000); await tick(); assert.ok(firstSignal);
    t.mock.timers.tick(5000); const next = task("next"); worker.enqueue(next);
    t.mock.timers.tick(5000); assert.equal(await old.result, ""); await tick();
    assert.equal(firstSignal.aborted, true); assert.equal(worker.registry.has("next"), true);
    worker.flushNow(); assert.equal(await next.result, "new result"); await tick(); assert.equal(worker.registry.size, 0);
});


test("three normal 8-second batches finish within the total deadline in FIFO order", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const e = environment(); const order = []; let active = 0, peak = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (_, messages, ...args) => {
        order.push(messages[0].id); peak = Math.max(peak, ++active); const signal = args[4];
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { active--; resolve(messages.map(message => ({ id: message.id, text: "done" }))); }, 8000);
            signal.addEventListener("abort", () => { clearTimeout(timer); active--; reject(Error("aborted")); }, { once: true });
        });
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const jobs = [task("a", "a".repeat(4000)), task("b", "b".repeat(4000)), task("c", "c".repeat(4000))];
    jobs[1].dmPrompt = "different prompt";
    jobs.forEach(job => worker.enqueue(job)); worker.flushNow(); await tick(); assert.deepEqual(order, ["a", "b"]);
    t.mock.timers.tick(8000); await tick(); assert.deepEqual(order, ["a", "b", "c"]);
    t.mock.timers.tick(8000); await tick(); assert.deepEqual(await Promise.all(jobs.map(job => job.result)), ["done", "done", "done"]);
    assert.equal(peak, 2); assert.equal(active, 0); assert.equal(worker.registry.size, 0);
});

test("work arriving during an active wave retains its original accumulation time", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const e = environment(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (_, messages) => {
        calls++;
        return new Promise(resolve => setTimeout(() => resolve(messages.map(message => ({ id: message.id, text: "done" }))), calls === 1 ? 16000 : 0));
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const first = task("first"), next = task("next"); worker.enqueue(first); worker.flushNow(); await tick();
    t.mock.timers.tick(5000); worker.enqueue(next);
    t.mock.timers.tick(11000); await tick(); assert.equal(await first.result, "done"); assert.equal(calls, 2);
    t.mock.timers.tick(1); await tick(); assert.equal(await next.result, "done");
});


test("Gemini errors and quota failures do not cancel an active DeepSeek batch", async () => {
    for (const quota of [false, true]) {
        const e = environment(), deepseek = deferred(); let signal;
        e.mocks["api/breaker.ts"].APIBreaker.reportError = () => true;
        e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { throw Object.assign(Error("Gemini failed"), quota ? { quotaKind: "rpm" } : {}); };
        e.mocks["api/deepseek.ts"].translateBatchWithDeepSeek = (...args) => { signal = args[6]; return deepseek.promise; };
        const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
        const a = task("a"), b = task("b"); b.engine = "deepseek";
        worker.enqueue(a); worker.enqueue(b); worker.flushNow();
        assert.equal(await a.result, ""); await tick(); assert.equal(signal.aborted, false); assert.equal(worker.registry.has("b"), true);
        deepseek.resolve([{ id: "b", text: "DeepSeek succeeded" }]);
        assert.equal(await b.result, "DeepSeek succeeded"); await tick(); assert.equal(worker.registry.size, 0);
    }
});

test("a failed batch does not discard other batches using the same engine", async () => {
    const e = environment(), calls = [];
    e.mocks["api/breaker.ts"].APIBreaker.reportError = () => true;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        calls.push(messages[0].id);
        if (messages[0].id === "bad") throw Error("malformed response");
        return messages.map(message => ({ id: message.id, text: "done" }));
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const jobs = [task("bad", "a".repeat(4000)), task("good", "b".repeat(4000)), task("waiting", "c".repeat(4000))];
    jobs.forEach(job => worker.enqueue(job)); worker.flushNow();
    assert.deepEqual(await Promise.all(jobs.map(job => job.result)), ["", "done", "done"]);
    assert.deepEqual(calls, ["bad", "good", "waiting"]); await tick(); assert.equal(worker.registry.size, 0);
});

test("work arriving during a failed batch remains queued and can run", async () => {
    const e = environment(), failing = deferred();
    e.mocks["api/breaker.ts"].APIBreaker.reportError = () => true;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = () => failing.promise;
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const first = task("first"), next = task("next"); next.engine = "deepseek";
    worker.enqueue(first); worker.flushNow(); await tick(); worker.enqueue(next);
    failing.reject(Error("Gemini failed")); assert.equal(await first.result, ""); await tick();
    assert.equal(worker.registry.has("next"), true); worker.flushNow();
    assert.equal(await next.result, "translated:next"); await tick(); assert.equal(worker.registry.size, 0);
});

test("an unavailable error notification cannot strand queued translations", async () => {
    const e = environment();
    e.mocks["api/breaker.ts"].APIBreaker.reportError = () => { throw Error("toast unavailable"); };
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { throw Error("API failed"); };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const a = task("a"), b = task("b"); b.engine = "deepseek";
    worker.enqueue(a); worker.enqueue(b); worker.flushNow();
    assert.deepEqual(await Promise.all([a.result, b.result]), ["", "translated:b"]);
    await tick(); assert.equal(worker.state, "IDLE"); assert.equal(worker.registry.size, 0);
});


test("a channel backlog does not monopolize all global request slots", async () => {
    const e = environment(), a = deferred(), b = deferred(), order = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        const id = messages[0].id; order.push(id);
        if (id === "a") await a.promise;
        if (id === "b") await b.promise;
        return messages.map(message => ({ id: message.id, text: "done" }));
    };
    const { AiChannelWorker } = e.load("api/worker.ts"), busy = new AiChannelWorker("123"), other = new AiChannelWorker("456");
    const jobs = ["a", "b", "c", "d"].map(id => task(id, id.repeat(4000)));
    jobs.forEach(job => busy.enqueue(job)); busy.flushNow(); await tick(); assert.deepEqual(order, ["a", "b"]);
    const waiting = task("other"); other.enqueue(waiting); other.flushNow(); await tick();
    a.resolve(); await tick(); assert.equal(order[2], "other"); assert.equal(await waiting.result, "done");
    b.resolve(); assert.deepEqual(await Promise.all(jobs.map(job => job.result)), ["done", "done", "done", "done"]);
    await tick(); assert.equal(busy.registry.size, 0); assert.equal(other.registry.size, 0);
});


test("backoff honors Retry-After, isolates credentials and models, and probes recovery only once", async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { withRequestBackoff } = environment().load("api/requestBackoff.ts");
    const scope = { engine: "deepseek", apiKey: "key", model: "model", endpoint: "https://example.test" };
    let calls = 0;
    const limited = () => withRequestBackoff(scope, async () => { calls++; throw Object.assign(Error("rate limited"), { status: 429, retryAfterMs: 30000 }); });
    await assert.rejects(limited(), /rate limited/); await assert.rejects(limited(), /30s/); assert.equal(calls, 1);
    assert.equal(await withRequestBackoff({ ...scope, model: "other" }, async () => "other model"), "other model");
    assert.equal(await withRequestBackoff({ ...scope, apiKey: "other" }, async () => "other key"), "other key");
    t.mock.timers.tick(30000); const recovering = deferred();
    const probe = withRequestBackoff(scope, () => { calls++; return recovering.promise; });
    await assert.rejects(withRequestBackoff(scope, async () => { calls++; }), /recovery check/);
    recovering.resolve("recovered"); assert.equal(await probe, "recovered");
    assert.equal(await withRequestBackoff(scope, async () => "normal"), "normal"); assert.equal(calls, 2);
});

test("temporary failures increase the pause; cancellation does not block healthy requests", async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { withRequestBackoff } = environment().load("api/requestBackoff.ts");
    const scope = { engine: "gemini", apiKey: "key", model: "model", endpoint: "url" };
    const failure = () => withRequestBackoff(scope, async () => { throw Object.assign(Error("server unavailable"), { status: 503 }); });
    await assert.rejects(failure(), /server/); await assert.rejects(failure(), /2s/);
    t.mock.timers.tick(2000); await assert.rejects(failure(), /server/); await assert.rejects(failure(), /4s/);
    t.mock.timers.tick(4000); await assert.rejects(withRequestBackoff(scope, async () => { throw Object.assign(Error("cancelled"), { name: "AbortError" }); }), /cancelled/);
    assert.equal(await withRequestBackoff(scope, async () => "recovered"), "recovered");
});

test("repeated DeepSeek 429 failures issue only one network request across channels", async () => {
    const e = environment(); delete e.mocks["api/deepseek.ts"]; let calls = 0;
    e.native.batDeepSeekFetch = async () => { calls++; return { ok: false, status: 429, retryAfter: "60", data: '{"error":{"message":"rate limit"}}' }; };
    const { safeTranslate } = e.load("api/translate.ts");
    for (const channel of ["1", "2", "3"]) await assert.rejects(safeTranslate("hello", "auto", "ko", "deepseek", { gemini: "", deepseek: "key" }, channel, ""), /rate limit/i);
    assert.equal(calls, 1);
});

test("HTTP Retry-After values survive IPC and support seconds and dates", async () => {
    const e = environment(), previous = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited", headers: { get: () => "120" } });
    try {
        const response = await e.load("native.ts").batDeepSeekFetch({ sender: { id: 1 } }, "https://example.test", "key", "{}", "id");
        assert.equal(response.retryAfter, "120");
        const { parseRetryAfter } = e.load("api/errors.ts");
        assert.equal(parseRetryAfter(response.retryAfter), 120000); assert.equal(parseRetryAfter("garbage"), 0);
        const future = new Date(Date.now() + 60000).toUTCString(); assert.ok(parseRetryAfter(future) >= 58000);
    } finally { global.fetch = previous; }
});

test("progress animates SVG without React state updates and pauses without scheduling frames", () => {
    const e = environment(), previousRaf = global.requestAnimationFrame, previousCancel = global.cancelAnimationFrame;
    const frames = new Map(); let id = 0, effect, stateUpdates = 0;
    global.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
    global.cancelAnimationFrame = frame => frames.delete(frame);
    Object.assign(e.mocks["@webpack/common"], { useEffect: fn => { effect = fn; }, useState: () => { stateUpdates++; throw Error("animation must not use state"); } });
    const ref = current => ({ current });
    const props = { channelId: "1", status: "waiting", isLeader: true, paused: false, threshold: 10,
        isPaused: ref(false), hasFired: ref(false), targetDeadline: ref(Infinity), targetEcoProgress: ref(0.3),
        targetStartTime: ref(Date.now()), targetMaxWaitMs: ref(0), circleRef: ref({ style: {} }), svgRef: ref({ style: {} }), countRef: ref({ hidden: true, textContent: "" }) };
    try {
        const { useProgressAnimation } = e.load("hooks/useProgressAnimation.ts"); useProgressAnimation(props); let cleanup = effect();
        for (let i = 0; i < 60; i++) { const [frame, fn] = frames.entries().next().value; frames.delete(frame); fn(); }
        assert.equal(stateUpdates, 0); assert.equal(props.countRef.current.textContent, "3/10");
        assert.notEqual(props.circleRef.current.style.strokeDashoffset, "38.000");
        cleanup(); assert.equal(frames.size, 0);
        props.paused = true; props.isPaused.current = true; useProgressAnimation(props); cleanup = effect();
        assert.equal(frames.size, 0); assert.equal(props.svgRef.current.style.opacity, "0.5"); assert.equal(stateUpdates, 0);
        assert.equal(e.load("utils/progressStore.ts").globalProgressStore.get("2"), 0);
        cleanup?.();
    } finally { global.requestAnimationFrame = previousRaf; global.cancelAnimationFrame = previousCancel; }
});

test("cache sends only changed entries, persists once per flush and refreshes visible entries for LRU", async () => {
    const e = environment(), saved = new Map(), patches = [];
    e.mocks["constants.ts"] = { CACHE_MAX_SIZE: 1000, CACHE_PERSISTENT_MAX_SIZE: 2, CACHE_SAVE_DEBOUNCE: 5000 };
    e.native.batCacheSave = async patch => { patches.push(structuredClone(patch)); if (patch.clear) saved.clear(); for (const [key, value] of patch.entries) value === null ? saved.delete(key) : saved.set(key, value); return true; };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    cache.set("v3:123:a", "hello", "gemini"); cache.set("v3:123:b", "other", "gemini"); await cache.flush();
    const runner = translationHookRunner(e, { ...translationHookProps(), cacheKey: "v3:123:a", cachedTranslated: "hello" }); runner.render();
    cache.set("v3:123:c", "new", "gemini"); await cache.flush();
    assert.equal(cache.peek("v3:123:a"), "hello"); assert.equal(cache.peek("v3:123:b"), undefined);
    assert.deepEqual(patches[1].entries, [["v3:123:c", "new"], ["v3:123:b", null]]);
    assert.deepEqual(Array.from(saved.keys()).sort(), ["v3:123:a", "v3:123:c"]); runner.unmount();
    cache.set("v3:123:c", "new", "gemini"); await cache.flush(); assert.equal(patches.length, 2);
});

test("large caches are byte-bounded and use bounded incremental IPC patches", async t => {
    const e = environment(), patches = [];
    const policy = e.load("utils/cachePolicy.ts");
    e.native.batCacheSave = async patch => { patches.push({ count: patch.entries.length, persist: patch.persist, bytes: patch.entries.reduce((total, [key, value]) => total + policy.cacheEntryBytes(key, value ?? ""), 0) }); return true; };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    for (let i = 0; i < 50000; i++) cache.set("v3:123:" + JSON.stringify([i, "x".repeat(300)]), "y".repeat(300), "gemini");
    const start = performance.now(); await cache.flush();
    assert.ok(cache.size < 15000); assert.ok(cache.size > 0);
    assert.ok(patches.every(p => p.count <= policy.CACHE_PATCH_ENTRY_LIMIT && p.bytes <= policy.CACHE_PATCH_BYTE_LIMIT));
    assert.equal(patches.filter(p => p.persist).length, 1);
    assert.ok(patches.reduce((sum, p) => sum + p.bytes, 0) <= policy.CACHE_BYTE_BUDGET);
    t.diagnostic(JSON.stringify({ entries: cache.size, patches: patches.length, rendererPatchPreparationMs: +(performance.now() - start).toFixed(1) }));
    const before = patches.length; cache.set("v3:123:one", "one changed entry", "gemini"); await cache.flush();
    assert.ok(patches.slice(before).reduce((sum, p) => sum + p.count, 0) <= 2);
});

test("cache save failure cannot overwrite a newer value queued during the write", async () => {
    const e = environment(), first = deferred(), saved = new Map(); let calls = 0;
    e.native.batCacheSave = async patch => { if (++calls === 1) return first.promise; for (const [key, value] of patch.entries) value === null ? saved.delete(key) : saved.set(key, value); return true; };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:key", "old", "gemini");
    const saving = cache.flush(); await tick(); cache.set("v3:1:key", "new", "gemini"); first.resolve(false); await saving;
    await cache.flush(); assert.equal(saved.get("v3:1:key"), "new"); assert.equal(cache.peek("v3:1:key"), "new");
});

test("clearing cache during a save dominates the old snapshot and preserves later additions", async () => {
    const e = environment(), first = deferred(), saved = new Map(); let calls = 0;
    e.native.batCacheSave = async patch => {
        if (++calls === 1) await first.promise;
        if (patch.clear) saved.clear(); for (const [key, value] of patch.entries) value === null ? saved.delete(key) : saved.set(key, value); return true;
    };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:old", "old", "gemini");
    const saving = cache.flush(); await tick(); cache.clearAll(); cache.set("v3:1:new", "new", "gemini"); first.resolve(); await saving;
    assert.deepEqual(Array.from(saved), [["v3:1:new", "new"]]); assert.equal(cache.size, 1);
});

test("native cache patches commit atomically and a failed rename preserves the previous file", async t => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "always-translate-cache-"));
    const destination = path.join(dir, "AlwaysTranslateCache.json"), realFs = require("node:fs/promises");
    fs.writeFileSync(destination, JSON.stringify({ version: 3, entries: { "v3:1:old": "old" } }));
    const e = environment(); e.mocks.electron.app.getPath = () => dir; let fail = true;
    e.mocks["fs/promises"] = { ...realFs, rename: async (...args) => { if (fail) throw Error("rename denied"); return realFs.rename(...args); } };
    const native = e.load("native.ts");
    try {
        assert.equal(await native.batCacheSave({}, { version: 3, clear: false, entries: [["v3:1:new", "new"]], persist: false }), true);
        assert.equal(JSON.parse(fs.readFileSync(destination, "utf8")).entries["v3:1:new"], undefined);
        const quiet = t.mock.method(console, "error", () => {});
        assert.equal(await native.batCacheSave({}, { version: 3, clear: false, entries: [["v3:1:old", null]], persist: true }), false);
        quiet.mock.restore(); assert.equal(JSON.parse(fs.readFileSync(destination, "utf8")).entries["v3:1:old"], "old");
        assert.equal(fs.existsSync(destination + ".tmp"), false);
        fail = false;
        assert.equal(await native.batCacheSave({}, { version: 3, clear: false, entries: [["v3:1:old", null]], persist: true }), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(destination, "utf8")).entries, { "v3:1:new": "new" });
    } finally { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
});


test("cache save failures retry in the background without new translations", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = environment(); let calls = 0;
    e.native.batCacheSave = async () => ++calls > 1;
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:key", "saved", "gemini");
    t.mock.timers.tick(5000); await tick(); assert.equal(calls, 1);
    t.mock.timers.tick(5000); await tick(); assert.equal(calls, 2);
    assert.equal(cache.peek("v3:1:key"), "saved"); await cache.flush(); assert.equal(calls, 2);
});

test("eviction while an entry is in flight sends a deletion after that write completes", async () => {
    const e = environment(), first = deferred(), saved = new Map(); let calls = 0;
    e.mocks["constants.ts"] = { CACHE_MAX_SIZE: 1000, CACHE_PERSISTENT_MAX_SIZE: 1, CACHE_SAVE_DEBOUNCE: 5000 };
    e.native.batCacheSave = async patch => {
        if (++calls === 1) await first.promise;
        for (const [key, value] of patch.entries) value === null ? saved.delete(key) : saved.set(key, value); return true;
    };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(); cache.set("v3:1:old", "old", "gemini");
    const saving = cache.flush(); await tick(); cache.set("v3:1:new", "new", "gemini"); first.resolve(); await saving;
    assert.deepEqual(Array.from(saved), [["v3:1:new", "new"]]); assert.equal(cache.peek("v3:1:old"), undefined);
});

test("native cache writes serialize concurrent callers without losing either update", async () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "always-translate-cache-"));
    const destination = path.join(dir, "AlwaysTranslateCache.json"), realFs = require("node:fs/promises"), hold = deferred(), started = deferred();
    const e = environment(); e.mocks.electron.app.getPath = () => dir; const operations = [];
    e.mocks["fs/promises"] = { ...realFs, writeFile: async (...args) => {
        operations.push("write"); if (operations.length === 1) { started.resolve(); await hold.promise; } return realFs.writeFile(...args);
    }, rename: async (...args) => { operations.push("rename"); return realFs.rename(...args); } };
    const native = e.load("native.ts");
    try {
        const first = native.batCacheSave({}, { version: 3, clear: false, entries: [["v3:1:a", "a"]], persist: true });
        const second = native.batCacheSave({}, { version: 3, clear: false, entries: [["v3:1:b", "b"]], persist: true });
        await started.promise; assert.deepEqual(operations, ["write"]);
        hold.resolve(); assert.deepEqual(await Promise.all([first, second]), [true, true]);
        assert.deepEqual(operations, ["write", "rename", "write", "rename"]);
        assert.deepEqual(JSON.parse(fs.readFileSync(destination, "utf8")).entries, { "v3:1:a": "a", "v3:1:b": "b" });
    } finally { hold.resolve(); for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
});


test("displayed translations retain their original cache key across settings and remounts", async () => {
    const e = environment(); let calls = 0;
    e.mocks["api/translate.ts"] = { safeTranslate: async () => { calls++; return "new translation"; } };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    const props = translationHookProps();
    cache.set(props.cacheKey, "original translation", "gemini");
    const first = translationHookRunner(e, { ...props, cachedTranslated: "original translation" }); first.render(); first.unmount();
    const displayed = cache.getDisplayed(props.channelId, props.messageId, props.content, props.resolvedTarget);
    assert.deepEqual(displayed, { cacheKey: props.cacheKey, text: "original translation" });
    const second = translationHookRunner(e, { ...props, cacheKey: displayed.cacheKey, cachedTranslated: displayed.text, currentEngine: "deepseek" });
    second.render(); await tick();
    assert.equal(second.render().translatedText, "original translation"); assert.equal(calls, 0);
    assert.equal(cache.peek("v3:123:new-engine"), undefined);
    assert.equal(cache.getDisplayed(props.channelId, props.messageId, "edited", props.resolvedTarget), undefined);
    second.unmount(); await cache.flush();
});

test("displayed references isolate languages and are removed by cache clearing and eviction", async () => {
    const e = environment(), cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    const remember = (channel, target, key) => { cache.set(key, target, "gemini"); cache.rememberDisplayed(channel, "message", "hello", target, key); };
    remember("123", "ko", "v3:123:ko"); remember("123", "ja", "v3:123:ja"); remember("456", "ko", "v3:456:ko");
    assert.equal(cache.getDisplayed("123", "message", "hello", "ko").text, "ko");
    assert.equal(cache.getDisplayed("123", "message", "hello", "ja").text, "ja");
    assert.equal(cache.getDisplayed("123", "message", "hello", "en"), undefined);
    cache.clearChannel("123"); assert.equal(cache.getDisplayed("123", "message", "hello", "ko"), undefined);
    assert.ok(cache.getDisplayed("456", "message", "hello", "ko"));
    cache.remove("v3:456:ko"); assert.equal(cache.getDisplayed("456", "message", "hello", "ko"), undefined);
    remember("123", "ko", "v3:123:ko"); cache.clearAll();
    assert.equal(cache.getDisplayed("123", "message", "hello", "ko"), undefined); await cache.flush();
});

test("language changes translate anew and late results never replace the displayed language", async () => {
    const e = environment(), old = deferred(); let calls = 0;
    e.mocks["api/translate.ts"] = { safeTranslate: () => ++calls === 1 ? old.promise : Promise.resolve("Japanese") };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance(), props = translationHookProps();
    const runner = translationHookRunner(e, props); runner.render();
    runner.render({ cacheKey: "v3:123:ja", resolvedTarget: "ja" }); await tick();
    old.resolve("Korean"); await tick();
    assert.equal(runner.render().translatedText, "Japanese");
    assert.equal(cache.peek(props.cacheKey), "Korean"); assert.equal(cache.peek("v3:123:ja"), "Japanese");
    assert.equal(cache.getDisplayed("123", props.messageId, "hello", "ko"), undefined);
    assert.equal(cache.getDisplayed("123", props.messageId, "hello", "ja").cacheKey, "v3:123:ja");
    runner.unmount(); await cache.flush();
});


test("accessory uses displayed cache identity after engine and model changes, but new messages use current settings", async () => {
    const e = environment({ translationEngine: "gemini", targetLang: "ko", channelList: [] }); let execution, visibility;
    e.mocks["settings.ts"].settings.use = () => e.store;
    e.mocks["settings.ts"].getChannelConfig = () => ({ allowed: true, config: null });
    e.mocks["@components/ErrorBoundary"] = { wrap: fn => fn };
    e.mocks["@webpack"] = { findCssClassesLazy: () => ({ markup: "markup" }) };
    e.mocks["react/jsx-runtime"] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    Object.assign(e.mocks["@webpack/common"], { UserStore: { getCurrentUser: () => ({ id: "me" }) }, Parser: { parse: text => text } });
    e.mocks["index.ts"] = { pluginStarted: true };
    e.mocks["components/LoadingIndicator.ts"] = { LoadingIndicator() {} };
    e.mocks["hooks/useMessageVisibility.ts"] = { useMessageVisibility: props => { visibility = props; } };
    e.mocks["hooks/useTranslationExecution.ts"] = { useTranslationExecution: props => {
        execution = props; return { translatedText: props.cachedTranslated, isTranslating: false, error: null };
    } };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    const { TranslationAccessory } = e.load("components/TranslationAccessory.tsx");
    const message = { id: "123456789012345678", channel_id: "123", content: "hello", author: { id: "other" } };
    TranslationAccessory({ message }); const originalKey = execution.cacheKey;
    cache.set(originalKey, "Korean", "gemini"); cache.rememberDisplayed("123", message.id, "hello", "ko", originalKey);
    e.store.translationEngine = "deepseek"; e.store.deepseekModel = "another-model";
    TranslationAccessory({ message }); assert.equal(execution.cacheKey, originalKey); assert.equal(execution.cachedTranslated, "Korean");
    TranslationAccessory({ message: { ...message, id: "123456789012345679" } });
    assert.notEqual(execution.cacheKey, originalKey); assert.equal(execution.cachedTranslated, undefined);
    e.store.targetLang = "ja"; TranslationAccessory({ message }); assert.notEqual(execution.cacheKey, originalKey);
    assert.equal(execution.cachedTranslated, undefined);
    e.store.translationEngine = "disable"; assert.equal(TranslationAccessory({ message }), null); assert.equal(visibility.allowed, false);
    await cache.flush();
});


test("a failed long translation cancels only its own remaining chunks for both engines", async () => {
    for (const engine of ["gemini", "deepseek"]) {
        const e = environment(), first = deferred(), second = deferred(), requests = [];
        e.mocks["api/" + engine + ".ts"][engine === "gemini" ? "translateBatchWithGemini" : "translateBatchWithDeepSeek"] = (...args) => {
            requests.push(args);
            if (requests.length === 1) return first.promise;
            if (requests.length === 2) return second.promise;
            return Promise.resolve(args[1].map(m => ({ id: m.id, text: "other translated" })));
        };
        const { translate } = e.load("api/translate.ts"), workers = e.load("api/worker.ts");
        const long = translate("123", "123456789012345678", "x".repeat(30000), "auto", "ko", engine, { gemini: "key", deepseek: "key" });
        const failed = assert.rejects(long, /first chunk failed/);
        const other = translate("123", "123456789012345678", "other", "auto", "ko", engine, { gemini: "key", deepseek: "key" });
        workers.aiWorkers.get("123").flushNow(); await tick(); assert.equal(requests.length, 2);
        first.reject(Error("first chunk failed")); await failed; await tick();
        assert.equal(await other, "other translated"); assert.equal(requests.length, 3);
        assert.equal(requests[1][6].aborted, true);
        second.resolve(requests[1][1].map(m => ({ id: m.id, text: "late" }))); await tick();
        assert.equal(workers.aiWorkers.size, 0);
    }
});

test("cancelling a chunk preserves other messages in its active batch", async () => {
    const e = environment(), first = deferred(), mixed = deferred(), requests = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (...args) => { requests.push(args); return requests.length === 1 ? first.promise : mixed.promise; };
    const { AiChannelWorker } = e.load("api/worker.ts"), worker = new AiChannelWorker("123");
    const jobs = [task("first", "x".repeat(6000)), task("sibling", "x".repeat(3000)), task("other", "y".repeat(1000)), task("queued", "x".repeat(6000))];
    for (const job of jobs) { if (job.id !== "other") job.groupId = "long-message"; worker.enqueue(job); }
    worker.flushNow(); await tick(); assert.equal(requests.length, 2);
    first.reject(Error("failed")); await tick();
    assert.equal(requests[1][6].aborted, false); assert.equal(worker.registry.size, 1); assert.equal(worker.registry.has("other"), true);
    mixed.resolve([{ id: "sibling", text: "late" }, { id: "other", text: "success" }]);
    assert.deepEqual(await Promise.all(jobs.map(job => job.result)), ["", "", "success", ""]);
    await tick(); assert.equal(requests.length, 2); assert.equal(worker.registry.size, 0);
});

test("empty chunk results cancel sibling chunks without waiting for a hung request", async () => {
    const e = environment(), first = deferred(), requests = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (...args) => { requests.push(args); return requests.length === 1 ? first.promise : new Promise(() => {}); };
    const { translate } = e.load("api/translate.ts"), workers = e.load("api/worker.ts");
    const result = translate("123", "", "x".repeat(18000), "auto", "ko", "gemini", { gemini: "key", deepseek: "" });
    const failed = assert.rejects(result, /no result/);
    await tick(); first.resolve(requests[0][1].map(m => ({ id: m.id, text: "" }))); await failed; await tick();
    assert.equal(requests.length, 2); assert.equal(requests[1][6].aborted, true); assert.equal(workers.aiWorkers.size, 0);
});

test("a chunk deadline cancels its siblings and releases all worker state", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const e = environment(), signals = [];
    e.mocks["api/gemini.ts"].translateBatchWithGemini = (...args) => { signals.push(args[6]); return new Promise(() => {}); };
    const { translate } = e.load("api/translate.ts"), workers = e.load("api/worker.ts");
    const result = translate("123", "", "x".repeat(30000), "auto", "ko", "gemini", { gemini: "key", deepseek: "" });
    const failed = assert.rejects(result, /timed out/); await tick();
    t.mock.timers.tick(20000); await failed; await tick();
    assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted)); assert.equal(workers.aiWorkers.size, 0);
});


test("resetting a grouped translation retains the existing empty-result cancellation behavior", async () => {
    const e = environment(), { translate } = e.load("api/translate.ts"), workers = e.load("api/worker.ts");
    const result = translate("123", "123456789012345678", "x".repeat(18000), "auto", "ko", "gemini", { gemini: "key", deepseek: "" });
    workers.resetAllWorkers(); assert.equal(await result, ""); assert.equal(workers.aiWorkers.size, 0);
});


test("Gemini preserves valid JSON field order, escapes and wrapped responses", async () => {
    const expected = [{ id: "a", text: 'Quotes "hello", slash \u005c, newline\n tab\t and JSON {"id":"data"}' }, { id: "b", text: "second" }];
    for (const reversed of [false, true]) {
        for (const wrapped of [false, true]) {
            const e = environment(); delete e.mocks["api/gemini.ts"];
            const response = expected.map(row => reversed ? { text: row.text, id: row.id } : row);
            const json = JSON.stringify(response), text = wrapped ? "Here is the result:\n" + json + "\nDone." : json;
            e.native.batGeminiFetch = async () => ({ ok: true, data: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
            const actual = await e.load("api/gemini.ts").translateBatchWithGemini("123", [{ id: "a", text: "one" }, { id: "b", text: "two" }], "ko", "key", "", "model");
            assert.deepEqual(actual, expected);
        }
    }
});

test("Gemini still repairs literal newlines and unescaped quotes in malformed JSON", async () => {
    const e = environment(); delete e.mocks["api/gemini.ts"];
    const text = '[{"id":"a","text":"line one\nHe said "hello"."}]';
    e.native.batGeminiFetch = async () => ({ ok: true, data: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
    assert.deepEqual(await e.load("api/gemini.ts").translateBatchWithGemini("123", [{ id: "a", text: "original" }], "ko", "key", "", "model"),
        [{ id: "a", text: 'line one\nHe said "hello".' }]);
});

test("channel deletion after a failed disk write cannot resurrect entries on the next save", async t => {
    const e = environment(), files = new Map(), patches = []; let failRename = true;
    e.mocks["fs/promises"] = {
        readFile: async key => { if (!files.has(key)) throw Error("ENOENT"); return files.get(key); },
        writeFile: async (key, value) => files.set(key, value),
        rename: async (from, to) => { if (failRename) { failRename = false; throw Error("disk write failed"); } files.set(to, files.get(from)); files.delete(from); },
        unlink: async key => files.delete(key)
    };
    const native = e.load("native.ts");
    e.native.batCacheSave = patch => { patches.push(patch); return native.batCacheSave({}, patch); };
    const quiet = t.mock.method(console, "error", () => {});
    try {
        const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
        cache.set("v3:123:deleted", "old translation", "gemini"); await cache.flush();
        cache.clearChannel("123"); cache.set("v3:456:kept", "other translation", "gemini"); await cache.flush();
        assert.equal(cache.peek("v3:123:deleted"), undefined);
        assert.deepEqual(JSON.parse([...files.values()][0]).entries, { "v3:456:kept": "other translation" });
        assert.ok(patches.some(patch => patch.entries.some(([key, value]) => key === "v3:123:deleted" && value === null)));
        const reloaded = environment(); reloaded.native.batCacheLoad = () => native.batCacheLoad({});
        const restored = reloaded.load("utils/cache.ts").TranslationCache.getInstance(); await restored.init();
        assert.equal(restored.peek("v3:123:deleted"), undefined); assert.equal(restored.peek("v3:456:kept"), "other translation"); await restored.flush();
    } finally { quiet.mock.restore(); }
});

test("eviction after a rejected save sends a deletion for the possibly applied entry", async () => {
    const e = environment(), saved = new Map(), patches = []; let fail = true;
    e.mocks["constants.ts"] = { CACHE_MAX_SIZE: 1000, CACHE_PERSISTENT_MAX_SIZE: 1, CACHE_SAVE_DEBOUNCE: 5000 };
    e.native.batCacheSave = async patch => {
        patches.push(patch); for (const [key, value] of patch.entries) value === null ? saved.delete(key) : saved.set(key, value);
        if (fail) { fail = false; throw Error("IPC response lost"); } return true;
    };
    const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    cache.set("v3:123:old", "old", "gemini"); await cache.flush();
    cache.set("v3:123:new", "new", "gemini"); await cache.flush();
    assert.deepEqual([...saved], [["v3:123:new", "new"]]);
    assert.ok(patches[1].entries.some(([key, value]) => key === "v3:123:old" && value === null));
});


test("unchanged successful outgoing translations send the original without a preview or failure", async () => {
    for (const engine of ["gemini", "deepseek"]) {
        for (const preview of [false, true]) {
            const e = environment({ translateOutgoing: true, previewOutgoing: preview, translationEngine: engine,
                geminiApiKey: "key", deepseekApiKey: "key", channelList: [{ id: "123", lang: "ru" }] });
            const original = "  Привет https://example.test  ", notices = [], actions = []; let cacheWrites = 0;
            Object.assign(e.mocks["@webpack/common"], {
                DraftType: { ChannelMessage: 0 }, DraftStore: { getDraft: () => original },
                ComponentDispatch: { dispatchToLastSubscribed: (...args) => actions.push(args) }
            });
            e.mocks["utils/toast.ts"] = { showTranslationToast: text => notices.push(text) };
            e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({ setOutgoing: () => { cacheWrites++; } }) } };
            e.mocks["api/" + engine + ".ts"][engine === "gemini" ? "translateBatchWithGemini" : "translateBatchWithDeepSeek"] = async (_, messages) => messages.map(m => ({ id: m.id, text: m.text }));
            const message = { content: original, attachments: [{ id: "file" }] };
            assert.equal(await e.load("api/outgoing.ts").handleOutgoingTranslation("123", message, () => true), undefined);
            assert.equal(message.content, original); assert.deepEqual(message.attachments, [{ id: "file" }]);
            assert.deepEqual(notices, []); assert.deepEqual(actions, []); assert.equal(cacheWrites, 0);
        }
    }
});

test("unchanged responses remain hidden for reading; actual outgoing API errors still cancel sending", async () => {
    const e = environment();
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => messages.map(m => ({ id: m.id, text: m.text }));
    const { safeTranslate } = e.load("api/translate.ts");
    assert.equal(await safeTranslate("Привет", "auto", "ru", "gemini", { gemini: "key", deepseek: "" }, "123", ""), null);
    const f = environment({ translateOutgoing: true, previewOutgoing: false, translationEngine: "gemini", geminiApiKey: "key", channelList: [{ id: "123", lang: "ru" }] });
    Object.assign(f.mocks["@webpack/common"], { DraftType: { ChannelMessage: 0 }, DraftStore: { getDraft: () => "Привет" } });
    const notices = []; f.mocks["utils/toast.ts"] = { showTranslationToast: text => notices.push(text) };
    f.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { throw Error("network failed"); };
    const message = { content: "Привет" };
    assert.deepEqual(await f.load("api/outgoing.ts").handleOutgoingTranslation("123", message, () => true), { cancel: true });
    assert.equal(message.content, "Привет"); assert.equal(notices.length, 1);
});


test("language filtering admits supported scripts and ambiguous Latin text", () => {
 const {shouldTranslate}=environment().load("utils/message.ts");
 for(const [text,target] of [["مرحبا بك","ko"],["Καλημέρα","ko"],["Bonjour tout le monde","en"],["hello 안녕","ko"],["你好","ja"]]) assert.equal(shouldTranslate(text,target),true);
 for(const text of ["12345","https://example.test","😀"]) assert.equal(shouldTranslate(text,"ko"),false);
 assert.equal(shouldTranslate("안녕하세요","ko"),false);
});
test("literal placeholders survive token restoration without becoming links", async () => {
 for(const engine of ["gemini","deepseek"]){
 const e=environment(),{safeTranslate}=e.load("api/translate.ts");
 const source="Keep [token0] and [token1] and [ TOKEN2 ] with https://example.test";
 assert.equal(await safeTranslate(source,"auto","ko",engine,{gemini:"key",deepseek:"key"},"123",""),"translated:"+source);
 }
});


test("appearance filters preserve code contents while removing outside mentions and emojis", async () => {
 const e=environment({hideEmojis:true,hideMentions:true});
 const source='Read '+String.fromCharCode(96)+'😀 <@123>'+String.fromCharCode(96)+' <@456> 😀';
 const result=await e.load("api/translate.ts").safeTranslate(source,"auto","ko","gemini",{gemini:"key",deepseek:""},"123","");
 assert.ok(result.includes(String.fromCharCode(96)+'😀 <@123>'+String.fromCharCode(96))); assert.equal(result.includes('<@456>'),false);
});
test("damaged protected tokens reject translations instead of silently losing or duplicating links", async () => {
 for(const response of ['translated','translated [token0] [token0]','translated [token9]']){
 const e=environment(); e.mocks['api/gemini.ts'].translateBatchWithGemini=async(_,messages)=>messages.map(m=>({id:m.id,text:response}));
 await assert.rejects(e.load('api/translate.ts').safeTranslate('Visit https://example.test','auto','ko','gemini',{gemini:'key',deepseek:''},'123',''),/protected content/);
 }
});
test("toast deduplication stays bounded while retaining recent repeats", () => {
 const e=environment(), shown=[]; delete e.mocks['api/breaker.ts']; e.mocks['utils/toast.ts']={showTranslationToast:text=>shown.push(text)};
 const {showApiToast}=e.load('api/breaker.ts');
 for(let i=0;i<101;i++)showApiToast('gemini','error '+i);
 showApiToast('gemini','error 100'); assert.equal(shown.length,101);
 showApiToast('gemini','error 0'); assert.equal(shown.length,102);
});


test("500 discarded previews leave no draft listeners; expiry and stop detach monitoring", async t => {
 t.mock.timers.enable({apis:["setTimeout","Date"],now:Date.now()});
 const e=outgoingEnvironment(),listeners=new Set();
 Object.assign(e.mocks['@webpack/common'].DraftStore,{addChangeListener:fn=>listeners.add(fn),removeChangeListener:fn=>listeners.delete(fn)});
 e.pending.resolve('Hello');
 for(let i=0;i<500;i++){
 e.edit('안녕하세요');await e.handleOutgoingTranslation('123',{content:'안녕하세요'},()=>true);t.mock.timers.tick(1);
 assert.equal(listeners.size,1);e.edit('');for(const fn of [...listeners])fn();assert.equal(listeners.size,0);
 }
 e.edit('안녕하세요');await e.handleOutgoingTranslation('123',{content:'안녕하세요'},()=>true);t.mock.timers.tick(1);
 t.mock.timers.tick(600000);assert.equal(listeners.size,0);
 e.edit('안녕하세요');await e.handleOutgoingTranslation('123',{content:'안녕하세요'},()=>true);t.mock.timers.tick(1);
 e.resetOutgoingTranslations();assert.equal(listeners.size,0);t.mock.timers.tick(600000);assert.equal(listeners.size,0);
});
test("generation tracking releases 5000 channels and never revives invalidated requests", async () => {
 const cache=environment().load('utils/cache.ts').TranslationCache.getInstance();
 for(let i=0;i<5000;i++){
 const key='v3:'+i+':key',old=cache.watchGeneration(key);cache.clearChannel(String(i));
 const next=cache.watchGeneration(key);assert.equal(old.isCurrent(),false);old.release();assert.equal(next.isCurrent(),true);next.release();
 }
 assert.equal(cache.channelGenerations.size,0);
 const old=cache.watchGeneration('v3:1:key');cache.clearAll();const next=cache.watchGeneration('v3:1:key');old.release();
 assert.equal(old.isCurrent(),false);assert.equal(next.isCurrent(),true);next.release();assert.equal(cache.channelGenerations.size,0);await cache.flush();
});


test("outgoing reset cancels pending results even before the caller lifecycle changes", async () => {
 const e=outgoingEnvironment(),message={content:'안녕하세요'};
 e.store.previewOutgoing=false;const result=e.handleOutgoingTranslation('123',message,()=>true);
 e.resetOutgoingTranslations();e.pending.resolve('Hello');
 assert.deepEqual(await result,{cancel:true});assert.equal(message.content,'안녕하세요');assert.deepEqual(e.notices,[]);
});
test("outgoing reset clears deferred preview insertions", async t => {
 t.mock.timers.enable({apis:['setTimeout']});const e=outgoingEnvironment();
 const result=e.handleOutgoingTranslation('123',{content:'안녕하세요'},()=>true);e.pending.resolve('Hello');await result;
 e.resetOutgoingTranslations();t.mock.timers.tick(1);assert.deepEqual(e.actions,[]);
});


test("1000 mixed cache writes, deletions and save failures converge without stale entries", async () => {
 const e=environment(),stored=new Map();let writes=0,recovered=false;
 e.mocks['constants.ts']={CACHE_MAX_SIZE:1000,CACHE_PERSISTENT_MAX_SIZE:8,CACHE_SAVE_DEBOUNCE:5000};
 e.native.batCacheSave=async patch=>{
 if(patch.clear)stored.clear();for(const [key,value]of patch.entries)value===null?stored.delete(key):stored.set(key,value);
 return recovered||++writes%4!==0;
 };
 const cache=e.load('utils/cache.ts').TranslationCache.getInstance();let seed=12345;
 for(let i=0;i<1000;i++){
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;const channel=String(seed%5),key='v3:'+channel+':'+(seed%17);
 if(seed%19===0)cache.clearAll();else if(seed%7===0)cache.clearChannel(channel);else cache.set(key,'value '+i,'gemini');
 if(i%3===0)await cache.flush();
 }
 recovered=true;await cache.flush();
 assert.deepEqual([...stored].sort(),[...cache.persistentCache].map(([key,entry])=>[key,entry.value]).sort());
 assert.equal(cache.changes.size,0);assert.equal(cache.inFlightKeys.size,0);assert.equal(cache.saveTimeout,null);
});
