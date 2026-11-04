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
    const { GeminiChannelWorker, geminiWorkers } = e.load("api/worker.ts");
    const worker = new GeminiChannelWorker("123"); geminiWorkers.set("123", worker);
    const job = task("deadline"); worker.enqueue(job);
    t.mock.timers.tick(9999); assert.equal(worker.registry.size, 1);
    assert.equal(calls, 0); t.mock.timers.tick(2); assert.equal(await job.result, "translated"); await tick();
    assert.equal(worker.registry.size, 0); assert.equal(geminiWorkers.size, 0); assert.equal(calls, 1);
});

test("hung AI and DeepL requests abort at the task deadline and ignore late completion", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const engine of ["gemini", "deepl"]) {
        const e = environment(); const pending = deferred(); let signal;
        if (engine === "gemini") e.mocks["api/gemini.ts"].translateBatchWithGemini = (...args) => { signal = args[6]; return pending.promise; };
        else e.mocks["api/deepl.ts"].translateWithDeepL = (...args) => { signal = args[4]; return pending.promise; };
        const workers = e.load("api/worker.ts");
        const worker = engine === "gemini" ? new workers.GeminiChannelWorker("123") : new workers.DeeplChannelWorker("deepl|||auto|||ko|||key");
        const job = task(engine); worker.enqueue(job); worker.flushNow(); await tick();
        t.mock.timers.tick(20000); assert.equal(await job.result, ""); assert.ok(signal.aborted);
        pending.resolve(engine === "gemini" ? [{ id: engine, text: "late" }] : ["late"]);
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
        "api/deepl.ts": { translateWithDeepL: async texts => texts.map(t => "translated:" + t) },
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
        const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
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

test("DeepL clears successful and failed tasks", async () => {
    for (const fail of [false, true]) {
        const e = environment();
        if (fail) e.mocks["api/deepl.ts"].translateWithDeepL = async () => { throw Error("network"); };
        const { DeeplChannelWorker, deeplWorkers } = e.load("api/worker.ts");
        const w = new DeeplChannelWorker("deepl|||auto|||ko|||key"); deeplWorkers.set(w.key, w);
        const t = task("unique-id"); w.enqueue(t); w.flushNow();
        assert.equal(await t.result, fail ? "" : "translated:unique-id");
        await tick(); assert.equal(w.registry.size, 0); assert.equal(deeplWorkers.size, 0);
    }
});

test("DeepL serializes arrivals during a running request", async () => {
    const e = environment(); const first = deferred(); let calls = 0;
    e.mocks["api/deepl.ts"].translateWithDeepL = async texts => { calls++; return calls === 1 ? first.promise : texts; };
    const { DeeplChannelWorker } = e.load("api/worker.ts");
    const w = new DeeplChannelWorker("deepl|||auto|||ko|||key");
    const a = task("a"), b = task("b"); w.enqueue(a); w.flushNow(); w.enqueue(b); w.flushNow();
    assert.equal(w.state, "PROCESSING"); assert.equal(calls, 1);
    first.resolve(["first"]); await a.result; await tick(); w.flushNow();
    assert.equal(await b.result, "b"); assert.equal(calls, 2); assert.equal(w.registry.size, 0);
});

test("AI requests sharing a message ID, including outgoing messages, all settle", async () => {
    const e = environment(); const { GeminiChannelWorker } = e.load("api/worker.ts");
    const w = new GeminiChannelWorker("123");
    const tasks = [task("a"), task("b"), task("c", "outgoing", ""), task("d", "another", "")];
    tasks.forEach(t => w.enqueue(t)); w.flushNow();
    assert.deepEqual(await Promise.all(tasks.map(t => t.result)), tasks.map(t => "translated:" + t.text));
    assert.equal(w.registry.size, 0);
});

test("reset cancels a worker waiting for a request slot without sending", async () => {
    const e = environment(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { calls++; return []; };
    const { GeminiChannelWorker } = e.load("api/worker.ts");
    const { aiRequestLimiters } = e.load("api/requestLimiter.ts");
    const releases = await Promise.all([aiRequestLimiters.gemini.acquire(), aiRequestLimiters.gemini.acquire()]);
    const w = new GeminiChannelWorker("123"); const t = task("a"); w.enqueue(t); w.flushNow(); w.reset(); releases.forEach(release => release());
    assert.equal(await t.result, ""); await tick(); assert.equal(calls, 0);
});

test("reset aborts an active request and suppresses remaining chunks", async () => {
    const e = environment(); e.mocks["constants.ts"] = { GEMINI_BATCH_SIZE: 1, BATCH_ACCUMULATION_TIME_GEMINI: 200 };
    let signal, calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (...args) => { calls++; signal = args[6]; return new Promise(() => {}); };
    const { GeminiChannelWorker } = e.load("api/worker.ts");
    const w = new GeminiChannelWorker("123"); const a = task("a"), b = task("b"); w.enqueue(a); w.enqueue(b); w.flushNow();
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

test("channel clear removes AI, DeepL, outgoing and pending entries without affecting other channels", async () => {
    const e = environment(); const cache = e.load("utils/cache.ts").TranslationCache.getInstance();
    cache.set("v3:1:ai", "AI", "gemini"); cache.set("v3:1:deepl", "DeepL", "deepl"); cache.set("v3:2:ai", "Other", "gemini");
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
    const result = translate("123", "123456789012345678", "hello", "auto", "ko", "gemini", { gemini: "key", deepl: "", deepseek: "" });
    e.store.geminiModel = "changed-model";
    e.load("api/worker.ts").geminiWorkers.get("123").flushNow();
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
        await translate(channel.id, "", "hello", "auto", "ko", "gemini", { gemini: "key", deepl: "", deepseek: "" });
        await translate(channel.id, "", "hello", "auto", "en", "gemini", { gemini: "key", deepl: "", deepseek: "" }, false, channel.outgoingCustomPrompt);
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
    e.mocks["api/deepl.ts"].translateWithDeepL = async texts => {
        received.push({ text: texts[0] });
        return texts.map(text => "translated:" + text);
    };
    const { safeTranslate } = e.load("api/translate.ts");
    const text = "hello <@123> https://example.test \u0060code\u0060";
    for (const engine of ["gemini", "deepl"]) {
        assert.equal(await safeTranslate(text, "auto", "ko", engine, { gemini: "key", deepl: "key", deepseek: "" }, "123", "", false, "keep tone"), "translated:" + text);
    }
    assert.deepEqual(received, [
        { text: "hello [token0] [token1] [token2]", prompt: "keep tone" },
        { text: "hello [token0] [token1] [token2]" }
    ]);
});


test("AI engines have separate bounded concurrency and cancelled waiters release their place", async () => {
    const e = environment();
    const { GeminiChannelWorker } = e.load("api/worker.ts");
    const held = deferred(); let geminiActive = 0, peak = 0, deepseekCalls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async (_, messages) => {
        peak = Math.max(peak, ++geminiActive); await held.promise; geminiActive--;
        return messages.map(m => ({ id: m.id, text: "done" }));
    };
    e.mocks["api/deepseek.ts"].translateBatchWithDeepSeek = async (_, messages) => {
        deepseekCalls++; return messages.map(m => ({ id: m.id, text: "independent" }));
    };
    const workers = ["1", "2", "3", "4"].map(id => new GeminiChannelWorker(id));
    const jobs = workers.map((w, i) => { const job = task("job" + i); w.enqueue(job); w.flushNow(); return job; });
    await tick(); assert.equal(geminiActive, 2);
    workers[2].reset(); assert.equal(await jobs[2].result, "");
    const separate = new GeminiChannelWorker("5"), other = task("deepseek"); other.engine = "deepseek";
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
    const e = environment({ translateOutgoing: true, previewOutgoing: true, targetLang: "en", translationEngine: "gemini" });
    let selected = "123", draft = "안녕하세요", calls = 0, notices = [];
    const actions = [], pending = deferred();
    Object.assign(e.mocks["@webpack/common"], {
        SelectedChannelStore: { getChannelId: () => selected },
        DraftType: { ChannelMessage: 0 }, DraftStore: { getDraft: () => draft },
        ReactDOM: { flushSync: fn => fn() },
        ComponentDispatch: { dispatchToLastSubscribed: (event, data) => {
            actions.push([event, data]); draft = event === "CLEAR_TEXT" ? "" : draft + data.rawText;
        } }
    });
    e.mocks["api/translate.ts"] = { safeTranslate: () => { calls++; return pending.promise; } };
    e.mocks["utils/toast.ts"] = { showTranslationToast: text => notices.push(text) };
    e.mocks["utils/cache.ts"] = { TranslationCache: { getInstance: () => ({ setOutgoing() {} }) } };
    const handler = e.load("api/outgoing.ts");
    return { ...e, ...handler, pending, actions, notices, get draft() { return draft; }, get calls() { return calls; },
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
