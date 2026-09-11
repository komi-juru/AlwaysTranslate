// Run from a Vencord checkout with: node src/userplugins/alwaysTranslate/tests/regression.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require(process.env.ALWAYS_TRANSLATE_TYPESCRIPT || "typescript");
const root = path.resolve(__dirname, "..");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function environment(extra = {}) {
    const store = { APIEcoModeThreshold: 100, APIMaxBatchWait: 0, customDictionary: {}, geminiModel: "gemini-a", deepseekModel: "deepseek-a", deepseekBaseUrl: "https://example.test", channelList: [], ...extra };
    const native = { batCacheLoad: async () => null, batCacheSave: async () => true, batDictLoad: async () => null, batDictSave: async () => true };
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
        new Function("require", "module", "exports", "window", "VencordNative", code)(localRequire, module, module.exports, window, { pluginHelpers: { AlwaysTranslate: native } });
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

test("reset cancels a worker waiting for the global mutex without sending", async () => {
    const e = environment(); let calls = 0;
    e.mocks["api/gemini.ts"].translateBatchWithGemini = async () => { calls++; return []; };
    const { GeminiChannelWorker, globalGeminiMutex } = e.load("api/worker.ts");
    const release = await globalGeminiMutex.acquire();
    const w = new GeminiChannelWorker("123"); const t = task("a"); w.enqueue(t); w.flushNow(); w.reset(); release();
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

test("cache keys isolate engines, channels, models, prompts, source language and dictionary", async () => {
    const e = environment(); const { getCacheKey } = e.load("utils/hash.ts");
    const key = (channel = "1", engine = "gemini", source = "auto") => getCacheKey(channel, "123", engine, source, "ko", "hello");
    const original = key();
    assert.notEqual(original, key("2")); assert.notEqual(original, key("1", "deepseek")); assert.notEqual(original, key("1", "gemini", "en"));
    e.store.geminiModel = "gemini-b"; assert.notEqual(original, key()); e.store.geminiModel = "gemini-a";
    e.store.channelList = [{ id: "1", aiCustomPrompt: "formal" }]; assert.notEqual(original, key()); e.store.channelList = [];
    const dict = e.load("dict.ts").CustomDictionaryStore.getInstance(); dict.add("hello", "안녕하세요"); assert.notEqual(original, key()); await dict.flush();
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

test("dictionary migration survives save failure, and updates during a save persist", async () => {
    const e = environment({ customDictionary: { hello: "안녕" } }); let calls = 0, saved;
    e.native.batDictSave = async value => { saved = value; return ++calls > 1; };
    const dict = e.load("dict.ts").CustomDictionaryStore.getInstance(); await dict.init(); await dict.flush();
    assert.deepEqual(e.store.customDictionary, { hello: "안녕" }); await dict.flush(); assert.deepEqual(e.store.customDictionary, {});
    const write = deferred(); e.native.batDictSave = async value => { saved = value; return write.promise; };
    dict.add("one", "하나"); const flushing = dict.flush(); await tick(); dict.add("two", "둘"); write.resolve(true); await flushing;
    e.native.batDictSave = async value => { saved = value; return true; }; await dict.flush();
    assert.equal(JSON.parse(saved).two, "둘");
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

test("concurrent initialization waits for the same cache and dictionary load", async () => {
    for (const [file, name, method] of [["utils/cache.ts", "TranslationCache", "batCacheLoad"], ["dict.ts", "CustomDictionaryStore", "batDictLoad"]]) {
        const e = environment(); const loading = deferred(); let calls = 0;
        e.native[method] = () => { calls++; return loading.promise; };
        const instance = e.load(file)[name].getInstance();
        const a = instance.init(), b = instance.init(); assert.equal(a, b); assert.equal(calls, 1);
        loading.resolve(null); await Promise.all([a, b]);
    }
});
