# Easy-API-Switcher

> 为 SillyTavern 的 **Custom (OpenAI-compatible)** API 提供「Base URL + API Key」联动切换。

**中文** | [English](#english)

## 简介

当你在 SillyTavern 中保存多个 Custom API Key 时，API Key 和 Custom Endpoint 原本是相对独立的。

例如：

```text
https://api.example-a.com/v1  +  Key A
https://api.example-b.com/v1  +  Key B
https://api.example-c.com/v1  +  Key C
```

**Easy-API-Switcher** 会将每个 Custom API Secret 与对应的 Base URL 绑定。

以后选择一个密钥时：

```text
选择 Key B
   ↓
API Key   → Key B
Endpoint  → https://api.example-b.com/v1
```

不再需要手动分别切换 URL 和密钥。

本扩展只作用于：

```text
Chat Completion
→ Custom (OpenAI-compatible)
```

不会改变 OpenAI、Claude、OpenRouter 等其他 API Provider 的密钥管理方式。

## 功能

- 🔗 将 Custom API Key 与 Base URL 绑定
- 🔄 选择密钥时同时切换 Custom Endpoint
- ➕ 添加新密钥时自动关联当前 URL
- ✏️ 可以编辑连接的 Base URL 和 API Key
- 🔑 同一个 URL 可以保存多把不同的 Key
- 🗂️ 保留 SillyTavern 原生 Secrets 系统
- 🛡️ API Key 只保存在 SillyTavern Secrets，不会被扩展另行持久化
- ⚙️ 可在 Extension Settings 中隐藏原生 Test Message 按钮
- 🔌 不需要 Server Plugin
- 📁 不创建、修改或删除 Connection Profiles

### 修改连接时

| 你的操作 | Easy-API-Switcher 的行为 |
|---|---|
| URL、Key 都不变 | 保持原样 |
| URL 不变，输入新 Key | 创建新 Secret，并绑定当前 URL |
| 只修改 URL | 将当前 Secret 重新绑定到新 URL |
| URL 和 Key 都修改 | 保留旧 Secret，并创建新的 URL + Key 绑定 |

例如：

```text
原来：
URL A + Key A

修改为：
URL B + Key B

结果：
URL A + Key A
URL B + Key B  ← 当前使用
```

旧密钥不会被自动删除。

## 安装

在 SillyTavern 中打开：

```text
Extensions
→ Install Extension
```

输入：

```text
https://github.com/Rbeyrolles/Easy-API-Switcher
```

安装完成后重新载入 SillyTavern。

## 使用

进入：

```text
API Connections
→ Chat Completion
→ Custom (OpenAI-compatible)
```

点击 **Custom API Key** 右侧的 🔑 按钮。

Easy-API-Switcher 会显示各个 Secret 对应的 Base URL。

选择其中一项后，会同时切换：

```text
Custom Endpoint
+
Custom API Secret
```

切换成功后窗口会自动关闭。

你也可以像以前一样，直接在 API Connections 页面输入新的：

```text
Custom Endpoint
Custom API Key
```

然后点击 **Connect / 连接**。

新创建的 Secret 会自动和当时填写的 URL 建立关联。

## 扩展设置

进入 SillyTavern 的 **Extensions** 面板，展开 **Easy API Switcher**：

- **隐藏测试按钮**：默认开启，隐藏 API Connections 中原生的 **Test Message** 按钮。

这个选项只改变按钮的可见性，不修改 API 配置、连接流程或聊天功能。

## 已有的旧密钥

安装 Easy-API-Switcher **不会修改或删除已有 Custom Secrets**。

如果旧 Secret 的 label 本身就是有效的 HTTP(S) URL，例如：

```text
https://api.example.com/v1
```

可以直接识别为它的 Base URL。

如果原来的 label 是：

```text
2026-08-11 20:30
Backup Key
备用 API
```

Easy-API-Switcher 不会猜测它属于哪个 URL。

你可以之后手动使用 **编辑连接** 为它建立绑定。

## Connection Profiles

Easy-API-Switcher 不替代 SillyTavern 的 Connection Profiles。

它不会自动创建、修改或删除 Profile，也不会因为其他地方切换了 Secret 就强制覆盖 Profile 中的 Server URL。

Connection Profiles、Slash Commands 和其他扩展进行的程序化连接切换仍交给 SillyTavern 原生逻辑处理。

## 安全

API Key 始终由 SillyTavern 原生 Secrets 系统保存。

Easy-API-Switcher 不会把 API Key 另外保存到：

```text
extension settings
localStorage
IndexedDB
日志
其他数据库
```

Extension Settings 中只保存 `hideTestMessageButton` 布尔值，不保存任何
API Key、Base URL 或 Secret ID。

Base URL 联动不要求开启 `allowKeysExposure`。如果 SillyTavern 的
`config.yaml` 未开启该选项，管理器只显示原生掩码，并会拒绝复制掩码；
开启后，SillyTavern 的 `/api/secrets/read` 会返回明文，管理器才会显示和复制真实 Key。

编辑已有连接时，如果输入了不同的 Key，扩展会通过 SillyTavern 原生
Secrets 写入接口创建一条新的 active Secret，并保留旧 Secret。这是因为
当前 SillyTavern 没有按 Secret ID 原位修改 Key 的接口。

> Base URL 会作为 Secret 的可见 label 保存，因此包含用户名或密码的 URL 会被拒绝。

## 兼容性

当前目标：

```text
SillyTavern 1.18.0+
```

这是一个独立的 SillyTavern UI Extension，无需 Server Plugin。

如果 SillyTavern 更新后出现兼容问题，欢迎提交 Issue，并附上：

- SillyTavern 版本
- Easy-API-Switcher 版本
- 浏览器
- 操作步骤
- Console 中相关错误

**请不要在 Issue 或截图中公开真实 API Key。**

## Development

```sh
npm test
npm run check
```

## License

MIT

---

# English

**Easy-API-Switcher** is a SillyTavern UI Extension that binds each
**Custom (OpenAI-compatible)** API Secret to its corresponding Base URL.

Instead of switching the API key and Custom Endpoint separately:

```text
Key B
→ Key B + https://api.example-b.com/v1
```

Easy-API-Switcher treats them as one connection pair.

## Features

- Bind Custom API Secrets to Base URLs
- Switch the active Secret and Endpoint together
- Automatically bind newly entered API keys to the current Endpoint
- Rebind the active Secret when only the URL changes
- Keep old Secrets when creating a new URL + Key pair
- Allow multiple API keys for the same Base URL
- Preserve SillyTavern's native Secrets system
- Display and copy plaintext keys only when SillyTavern explicitly exposes them
- Optionally hide the native Test Message button from Extension Settings
- Leave other API providers untouched
- Do not create, modify, or delete Connection Profiles
- No Server Plugin required

## Installation

Open SillyTavern:

```text
Extensions
→ Install Extension
```

Enter:

```text
https://github.com/Rbeyrolles/Easy-API-Switcher
```

Then reload SillyTavern.

## Extension Settings

Open SillyTavern's **Extensions** panel and expand **Easy API Switcher**.
**Hide Test Message button** is enabled by default and hides the native button
in API Connections. This changes visibility only; API connections and chat
behavior are unaffected.

## Existing Secrets

Existing Custom Secrets are never automatically deleted or migrated.

A label is treated as an existing binding only when it is clearly a valid
HTTP(S) URL. Legacy labels such as timestamps or custom names can be assigned
a Base URL manually.

## Security

API keys remain exclusively in SillyTavern's native Secrets system.

The only Easy-API-Switcher preference persisted in Extension Settings is the
`hideTestMessageButton` boolean. It contains no API key, Base URL, or Secret ID.

Easy-API-Switcher does not store them in extension settings, localStorage,
IndexedDB, logs, or another database. Base URL switching works without
`allowKeysExposure`; plaintext display and copying are available only when that
SillyTavern server option is enabled. Otherwise the manager shows the native
mask and refuses to copy it.

SillyTavern currently has no endpoint for replacing a Secret's value in place.
Editing a connection with a different Key therefore creates a new active native
Secret and keeps the old one.

## Compatibility

Target: **SillyTavern 1.18.0+**

If you encounter a compatibility issue after a SillyTavern update, please open
an Issue with your SillyTavern version, Easy-API-Switcher version, browser,
reproduction steps, and relevant console errors.

Please never include a real API key.

## License

MIT
