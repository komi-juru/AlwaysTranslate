# AlwaysTranslate

Real-time AI translation for Vencord.

<img width="583" height="698" alt="image" src="https://github.com/user-attachments/assets/d3ef429d-0af7-4388-985f-9e95c6c6dd6f" />
<img width="682" height="462" alt="Honeycam 2026-07-01 15-46-22" src="https://github.com/user-attachments/assets/3d468a52-e4b9-40a4-b089-181bad716574" />
<img width="682" height="341" alt="Honeycam 2026-07-01 18-22-25" src="https://github.com/user-attachments/assets/46629439-bfe3-4544-b7d2-cdabbcfa39aa" />


## Features

- **AI Translation** – Context-aware translations that preserve tone and slang.
- **Eco Mode** – Batch messages and save up to 90% on API costs with DeepSeek Context Caching.
- **Outgoing Translation** – Write in your language and send translated messages while keeping the original visible.
- **Custom Dictionary** – Override translations for names, game terms, and other custom phrases.
- **Per-Channel Settings** – Configure different languages and translation engines for each server or DM.

---

## Install

Building Vencord from source is required.

### 1. Install prerequisites

Install [**Git**](https://git-scm.com/) and [**Node.js**](https://nodejs.org/), then install `pnpm`:

```bash
npm install -g pnpm
```

### 2. Clone Vencord

```bash
git clone https://github.com/Vendicated/Vencord
```

### 3. Install AlwaysTranslate
```bash
cd Vencord/src
mkdir userplugins
cd userplugins
git clone https://github.com/komi-juru/AlwaysTranslate.git alwaysTranslate
pnpm build
pnpm inject
```

---

## Update
Pull the latest changes and rebuild.
```bash
cd Vencord/src/userplugins/alwaysTranslate
git pull
pnpm build
```

---

## API Keys

Configure your API key in the plugin settings.

- **DeepL** – https://app.deepl.com/your-account/keys
- **Gemini** – https://aistudio.google.com/api-keys
- **DeepSeek** – https://platform.deepseek.com/

---

## Privacy

This plugin does not collect personal data. However, messages are sent to your chosen AI API; please use caution in channels with sensitive information.
> **Disclaimer:** This plugin is not officially supported by Vencord.
