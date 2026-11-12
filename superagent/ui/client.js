// Generated from the copied src/client by `npm run build`. Do not edit by hand.
window.__ModuleLoader__.load({
  id: 'ds-superagent-ui',
  factory: (require) => {
const module = { exports: {} }
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/superagent-chat.js
var import_react18 = require("react");

// src/client/i18n.js
var NAMESPACE = "ds-bot";
var ZH = {
  Evidence: "证据",
  "Read more": "继续读取",
  Resume: "继续",
  "Message Super-agent": "发送消息给 Super-agent",
  "Super-agent conversation": "Super-agent 对话",
  "Work status": "工作状态",
  ready: "已完成",
  // Shared
  "Main Bot": "主 Bot",
  Working: "工作中",
  "Waiting for your answer": "等你回答",
  "Waiting for {names}": "等 {names} 交回",
  "Unread activity": "有未读",
  "Not read yet": "未读",
  Search: "搜索",
  "New chat": "新对话",
  "Back to chat": "返回对话",
  "New…": "新建",
  "Collapse sidebar": "收起侧边栏",
  "Expand sidebar": "展开侧边栏",
  "Resize sidebar": "调整侧边栏宽度",
  "Animation": "动画",
  "Bot animation": "Bot 动画",
  "Quiet": "安静",
  "Normal": "正常",
  "Lively": "活泼",
  Settings: "设置",
  Usage: "用量",
  Account: "账户",
  Cancel: "取消",
  Delete: "删除",
  Duplicate: "复制一份",
  Hidden: "已隐藏",
  Admin: "管理员",
  Add: "添加",
  Close: "关闭",
  Copy: "复制",
  Copied: "已复制",
  Content: "内容",
  "Referenced {labels}": "引用了 {labels}",
  ", ": "、",
  You: "你",
  you: "你",
  Bot: "Bot",
  "a Bot": "一个 Bot",
  "a group chat": "一个群聊",
  " and ": "、",
  and: "和",
  "{count} members": "{count} 位成员",
  "Loading…": "加载中…",
  "Edit Bot": "编辑 Bot",
  "Make Main Bot": "设为主 Bot",
  "Remove Main Bot role": "取消主 Bot",
  "Bot settings": "Bot 设置",
  "Create group chat": "新建群聊",
  "Delete group": "删除群聊",
  "Open {name}'s chat": "打开 {name} 的对话",
  "New Bot": "新 Bot",
  // Sidebar and account menu
  "Bot list": "Bot 列表",
  "Setting up your Main Bot…": "正在设置你的主 Bot…",
  "The Bot team could not start. The engine’s startup output — its console, or the app’s startup error box — has the cause.": "Bot 团队启动失败。原因在引擎的启动输出里——它的控制台，或应用的启动错误框。",
  "The Bot team could not start. {error}. The engine’s startup output — its console, or the app’s startup error box — has the cause.": "Bot 团队启动失败。{error}。原因在引擎的启动输出里——它的控制台，或应用的启动错误框。",
  "Automation tasks": "自动化任务",
  Connectors: "连接器",
  "Search connectors": "搜索连接器",
  "No connectors": "暂无连接器",
  Capabilities: "能力",
  "Shared capabilities": "共享能力",
  "Add capability": "添加能力",
  "No capabilities saved": "还没有保存能力",
  Type: "类型",
  "MCP server": "MCP 服务",
  Skill: "技能",
  Pack: "能力包",
  Connection: "连接方式",
  "Local command": "本地命令",
  "HTTP server": "HTTP 服务",
  Command: "命令",
  "Arguments (one per line)": "参数（每行一个）",
  "Environment (JSON)": "环境变量（JSON）",
  '{"API_KEY": "$DSH_SECRET_MY_KEY"}': '{"API_KEY": "$DSH_SECRET_MY_KEY"}',
  URL: "URL",
  "Headers (JSON)": "请求头（JSON）",
  "Skill instructions": "技能说明",
  "New skill": "新技能",
  "Awaiting approval": "等待批准",
  Added: "新增",
  Modified: "已修改",
  "Show all {count} lines": "展开全部 {count} 行",
  "Skill update": "技能更新",
  "AGENTS.md update": "AGENTS.md 更新",
  Approve: "批准",
  Decline: "拒绝",
  "Save changes": "保存更改",
  Edit: "编辑",
  "Click again to delete.": "再点一次删除。",
  Ready: "就绪",
  "Needs approval": "需要批准",
  "No items": "没有项目",
  "Save an MCP server or skill first.": "请先保存 MCP 服务或技能。",
  Environment: "环境变量",
  Headers: "请求头",
  "{label} must be valid JSON.": "{label}必须是有效的 JSON。",
  "{label} must be a JSON object.": "{label}必须是 JSON 对象。",
  "Repositories, issues, and pull requests": "仓库、issue 和 PR",
  "Connecting…": "正在连接…",
  "Could not connect: {error}": "连接失败：{error}",
  "Bot mode could not be set up here: {error}": "这里无法启用 Bot 模式：{error}",
  "Connected as {account}": "已连接：{account}",
  Connected: "已连接",
  Disconnect: "断开",
  Connect: "连接",
  "GitHub token": "GitHub token",
  "Create a token on GitHub": "去 GitHub 生成 token",
  "Could not reach GitHub": "连不上 GitHub",
  "GitHub did not accept this token": "GitHub 不接受这个 token",
  "GitHub did not say who this token belongs to": "GitHub 没有返回这个 token 的账号",
  "Paste a token first": "请先粘贴 token",
  "GitHub addresses must start with https://": "GitHub 地址必须以 https:// 开头",
  "This DSH cannot load connectors": "这个 DSH 不能加载连接器",
  "No such connector": "没有这个连接器",
  "Classic Agent mode": "经典 Agent 模式",
  "Switch": "切换",
  "Switch to classic Agent mode": "切换经典 Agent 模式",
  "{model} is not available anymore. Pick another model for me.": "{model} 已经不可用了。给我换一个模型吧。",
  "Hi, I'm {name}. I don't have a model yet. How do you want to set one up?": "你好，我是 {name}。我还没有可用的模型。你想怎么配置？",
  "Hi, I'm {name}. Pick a model for me first. You can change it later in my details.": "你好，我是 {name}。先给我选一个模型吧，以后可以在我的详情里换。",
  "Hi, I'm {name}. I need a {provider} API key before I can start.": "你好，我是 {name}。开始之前，我需要一个 {provider} API key。",
  "{provider} API key": "{provider} API key",
  "Enter the API key": "请填入 API key",
  "Paste only the key, not a NAME=value line": "只粘贴 key 本身，不要带「名字=」",
  "Paste the key without quotes": "粘贴时不要带引号",
  "An API key has no spaces or special characters": "API key 里不能有空格或特殊字符",
  "Another provider": "其他服务商",
  // Models page
  "This DSH cannot set up model providers.": "这个 DSH 不能设置模型服务商。",
  "This DSH cannot set up model providers": "这个 DSH 不能设置模型服务商",
  "Model providers · {count}": "模型服务商 · {count}",
  "Add a provider": "添加服务商",
  "Needs an API key": "需要 API key",
  "Key set": "已设置 key",
  "Key set outside DS Bot": "key 在 DS Bot 之外设置",
  "No models": "没有模型",
  "{count} models": "{count} 个模型",
  "This key comes from outside DS Bot, such as an environment variable, and cannot be changed here.": "这个 key 来自 DS Bot 之外（例如环境变量），这里改不了。",
  "and {count} more": "还有 {count} 个",
  "Remove {name}? Bots on its models need another model.": "删除 {name}？用它的模型的 Bot 要换一个模型。",
  "Remove provider": "删除服务商",
  "Replace the API key": "更换 API key",
  "API key": "API key",
  "Remove key": "删除 key",
  "Saved.": "已保存。",
  "Kind of provider": "服务商类型",
  "Known provider": "常用服务商",
  "Custom API": "自定义接口",
  Provider: "服务商",
  "Choose a provider": "选择服务商",
  "Provider ID": "服务商 ID",
  "Provider ID, e.g. my-gateway": "服务商 ID，例如 my-gateway",
  "Name (optional)": "名称（可选）",
  Endpoint: "接口地址",
  Protocol: "协议",
  "Asking…": "获取中…",
  "Fetch models": "获取模型列表",
  "The endpoint lists no models. Enter their ids below.": "这个接口没有列出模型，请在下面填写模型 ID。",
  "Model ids": "模型 ID",
  "Model ids, separated by commas": "模型 ID，用逗号分隔",
  "Enter the endpoint as an http or https address": "接口地址要以 http 或 https 开头",
  "Every model needs an id": "每个模型都要有 ID",
  "A provider id is lowercase letters, digits and dashes, starting with a letter": "服务商 ID 只能用小写字母、数字和短横线，并以字母开头",
  "Add at least one model": "至少添加一个模型",
  "Two models have the same id": "有两个模型的 ID 相同",
  "Mode": "模式",
  "Sign in to DeepSeek": "登录 DeepSeek 账号",
  "Enter a DeepSeek API key": "填入 DeepSeek API key",
  "Open settings to set up a custom model": "打开设置配置自定义模型",
  "DS Bot": "DS Bot",
  // Header
  "Message {name}": "给 {name} 发消息",
  Message: "发消息",
  "View conversation details": "查看对话详情",
  "1 new message": "1 条新消息",
  "{count} new messages": "{count} 条新消息",
  "New messages": "新消息",
  "Dismiss new messages": "关闭新消息提示",
  New: "新",
  // New chat
  "Create new Bot": "新建 Bot",
  "Create new Bot “{name}”": "新建 Bot「{name}」",
  "Add to group chat": "加入群聊",
  "Message Bot": "给 Bot 发消息",
  "To:": "发给：",
  "Remove {name}": "移除 {name}",
  Recipient: "收件人",
  Recipients: "收件人",
  "Search Bots…": "搜索 Bot…",
  "Start a chat with…": "和谁聊…",
  "Close new chat": "关闭新对话",
  "No Bots match": "没有匹配的 Bot",
  "Type a name to create a Bot": "输入名字来新建 Bot",
  "Send message": "发送",
  // Details drawer
  Details: "详情",
  Browser: "浏览器",
  "Browser access": "浏览器权限",
  "Bots browse, click and fill in forms freely. Posting, uploading, downloading and deleting ask you first unless you allow them here. Payments are always yours: the Bot hands the page to you.": "Bot 可以自由浏览、点击和填写表单。发布、上传、下载和删除会先征求你的同意，除非你在这里预先允许。付款始终由你自己完成：Bot 会把页面交给你。",
  "Allowed actions": "已允许的操作",
  "Nothing allowed yet.": "还没有允许的操作。",
  "All sites": "所有网站",
  "All four": "全部四项",
  Permanent: "永久",
  "Until {time}": "截至 {time}",
  Expired: "已过期",
  "Remove grant": "移除授权",
  "Allow an action": "允许操作",
  Site: "网站",
  Actions: "操作",
  Post: "发布",
  Duration: "时限",
  "1 hour": "1 小时",
  Today: "今天",
  "example.com — leave empty for all sites": "example.com — 留空表示所有网站",
  About: "简介",
  "Show less": "收起",
  "Show more": "展开",
  "Admin leads": "管理员主持",
  "Plain messages go to the admin, who calls others with @Name.": "普通消息先给管理员，由管理员用 @名字 点名其他成员。",
  Everyone: "所有人",
  "Every member answers in turn, admin first.": "每位成员轮流回答，管理员先说。",
  "Members · {count}": "成员 · {count}",
  "Leave the group without an admin": "让群聊不设管理员",
  Unset: "取消",
  "Make admin": "设为管理员",
  "Remove {name} from the group": "把 {name} 移出群聊",
  "Remove from group": "移出群聊",
  "Add member": "添加成员",
  "{name} leads this group: it can call members with @Name, change the group, and post here.": "{name} 主持这个群：可以用 @名字 点名成员、修改群设置、在群里发言。",
  "No admin yet. An admin can call members with @Name, change the group, and post here.": "还没有管理员。管理员可以用 @名字 点名成员、修改群设置、在群里发言。",
  "Who answers": "谁来回答",
  "Choose an admin first": "先选一个管理员",
  "@mentions always pick who answers.": "@提及总是指定由谁回答。",
  Notice: "群公告",
  "Shared instructions every member reads before speaking…": "每位成员发言前都会读到的共同说明…",
  "Group notice": "群公告",
  "Back to details": "返回详情",
  "Close details": "关闭详情",
  "Copied conversation": "已复制对话",
  "Share conversation": "分享对话",
  "Copy conversation as Markdown": "把对话复制为 Markdown",
  "This conversation is not part of your Bot team.": "这个对话不属于你的 Bot 团队。",
  "Admin {name}": "管理员 {name}",
  "No admin": "无管理员",
  "Bot name": "Bot 名字",
  "Group name": "群名",
  "Name after members": "按成员命名",
  "Rename {name}": "重命名 {name}",
  Rename: "重命名",
  "Add instructions in Bot settings": "在 Bot 设置里添加说明",
  "No scheduled tasks yet. To add one, tell the Bot in its chat what to do and when.": "还没有定时任务。要添加，在对话里告诉 Bot 做什么、什么时候做。",
  "The browser is in DSH Desktop and the DS Bot app.": "浏览器在 DSH 桌面版和 DS Bot 应用里。",
  "New tab": "新标签页",
  "Close tab": "关闭标签页",
  "Open {title}": "打开 {title}",
  "Conversation details": "对话详情",
  "Panel tabs": "面板标签页",
  "Close panel": "关闭面板",
  // Cookie imports
  "Import cookies": "导入 cookie",
  "From a file…": "从文件导入…",
  "cookies.txt, JSON, storageState": "cookies.txt、JSON、storageState",
  "Copy of its cookies": "复制它的 cookie",
  "No browsers found": "没有找到浏览器",
  "The Bot controls this browser": "Bot 正在控制此浏览器",
  "The Bot is waiting for you": "Bot 正在等待你",
  "You control this browser": "你正在控制此浏览器",
  "The Bot handed this browser to you: {reason}": "Bot 已将此浏览器交给你：{reason}",
  "Take over": "接管",
  "Give back": "交还",
  "Sign-in needed": "需要登录",
  "Payment needed": "需要付款",
  "Verification needed": "需要验证",
  "Help needed in the browser": "需要你在浏览器里帮忙",
  Skipped: "已跳过",
  Returned: "已交还",
  "I'm done": "我完成了",
  "{name} is running": "{name} 正在运行",
  "It must close for a moment so its cookies can be copied. It will reopen with your tabs.": "需要先把它关掉一下才能复制 cookie，之后会自动重新打开并恢复你的标签页。",
  "Close {name} and import": "关闭 {name} 并导入",
  "Closing…": "正在关闭…",
  "Import {count} cookies": "导入 {count} 个 cookie",
  "the browser was restarted": "浏览器已重新打开",
  "{count} skipped": "跳过 {count} 个",
  "{count} session": "{count} 个会话",
  "{count} adjusted": "调整了 {count} 个",
  "Cookies without an expiry stay until the app closes.": "没有过期时间的 cookie 会保留到应用关闭。",
  "Some sites also keep sign-in outside cookies; you may need to sign in again there.": "有些网站还把登录信息存在 cookie 之外，这些网站可能要重新登录。",
  "Importing…": "正在导入…",
  "Import": "导入",
  "Imported {count} cookies": "已导入 {count} 个 cookie",
  "No cookies were stored": "没有 cookie 被写入",
  "Reload the page": "刷新页面",
  "Import failed": "导入失败",
  "That file is too large to be a cookie export.": "这个文件太大了，不像是 cookie 导出文件。",
  "That file could not be read.": "这个文件读不了。",
  "This browser encrypts its cookies so only it can read them. Export them to a file first, then import that file.": "这个浏览器把 cookie 加密了，只有它自己能读。先把 cookie 导出成文件，再导入那个文件。",
  "{count}": "{count} 个",
  // Bot settings
  "Choose a PNG, JPEG, WebP, or GIF image": "请选择 PNG、JPEG、WebP 或 GIF 图片",
  "Choose an image smaller than 25 MB": "请选择小于 25 MB 的图片",
  "That image is too large": "图片太大了",
  Model: "模型",
  "Avatar editor": "形象编辑",
  "Avatar source": "形象来源",
  Upload: "上传",
  "Reset character to default": "恢复默认形象",
  Reset: "恢复默认",
  "Character shape": "形状",
  "Character color": "颜色",
  "Drag, drop, or paste an image": "拖入或粘贴一张图片",
  Replace: "替换",
  "Browse files": "选择文件",
  "Remove photo": "移除照片",
  "Edit Bot avatar": "编辑 Bot 形象",
  Name: "名字",
  Instructions: "说明",
  "What this Bot is responsible for…": "这个 Bot 负责什么…",
  "Pick the model this Bot runs on.": "选择这个 Bot 使用的模型。",
  "This model is not available now. Pick another one.": "这个模型现在不可用，请换一个。",
  "Every message of this Bot runs on it.": "这个 Bot 的每条消息都用它。",
  "Applies from the next message.": "从下一条消息开始生效。",
  Profile: "资料",
  Label: "标签",
  "Optional. Shown under the name.": "可选，显示在名字下方。",
  "Research, admin…": "研究、行政…",
  "What this Bot does": "这个 Bot 做什么",
  "Its job on the team. Part of the Bot's system prompt.": "它在团队里的分工，会写进 Bot 的系统提示词。",
  "A copy with the same job and model, and fresh memory.": "复制分工和模型，记忆从零开始。",
  "Delete {name}?": "删除 {name}？",
  "Delete Bot": "删除 Bot",
  "Click again to delete. Its chats are archived.": "再点一次删除，它的对话会归档。",
  "Removes the Bot from the team.": "把这个 Bot 从团队里移除。",
  "Pick a model and {name} can start.": "选好模型，{name} 就能开始工作。",
  "Permissions": "权限",
  "Read only": "仅可查看",
  "Workspace": "工作区内修改",
  "Full access": "完全权限",
  "Same for every member": "全员统一",
  "Replaces each member's own permissions in this group.": "在这个群里代替各成员自己的权限。",
  "The only Main Bot. To hand the role to another Bot, use Main Bot on the Bots page.": "这是唯一的主 Bot。要把主 Bot 交给别的 Bot，请到「Bot」页的主 Bot 里换。",
  Change: "更换",
  "Can create and change Bots, and runs every group chat.": "可以创建和修改 Bot，并管理所有群聊。",
  Sidebar: "侧栏",
  "Kept above the other chats.": "排在其他对话上面。",
  "Search still finds it.": "仍然可以搜索到。",
  Manage: "管理",
  // Avatar library
  Library: "头像库",
  "Import photos": "导入照片",
  "Importing photos…": "正在导入照片…",
  "No photos in the library yet.": "头像库还是空的。",
  "Use this photo": "用这张照片",
  "Remove photo from the library": "从头像库移除这张照片",
  "1 photo imported": "已导入 1 张照片",
  "{count} photos imported": "已导入 {count} 张照片",
  "1 photo was already in the library": "有 1 张照片已经在头像库里",
  "{count} photos were already in the library": "有 {count} 张照片已经在头像库里",
  "{name}: {reason}": "{name}：{reason}",
  photo: "照片",
  "Show more photos": "显示更多照片",
  "Showing {shown} of {total} photos": "显示 {shown} / {total} 张照片",
  // Group chat settings
  "Leave it empty to name the group after its members.": "留空就按成员命名。",
  "Every member reads it before speaking in this group.": "每位成员在这个群里发言前都会读到。",
  "Add a Bot first: a group chat needs at least two.": "请先添加一个 Bot：群聊至少要两个。",
  "Click again to delete. Its history is archived.": "再点一次删除，聊天记录会归档。",
  "Removes the group chat. Its members stay on the team.": "删除这个群聊，成员仍留在团队里。",
  "Add a notice in group settings": "在群设置里添加群公告",
  // Create Bot
  "Create Bot": "创建 Bot",
  "Back to new chat": "返回新对话",
  Look: "形象",
  Shuffle: "随机",
  "Replace photo": "更换照片",
  "Upload photo": "上传照片",
  "A Bot named {name} already exists": "已经有叫 {name} 的 Bot 了",
  "The Bot runs on this model. You can change it later in its details.": "Bot 会使用这个模型。以后可以在详情里修改。",
  "Add a provider and a model in DeepSeek Harness first, or pick one in the Bot's chat later.": "请先在 DeepSeek Harness 里添加服务商和模型，或者稍后在 Bot 的对话里选择。",
  "Creating…": "创建中…",
  Create: "创建",
  // Model menu
  Default: "默认",
  "Thinking level": "思考强度",
  "Model: {model}": "模型：{model}",
  none: "无",
  "Choose a model": "选择模型",
  "{provider} · not available": "{provider} · 不可用",
  "Model for {name}": "{name} 的模型",
  "No models are set up in DeepSeek Harness yet.": "DeepSeek Harness 里还没有设置模型。",
  "Models and providers…": "模型和服务商…",
  Models: "模型",
  "Harness default": "Harness 默认",
  Saving: "保存中",
  "Manage models": "管理模型",
  // Shapes
  Whale: "鲸鱼",
  Star: "星星",
  Moon: "月亮",
  Wave: "声波",
  Squircle: "圆角方",
  Bull: "牛角",
  Blossom: "花朵",
  Gumdrop: "软糖",
  Peanut: "花生",
  Bubbles: "泡泡",
  Saucer: "飞碟",
  Sprout: "嫩芽",
  Bunny: "兔子",
  Kitty: "小猫",
  Beacon: "灯塔",
  Plus: "加号",
  Magnet: "磁铁",
  Acorn: "橡果",
  Pebbles: "石子",
  Cushion: "靠垫",
  Ring: "圆环",
  Gem: "宝石",
  // Colors
  Black: "黑",
  Brown: "棕",
  Red: "红",
  Orange: "橙",
  Yellow: "黄",
  Green: "绿",
  Cyan: "青",
  Blue: "蓝",
  Violet: "紫",
  Magenta: "品红",
  Gray: "灰",
  Aurora: "极光",
  Deepseek: "DeepSeek 蓝",
  Charcoal: "炭黑",
  Graphite: "石墨",
  Rose: "玫瑰",
  Sky: "天蓝",
  Tangerine: "橘",
  Cobalt: "钴蓝",
  // Themes
  DeepSeek: "DeepSeek",
  Mono: "黑白",
  Paper: "纸张",
  Moonlight: "月光",
  // Settings dialog
  General: "通用",
  Bots: "Bot",
  "Group chats": "群聊",
  Secrets: "密钥",
  Appearance: "外观",
  Theme: "主题",
  "Colors for the whole team, on every device.": "整个团队的配色，所有设备同步。",
  Accent: "强调色",
  "Unread marks, badges, and the brand mark.": "未读标记、徽标和品牌标志。",
  "Theme accent": "主题强调色",
  "Custom accent": "自定义强调色",
  "Message layout": "消息布局",
  Bubble: "气泡",
  Flat: "平铺",
  "Bubble width": "气泡宽度",
  "Text width": "正文宽度",
  "Show thinking": "显示思考过程",
  "Bots · {count}": "Bot · {count}",
  "First in the sidebar. Pick another Bot to hand it the role; {name} then stops being a Main Bot.": "排在侧栏最上面。选另一个 Bot 就会把主 Bot 交给它，{name} 随之不再是主 Bot。",
  "Choose a Bot…": "选择一个 Bot…",
  "Also a Main Bot.": "也是主 Bot。",
  "Move to first": "移到最前",
  "Add a Main Bot": "添加主 Bot",
  "Main Bots can create and change Bots, and run every group chat.": "主 Bot 可以创建和修改 Bot，并管理所有群聊。",
  "Group chats · {count}": "群聊 · {count}",
  "No group chats yet.": "还没有群聊。",
  "A group chat lets several Bots work on one thing with you.": "在群聊里，几个 Bot 和你一起做一件事。",
  "Back to group chats": "返回群聊列表",
  "DS Bot settings": "DS Bot 设置",
  "Settings pages": "设置页面",
  "Models, providers, and the rest of DeepSeek Harness": "模型、服务商和 DeepSeek Harness 的其他设置",
  "Harness settings": "Harness 设置",
  "Back to Bots": "返回 Bot 列表",
  "Close settings": "关闭设置",
  // Context menu
  Unpin: "取消置顶",
  Pin: "置顶",
  Pinned: "已置顶",
  "Mark as Unread": "标为未读",
  "Rename Bot": "重命名 Bot",
  "Group settings": "群设置",
  "Rename group": "重命名群聊",
  "Copy conversation ID": "复制对话 ID",
  "Hide from sidebar": "从侧栏隐藏",
  "{name} actions": "{name} 的操作",
  // The DSH Agent's own row and Session list. "DSH Agent" is a product name and
  // stays in English.
  "Add DSH Agent": "添加 DSH Agent",
  "Remove DSH Agent": "移除 DSH Agent",
  "New session": "新会话",
  Archive: "归档",
  "Session actions": "会话操作",
  "Plain dsh session": "原生 dsh 会话",
  "just now": "刚刚",
  "{n} min": "{n} 分钟",
  "{n} h": "{n} 小时",
  "{n} d": "{n} 天",
  // Plugin updates
  "DS Bot {version} is available": "DS Bot {version} 可以更新",
  "Updating DS Bot…": "正在更新 DS Bot…",
  "DS Bot {version} is installed. Restart DSH to use it.": "DS Bot {version} 已安装，重启 DSH 后生效",
  "DS Bot {version} is installed.": "DS Bot {version} 已安装。",
  "DS Bot update": "DS Bot 更新",
  "DS Bot {version}": "DS Bot {version}",
  "Update installed": "更新已安装",
  "Restart DSH to start using DS Bot {version}.": "重启 DSH 后开始使用 DS Bot {version}。",
  "You have {version}.": "当前版本 {version}。",
  "The update did not finish: {reason}": "更新没有完成：{reason}",
  "What's new": "更新说明",
  "Updating…": "正在更新…",
  "DSH {version} is available": "DSH {version} 可以更新",
  "Updating DSH…": "正在更新 DSH…",
  "DSH update": "DSH 更新",
  "DSH {version}": "DSH {version}",
  "Restart DSH to start using DSH {version}.": "重启 DSH 后开始使用 DSH {version}。",
  "Update DS Bot {version} first.": "先更新 DS Bot {version}。",
  "Open updates": "打开更新",
  // Command palette
  Messages: "消息",
  Commands: "命令",
  "Search Bots, chats and messages": "搜索 Bot、对话和消息",
  "Clear search": "清除搜索",
  Results: "结果",
  "No results": "没有结果",
  "Try a Bot name or words from a message": "试试 Bot 名字或消息里的词",
  // Bot exchange
  "Bot exchange": "Bot 间对话",
  "Bot exchange transcript": "Bot 间对话记录",
  "No messages yet": "还没有消息",
  "Close Chat": "关闭",
  "Show all · {count} characters": "显示全部 · {count} 字",
  "Showing the first {count} characters": "只显示前 {count} 字",
  "Only the start of this message is kept here": "这里只保留了这条消息的开头",
  // Time and usage
  "Today {time}": "今天 {time}",
  "Yesterday {time}": "昨天 {time}",
  "Ran for {duration}": "本次用时 {duration}",
  "{tokens} tok · Cache hit {hit}%": "{tokens} tok · 缓存命中 {hit}%",
  "1 turn": "1 轮",
  "{count} turns": "{count} 轮",
  "{speed} tok/s": "{speed} tok/s",
  "Cache hit {hit}%": "缓存命中 {hit}%",
  "Context {percent}%": "上下文 {percent}%",
  "{used} of {total} tokens of context in use": "上下文已用 {used} / {total} tokens",
  // Transcript
  Footnotes: "脚注",
  "Remove reaction {emoji}": "移除表情 {emoji}",
  "Add reaction": "添加表情",
  Reply: "回复",
  "More message actions": "更多操作",
  More: "更多",
  Reactions: "表情",
  "Message actions": "消息操作",
  Download: "下载",
  "Thought it through": "思考过程",
  "Earlier messages": "更早的消息",
  "Loading earlier messages…": "正在加载更早的消息…",
  "Couldn’t load earlier messages · Retry": "更早的消息没加载出来 · 重试",
  "Load earlier": "加载更早的消息",
  "1 image": "1 张图片",
  "{count} images": "{count} 张图片",
  "Replies from": "群聊回复：",
  "Reply from": "收到回复：",
  "Message from": "收到消息：",
  "Stopped by": "叫停者：",
  "{count} messages with": "{count} 条消息，来自",
  "Routine started": "例行任务开始",
  Update: "更新",
  "Thinking about it": "想一想",
  "Weighing the options": "权衡一下",
  "Working out a plan": "理一下思路",
  "Sorting out the details": "梳理细节",
  "On it": "在做了",
  "Busy with it": "正在处理",
  "Moving ahead": "推进中",
  "Taking care of it": "处理中",
  "Making headway": "有进展了",
  "Moving to a fresh conversation": "整理记忆，换到新对话",
  "Switching working folder": "正在切换工作文件夹",
  "Searching online": "上网搜索",
  "Reading a page": "阅读网页",
  "Running shell commands": "运行命令",
  "Opening a file": "打开文件",
  "Looking through files": "查找文件",
  "Writing changes": "写入修改",
  "Working on an image": "处理图片",
  "Creating a group": "创建群聊",
  "Updating the group": "更新群聊",
  "Deleting the group": "删除群聊",
  "Posting in the group": "在群里发言",
  "Checking the keys": "查看密钥",
  "Asking {name}": "询问 {name}",
  "Asking another Bot": "询问其他 Bot",
  "Stopping {name}": "叫停 {name}",
  "Stopping another Bot": "叫停其他 Bot",
  "Creating {name}": "创建 {name}",
  "Updating {name}": "更新 {name}",
  "Checking the team": "查看团队",
  "Reading {name}": "阅读 {name}",
  "Looking back through the chat": "翻看聊天记录",
  "{name} looked up its own chat": "{name} 查看了自己的对话",
  "{name} looked up its own chat for “{text}”": "{name} 在自己的对话里查找「{text}」",
  "{name} is typing…": "{name} 正在输入…",
  "{name} didn't answer in time": "{name} 没有及时回应",
  "{name} did not answer or call anyone; call a member with @Name": "{name} 没有回答，也没有叫谁；用 @名字 叫一个成员来回答",
  "The group replies could not be shown": "群里的回复显示不出来",
  "Paused after {count} Bot relays. Waiting: {names}": "Bot 之间已接力 {count} 次，先停下了。还在等：{names}",
  "{name} paused for your approval": "{name} 停下来等你批准",
  "{name} started on it": "{name} 开始做了",
  "You stopped {name}'s work": "你停下了 {name} 的工作",
  "{name} finished its work": "{name} 做完了",
  "{name} was cut off by a restart and picked its work back up": "{name} 的工作被重启打断，已经接着做",
  "{name} was cut off by a restart again and stopped": "{name} 的工作又被重启打断，已停下",
  "Picked up its work after a restart": "重启后接着做之前的工作",
  "Profile updated": "资料已更新",
  "Asked to make the tool call it wrote as text": "工具调用被写成了文字，已让它重新调用",
  "A Bot": "一个 Bot",
  "{name} is waiting for your approval": "{name} 等你批准",
  "{first} and {second} are waiting for your approval": "{first}、{second} 等你批准",
  "{first}, {second} and {count} more are waiting for your approval": "{first}、{second} 等 {total} 个等你批准",
  "Waiting for your approval": "等你批准",
  "in its own chat": "在自己的对话里",
  "Stop all work in this group": "停止本群的所有工作",
  "Stop all": "全部停止",
  Reject: "拒绝",
  "Allow once": "允许一次",
  "Couldn't message {name}": "没能给 {name} 发消息",
  Messaged: "已发消息给",
  "Couldn't stop {name}": "没能叫停 {name}",
  Stopped: "已叫停",
  Created: "已创建",
  Updated: "已更新",
  "Created group": "已创建群聊",
  "Couldn't create the group": "没能创建群聊",
  "Updated group": "已更新群聊",
  "Couldn't update the group": "没能更新群聊",
  "Deleted group": "已删除群聊",
  "Couldn't delete the group": "没能删除群聊",
  "Posted in": "已发到",
  "Couldn't post in the group": "没能在群里发言",
  Read: "已读取",
  // Questions
  "Your own answer": "你自己的回答",
  "Type your own answer": "输入你自己的回答",
  Selected: "已选",
  Skip: "跳过",
  Submit: "提交",
  "Choose all that apply": "可多选",
  "Dismiss question": "关闭问题",
  Dismiss: "关闭",
  Dismissed: "已关闭",
  "Your answer": "你的回答",
  // Views
  View: "视图",
  Confirm: "确认",
  Progress: "进度",
  "Dismiss view": "关闭视图",
  Sources: "来源",
  Chart: "图表",
  "Chart {n}": "图表 {n}",
  Series: "系列",
  "Chart options": "图表选项",
  "View as table": "以表格查看",
  "View as chart": "以图表查看",
  "Copy data": "复制数据",
  "Download image": "下载图片",
  "This view tried to open a page and was stopped.": "这个视图想打开一个网页，已被拦下。",
  "Send to Bot": "发给 Bot",
  // Secrets
  "All Bots": "所有 Bot",
  "No Bot": "没有 Bot",
  "Paste or type the key": "粘贴或输入密钥",
  "Only {name}": "只给 {name}",
  "Who may use it": "谁可以用",
  "Cancel the request": "取消请求",
  "This page is not on HTTPS: the key crosses the network unencrypted.": "这个页面不是 HTTPS：密钥会以明文经过网络。",
  "Let {bot} use {name}?": "允许 {bot} 使用 {name}？",
  "{name} needs a key": "{name} 需要一个密钥",
  "Saved for {scope}": "已保存，可用范围：{scope}",
  "Value of {name}": "{name} 的值",
  "{bot} never sees the value. It reaches {bot}'s shell as ": "{bot} 永远看不到这个值。它会作为下面的环境变量进入 {bot} 的 shell：",
  " At least {count} characters.": " 至少 {count} 个字符。",
  "At least {count} characters.": "至少 {count} 个字符。",
  "Replace value": "替换值",
  "Saving…": "保存中…",
  Save: "保存",
  "Allowing…": "允许中…",
  Allow: "允许",
  "{bot} asked for {name}": "{bot} 请求了 {name}",
  "Allowed {bot} to use {name}": "已允许 {bot} 使用 {name}",
  "Saved {name}": "已保存 {name}",
  Canceled: "已取消",
  Done: "完成",
  "{bot} is using {name}": "{bot} 正在使用 {name}",
  "{bot} could not ask for a key: this window can only view the team": "{bot} 没能要密钥：这个窗口只能查看团队",
  "a saved key": "一个已保存的密钥",
  "Chosen Bots": "指定的 Bot",
  "Who may use {name}": "谁可以用 {name}",
  "Save access": "保存权限",
  "Replace the value": "替换值",
  "New value of {name}": "{name} 的新值",
  "Replaced. Bots get the new value from their next command.": "已替换。Bot 从下一条命令开始拿到新值。",
  "a deleted Bot": "一个已删除的 Bot",
  "Asked by {name}": "由 {name} 请求",
  "added {time}": "添加于 {time}",
  "last used {time}": "上次使用 {time}",
  "not used yet": "还没用过",
  "Delete {name}? Bots lose it at once.": "删除 {name}？Bot 会立刻失去它。",
  Keep: "保留",
  "Key name": "密钥名",
  "NAME, e.g. GITHUB_TOKEN": "名字，例如 GITHUB_TOKEN",
  "What it is for": "用途",
  Value: "值",
  "New keys are for all Bots; narrow it down afterwards.": "新密钥默认所有 Bot 可用，之后可以收窄。",
  "Save key": "保存密钥",
  "Keys your Bots asked for. Bots never see the values: they use them as ": "你的 Bot 请求过的密钥。Bot 永远看不到值：它们在 shell 里通过 ",
  " in their shell, and every value is replaced by ": " 使用，而且发给模型之前，每个值都会被替换成 ",
  " before anything goes to a model.": "。",
  "Secrets · {count}": "密钥 · {count}",
  "No keys yet. When a Bot needs one, it shows a card in its chat.": "还没有密钥。Bot 需要时，会在对话里弹出一张卡片。",
  "Add a key": "添加密钥",
  // Memory
  Memory: "记忆",
  "Nothing saved yet": "还没有保存内容",
  "1 entry": "1 条",
  "{count} entries": "{count} 条",
  "Manage {name}'s memory": "管理 {name} 的记忆",
  "{name}'s memory": "{name} 的记忆",
  "Memory summary": "记忆摘要",
  "All entries": "全部记忆",
  "Memory options": "记忆选项",
  "Close memory": "关闭记忆",
  "Back to the summary": "返回摘要",
  "Regenerate summary": "重新生成摘要",
  "Updated {time}": "更新于 {time}",
  "Updated just now": "刚刚更新",
  "Writing the summary…": "正在生成摘要…",
  "The summary is out of date: {reason}": "摘要不是最新的：{reason}",
  "The summary could not be written: {reason}": "摘要没能生成：{reason}",
  "{name} has not saved anything yet": "{name} 还没有记住任何内容",
  "Bots keep lasting preferences, decisions, and what you ask them to remember. Tell {name} below, or in its chat.": "Bot 会记住长期的偏好、做过的决定，以及你让它记住的事。可以在下面告诉 {name}，也可以在对话里说。",
  "Nothing is saved for this group yet": "这个群还没有记住任何内容",
  "A group keeps the decisions, rules, and facts its work needs, for its members to read here. Tell it below, or in the group.": "群会记住工作需要的决定、规则和事实，只有群成员在这个群里会读。可以在下面告诉它，也可以在群里说。",
  "Team memory": "团队记忆",
  "Every Bot reads it": "所有 Bot 都会读",
  "Group memory": "群记忆",
  "Only its members read it": "只有群成员会读",
  "MEMORY.md, which every conversation reads": "MEMORY.md，每次对话都会读",
  "{used} of {limit} characters": "{used} / {limit} 字符",
  "by you": "由你添加",
  "by {name}": "由 {name} 添加",
  "Remove from memory": "从记忆中删除",
  "Click again to remove": "再点一次删除",
  Remove: "删除",
  "Ask or update": "询问或更新",
  "Ask about or update {name}'s memory": "询问或更新 {name} 的记忆",
  Send: "发送",
  "Added: {text}": "已添加：{text}",
  "Added to team memory: {text}": "已加入团队记忆：{text}",
  "Updated: {text}": "已更新：{text}",
  "Removed: {text}": "已删除：{text}",
  "Removed from team memory: {text}": "已从团队记忆删除：{text}",
  "Not changed: {text} ({reason})": "没有改动：{text}（{reason}）",
  "Saving to memory": "正在记下",
  "Updating memory": "正在更新记忆",
  "Checking memory": "正在查看记忆",
  "Memory updated": "记忆已更新",
  "Already saved": "已经保存过了",
  "Couldn't save to memory": "没能保存到记忆",
  "Couldn't remove from memory": "没能从记忆里删除",
  "Memory not changed": "记忆没有变化",
  "Write something to save": "请写下要保存的内容",
  "No saved entry matched": "没有匹配的记忆条目",
  "The memory refused this change": "记忆没有接受这次改动",
  "The memory could not be changed": "记忆没能改动",
  "Team memory updated": "团队记忆已更新",
  "Updated {name}'s memory": "已更新 {name} 的记忆",
  "Memory updated. Open {name}'s memory": "记忆已更新，打开 {name} 的记忆",
  // Browser
  "Close browser": "关闭浏览器",
  "Open browser": "打开浏览器",
  "{name}'s browser": "{name} 的浏览器",
  "Resize panel": "调整面板宽度",
  "{name} read this page": "{name} 读了这个页面",
  "{name}'s browser. {name} can read the page shown here.": "{name} 的浏览器。{name} 能读取这里显示的页面。",
  Back: "后退",
  Forward: "前进",
  Stop: "停止",
  Reload: "刷新",
  Address: "地址",
  "Search or enter address": "搜索或输入网址",
  "This page didn’t load": "页面没有加载出来",
  "Try again": "重试",
  "Open a page here and {name} can read it with you. Logins and cookies stay with {name}; other Bots never see them.": "在这里打开网页，{name} 就能和你一起读。登录状态和 cookie 只属于 {name}，其他 Bot 看不到。",
  "Only http and https addresses open here.": "这里只能打开 http 和 https 地址。",
  "The page crashed.": "页面崩溃了。",
  "The browser blocked the new window.": "浏览器拦截了新窗口。",
  "Open the issue": "打开问题页面",
  "Cloud metadata addresses do not open here.": "这里不能打开云元数据地址。",
  // Voice
  "Dictation is not available in this browser": "这个浏览器不支持听写",
  "Microphone access is blocked": "麦克风权限被阻止了",
  "Couldn't hear that": "没听清",
  "Couldn't start dictation": "无法开始听写",
  "Stop dictation": "停止听写",
  Dictate: "听写",
  "Start voice chat": "开始语音对话",
  "Voice chat": "语音对话",
  Listening: "在听",
  Thinking: "思考中",
  "Thinking…": "思考中…",
  Speaking: "在说",
  Paused: "已暂停",
  "Voice chat is not available in this browser": "这个浏览器不支持语音对话",
  "Voice chat with {name}": "和 {name} 语音对话",
  "Resume listening": "继续听",
  Pause: "暂停",
  "End voice chat": "结束语音对话",
  "Recognizing…": "识别中…",
  "Voice input needs its speech model": "语音输入还没有语音模型",
  "Set up voice input": "设置语音输入",
  "Preparing voice input…": "正在准备语音输入…",
  "Downloading the speech model… {pct}%": "正在下载语音模型… {pct}%",
  "Couldn't prepare voice input": "语音输入准备失败",
  "That was too long to recognize": "这段太长了，识别不了",
  // Usage page
  "24 hours": "24 小时",
  "7 days": "7 天",
  "30 days": "30 天",
  "12 weeks": "12 周",
  "12 months": "12 个月",
  "Per hour": "按小时",
  "Per day": "按天",
  "Per week": "按周",
  "Per month": "按月",
  Output: "输出",
  Input: "输入",
  "Cache hit": "缓存命中",
  "Deleted Bot": "已删除的 Bot",
  Deleted: "已删除",
  "Deleted group chat": "已删除的群聊",
  "Group chat": "群聊",
  "Own chat": "单聊",
  "Side chat": "侧边对话",
  "New browser tab": "新建浏览器页",
  Terminal: "终端",
  Files: "文件树",
  "Close side chat": "关闭侧边对话",
  "Delete side chat": "删除侧边对话",
  "Ask without interrupting": "不打断当前工作，顺便问一句",
  "Ask about the work so far": "问问目前做到哪了",
  "Answering…": "正在回答…",
  Cancelled: "已取消",
  "Answered from progress so far; nothing was run": "基于目前已有进展的回答，没有执行任何操作",
  "Could not answer.": "没能答上。",
  "Cancel this side question": "取消这次旁路提问",
  Conversations: "对话",
  "Compaction and handoff": "压缩与交接",
  "Image reading": "识图",
  Titles: "标题",
  Other: "其他",
  "Last {range}": "最近 {range}",
  tokens: "Token",
  "Compared with the {range} before": "与再往前 {range} 相比",
  "{share}% of all usage in the last {range}": "占最近 {range}全部用量的 {share}%",
  Calls: "调用次数",
  "Cache hit rate": "缓存命中率",
  "Tokens over time": "Token 走势",
  "{count} tokens": "{count} Token",
  "{tokens} tokens · {calls} calls": "{tokens} Token · {calls} 次调用",
  "Active on 1 day in the last year": "近一年有 1 天在用",
  "Active on {count} days in the last year": "近一年有 {count} 天在用",
  Light: "少",
  Heavy: "多",
  "Unknown model": "未知模型",
  "More Bots": "其余 Bot",
  "More models": "其余模型",
  "Reading your chats…": "正在读取聊天记录…",
  "No usage yet.": "还没有用量。",
  "Token usage shows up here after a model is called.": "调用模型之后，这里会显示 Token 用量。",
  "Nothing in this range.": "这段时间没有用量。",
  "Who used it": "谁在用",
  "What for": "用途",
  Activity: "活跃度",
  "Time range": "时间范围",
  "All usage": "全部用量",
  "Group usage by": "用量分组",
  "By Bot": "按 Bot",
  "By model": "按模型",
  "Still reading older chats; totals may grow.": "还在读取较早的聊天记录，数字可能还会变大。",
  Custom: "自定义",
  "Custom range": "自定义时间范围",
  "This month": "本月",
  "Last month": "上个月",
  "This year": "今年",
  "Previous month": "往前一个月",
  "Next month": "往后一个月",
  "Pick the first day": "选择开始日期",
  "Pick the last day": "选择结束日期",
  "1 day": "1 天",
  "{count} days": "{count} 天",
  "Compared with the day before": "与前一天相比",
  "Compared with the {count} days before": "与再往前 {count} 天相比",
  "{share}% of all usage from {span}": "占 {span} 全部用量的 {share}%",
  // About
  "About DS Bot": "关于 DS Bot",
  "Version {version}": "版本 {version}",
  "Star DS Bot on GitHub": "在 GitHub 上给 DS Bot 点 Star",
  "{count} stars": "{count} 个 Star",
  "If DS Bot helps you, a star on GitHub helps more people find it.": "如果 DS Bot 对你有用，欢迎在 GitHub 上点个 Star，让更多人看到它。",
  Updates: "更新",
  "Check for updates": "检查更新",
  "Checking…": "正在检查…",
  "Up to date": "已是最新版本",
  "Checked {time}": "检查于 {time}",
  "Could not check for updates.": "没能检查更新。",
  "Update checks are off.": "已关闭更新检查。",
  "Checking for updates…": "正在检查更新…",
  "Downloading {version}…": "正在下载 {version}…",
  "{version} is ready; it installs when you restart": "{version} 已下载好，重启后安装",
  "Restart to update": "重启更新",
  "{version} is available": "{version} 已发布",
  "Installed from a local folder; update it there.": "从本地文件夹安装，请在那里更新。",
  "Updates are not offered for this install.": "这种安装方式不提供更新。",
  "Updates come with the DS Bot app.": "随 DS Bot 应用一起更新。",
  Links: "链接",
  "Source code": "源代码",
  "Release notes": "发布说明",
  Open: "打开",
  // Feedback and errors
  Feedback: "反馈",
  "Report a problem": "报告问题",
  "What happened?": "发生了什么？",
  "What you did, what you expected, and what happened instead. It goes into the issue.": "你做了什么、期望什么、实际发生了什么。会写进 issue。",
  "For example: I asked Writer in the group chat and it showed an error.": "例如：我在群聊里问 Writer，它显示出错了。",
  Diagnostics: "诊断信息",
  "Versions, system, models, and the latest errors. Saved keys, tokens, and your home folder are hidden.": "版本、系统、模型和最近的错误。已保存的密钥、令牌和你的用户目录都已隐藏。",
  Show: "查看",
  Hide: "收起",
  "GitHub issue": "GitHub issue",
  "Opens a new issue in the DS Bot repository with all of this filled in. Nothing is sent until you submit it there.": "在 DS Bot 仓库新建一个 issue，并填好以上内容。你在 GitHub 上提交之前，什么都不会发出。",
  "Report on GitHub": "在 GitHub 上报告",
  "Copied the diagnostics.": "已复制诊断信息。",
  "Could not copy. Select the text below and copy it.": "无法复制。请选中下面的文字手动复制。",
  "Opened a new GitHub issue with the diagnostics filled in. Check it before you submit.": "已打开新的 GitHub issue，诊断信息已填好。提交前请检查一遍。",
  "Opened a new GitHub issue. The diagnostics are long, so they are on the clipboard: paste them into the issue.": "已打开新的 GitHub issue。诊断信息太长，已复制到剪贴板，请粘贴到 issue 里。",
  "Opened a new GitHub issue. Copy the diagnostics below into it.": "已打开新的 GitHub issue。请把下面的诊断信息复制进去。",
  "Downloaded the log. Keys, tokens, and your home folder are hidden in it.": "已下载日志。里面的密钥、令牌和用户目录都已隐藏。",
  "Cleared the error log.": "已清空错误日志。",
  "Recent errors": "最近的错误",
  "Recent errors · {count}": "最近的错误 · {count}",
  "No errors recorded.": "没有错误记录。",
  "Failed model calls and DS Bot problems show here, newest first.": "模型调用失败和 DS Bot 的问题会显示在这里，最新的在前。",
  "Model call": "模型调用",
  "This window": "这个窗口",
  "Error log": "错误日志",
  "Kept on this computer across restarts, up to about 1 MB.": "保存在这台电脑上，重启后仍在，最多约 1 MB。",
  Clear: "清空",
  "Settings → Feedback has the details.": "详情见 设置 → 反馈。",
  "Could not reach DSH. Check that it is still running.": "连不上 DSH，请确认它还在运行。",
  "{name} could not answer: {reason}": "{name} 没能回答：{reason}",
  "Unknown error": "未知错误",
  "The API key was rejected": "API 密钥无效",
  "The account is out of quota": "账户额度已用尽",
  "Too many requests to the model": "模型请求太频繁",
  "The conversation is too long for the model": "对话太长，超出模型上限",
  "The model service refused the request": "模型服务拒绝了请求",
  "The model service failed": "模型服务出错",
  "The model took too long to answer": "模型响应超时",
  "Could not reach the model service": "连不上模型服务",
  "Its group conversation could not open": "它的群聊会话打不开",
  "Its group conversation could not open, so it starts a new one next time": "它的群聊会话打不开，下次会换一个新的",
  // The composer's +
  "Add files": "添加文件",
  "Reference a chat": "引用对话",
  "Chat with {name}": "与 {name} 的对话",
  "Scheduled task": "定时任务",
  "Send to": "发给",
  "Scheduled task: {text}": "定时任务：{text}",
  // New group chats
  "Choose the group admin": "选择群管理员",
  "Group admin": "群管理员",
  "Who to chat with…": "想和谁聊…",
  "Add at least one more Bot": "再至少添加一个 Bot",
  Members: "成员",
  // Connectors and scheduled tasks
  "Scheduled tasks": "定时任务",
  "Every day": "每天",
  "Every {count} days": "每 {count} 天",
  "Every hour": "每小时",
  "Every {count} hours": "每 {count} 小时",
  "Every {count} minutes": "每 {count} 分钟",
  "Once, {time}": "一次，{time}",
  "Every day at {time}": "每天 {time}",
  "Every {days} at {time}": "每{days} {time}",
  "Every weekday at {time}": "每个工作日 {time}",
  "Every weekend at {time}": "每个周末 {time}",
  "On the schedule {expression}": "按计划 {expression}",
  "Next: {time}": "下次 {time}",
  Finished: "已结束",
  "in {name}": "在 {name}",
  "Click again to delete": "再点一次删除",
  "Delete task": "删除任务",
  Once: "一次",
  "Every week": "每周",
  Repeat: "重复",
  minutes: "分钟",
  hours: "小时",
  days: "天",
  "Morning briefing": "早间简报",
  "What to do": "要做什么",
  "Sum up what changed since yesterday and what needs me today.": "总结一下昨天以来的变化，以及今天需要我处理的事。",
  When: "什么时候",
  "Date and time": "日期和时间",
  Days: "星期",
  Time: "时间",
  Every: "每",
  "How many": "数量",
  Unit: "单位",
  "Create task": "创建任务",
  "Turn on Automation tasks in DSH": "在 DSH 里打开「自动化任务」",
  "Switch on Automation tasks on the Plugins page in Harness settings.": "在 Harness 设置的插件页启用「自动化任务」。",
  "Open Harness settings": "打开 Harness 设置",
  "New task": "新建任务",
  "No scheduled tasks yet.": "还没有定时任务。",
  "No scheduled tasks yet. Add one": "还没有定时任务，去添加",
  "Automation tasks are off in DSH": "DSH 的「自动化任务」没有打开",
  "No such Bot": "没有这个 Bot",
  "No such Bot or group chat": "没有这个 Bot 或群聊",
  "Give the task a name": "给任务起个名字",
  "Say what the Bot should do": "写下 Bot 要做什么",
  "Pick a date and time": "选一个日期和时间",
  "Pick a time in the future": "选一个将来的时间",
  "Pick a time of day": "选一个时间",
  "Pick at least one day": "至少选一天",
  "Repeat every 1 minute to 7 days": "重复间隔要在 1 分钟到 7 天之间",
  "Pick when it runs": "选择什么时候运行",
  "No such task": "没有这个任务",
  "Working folder": "工作文件夹",
  "Working folder: {folder}": "工作文件夹：{folder}",
  Folder: "文件夹",
  Folders: "文件夹",
  Privacy: "隐私",
  Private: "隐私",
  "Other Bots cannot read its folder, memory or chats, and you approve what it shares with them.": "其他 Bot 不能读取它的文件夹、记忆或对话；它分享给其他 Bot 的内容需要你批准。",
  "A Main Bot cannot be private.": "主 Bot 不能设为隐私 Bot。",
  "Leave its group chats before making it private.": "先退出所有群聊，才能设为隐私 Bot。",
  "Choose a working folder of its own first.": "先选择一个独立的工作文件夹。",
  "A private Bot cannot be a Main Bot.": "隐私 Bot 不能设为主 Bot。",
  "Closed after deletion · {count}": "删除后仍受保护 · {count}",
  "Remove protection": "解除保护",
  "Click again to remove. Other Bots can then read its folder, memory and chats.": "再点一次解除。其他 Bot 之后可以读取它的文件夹、记忆和对话。",
  "Nothing kept closed for this Bot": "这个 Bot 没有保留的保护",
  "Team workspace": "总工作区",
  "Team workspace: {folder}": "总工作区：{folder}",
  "Where Bots without a folder of their own work.": "没有单独设置文件夹的 Bot 在这里工作。",
  Locations: "位置",
  "Data location": "数据位置",
  "Change…": "更改…",
  "Each Bot's own folder": "各 Bot 自己的文件夹",
  "Choose a folder…": "选择文件夹…",
  "Browse folders…": "浏览文件夹…",
  "Enter a path…": "输入路径…",
  "Folder path": "文件夹路径",
  "Full path of a folder": "文件夹的完整路径",
  "Use this folder": "使用这个文件夹",
  "Up one level": "上一级",
  "No folders inside.": "里面没有文件夹。",
  "Some folders are not shown.": "还有一些文件夹没有显示。"
};
var HOST_ERRORS = [
  [/^Model (.+) is not available\. Available: (.*)$/, "模型 $1 不可用。可用的：$2"],
  [/^The API key for (.+) is set outside DS Bot and cannot be changed here$/, "$1 的 API key 是在 DS Bot 之外设置的，这里改不了"],
  [/^(.+) takes no API key here$/, "$1 不能在这里填 API key"],
  [/^(.+) is already set up$/, "$1 已经设置过了"],
  [/^DSH offers no provider (.+)$/, "DSH 没有服务商 $1"],
  [/^DSH already offers (.+); add it from its list$/, "DSH 已经提供 $1，请在常用服务商里添加"],
  [/^The protocol must be one of (.+)$/, "协议只能是 $1"],
  [/^(.+) is not set up$/, "$1 还没有设置"],
  [/^(.+) comes with this setup and cannot be removed$/, "$1 是这个配置自带的，不能删除"],
  [/^A Bot named (.+) already exists$/, "已经有叫 $1 的 Bot 了"],
  [/^Name (.*) is not available$/, "名字 $1 不可用"],
  [/^"(.+)" calls everyone in a group, so it cannot be a Bot name$/, "「$1」在群里表示所有人，不能用作 Bot 名字"],
  [/^"(.+)" stands for the user in a chat, so it cannot be a Bot name$/, "「$1」在对话里表示用户本人，不能用作 Bot 名字"],
  [/^Another group chat is already called "(.+)"$/, "已经有叫「$1」的群聊了"],
  [/^A group chat holds at most (\d+) Bots$/, "一个群聊最多 $1 个 Bot"],
  [/^Reply mode must be one of (.+)$/, "回复模式只能是 $1"],
  [/^Only the user, a Main Bot, or the admin of "(.+)" can change it$/, "只有你、主 Bot 或「$1」的管理员可以修改"],
  [/^A key must have at least (\d+) characters$/, "密钥至少 $1 个字符"],
  [/^A key can have at most (\d+) characters$/, "密钥最多 $1 个字符"],
  [/^(.+) is not saved yet$/, "$1 还没有保存"],
  [/^The Bot team in (.+) is open in another dsh \((.+)\)\. This window shows the team but cannot change it; close the other one and reload\.$/, "$1 里的 Bot 团队已在另一个 dsh 中打开（$2）。这个窗口只能查看，不能修改；关掉另一个后刷新。"],
  [/^HTTP (\d+)$/, "请求失败（HTTP $1）"],
  [/^GitHub answered (\d+)$/, "GitHub 返回了 $1"],
  [/^Keep the name under (\d+) characters$/, "名字不能超过 $1 个字"],
  [/^Give the full path of the folder, not (.+)$/, "请填写文件夹的完整路径，而不是 $1"],
  [/^The avatar library holds at most (\d+) photos\.$/, "头像库最多放 $1 张照片"],
  [/^The avatar must be a PNG, JPEG, WebP, or GIF image\. Use a square image; 256x256 is recommended\.$/, "头像必须是 PNG、JPEG、WebP 或 GIF 图片。建议用正方形图片，256x256。"],
  [/^The avatar image is too large: .+$/, "头像图片太大了"],
  [/^There is no folder at (.+)$/, "找不到文件夹 $1"],
  [/^(.+) is a file, not a folder$/, "$1 是文件，不是文件夹"],
  [/^(.+) holds DeepSeek Harness data, so Bots cannot work there$/, "$1 里有 DeepSeek Harness 的数据，Bot 不能在这里工作"],
  [/^(.+) needs a folder of its own to be private$/, "$1 需要有自己的工作文件夹，才能设为隐私 Bot"],
  [/^(.+) is a Main Bot, so it cannot be private$/, "$1 是主 Bot，不能设为隐私 Bot"],
  [/^(.+) is in a group chat, where every member reads what is said\. Remove it from its groups first$/, "$1 还在群聊里，群成员都能看到群里的内容。请先把它移出群聊"],
  [/^(.+) is private, so it cannot be a Main Bot$/, "$1 是隐私 Bot，不能设为主 Bot"],
  [/^(.+) is private, so it cannot be copied$/, "$1 是隐私 Bot，不能复制"],
  [/^(.+) is a private Bot and cannot be in a group chat: what is said in a group is read by every member$/, "$1 是隐私 Bot，不能加入群聊：群成员都能看到群里的内容"],
  [/^(.+) is in or around the team workspace, so (.+) cannot be private there\. Give it a folder of its own$/, "$1 与总工作区重叠，$2 不能在这里设为隐私 Bot。请给它一个独立文件夹"],
  [/^(.+) is in or around the folder of (.+), so (.+) cannot be private there\. Give it a folder of its own$/, "$1 与「$2」的文件夹重叠，$3 不能在这里设为隐私 Bot。请给它一个独立文件夹"],
  [/^(.+) is in or around the folder of (.+), a private Bot, so (.+) cannot work there$/, "$1 在隐私 Bot「$2」的文件夹内或外层，$3 不能在这里工作"],
  [/^(.+) is in or around the folder of (.+), a private Bot, so a group cannot work there$/, "$1 在隐私 Bot「$2」的文件夹内或外层，群聊不能在这里工作"],
  [/^(.+) is in or around the folder of (.+), a private Bot, so it cannot be the team workspace$/, "$1 在隐私 Bot「$2」的文件夹内或外层，不能作为总工作区"],
  // Memory changes the memory panel asked for; the whole message is matched.
  [/^This looks like a key, token, or password[\s\S]*$/, "看起来像密钥、令牌或密码，记忆不会保存这类内容"],
  [/^An entry holds at most (\d+) characters; this one has (\d+)\.[\s\S]*$/, "一条记忆最多 $1 个字符，这条有 $2 个"],
  [/^[\s\S]*'s MEMORY\.md would have (\d+) of its (\d+) characters\.[\s\S]*$/, "主记忆会超过 $2 个字符的上限，请先删掉一些"],
  [/^The topic \[\[(.+?)\]\] in [\s\S]* would have (\d+) of its (\d+) characters\.[\s\S]*$/, "主题 $1 会超过 $3 个字符的上限"],
  [/^[\s\S]* already has (\d+) topics, the most it holds\.[\s\S]*$/, "主题已经有 $1 个，不能再加新主题"],
  [/^There is no entry (.+)\.$/, "没有第 $1 条"],
  [/^No entry in [\s\S]* matches "([\s\S]*)"\.[\s\S]*$/, "找不到「$1」这条记忆"],
  [/^"([\s\S]*)" matches (\d+) entries in [\s\S]*$/, "「$1」对应了 $2 条记忆，请说得更具体"],
  [/^Memory cannot change now: [\s\S]*$/, "现在不能修改记忆：另一个 dsh 正在使用这个 Bot 团队"]
];
var HOST_ZH = {
  "Request failed": "请求失败",
  "Permissions are not available in this DeepSeek Harness": "这个 DeepSeek Harness 不支持权限设置",
  "Avatar images must be PNG, JPEG, WebP, or GIF": "头像图片必须是 PNG、JPEG、WebP 或 GIF",
  "Avatar image is too large": "头像图片太大了",
  "A Bot needs a name": "Bot 需要一个名字",
  "A Bot name cannot contain @, ` or a line break": "Bot 名字里不能有 @、` 或换行",
  "Unknown Bot": "找不到这个 Bot",
  "Unknown conversation": "找不到这个对话",
  "A group chat needs at least two Bots": "群聊至少要两个 Bot",
  "The admin must be a member of the group": "管理员必须是群成员",
  "Unknown group chat": "找不到这个群聊",
  "No Bot is left in this group chat": "这个群聊里已经没有 Bot 了",
  "That group chat has been deleted": "这个群聊已经删除了",
  "Hand the admin role to another member instead of leaving the group without one": "请把管理员交给其他成员，不要让群聊没有管理员",
  "Hand the admin role to another member before leaving the group": "离开群聊前，请先把管理员交给其他成员",
  "The team needs at least one Main Bot": "团队至少要有一个主 Bot",
  "Only a Main Bot can be replaced": "只能替换主 Bot",
  "A Main Bot cannot be deleted; remove its Main Bot role first": "主 Bot 不能删除，请先取消它的主 Bot 身份",
  "Unknown theme": "未知主题",
  "Accent must be a #rrggbb color": "强调色必须是 #rrggbb 格式",
  "Type the key first": "请先输入密钥",
  "Choose every Bot or a list of Bots": "请选择所有 Bot 或指定的 Bot",
  "This request is gone": "这个请求已经不存在了",
  "This request was already answered": "这个请求已经处理过了",
  "A name uses capitals, digits, and underscores, and starts with a letter": "名字只能用大写字母、数字和下划线，并以字母开头",
  "No such key": "没有这个密钥",
  "Type a question or a change first": "请先输入问题或要改的内容",
  "No model is available. Add one in Harness settings.": "没有可用的模型，请先在 Harness 设置里添加模型。",
  "Memory is turned off on this host": "这台主机关闭了记忆功能",
  "The model wrote nothing": "模型没有输出内容",
  "Write the entry to save.": "请写下要保存的内容。",
  "This DeepSeek Harness has no folder chooser": "这个 DeepSeek Harness 没有文件夹选择窗口",
  "This DeepSeek Harness cannot list folders": "这个 DeepSeek Harness 不能列出文件夹",
  "Side chat is only available in a Bot's private chat.": "侧边对话只在 Bot 的私聊里可用。",
  "Write a question.": "写上问题。",
  "Write a question after /side.": "在 /side 后面写上问题。",
  "/side does not take attachments.": "/side 不能带附件。",
  "Wait for the answer, or cancel it.": "等它答完，或者先取消。",
  "This side chat is no longer here.": "这个侧边对话已经不在了。",
  "This side question is no longer here.": "这个侧边提问已经不在了。",
  "This Bot has not called a model yet. Send a normal message first.": "这个 Bot 还没有调用过模型，请先正常发一条消息。",
  "DS Bot restarted before this answer finished.": "DS Bot 在回答完成前重启了。",
  "The model called a tool again after being told not to, so this aside was not answered.": "模型在被要求不要调用工具之后又调用了工具，所以这次没有回答。",
  "The model wrote nothing.": "模型没有写任何内容。",
  "Nothing to ask": "没有要问的内容",
  "Nothing to open": "没有要打开的内容",
  "Nothing to cancel": "没有要取消的内容",
  "Nothing to close": "没有要关闭的内容",
  "DS Bot is still loading this chat.": "DS Bot 还在加载这个对话。"
};
Object.assign(ZH, HOST_ZH);
var fill = (text, params) => params ? text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : text;
var service = null;
var bound = null;
function installLocale(locale) {
  if (!locale || typeof locale.register !== "function" || typeof locale.bind !== "function") return () => {
  };
  service = locale;
  bound = locale.bind(NAMESPACE);
  const off = locale.register(NAMESPACE, "zh", ZH);
  return () => {
    if (service === locale) {
      service = null;
      bound = null;
    }
    if (typeof off === "function") off();
  };
}
function t(key, params) {
  return bound ? bound(key, params) : fill(key, params);
}
function hostText(message) {
  if (!language().startsWith("zh")) return message;
  if (Object.hasOwn(ZH, message)) return t(message);
  for (const [pattern, template] of HOST_ERRORS) {
    if (pattern.test(message)) return message.replace(pattern, template);
  }
  return message;
}
function language() {
  const active = service?.getLocale?.().active;
  return typeof active === "string" ? active : "en";
}
var dateLocale = () => language().startsWith("zh") ? "zh-CN" : "en-US";

// src/client/diagnostics.js
var MAX = 30;
var REPEAT_MS = 5 * 60 * 1e3;
var entries = [];
var noted = /* @__PURE__ */ new WeakSet();
var markNoted = (error) => {
  if (error !== null && typeof error === "object") noted.add(error);
  return error;
};
function noteClientError(where, error) {
  if (error !== null && typeof error === "object") {
    if (noted.has(error)) return;
    noted.add(error);
  }
  const message = String(error?.message ?? error ?? "error").slice(0, 300);
  const code = typeof error?.code === "string" ? error.code : void 0;
  const text = `${where}: ${message}`;
  const now = Date.now();
  const last = entries.at(-1);
  if (last && last.text === text && now - last.time < REPEAT_MS) {
    last.time = now;
    last.count = (last.count ?? 1) + 1;
    return;
  }
  entries.push({ time: now, level: "error", text, ...code ? { code } : {} });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}
var FAILURES = {
  AUTH: "The API key was rejected",
  QUOTA: "The account is out of quota",
  ACCOUNT_QUOTA: "The account is out of quota",
  RATE_LIMIT: "Too many requests to the model",
  CONTEXT_WINDOW_EXCEEDED: "The conversation is too long for the model",
  INVALID_REQUEST: "The model service refused the request",
  SERVER: "The model service failed",
  TIMEOUT: "The model took too long to answer",
  TRANSPORT: "Could not reach the model service",
  SESSION: "Its group conversation could not open",
  SESSION_RESET: "Its group conversation could not open, so it starts a new one next time"
};
function failureLabel(code, message) {
  if (FAILURES[code]) return t(FAILURES[code]);
  return message || code || t("Unknown error");
}

// src/client/api.js
var ROUTE = "api/superagent";
var REFUSALS = /* @__PURE__ */ new Set(["bot/refused", "bot/invalid", "bot/read-only", "bot/not-found", "bot/browser-off"]);
var call = async (endpoint, payload, signal) => {
  let response;
  try {
    response = await fetch(ROUTE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, payload: payload ?? null }),
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    noteClientError(endpoint, Object.assign(new Error(`network error: ${error?.message ?? error}`), { code: "NETWORK" }));
    throw markNoted(Object.assign(new Error(t("Could not reach DSH. Check that it is still running.")), { code: "NETWORK", cause: error }));
  }
  if (!response.ok) {
    const error = Object.assign(new Error(hostText(`HTTP ${response.status}`)), { code: `HTTP_${response.status}` });
    noteClientError(endpoint, error);
    throw error;
  }
  const result = await response.json();
  if (!result.ok) {
    const code = result.error?.code ?? "bot/error";
    const message = hostText(result.error?.message ?? "Request failed");
    const error = Object.assign(new Error(code === "bot/internal" ? `${message} ${t("Settings → Feedback has the details.")}` : message), { code });
    if (!REFUSALS.has(code)) {
      noteClientError(endpoint, Object.assign(new Error(result.error?.message ?? "Request failed"), { code }));
      markNoted(error);
    }
    throw error;
  }
  return result.value;
};

// src/client/cells.js
var import_react17 = require("react");
var import_react_dom = require("react-dom");

// src/client/dsh-primitives.js
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/inks.js
var INKS = {
  deepseek: ["#4D6BFE", "#6A84FF"],
  charcoal: ["#141416", "#F1F2F4"],
  graphite: ["#2D2D2D", "#D6D6DA"],
  rose: ["#EC2F6B", "#FF5A7A"],
  sky: ["#0AA8D6", "#2EE6E0"],
  tangerine: ["#FF6900", "#FF8A2E"],
  cobalt: ["#082DFF", "#5C78FF"],
  black: ["#000000", "#FFFFFF"],
  brown: ["#A27952", "#855C36"],
  red: ["#FF3E51", "#E02135"],
  orange: ["#FF781C", "#FF6700"],
  yellow: ["#FFAF38", "#FF9800"],
  green: ["#00C972", "#009957"],
  cyan: ["#1CC3B0", "#00A592"],
  blue: ["#2A92FE", "#0E74E0"],
  violet: ["#A97EFE", "#804EE0"],
  magenta: ["#FF5EB1", "#E02A88"],
  gray: ["#959595", "#777777"],
  aurora: ["#00B8D4", "#2EE6E0"]
};
var GRADIENTS = { aurora: [[0, "#A4FFB0"], [0.42, "#00F0E4"], [1, "#2E9EF7"]] };
var ACCENT_INKS = ["deepseek", "charcoal", "graphite", "rose", "sky", "tangerine", "cobalt"];
var LEGACY_INKS = { kimi: "charcoal", zai: "graphite", minimax: "rose", stepfun: "sky", mimo: "tangerine", qwen: "cobalt" };
var isHex = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
var luminance = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
var inkName = (color) => INKS[color] ? color : INKS[LEGACY_INKS[color]] ? LEGACY_INKS[color] : "gray";
var inkFill = (color) => isHex(color) ? color : `var(--bt-ink-${inkName(color)})`;
var inkText = (color) => color === "black" ? "var(--bt-ink-gray)" : inkFill(color);

// src/shared/mentions.js
var ALL_WORDS = ["all", "everyone", "所有人", "全体"];
var NAME_GOES_ON = /^(?:[a-z0-9_\-/\\]|\.[a-z0-9_-])/i;
var ADDRESS_BEFORE = /[a-z0-9_./]/i;
var LITERAL = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
var fitsAt = (text, at, word) => text.slice(at, at + word.length).toLowerCase() === word.toLowerCase() && !NAME_GOES_ON.test(text.slice(at + word.length));
var overlaps = (spans, start, end) => spans.some((span) => start < span.end && span.start < end);
function referenceSpans(text, labels = []) {
  const spans = [];
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    const mention = `@${label}`;
    for (let at = text.indexOf(mention); at !== -1; at = text.indexOf(mention, at + 1)) {
      const end = at + mention.length;
      if (at > 0 && ADDRESS_BEFORE.test(text[at - 1]) || NAME_GOES_ON.test(text.slice(end)) || overlaps(spans, at, end)) continue;
      spans.push({ start: at, end, label });
      break;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
function mentionSpans(text, bots, { references = [] } = {}) {
  const value = String(text ?? "");
  const skip = [
    ...[...value.matchAll(LITERAL)].map((match) => ({ start: match.index, end: match.index + match[0].length })),
    ...referenceSpans(value, references)
  ];
  const byLength = bots.filter((bot) => bot?.name).sort((a, b) => b.name.length - a.name.length);
  const spans = [];
  for (let at = value.indexOf("@"); at !== -1; at = value.indexOf("@", at + 1)) {
    if (at > 0 && ADDRESS_BEFORE.test(value[at - 1]) || overlaps(skip, at, at + 1)) continue;
    const bot = byLength.find((candidate) => fitsAt(value, at + 1, candidate.name));
    const all = bot ? void 0 : ALL_WORDS.find((word) => fitsAt(value, at + 1, word));
    if (!bot && !all) continue;
    const end = at + 1 + (bot ? bot.name.length : all.length);
    spans.push(bot ? { start: at, end, bot } : { start: at, end, all: true });
    at = end - 1;
  }
  return spans;
}

// src/client/text.js
var MENTION_ORIGIN = "https://bots.local/";
function linkMentions(text, bots, selfId) {
  if (!text || !text.includes("@")) return text;
  let out = "";
  let cursor = 0;
  for (const span of mentionSpans(text, bots)) {
    if (!span.bot || span.bot.id === selfId) continue;
    out += `${text.slice(cursor, span.start)}[${text.slice(span.start + 1, span.end).replace(/[[\]\\]/g, "\\$&")}](${MENTION_ORIGIN}${span.bot.id})`;
    cursor = span.end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}
function mentionTarget(event) {
  const anchor = event.target instanceof Element ? event.target.closest(`a[href^="${MENTION_ORIGIN}"]`) : null;
  return anchor ? anchor.getAttribute("href").slice(MENTION_ORIGIN.length) : null;
}
function clock(ms) {
  return new Date(ms).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit" });
}
var midnight = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
var daysBefore = (date, now) => Math.round((midnight(new Date(now)) - midnight(date)) / 864e5);
function dayLabel(ms) {
  const date = new Date(ms);
  const today = /* @__PURE__ */ new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? t("Today {time}", { time: clock(ms) }) : `${date.toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric" })} ${clock(ms)}`;
}
function clockLabel(time, now = Date.now()) {
  const date = new Date(time);
  const days = daysBefore(date, now);
  const stamp = clock(time);
  if (days === 0) return t("Today {time}", { time: stamp });
  if (days === 1) return t("Yesterday {time}", { time: stamp });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${date.toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric", ...sameYear ? {} : { year: "numeric" } })} ${stamp}`;
}
function messageClock(time, now = Date.now()) {
  return daysBefore(new Date(time), now) === 0 ? clock(time) : clockLabel(time, now);
}
function elapsedLabel(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const hours = Math.floor(total / 3600);
  return `${hours > 0 ? `${hours}h ` : ""}${total >= 60 ? `${Math.floor(total / 60) % 60}m ` : ""}${total % 60}s`;
}

// src/client/icons.js
var import_react = require("react");
function ArrowUpIcon() {
  return (0, import_react.createElement)("svg", { width: 16, height: 16, viewBox: "0 0 20 20", "aria-hidden": true }, (0, import_react.createElement)("path", { d: "M10 16V4M5 9l5-5 5 5", stroke: "currentColor", strokeWidth: 1.8, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function CloseIcon() {
  return (0, import_react.createElement)("svg", { width: 16, height: 16, viewBox: "0 0 20 20", "aria-hidden": true }, (0, import_react.createElement)("path", { d: "M5 5l10 10M15 5L5 15", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }));
}
var lineIcon = (paths) => function LineIcon() {
  return (0, import_react.createElement)(
    "svg",
    { width: 15, height: 15, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    paths.map((d, index) => (0, import_react.createElement)("path", { key: index, d }))
  );
};
var SmileIcon = lineIcon(["M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M7.3 11.6a3.4 3.4 0 0 0 5.4 0", "M7.75 8.25h.01M12.25 8.25h.01"]);
var ReplyIcon = lineIcon(["M8 5L4 9l4 4", "M4 9h7.5a4.5 4.5 0 0 1 4.5 4.5V15"]);
var DotsIcon = lineIcon(["M5 10h.01M10 10h.01M15 10h.01"]);
var CheckIcon = lineIcon(["M4.5 10.5l3.5 3.5 7.5-8"]);
var GlobeIcon = lineIcon(["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M3 10h14", "M10 3c2 2.2 2.9 4.5 2.9 7S12 14.8 10 17c-2-2.2-2.9-4.5-2.9-7S8 5.2 10 3z"]);
var ArrowDownIcon = lineIcon(["M10 4v12", "M5 11l5 5 5-5"]);
var DownloadIcon = lineIcon(["M10 3.5v9", "M6.5 9.5L10 13l3.5-3.5", "M4 16h12"]);
var GaugeIcon = lineIcon(["M3.5 13.5a6.5 6.5 0 1 1 13 0", "M10 13.5l3-4", "M10 13.5h.01"]);
var PlugIcon = lineIcon(["M7 3v4M13 3v4", "M5 7h10v2.5a5 5 0 0 1-10 0z", "M10 14.5V17"]);
var CalendarIcon = lineIcon(["M5.5 5h9A1.5 1.5 0 0 1 16 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5z", "M4 8.75h12", "M7.25 3.5v3M12.75 3.5v3"]);
var ConnectorIcon = lineIcon(["M7 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z", "M18 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z", "M7 10h6"]);
var SwitchIcon = lineIcon(["M4 7h9.5M10.5 3.5L14 7l-3.5 3.5", "M16 13H6.5M9.5 9.5L6 13l3.5 3.5"]);
var SignOutIcon = lineIcon(["M8.5 17H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5", "M10 10h6.5", "M13.5 7l3 3-3 3"]);
var PaperclipIcon = lineIcon(["M15.5 9.5l-5.6 5.6a3.4 3.4 0 0 1-4.8-4.8l6.1-6.1a2.25 2.25 0 0 1 3.2 3.2l-6 6a1.1 1.1 0 0 1-1.6-1.6l5.5-5.5"]);
var ClockIcon = lineIcon(["M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M10 6.5V10l2.5 1.5"]);
var GearIcon = lineIcon(["M10 7.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z", "M7.85 4.4l.29-1.87a7.7 7.7 0 0 1 3.72 0l.29 1.87a6 6 0 0 1 1.63.94l1.76-.69a7.7 7.7 0 0 1 1.86 3.23l-1.47 1.18a6 6 0 0 1 0 1.88l1.47 1.18a7.7 7.7 0 0 1-1.86 3.23l-1.76-.69a6 6 0 0 1-1.63.94l-.29 1.87a7.7 7.7 0 0 1-3.72 0l-.29-1.87a6 6 0 0 1-1.63-.94l-1.76.69a7.7 7.7 0 0 1-1.86-3.23l1.47-1.18a6 6 0 0 1 0-1.88L2.6 7.88a7.7 7.7 0 0 1 1.86-3.23l1.76.69a6 6 0 0 1 1.63-.94z"]);
var PinIcon = lineIcon(["M12.5 3l4.5 4.5-3 1.5-2.5 2.5.5 3.5-1.5 1.5L7 13 3.5 16.5", "M7 13l-3.5-3.5L5 8l3.5.5L11 6l1.5-3"]);
var UnreadIcon = lineIcon(["M10 3.5a4.5 4.5 0 0 0-4.5 4.5v3L4 13.5h12L14.5 11V8", "M8.3 16a1.8 1.8 0 0 0 3.4 0", "M15.5 3.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z"]);
var PencilIcon = lineIcon(["M9 4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3", "M14.3 3.7a1.6 1.6 0 0 1 2.3 2.3L10.5 12l-3 .8.8-3z"]);
var InfoIcon = lineIcon(["M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M10 9.25v4", "M10 6.6h.01"]);
var StarLineIcon = lineIcon(["M10 3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.7z"]);
var CopyIcon = lineIcon(["M8.5 7h6A1.5 1.5 0 0 1 16 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 14.5v-6A1.5 1.5 0 0 1 8.5 7z", "M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4H13"]);
var HideIcon = lineIcon(["M3 3l14 14", "M8.6 5.2A7.6 7.6 0 0 1 10 5c4.5 0 7 5 7 5a12.6 12.6 0 0 1-2 2.6M12.2 14.5A6.8 6.8 0 0 1 10 15c-4.5 0-7-5-7-5a12.4 12.4 0 0 1 3-3.4", "M8.5 8.5a2 2 0 0 0 3 3"]);
var TrashIcon = lineIcon(["M3.5 5.5h13", "M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5", "M5 5.5l.7 10A1.5 1.5 0 0 0 7.2 17h5.6a1.5 1.5 0 0 0 1.5-1.5l.7-10", "M8.5 9v4.5M11.5 9v4.5"]);
var DuplicateIcon = lineIcon(["M7 7h8.5v9.5H7z", "M4.5 13V3.5H13", "M11.25 9.5v4.5M9 11.75h4.5"]);
var SlidersIcon = lineIcon(["M4 6.5h5M12.5 6.5H16M4 13.5h4M11.5 13.5H16", "M10.5 4.5v4M9.5 11.5v4"]);
var MemoryIcon = lineIcon(["M5.5 3.5h8A1.5 1.5 0 0 1 15 5v10a1.5 1.5 0 0 1-1.5 1.5h-8z", "M5.5 3.5v13", "M8.5 7.5h3.5M8.5 10.5h2.5", "M12 3.5v4l1-.8 1 .8"]);
var TerminalIcon = lineIcon(["M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4z", "M6.5 8l2.5 2.5L6.5 13", "M11 13h3.5"]);
var FolderIcon = lineIcon(["M3 6A1.5 1.5 0 0 1 4.5 4.5h3.2l1.8 2h6A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"]);
var SideIcon = lineIcon(["M4.5 4h11A1.5 1.5 0 0 1 17 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9L5.5 16v-3h-1A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4z", "M6.5 7h7", "M6.5 10h4.5"]);
var ChatsIcon = lineIcon(["M3.5 5.5A1.5 1.5 0 0 1 5 4h7a1.5 1.5 0 0 1 1.5 1.5V10A1.5 1.5 0 0 1 12 11.5H8L5 14v-2.5A1.5 1.5 0 0 1 3.5 10z", "M13.5 7.5H15A1.5 1.5 0 0 1 16.5 9v4.5A1.5 1.5 0 0 1 15 15v2l-2.5-2h-3A1.5 1.5 0 0 1 8 13.5V13"]);

// src/client/mark.js
var import_react2 = require("react");

// src/client/characters.js
var CHARACTERS = {
  whale: { label: "Whale", body: "M65.3 20.9l5.1 .1 4.8 .9 4.8 1.7 4.3 2.3 3.8 3.1 3 3.4 2.3 3.8 1.6 4.3 .9 4.3 0 4.8-.8 4.8-1.4 4.3-2.3 4.3-3.2 4.3-3.4 3.3-4.3 3.1-7.2 3.5-7.6 1.7-7.2 .1-9.6-1.6-3.3-1-2.9-1.7-8.8-8.9-6-4.7-3.3-.5-7.7 1.1-4.8-.1-4.7-1.2-1.9-1.2-1-1-.5-1.5 .4-1.4 1.1-1.3 1.9-1.3 4.7-1.5 7.7-.6 1.1-.5 .7-1 0-1.4-2.8-7.2-1.2-5.3-.1-4.3 .4-1.4 .9-1.2 1.9-.2 2 1 2.2 2.3 2.2 3.4 3.2 7.6 1.9 9.7 .5-.1 1.1-7.2 1.8-4.8 3.2-5.2 3.9-4.3 4.9-3.9 5.6-2.9 5.8-1.9z", paints: [["M93.3 55.8l1-.3 .1 1.2-2.4 5.3-3.4 4.8-3.8 3.8-4.8 3.4-5.7 2.8-4.8 1.5-4.8 .4 20.1-17.4 5.2-3.7z", "#fff", 1]], shade: "M88.6 29.5l2.4 2.9 1.9 2.8 2.4 6.3 .5 3.3 .1 5.3-1.5 6.6-1.9 4.3-2 3.3-4.8 5.4-5.7 4.3-7.2 3.3-6.2 1.5-6.7 .1-3.3-.2-9.6-1.8-3.3-1.5-2.4-1.9-8.6-8.9-5.3-3.9-3.3-.1-2.9 .2-3.3 .8-5.8 0-4.3-1-2.9-1.9 .6-.6 3.8-1.3 10.5-2.5 4.3 .9 1.4-.1 2.2-1.7 .5-1.4-.3-1.5-1.2-1.4-2.2-1.4-1.2-1.9-.6-12 .4-3.3 .5-.5 2.9 3.8 2.4 4.8 1.9 5.7 .7 5.8 .7 2.8 2.1 2.4 2.7 5.5 3.8 4.3 2.9 2.2 3.3 1 3.4-.4 6.2-3 7.1-4.5 7.3-5.6 6.6-5.9 5.9-6.5 3.7-5.3 1.7-4.2 .1-2.9z", light: "M55.6 22.8l1.9-.3 1.5 .3 .6 1 .1 .9-2 4.3-3.8 5.3-5.8 6.2-5.4 4.4-4.8 2.3-1.4 0-1.2-.5-.8-1.9 .5-3.3 2.5-4.8 3.3-4.3 2.4-2.4 5.3-3.9zM19.3 28.1l-1.4 2 .3-1.1zM21.7 49.1l.6 .5-.3 .5-.8 0zM35.8 52l1.2-.4 .9 .7 .7 1.6-.4 .9-1.2 .1-2.6-.5zM7.2 52.9l-2.9 2.9 1.2-1.6z", eyes: [[72.5, 48.4, 9.3, 23, -15.8], [85.6, 43.4, 7, 22.9, -21.2]] },
  star: { label: "Star", body: "M40.1 4.4l1.5-.4 1.9 .1 5.2 1.1 1.9 .9 13.2 14.9 17.1-.8 5.2 1.1 1.8 .9 1.7 1.6 .7 2.4-.4 1.9-9.7 23.6 5.6 23.7 .1 1.9-.6 1.4-2.1 1.8-2.3 .5-19.9-1.8-16.6 15.5-1.9 1-1.9 .3-7-1.5-2.6-2.1-.9-2.4-2.8-24.1-16-13.6-1.1-1.5-.5-1.9 .4-1.9 1.2-1.5 18.9-13.6 7.1-24.6 1-1.7z", shade: "M52 7.7l14.3 16.1 1 2.9 .3 3.1 19.4-1.3 2-1.4 .7-2.3-.4-1 .5 .5 .5 1.9-.4 1.9-9.8 23.2 5.5 23.1 .1 3.4-2 2.4-2.8 .8-19.4-2.1-1.9 1.4-14.7 14-2.4 1.4-3.3 .1-4.7-1-2-1 .6-.2 3.3 .8 2.8 .1 5.1-2.1 .7-.9 .4-2.4-2.6-22.7-.3-.3-1.4 .2-1.4 .7-5.7 .7-5.6-1.2-16.7-13.8 1-.1 5.2 1 3.8-1.1 1-.7 1.9-.4 .4-.4 1.5 .3 .4-.4 1 .2 18-12.8 6.7-23.5 0-1.8-.4-.5-.3-1.9 .4-2.4z", light: "M40.1 4.4l2-.1 4.7 1 .7 1-.5 1.4-2.8 1.5-6.6 23.1 .7 1.2 .6 .3-18.1 12.5-1.8 2.1-3.4 .7-5.2-1.2-.3-.4 .3-.9 1.4-1.4 18.3-12.9 .9-2.3 6.4-22.7 .8-1.4z", eyes: [[53.9, 53.4, 7.2, 18.8, -10], [65.1, 49.2, 7.2, 18.8, -10]] },
  moon: { label: "Moon", body: "M45.8 4.2l4.7-.2 4.2 .4 10.2 2.4 3.7 1.6 3.6 2.1 3.3 2.5 3 3.1 4.6 6.7 3.4 8.3 1.5 8.8 .1 4.6-.8 7.8-2.6 8.8-3.9 7.7-5.1 6.7-6.1 5.3-4.1 2.6-3.6 1.6-27.2 10.2-2.8 .7-2.6 0-5.7-1.3-2-.8-1.9-1.7-1.1-2.6-6.5-37.7-.2-5.2 .8-7.7 1.3-5.2 3.1-7.8 4.2-6.7 3-3.6 3.9-3.6 6.3-4.2 4.1-1.8z", paints: [["M57.6 9.9l.2-.3 .2 .3 2 4.7 1.9 1.9 2.6 .5 1.5-.7 1.1-1.1 .4 .4-.1 1.6-.7 1.5-2.2 2.5-1.6 .7-2 0-1.6-.8-1.3-1.4-.8-2-.4-2.6 .1-3.1z", "#1783FF", 1]], shade: "M74.3 13.5l2.1 1.5 .3-.4-.3-.6 2.1 2.1 4.6 6.7 3.1 7.4 1.5 7.6 .1 10.4-.6 4.6-2.5 8.3-4.2 8.2-3.1 4.2-5.7 5.7-6.2 4.2-4.6 2-28 10.3-4.1 0-5.2-1.1-2-.9-.5-.7 .5 .5 1.5 0 3.6 1 2.6-.3 5.7-2.1 2.1-2.1-5.4-31.5-.2-4.1 .4-1.1-.1-2.6 .5-3.6 1.8-7.7 2.8-6.7 1.9-3.1 3.9-5.2 3.2-3.1 2.5-2 5.2-2.9 3.1-1.1 3.1-.8 2.1 0 .5-.4 2.6 .2 1-.3 1.6 .4 1-.5 2.1 .8 1-.8 2.1 1.2z", light: "M38 6.3l1.7-.3 2.5 .2 .6 .4 1.5 0 .5 .5 1.6 .3-3.1 1.3 .4 .7-2.5 1.6-.5 1-2.5 2.1-2.7 2.9-6.2 7.9-1.5 2.7-1 .9-1.2 2.6-1.4 1-1.3 3.7-1.3 .3-6-1.4-1 3.6-.8 0 .9-3.6-.5-1 1.1-3.6 2.7-5.7 4.1-6.2 5.7-5.8 3.1-2.4 3.6-2.2z", eyes: [[51.6, 48.5, 8.4, 22.1, -10], [66.8, 42.9, 8.4, 22.1, -10]] },
  wave: { label: "Wave", body: "M46.1 4l6.1 .3 9.6 2.1 4.5 1.8 4.1 2.4 3.5 2.8 4.4 4.8 2.6 4 2.1 4.1 2.2 6 4.8 26 .5 5.3-.3 4.1-1.2 3.8-1.5 2.8-2.4 2.5-2.1 1.4-3.1 1-3 .3-8.1-1.5-3.2 5.3-2.1 2.1-2.5 1.5-2.8 1-3 .4-9.1-1.6-2.7 4.2-3.4 3.1-4 1.7-4.6 .1-7-1.5-3.5-1.9-3.4-3.5-2.1-4-1.5-5.6-3.7-20.7-.6-5.6-.1-5 .5-6.1 2.3-9.6 2.3-5.5 2.7-4.9 2.7-3.7 3.2-3.6 4.2-3.6 4.7-2.9 4.4-2 4-1.2z", paints: [["M61.6 48.5l2.2-.3 2 1.1 1.1 2.2 .3 3-.6 3.1-1.5 3.5-2.5 4.1-2.4 2.8-5-2.2-3-2.2-2.3-3-.7-3.5 .6-2.6 1.8-2.1 1.6-.7 1.5 0 1.5 .6 1.5 1.3 2-3.6z", "#fff", 0.4]], shade: "M69.3 13.6l2.6 1.3 .5-.3 .5-1.3 2 1.7 .5 0 2.5 2.7 3.5 5.5 3.6 8.6 1.5 6.6 3.5 19.7 .5 5.5-.4 4.6-2 5-1 1.6-2.6 2.5-3 1.5-2.1 .5-4 0-6.6-1.4-1.4 2.9-1.9 2.5-2.7 2.6-3.1 1.5-2.5 .6-4 .1-7.1-1.5-1.5 2.8-2.6 3-2 1.6-3 1.4-4.5 .6-7.1-1.5-3.6-1.5-3.5-3.1 6.6 1.5 2.8-.5 .5-.5-.3-.5 3.2-2-.4-1 1.4-1.5-.3-1 .7-1.6-.2-2.5-3.4-19.2 .3-.5-.6-5 .5-.5-.1-4.6 .4-.5 .3-4 1-4.1 1.5-4.5 3.8-7.7 5.5-6.9 3.1-2.6 6.5-3.9 7.6-2.2 3.1 0 .5-.4 3 .5 1-.5 2.5 1z", light: "M36.5 6.1l2-.3 .5 .6 4.1 .5 1 .7-3.3 1.5-.3 1.2-3 2-.3 .8-2.8 2.6-3.5 4-3.9 5-2 3.6-1 .5-1.7 4-1.5 .5-1.4 4.6-1.6 .2-.5-.4-5.6-.9-.4-.4 1.4-5.1 1.5-3.5 2.6-5.1 4-5.5 6.6-6.2 4-2.5z", eyes: [[47.5, 37.2, 8.4, 22.1, -10], [61.6, 31.9, 8.4, 22.1, -10]] },
  squircle: { label: "Squircle", body: "M54.5 4.2l3.9-.2 3.7 .3 11.6 2.7 3.1 1.6 2.8 1.9 2.6 2.7 2.2 3.1 2.4 4.8 1.9 5.8 3.7 19.4 .8 11.1-.4 4.7-1 4.7-1.3 3.5-1.8 3.4-4.8 5.8-6.4 4.7-8 4-14.2 5.3-9.5 2.2-7.4 .1-10.5-2.2-5.3-2.5-4.3-3.7-3.3-4.8-2.7-6.3-2.4-9.5-2.8-17.9-.2-7.8 1.3-7.9 2.2-5.3 2.8-4.2 4.1-4.2 4.3-3.1 6.3-3.4 11.6-4.6 7.9-2.7z", shade: "M80.5 11.6l2.1 2.1 2.1 3.2 3.2 7.3 2.1 8.4 2.7 15.8 .5 7.9-.6 7.4-2 6.3-3.8 6.3-4.2 4.3-2.6 2-6.9 3.8-15.2 6.2-9.5 2.7-6.8 .6-6.2-.7-8.5-2-5.8-3.2-3.2-3.3 .5 .4 1.1-.2 5.8 1.4 2.1-.8 1.4-.7-.3-.5 1.4-1.1-.1-1 .8-.5 0-1.1 1.1-1 .1-2.1 .4-.6-.2-3.6-2.4-17.9-.2-9.5 .8-5.3 1.1-3.6 1.2-2.7 2.2-3.5 2.7-2.8 3.1-2.5 5.8-3.2 17.9-6.9 5.3-1.4 8.4-1.4 1.6-1.1 .5 .1 .9-1.5z", light: "M39.4 8.4l1.2 0-1.6 .7-1-.1 1-.1zM36.8 9.5l1 0 .6 .9 4.2 .6 .7 .6-3.8-.4-.3 .4 1.9 .3 .1 .7-3.2 1.6-6.9 5.8-5.3 6-4.7 6.1-3.8 3.7-.2 .5-1.8 .1-6.8-1.7 .4-3.6 2.1-4.2 2.2-3.2 4.2-4.3 4.2-3 3.1-1.8 5.3-2.5zM35.1 10.5l1.7 0-.5 .4zM36.5 11.1l.3-.5 2.2 .1 .4 .4-.4 .3z", eyes: [[52.6, 52.4, 8.4, 22.1, -10], [67.3, 46.9, 8.4, 22.1, -10]] },
  zed: { label: "Bull", body: "M77 4.4l1.1-.4 1.1 .2 1.2 1.3 2 9.8 2.2 5.9 .4 2.8-.3 2.1-.8 1.7-4.7 5.1-1.3 1.9-.4 1.7 .1 1.6 1 1.7 4.4 .2 3.8 1.3 2 1.7 .6 1.6-.3 1.7-.7 1.1-3.5 2.7 1.7 6 .4 5.9-.8 6.6-1.9 6-3.4 5.9-4.4 5.3-5.5 4.4-6 3.1-6.5 2-7.1 .7-6.5-.7-6.5-2.1-6-3.4-4.8-4.4-3.5-4.9-3.1-6.7-3.3 1.1-2.7 .3-2-.6-1.1-1.1-.3-2.2 .9-2.7 2.9-3.8 4.6-3.8 1.8-7.1-6.3-1.8-1.6-1.3-1.3-1.8-.6-2.7 0-6.6-1.4-8.7 .2-1.1 1.5-1.4 1.1-.1 1 .5 5.5 7.9 2.2 2.2 2.7 1.4 4.9 .4 .5-.1 6.5-5.1 6.6-3.2 6-1.6 8.7-.7 3.8-.9 2.7-1.5 3.9-3.2 3-3.8 2.4-4.9 2.1-10z", paints: [["M61 36.5l1.9 .7 1.4 2-.7 5.4 .3 .4 2.8-1.2 1.1 0 1 .9 .5 1.6-.5 .8-1 .5-7.1 2.4-1.1-.5-.9-1.6 1.4-5.4-.5-.6-3.3 1.1-1.1-.1-1.6-1-1-1.6 .5-.9z", "#fff", 1]], shade: "M80.2 5.5l.6 1.6 1.3 8.2 2.5 6 .2 3.7-.1 1.1-1.2 2.2-5.2 5.4-1.1 3.3 .9 2.7 3.8 3.9 1.6 .1 4.4-1.4 1.2 1.2 .1 1.1-.2 1.7-.6 1.1-3.6 2.7 .9 2.2 1.1 5.4 .1 6-1.1 6.5-2.3 6-3.8 6-6 6-4.9 3.3-5.9 2.6-7.1 1.7-7.1 .1-6-1.1-5.9-2.3-4.4-2.7-4.4-4.5 3.8 .4 5.5-1.5 7.6-3.9 6.8-4.7 7.9-6.5 7.1-6.9 5.4-6.5 4.4-6.7 1.8-4.4 .4-3.2-.3-1.1-3.3-3.8-.8-2.8 .8-2.7 6.2-7 .8-2.2-.1-2.7-1.7-4.4-.8-8.2zM14.9 29.9l.1-.5 4 6.5 2.3 2.7-1.4 .1-2-.6-3.6-7.1zM24.3 44.6l1-.3 1.1 .2 3.3 2.9 1.7 .5 .3 1.6-.5 2.2-1 1.6-1.6 1.5-1.6 .7-1.7 .1-3.2-2.2-2.2 0-2.7-.6-2.9-1.6 3.9-1.6 2.2-1.7 2.2-2.3zM21 68.6l.5-.5 1.1 .1 1.1 .5 .8 1 .6 2.7-.1 1.1-.7 1.1-.6 .1-2.2-1.2-2.7 1.1-3.8 .6-2.7-1.2 3.4-1.6z", light: "M77 4.4l.6-.2 .1 .7-1.2 .8-.1-.8zM74.2 15.8l.6 1.1 .1 2.7-.6 2.2-1 1.6-5.5 5-1.7 .7-3.3 .3 .1-.6 2.1-1.2 4.2-3.6 2.7-3.9zM11.7 28.9l.8 0-.1 .5-1.2 .8-.1-.8zM44.3 32.1l3.1 0 .8 1.1 0 1.1-1.9 4.3-3 4.1-1.7-1.1-2.1-.8-4.4-.6-4.4 .1 5.5-4.4zM22 54.4l.6 0-.3 .6 .2 .5 2.3 2.7 .4 1.7-1 .9-4.8 2.3-7.1 7.8 0-1.8 2.1-3.3 6.4-5.4 1.2-4.3z", eyes: [[61.8, 69, 9.5, 22.3, -10.5], [78.4, 62.7, 6.9, 22.2, -11.2]] },
  hex: { label: "Blossom", body: "M38.8 4.2l2.6-.1 6 1.3 2 1.3 3 3.3 12-4.5 2-.5 6.5 1.1 2.9 1.6 4.9 6 .8 2 .3 2-.2 2.5-1.9 7-1.3 2.2-1.9 1.8 2.9 1.3 1.8 1.7 10.1 12.5 1.5 3 .1 4-1.8 7-.9 2-2.8 2.7-7.1 2.7-5.2 20-.8 2-1.4 1.9-1.5 1.1-6.5 2.6-3 .2-6.5-1.6-2-1.4-4-4.9-16 5.7-2 .1-4.5-1-3-1.2-5.2-6-1.3-3 0-3.5 2-8.5-10.8-13.4-1.4-3-.3-2 .3-2.5 1.7-6.5 1.8-3 2.2-1.8 5.9-2.2 2.1-.4 2.5 .3 .4-.4-.7-2.5 .1-2.5 4.8-18.5 1-2.5 2.9-2.9z", shade: "M49.7 7.7l.2-.4 .5 .4 2 2.3 0 .7 1.6 1.5 1 2 .1 1.5-.3 .5 .6 1.3 17.5-6.5 2.5-1.3 1-1.5 4.5 6 .6 1.5 .3 3-1.9 8-1 2-3 3-.3 1 .4 .5-1.7 3 .1 .5-.5 .5 0 .7 5.5-2.2 1.5-1.5 2 2 8 10 1 1.5 1 2.5-.1 4-1.9 7-1.1 1.9-2.9 2.5-6.8 2.5-4.7 19-1.5 3.5-2.5 2.5-6.5 2.6-4 0-5.5-1.4-2.2-1.7-3.2-4 4.9 .8 2.5-1.4 1.5-2.6 .7-2.3 1.7-6.5-.4-.3-.6 .8-.7 3.5-1.1 1.5 .3 .5-.3 .5-.7-.5-1.4-5.5-.5 1-.2 2-.9 1-.1 1.5-1.1 2-2.7 2.8-1 .4-1 .1-15.5 5.8-3-.1-4.5-1-2-1-2-2-2.2-3 .2-.2 4 .9 2-1.1 1.7-1.6 1.3-3.2 1.7-6.3 1.1-2.5-.3-.3-.5 .2-6.5-.3-.5-.5-2 0-.5-.5-1.7-.1-10.4-13.4 4.1 .7 3.1-1.7 1.3-2 2.5-8.5 .9-1.5 1.7-1.3 6.5-2.7 2-1.5-.3-.5 .3-.5 1.5-1.2 1.5-3 5.6-20.3 1.9-2 6-2.4 1.1-.6zM73.2 31.2l1.5 0-.8 1-34 12.7-1 .1-1.5-.5-2 .8-1.9-2.6 .4-.9 2 .5 1.5 1 .5-.4 1 .5 1-.3 1 .4 3-1.5 1 .1 3-1.6 1 .1 3-1.6 1 .1 3-1.6 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 1 0zM61.3 74.6l.1-.2 .4 .2-.4 1.7z", light: "M33.4 6.2l3 .1 1.9 .9-.1 .5-1.8 2.5-3.4 3.5-4.5 17-3.6-.9-1 .4 0-1 4.4-16.5 0-1.5 2.1-3.1zM68.2 6.2l1.2 0zM14.9 37.7l3.5 .9 .4 .6-.3 1-5 5.5-1.1 4.6-2.5-.5-2 .1 0-1.7 1-4.5 1-2.5 2-2.1zM19.4 71.6l4 .7 1.8 .8-1.2 1-1.1 5.1-4.5-.5-.5-.6 1.4-5z", eyes: [[49.8, 55.5, 6.7, 17.7, -10], [61.6, 51.1, 6.7, 17.7, -10]] },
  gumdrop: { body: "M38.7 4.5l4.4-.5 4.6 .8 4.1 1.9 3.7 3.2 23.2 36.6 2.3 5 1.4 5.1 .7 6.4-.7 6.4-1.8 6.1-3.1 5.7-4.1 5.1-5.2 4.2-5.8 3.1-6 1.8-6.4 .6-6.4-.6-6-1.8-5.9-3.1-5.1-4.2-4.1-5.1-3-5.4-1.9-6.4-.7-6 .5-5.9 9-41.6 2-4.1 2.6-3.2 3.4-2.5z", shade: "M54.9 9.5l1.9 2.3 22.9 36.5 1.8 4.6 .9 3.7 .6 4.1-.1 5.9-1.4 6.4-2.3 5.5-3.7 5.4-4.1 4.2-4.5 3.3-7.3 3.2-6.4 1.2-6.4 0-5.1-.9-5.9-2.1-5.5-3.3-4.6-4.1 .5-.3 4.1 .8 5.5-1 6.4-2.6 7.3-4.5 7.2-5.7 6.5-6.4 5.5-6.9 3.5-5.9-18.1-37 1.1-3.7 .2-2.3z", light: "M37.1 4.9l2.5 0 .8 1.4-.5 2.1-1.8 2.9-3.2 3.2-3.2 2.1-2.3 .7-1.8-.1-.7-.9 .1-1.8 2.4-4.1 2.7-2.8z", eyes: [[52.1, 40.3, 9.7, 22.9, -15.2], [64.8, 35.6, 6.3, 23, -27]] },
  peanut: { body: "M43.5 4l6.6 .7 5.8 2.2 5.4 3.8 4.1 4.7 2 3.8 1.4 4.3 1.3 11.9 1 4.3 1.6 3.8 5.8 10.5 1.4 3.8 .8 4.3 .1 6.2-1 5.7-2.1 5.5-3.2 4.9-4.1 4.3-4.8 3.4-5.6 2.4-5.7 1.3-6.1 .1-5.8-1.1-5.7-2.2-4.7-3.1-4.3-4.1-3.3-4.8-2.5-5.7-1.2-5.7-.1-6.7 1.7-9 .4-4.3-.5-4.7-2.5-9.6-.6-3.8 .2-5.2 1.2-5.2 1.5-3.4 2.2-3.3 2.5-2.9 2.8-2.3 3.4-2.1 3.4-1.4 3.8-.9z", shade: "M62.7 12.6l2.6 2.8 2.8 5.8 1.1 4.2 1 11.9 1 3.4 2.3 4.7 4.2 6.7 1.9 4.7 .9 3.8 .2 2.9-.1 6.2-.5 3.3-1.9 5.3-3.4 5.7-3.4 3.8-4.2 3.3-5.7 2.9-4.8 1.4-5.7 .6-6.2-.6-3.8-1-5.2-2.3-4.8-3.4-2.9-2.8 3.9 .8 5.2-.7 6.2-2.5 5.7-3.3 6.7-5.1 6.2-5.9 5.1-6.2 3.5-5.7-1.1-2.8-2.4-2.4-3.2-1.7-11.5-4.1-2.7-1.8-1.6-2.4-.2-2.4 .8-2.9 7.8-8 4.9-7.7 1.6-5.2z", light: "M35.9 5.4l3.2-.2 1.3 .7 .5 1-.5 3.3-2.9 4.8-4.1 4.1-4.8 3.3-4.2 1.5-1.5 0-1.4-.6-.7-1.2 .2-2.4 1.9-3.8 2.4-3.3 4.3-3.9z", eyes: [[50.9, 31.5, 8.7, 20.5, -11.9], [64.2, 26.5, 5.7, 20.3, -16.3]] },
  saucer: { body: "M45 22.7l6.7 .1 6.7 1.9 4.3 2.5 3.5 3.1 2.8 3.5 2.5 4.5 6.8 .9 5.6 1.2 4.5 1.6 3.5 2.1 2.8 2.8 1.3 3.5-.5 3.5-2 3.5-2.6 2.8-3.5 2.8-4.5 2.8-5.1 2.6-12 4.4-13.6 3.1-13.6 1.5-12.6-.3-5.5-.7-5-1.2-4.1-1.6-3.5-2-2.8-3.1-1.1-3 .5-3.5 2-3.6 2.7-3 3.7-2.9 10.3-5.6 .7-5.1 1.5-4.5 2.6-4.5 3.1-3.5 3-2.4 3.5-2 3.5-1.4z", shade: "M66.5 31.3l.3-.2 .6 .7 1.9 2.5 2 4.5 1.6 1.5 .1 1.5-1.7 1.7-3 1.2-3.1 .5-3.1-.3 4-8.1 .7-3.5zM94.9 47.4l1.1 3-.5 3.5-2.1 3.5-4 4.1-5 3.5-6.1 3.1-7 2.9-6.6 2.1-8 2-9.1 1.5-6.5 .6-11.6 0-4.5-.2-8-1.4-4.6-1.5-3.6-2.1 4.1 1.2 5.1 .8 7 .3 6-.2 15.1-1.9 15.6-3.6 14.5-5.1 5.4-2.5 5.3-3.1 4-3 2.3-2.5 1.2-2.1zM7.3 71l.7 .5z", light: "M40.6 23.7l2.8 0 .8 .5 .7 1.5-.8 3.6-2.6 4-3.9 4-4.5 3.2-4.6 1.7-2.5-.4-1-1.4 0-1.6 .9-2.5 2.1-3.5 2.6-3 3-2.6 3.5-2.1zM22.4 47.4l.7 0-.5 .5 0 1.5 .4 .8 2 1.4 3 1.2 9.1 2 15.1 1.1-.2 1.5-2.2 3.6-3 2.5-4.9 2.5-6 2-7.9 1.5-6.5 .5-7.1-.4-4.9-1.1-3-1.5-1.6-1.7-.6-2.3 1.1-3.1 2.9-3.5 4.1-3.5 4.1-2.6z", eyes: [[53.6, 45, 7.8, 18.4, -14.5], [66.2, 40.3, 5, 18.3, -25.1]] },
  bunny: { body: "M49.3 4.4l1.5-.4 2 1.2 1.6 2.7 1.2 3.4 1.6 8.9 .2 6-.2 6.4 .6 3 2.4 2.5 5.4 3 3.4 2.4 5.1 5.5 2.4 3.9 1.7 4 1.1 4.4 .4 4.5-.5 5.9-1.6 5.5-2.8 5.4-3.6 4.5-4.6 3.8-4.9 2.7-5.5 1.7-5.9 .7-6-.5-5.4-1.7-4.9-2.5-4.7-3.7-3.8-4.5-2.7-4.9-1.8-5.5-.7-5.9 .6-6.5 1.9-5.9 3.1-5.4 4.6-5.5-.4-2-3.4-8.4-1.8-6.9-.6-6.9 .3-3 .6-2 1.3-1.4 2-.1 2.5 1.5 2.1 2.5 4 6.9 2.1 5.5 1.7 5.9 1.5 2.1 1.8-1.6 .7-2-.4-12.4 1-8.9 1.6-4.9z", shade: "M52.7 5.4l2.1 3.5 1.9 7.4 .7 7.9-.5 8.4 .8 3.6-4.4-2.5-2.1-2.6 1.4-17.3zM31.2 15.3l.3-.5 2 2.5 2.9 4.9 2.5 6 1.7 6.4 1.4 2.5 0 .5-1.1 .9-4.5 1.9-2.4 .2-1.2-.6zM71.5 46l3.6 4.4 2.9 6 1.5 6.4 .1 5.5-1.1 6.3-2 5-3.4 5.4-3.5 3.6-4 2.9-6.4 3-4 1-6.9 .5-5.9-1-5.5-2-5.4-3.5-3.6-3.4 2.6 .7 2.5 .1 2.9-.5 4-1.3 8.4-4.6 8.7-6.8 7.4-7.9 5.3-7.9 1.3-3 1-3.5 .2-2.9-.2-2z", light: "M49.3 4.4l.6 0-3.6 6.2 1-3.7zM26 13.3l.5-.4 .2 .4-1.7 2.2 0-.7zM44.8 34.6l.5-.1 1.2 1.1 .8 1 0 .7-.5 .3-4-.5zM45.1 42.5l.8 0-.3 1-2.4 4.5-3.8 4.4-4.1 3.5-3.8 2.4-4 1.6-2.9 .1-1.8-1.1-.4-2.5 1.1-3.5 3.5-5.4 3-3.1 .2 1.6 .8 .8 3 .1 4.4-1.2z", eyes: [[59.2, 69.2, 8.2, 19.3, -12], [72.9, 64, 5.6, 19.1, -15.4]] },
  kitty: { body: "M62.4 4.2l1.6-.1 1.5 1.2 7.4 21.3 3.7 6.4 6.2 7.4 3.1 5.9 1.5 4.8 .7 5.3-.2 5.4-1.1 5.3-3 7.4-4.4 6.4-5.3 5.4-6.9 4.6-7.5 3.1-8 1.7-8 .2-7.4-1.4-4.3-1.5-3.7-1.8-3.8-2.5-3.1-2.7-2.7-3-2.5-3.7-1.9-3.7-1.4-4.3-.9-5.3 .1-5.8 1.4-7 1.6-4.2 2-3.8 .8-3.2 .2-20.2 1.1-1.4 1.1-.3 1.1 .3 12.2 9.7 5.9-2.5 8-2.1 3.2-1.8 2.3-2.4 8.3-16z", shade: "M64.9 5.8l.1-.3 .7 .3 6.5 19.7 3.1 5.9 2.5 3.2-1.6-.8-2.6-2.4-5.1-8zM79.4 36.7l2.2 2.1 1.6 2.2 3.3 6.9 1.5 6.9-.1 6.4-1.6 7.5-3.1 6.9-3.8 5.3-5.3 5.4-6.4 4.3-7 3.1-6.3 1.6-4.3 .6-5.3 0-7.5-1.1-5.8-2-5.9-3.3-5.9-5.4 2.7 .7 3.2-.1 3.7-.8 5.2-1.9 10.3-5.5 11-7.8 10.7-9.6 7.8-9.1 3-4.6 1.6-3.4 .7-3.2z", light: "M62.4 4.2l.5-.1 0 .6-.8 1.1-4.5 14.4 .2 2.7-.3 1.6-1.1 1-2 .6-6.9-.5 2.6-1.3 3.1-3 8.1-16zM18.7 20.7l1.1-.5 0 .8-1.1 .9-.6-.1zM39.5 27.7l2.6-.3 1.9 .8 .4 1.6-.7 1.8-4.2-1.5-5.4 .2 0-.5zM16 47.4l.3 4.2 1.6 2.2 3 2.1-.6 .5-3.7 .6-1.1-.3-1.1-1.1-.4-1.8 .4-2.7z", eyes: [[59.6, 65.1, 9.4, 22.6, -11.9], [77.5, 58.4, 7, 22.5, -14]] },
  beacon: { body: "M40 4.1l2.7 0 2.5 .9 2 1.7 1.1 2.1 .5 2-.2 2.1-2.1 4.1-.4 1.6 1.5 7.7 9-3.1 4.1-.2 18.5 4 3.1 1.6 2.4 2.3 1.3 2.1 .9 2.6 5.8 33.4-.4 3.1-1.3 3.1-2 2.5-2.6 1.9-41.7 15.7-4.1 .7-19.6-4-3.5-1.9-2.5-2.5-1.2-2.1-.8-2.6-5.7-32.9 .4-3.1 1-2.7 1.7-2.5 2.4-1.9 28.4-10.9-1.5-9.3-.7-1-3.5-3.3-.9-1.9-.4-2 .5-2.6 1.1-2.1 1.7-1.5z", shade: "M47.1 7.2l.4 0 .8 1.6 .3 2-.2 2.6-2.5 4.7 1.5 8.2 0 2 .5 .6 .1 1.5 .5 1-1.2 .4-1.3-.4-.3-.5-1.9-10.3-4.1-1.5-3.2-2.6 3.1-.9 3.2-2.2 2.5-2.6zM84.2 30.9l1.2 1.1 1.5 3.6 5.7 32.4 0 2.6-1 3.6-1 1.5-3.1 3.2-4.2 1.9-40.6 15-4.2 0-16.4-3.6-3.6-1.4-2.6-2.2 .5 .4 17.5 3.4 3.8-1.2 5-3.4 1-1.3-5.4-30.3 .2-.6 3.1-3.4 40.2-15.1 2-3.6z", light: "M38.5 4.7l2 0-.1 1-.8 1.4-2.6 2.2-1 .4-1.1-.1-.1-.8 .7-1.6 1.5-1.6zM55 23.7l1.1 .1-1.6 .6-.9-.2 .9 0zM52.4 24.7l1 0-3 1.2-.9-.1 2.4-.6zM48.3 26.3l1 0-1.5 .6zM40 29.4l1.1 0-3.1 1.2-.9-.2 2.5-.5zM35.9 30.9l1 0-3 1.2-.9-.1 2.5-.6zM31.8 32.5l1 0-3 1.2-.9-.2 2.4-.5zM40.2 33l.4-.4 1-.1 1.6 .8 3 .7-1.5 .5-4.1 0-.9-1zM27.7 34l1 0-3 1.2-1-.2 2.5-.5zM23.6 35.6l1 0-3 1.1-1-.1 2.5-.5zM19.4 37.1l1 0-2.4 .8-.5 .7 15.4 3.3 .5 .3 .3 1.1-1.1 2.6-3.3 3.3-3.1 1.5-17.5-3.6-.6-1.2 .5-1.6 3.2-3.7 2.1-1.4 2.5-1.1 1 0 .6-.5 1 0z", eyes: [[55.5, 65.3, 8.4, 22.1, -10], [74.2, 58.3, 8.4, 22.1, -10]] },
  plus: { body: "M44.6 4.3l3.3-.1 11.9 2.5 2.5 1.3 1.3 1.4 .7 1.6 2.1 11.4 4.1-1.2 2.1 0 12.3 2.6 2.8 1.6 1.2 1.5 .7 1.5 3.8 21.6-.5 3.1-1 1.5-1.3 1.3-17 6.6 3.4 20.4-.4 2.5-1.2 2.1-2.3 1.6-19 6.9-2-.2-11.9-2.5-2.5-1.3-1.3-1.4-.7-1.6-2.1-11.4-4.1 1.2-2.1 0-12.3-2.6-2.8-1.6-1.2-1.5-.7-1.5-3.8-21.6 .5-3.1 1-1.5 1.3-1.3 17-6.6-3.4-20.4 .2-2 1.1-2.2 2.6-2z", shade: "M63.2 9.4l.7 .6 .5 1.5 2.1 13.3 .6 .6 0 2.5 .5 .5 .1 2.6 .5 .5 .1 2.1-.8 3.1 19-7.1 1-1.2 1-2.1 1.1 2.1 .4 2.6 3.2 18 0 3.1-1 2-2.2 2.1-15.9 5.8-.8 .8 3.6 19.5-.1 2.6-1.5 2.6-2.2 1.6-16.4 6.1-2.1 .6-2.5 0-12.4-2.7-2.2-1.5 12.5 2.5 2.4-1 2.7-2-3.9-22.1-3.8 3.5-1 .4-2.6 .5-1.5 1-2.6 .5-1.5 1-2.6 .4-1.5 1-4.6 1.5-2.5 0-11.9-2.6-2.7-1.6 12.4 2.3 2.6-.9 2.4-1.9-3.4-20.5 .3-.5 1.7-1.8 18.6-6.9 .3-.6-.7-1-3.8-22.1 2.1-2.1 16.4-6.1 .6-.5z", light: "M28.4 10.5l1.1 .5 10.2 2.1 .5 .4-.1 1.1-1.9 2.3-2.1 1-12.3-2.5-.1-1.3 1-1.6 1.2-1zM11.4 43.3l11.4 2.2 1 .6 0 .8-1.5 2.3-2.6 1.4-12.3-2.6-.2-1.1 .6-1 2.2-2.1z", eyes: [[54.5, 53.1, 6.1, 15.9, -10], [64.5, 49.4, 6.1, 15.9, -10]] },
  magnet: { body: "M71.9 4.2l1.2-.2 12.1 2.6 .5 .3 .6 1 6.2 35.6 .6 5.8-.1 5.7-.7 5.8-1.5 5.7-2.2 5.8-4.2 7.3-5.5 6.5-6.5 5-7.1 3.4-6.3 1.3-6.3 0-15.2-3.1-5.2-1.8-5.2-3-4.6-4.1-4-5.2-2.9-5.8-2.4-7.8-6.4-36.2 25-9.5 13.1 2.9 .5 .9 6.3 35.3 1.8-3.9 .5-4.7-6.3-36.1 .4-.6z", shade: "M86.2 9.5l.5 1 5.8 33 .6 4.7 0 5.2-.6 5.8-2.1 8.4-3.1 7.3-3.7 5.8-6.3 6.8-5.7 4.1-5.8 2.7-6.8 1.5-6.3 0-15.2-3.1-5.7-2-5.2-3.2-5.9-5.8 .1-.7 11.5 2.5 .3-3.4-1.9-13.6-5.7-32.4 1-.1 18.3-6.9 .9-.9 .4-1 6.1 35 1.6 2.1 .1 .6 4 4.7 3.2 1.1 3.6-.6 3.2-1.9 2.4-2.8 1.9-4.2 .6-3.7-6.4-36.6 19.3-7.1 .8-.8z", light: "M53.6 54.5l.7-.4 12 2.8 .6 1.8-.6 2.1-2.1 2.4-2.6 1-1.5 0-6.3-1.4-1.6-2.6-.2-2.1z", eyes: [[59.6, 82.1, 6.1, 15.9, -10], [72, 77.5, 6.1, 15.9, -10]] },
  acorn: { body: "M47.6 4l2.1 .6 1.3 1.5 .4 1.5-.4 5.2 .3 .3 8.8-.1 7.7 1 7.3 2.1 5.7 2.9 3.6 2.9 2.6 3 1.8 3.4 .9 3.7 0 4.1-1 3.6-1.7 2.2-3.9 3 2.9 8.3 .9 8.3-.9 8.3-2.7 7.7-4.2 6.8-2.9 3.1-3.2 2.6-6.7 3.8-3.7 1.2-4.1 .8-7.2 0-7.3-1.7-7-3.6-5.9-5.1-4.8-6.3-3.3-7.3-1.8-7.7-.1-8.3-4.5-1.5-2.6-1.7-2.6-4.1-1.1-4.1 0-4.2 1.2-4.1 2.2-4.1 2.8-3.7 5.2-4.6 6.3-3.8 7.2-3.2 8.3-2.3 .9-8.3 1.2-1.4z", shade: "M50.6 6.1l.1-.5 .6 2-.6 5.7 .2 2.1-1.2 .2-1.2-.7 .5-6.8zM85.8 23.7l1.7 2 1.6 3.7 .6 2.6-.1 4.1-.5 2.6-1.1 2.1-2.1 2-2.9 2.1 1.4 3.1 1.6 5.2 .9 8.8-.5 5.7-1.4 5.7-2.2 5.1-2.6 4.2-5.1 5.7-5.2 3.6-4.7 2.2-6.2 1.5-7.7 .1-5.7-1.2-6.8-3-4.6-3.2-4.2-4.2 2.1 1 2.1 .3 3.1-.3 3.1-.9 6.4-3.1 6.5-4.6 6.6-5.8 5.9-6.4 5.6-7.9 4-7.4-2.4 .4-.5 .5-1.1 0-.5 .5-1 0-.5 .5-1.1 0-.5 .5-1 0-.5 .6-1.6-.1-.5 .5-1.6 0-.5 .5-3.6 .5-.5 .5-2.1-.1-.5 .6-2.1-.1-.5 .7-3.1-.2-.5 .5-3.1 0-.5 .7-4.7-.2-.5 .7-15.6-.3 0-.3 8.3-.6 11.4-2.4 11.4-3.8 10.5-4.8 9.2-5.7 6-5.2 2.2-2.6 1.6-2.9 .5-1.7z", light: "M46 4.5l1.1-.1 0 .6-1.5 1.6-1.1 .2-.1-.7zM38.5 15.9l5 0 3.3 1.6 1.6 3.1 .1 3.1-.9 3.1-1.9 3.1-3.2 3.6-4 3.1-3.6 2.1-8.5 3.2-4.1 .7-4.2 .1-3.1-.5-2.6-1.5-1.1-2 .1-2.1 .5-1.5 2.1-3.7 4.1-4.6 3.7-3.1 5.1-3.2 6.3-3z", eyes: [[63.6, 63.3, 9.6, 22.7, -11.9], [79.5, 57.3, 6.5, 22.5, -15.5]] },
  pebbles: { body: "M47.3 4.5l2.7-.4 2.7 .1 13.7 3 4.3 2.1 3.3 3.4 1.3 2.2 1 2.8 2 12-.5 4.3-3.1 7.7 .2 .5 8.4 1.9 2.7 1 3.3 2.1 2.7 2.8 2.4 4.3 1.4 6.5 .1 4.4-.8 3.8-1.3 2.7-2 2.8-2.4 2.2-2.7 1.6-45.5 17-3.3 .6-3.2-.2-19.2-4.2-4.9-2.8-3.4-3.8-1.9-4.4-1.3-7.7 .2-3.2 .8-2.8 1.3-2.7 2-2.7 3.2-2.8 7.9-3.8 2.5-2.2-.4-1.6-5.4-6.1-1.8-3.8-2.3-12.5 .2-3.3 .7-2.7 2.6-4.4 2.2-2 2.2-1.4z", shade: "M73.2 12.2l.4 0 1.5 2.2 1.2 3.3 1.8 11.4-.2 4.4-3.3 7.6 0 1.1 .6 1.1-1.2 1.3-26.8 10.1-3.2 .5-5.8-.4-15.2-3.3-1.4-.5-3.5-3.8 .2-.3 1.6 .2 10.9 2.2 2.8-.5 4.4-2.2 5-3.8 .1-.6-1.5-8.7 4-4.5 24.2-9.2 2.4-3.8zM90.9 48.8l2.8 3.8 1 2.8 1.2 6 0 4.3-1.1 3.9-1.7 3.2-3.8 3.9-2.7 1.7-42.1 15.8-5.5 1.6-3.8 0-18-3.8-4.9-2.1-3.4-2.9 17.6 3.8 2.7-.2 3.3-1.2 4.3-2.6 4.4-3.6-.4-3.8 4.4-4.9 42.5-16 2.1-3.1 1.1-2.8 .5-3.3z", light: "M45.6 5.1l1.5 0-.4 .2-22.9 8.5 11.4 2.5 .6 .8 0 1.6-1.5 2.8-1.9 2.2-2.8 2.1-3.1 1.2-13.2-2.8-.1-2.2 1.2-2.2 1.7-2.2 2.7-2.2 2.2-1.1 2.2-.5 .5-.5 2.8-.6 1.6-1.1 2.7-.5 1.7-1.1 2.7-.6 1.6-1 2.8-.6 1.6-1.1 2.8-.5zM21.6 53.2l15.8 3.6 1.2 .7-.1 .9-.8 .8-3.1 1.6-1.3 3.8-3 3.8-3.3 2.5-3.3 1.4-18-3.6-.6-1.3 .6-2.2 1.6-2.7 1.7-1.8 3.8-2.8 5.5-2.2z", eyes: [[51.2, 34.1, 6.9, 18.1, -10], [66.4, 28.4, 6.9, 18.1, -10]] },
  cushion: { body: "M64.2 4.4l3.3-.4 2.8 .2 3.9 .8 2.8 1.1 2.7 1.7 2.4 2.1 1.9 2.4 1.5 2.8 1.2 3.9 7.1 40.6-.1 5-1.4 4.5-1.6 2.9-1.9 2.2-2.2 1.9-2.8 1.7-45.6 17.1-3.4 .9-3.4 .2-4.5-.7-3.4-1.2-3.3-2-2.9-2.7-2.3-3.4-1.5-3.9-7.3-41.7 .1-5 1.4-4.5 1.6-2.9 1.9-2.2 2.2-1.9 2.8-1.7z", shade: "M82.1 10l2.9 4 1.6 4.5 7.3 42.2-.5 5.1-1.1 3.3-1.7 2.9-4.6 4.5-3.3 1.7-46.8 17.4-5.6 .2-4-.7-3.3-1.2-3.4-2.2-1.7-1.8 .6 .4 3.3 .2 4.5-1.2 5.1-2.8 5.3-4.4-6.9-39.4 5-5.7 43.9-16.4 2.3-3.6 1.1-2.8 .5-3.6z", light: "M62.3 4.9l1.8 .1-43.4 16.1 1.1 .4 .8 .9 .1 1.7-1.6 3.4-2.6 3-3.4 2.7-3.4 1.5-3.4-.2-.8-.8-.2-1.2 .4-1.6 1.7-2.9 3.4-3.5 2.3-1.6 3.4-1.6 5.6-1.8 .6-.5 1.1 0 .5-.6 2.3-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1 0 .6-.6 2.2-.6 .6-.5 1.1 0z", eyes: [[51.1, 57.2, 8.4, 22.1, -10], [69.9, 50.1, 8.4, 22.1, -10]] },
  ring: { body: "M48.1 4.3l8-.1 7.8 1.8 7.3 3.5 6.7 5.4 5.2 6.7 4.1 8.3 2.3 8.9 .7 9-1 9.5-2.5 8.9-4.1 8.3-5.3 7.3-6.6 6.1-7.3 4.5-7.8 2.7-8.4 .9-7.2-.8-7.3-2.5-6.7-4.1-5.6-5.3-4.5-6.5-3.5-7.8-2-8.4-.6-8.4 .9-8.9 2.2-8.4 3.5-7.8 4.9-7.2 5.8-6.1 6.3-4.5 7.1-3.3zM50.5 33.8l2.3-.3 1.7 .4 1.6 1.1 2 2.2 1.3 2.8 .8 2.7 .4 3.4-.1 3.3-1.4 6.2-3 5.6-2.2 2.4-2.2 1.6-2.3 1-2.2 .3-1.7-.4-1.6-1.1-2.8-3.7-1.5-5.2-.1-5.5 1.2-5.6 2.4-5 3.6-4z", shade: "M76.2 14.9l1.1-.5 3.4 3.8 2.8 3.9 2.3 4.5 1.6 3.9 1.6 5.6 1.1 8.3-.4 10.1-1.3 6.1-2.6 7.8-4.6 8.3-4.4 5.6-6.2 5.7-6.1 3.8-7.2 2.9-6.2 1.1-7.8-.1-7.2-1.7-3.9-1.6-4-2.2-5.5-4.5-2.8-3.4 1.7-.6 2.4-2.1 2-2.8 1.2-2.8 1.2-5 1.1-13.4 1.4-7.8 2.5-7.8 3.8-7.3 3.3-4.5 3.4-3.4 3.9-3.1 4.4-2.6 3.9-1.5 4.5-1.1 12.3-.9zM50.5 33.8l.6-.3 2.8 0 1.6 .9 2.7 2.8 3 1.4 3.3 .5 6.1 .2 3.9 .9 1.7 1 1.7 1.6 2.1 4.4 .7 4.5-.3 5-1.2 5-1.9 4.5-2.8 4.2-3.3 3.6-3.9 2.8-3.9 1.7-3.4 .6-3.3-.1-3.4-1.1-2.5-1.7-2.5-3-3.6-7-2.9-3.4-2.1-5-.6-5.6 .6-4.4 1-3.4 2.3-4.4 1.4-2.1 2.3-2.2 2.7-1.7z", light: "M41.1 5.9l.5 .1 .2 .5-.3 .6-12.4 13.3-13.1 18.1-2.3 2.1-1.1 0-.2-1.2 .2-2.8 1.6-5 4.6-8.3 3.9-5.1 4.4-4.4 4.5-3.4 5-2.8zM60.5 53.3l1.2-.3 1.1 .6 1.1 1.3 .8 1.8-.2 3.3-1.5 2.8-2 1.7-2.6 1-7.3 .2 2.2-1.4 2.6-2.6z", eyes: [[56.2, 84.6, 5.3, 13.3, -6.8], [71.7, 78.8, 5.1, 13.4, -6.5]] },
  gem: { body: "M57 9.3l2.9-.4 14.9 3.5 19.6 14.1 1 1.4 .6 1.6-.5 2.6-27.1 56.5-1.6 1.8-2.1 .7-15.9-3.4-42.9-30.7-1.3-1.6-.6-1.6 .5-2.6 12-25.2 1.1-1.5 1.5-1z", shade: "M75.7 14.6l.1-.4 .6 .2 16.9 12.3 1.1 .7 .5-.2 .5 .7 .6 2.6-.5 1.6-26.4 55.1-1.2 2.1-1.1 1.1-1.6 .6-2.1 0-14.3-3.3-42.8-30.7 1.5-.2 11.6 2.5 2.2-.7 2.8-2.6 11.9-24.9 .6-.8 38.2-14.2z", light: "M19.1 23.6l1.1-.4 .5 .5 11.7 2.2 1 .9-.2 .5-1.8 2.7-11.7 24.4-1.6 .6-13.3-2.8-.5-.5 12.1-25.4 1.2-1.7z", eyes: [[51.4, 42.9, 6.7, 17.7, -10], [66.1, 37.4, 6.7, 17.7, -10]] }
};
var PICKER_SHAPES = Object.keys(CHARACTERS);
var DEFAULT_SHAPES = ["star", "moon", "gumdrop", "peanut", "bunny", "kitty", "acorn"];
var FALLBACK_SHAPE = "gumdrop";
var MAIN_LOOK = Object.freeze({ shape: "whale", color: "deepseek" });
var CHARACTER_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray", "aurora"];
var DEFAULT_COLORS = CHARACTER_COLORS.filter((color) => !["black", "gray", "brown"].includes(color) && !GRADIENTS[color]);
var isColor = (color) => isHex(color) || Object.hasOwn(INKS, color);
function fnv1a(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function defaultColor(id) {
  const t2 = fnv1a(id) + 1831565813 | 0;
  let n = Math.imul(t2 ^ t2 >>> 15, 1 | t2);
  n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
  return DEFAULT_COLORS[Math.floor(((n ^ n >>> 14) >>> 0) / 4294967296 * DEFAULT_COLORS.length)];
}
function defaultShape(id) {
  let value = fnv1a(id) | 0;
  value = Math.imul(value ^ value >>> 16, 73244475);
  value = Math.imul(value ^ value >>> 13, 3266489909);
  return DEFAULT_SHAPES[((value ^ value >>> 16) >>> 0) % DEFAULT_SHAPES.length];
}
var colorOf = (bot) => isColor(bot?.color) ? bot.color : bot?.id ? defaultColor(String(bot.id)) : "black";
function lookOf(bot) {
  const avatar = bot?.avatar ?? {};
  return {
    shape: hasShape(avatar.shape) ? avatar.shape : bot?.id ? defaultShape(String(bot.id)) : FALLBACK_SHAPE,
    image: avatar.image,
    color: colorOf(bot)
  };
}
var SHAPES = {};
for (const [id, character] of Object.entries(CHARACTERS)) {
  const layers = [
    ...(character.paints ?? []).map(([d, fill2, opacity]) => `<path d="${d}" fill="${fill2}" fill-opacity="${opacity}"/>`),
    `<path d="${character.shade}" fill="#000" fill-opacity=".14"/>`,
    `<path d="${character.light}" fill="#fff" fill-opacity=".16"/>`
  ].join("");
  SHAPES[id] = { label: character.label ?? id[0].toUpperCase() + id.slice(1), size: 100, path: character.body, layers, eyes: character.eyes };
}
var hasShape = (id) => typeof id === "string" && Object.hasOwn(SHAPES, id);
var shapeId = (id) => hasShape(id) ? id : FALLBACK_SHAPE;
var shapeOf = (id) => SHAPES[shapeId(id)];
function bodyOf(def, paint, flat = false) {
  if (def.path) return `<g fill-rule="evenodd"><path d="${def.path}" fill="${paint}"/>${flat ? "" : def.layers}</g>`;
  try {
    return def.body(paint);
  } catch {
    return "";
  }
}
var eyeMarkup = ([cx, cy, w, h20, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><rect class="bt-eye" x="${-w / 2}" y="${-h20 / 2}" width="${w}" height="${h20}" rx="${w / 2}"/></g>`;
var happyEyeMarkup = ([cx, cy, w, h20, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><path class="bt-eye-happy" opacity="0" d="M${-w * 0.62} ${h20 * 0.14}Q0 ${-h20 * 0.42} ${w * 0.62} ${h20 * 0.14}" fill="none" stroke="#000" stroke-width="${w * 0.5}" stroke-linecap="round"/></g>`;
var maskBox = (size) => `maskUnits="userSpaceOnUse" x="${-size}" y="${-size}" width="${size * 3}" height="${size * 3}"`;
var holes = (def, eyes) => `<rect x="${-def.size}" y="${-def.size}" width="${def.size * 3}" height="${def.size * 3}" fill="#fff"/>${eyes}`;
var MASK_ID = "%MASK%";
var markSerial = 0;
var nextMarkSerial = () => markSerial += 1;
var markupCache = /* @__PURE__ */ new Map();
function characterMarkup(shape, color) {
  const key = `${shape}|${color}`;
  let markup = markupCache.get(key);
  if (markup === void 0) {
    const def = shapeOf(shape);
    const eyes = `<g class="bt-gaze"><g class="bt-eyes" fill="#000">${def.eyes.map(eyeMarkup).join("")}${def.eyes.map(happyEyeMarkup).join("")}</g></g>`;
    const stops = GRADIENTS[color];
    const gradient = stops ? `<linearGradient id="${MASK_ID}g" gradientUnits="userSpaceOnUse" x1="18" y1="10" x2="78" y2="92">${stops.map(([offset, value]) => `<stop offset="${offset}" stop-color="${value}"/>`).join("")}</linearGradient>` : "";
    const body = `<g mask="url(#${MASK_ID})">${bodyOf(def, stops ? `url(#${MASK_ID}g)` : inkFill(color))}</g>`;
    markup = `<defs>${gradient}<mask id="${MASK_ID}" ${maskBox(def.size)}>${holes(def, eyes)}</mask></defs><g class="bt-b">${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}</g>`;
    markupCache.set(key, markup);
  }
  return markup;
}
var svgUrl = (inner, size) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${inner}</svg>`)}")`;
var maskCache = /* @__PURE__ */ new Map();
function maskOf(shape) {
  let mask = maskCache.get(shape);
  if (mask === void 0) {
    const def = shapeOf(shape);
    const body = `<g mask="url(#e)">${bodyOf(def, "#000", true)}</g>`;
    mask = svgUrl(`<mask id="e" ${maskBox(def.size)}>${holes(def, def.eyes.map(eyeMarkup).join("").replaceAll('class="bt-eye"', 'fill="#000"'))}</mask>${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}`, def.size);
    maskCache.set(shape, mask);
  }
  return mask;
}
var DEFAULT_MASK = maskOf(FALLBACK_SHAPE);

// src/client/mark.js
var STATES = ["idle", "thinking", "searching", "working", "sending", "orbit", "waiting", "alert", "done"];
function useGaze(ref, enabled) {
  (0, import_react2.useEffect)(() => {
    if (!enabled) return void 0;
    let frame = 0;
    let point = null;
    const place = () => {
      frame = 0;
      const node = ref.current;
      if (!node || !point) return;
      const box = node.getBoundingClientRect();
      const clamp = (value) => Math.max(-1, Math.min(1, value));
      node.style.setProperty("--bt-gx", clamp((point.x - box.left - box.width / 2) / 160).toFixed(2));
      node.style.setProperty("--bt-gy", clamp((point.y - box.top - box.height / 2) / 160).toFixed(2));
    };
    const onMove = (event) => {
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(place);
    };
    const onLeave = () => {
      point = null;
      ref.current?.style.setProperty("--bt-gx", "0");
      ref.current?.style.setProperty("--bt-gy", "0");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled]);
}
var FIDGETS = ["hop", "sway", "stretch", "look"];
function BotMark({ bot, look: given, size = 36, state = "idle", live = false, gaze = false, pokeable = false, label }) {
  const look = given ?? lookOf(bot);
  const ref = (0, import_react2.useRef)(null);
  const maskId = (0, import_react2.useRef)("");
  if (maskId.current === "") maskId.current = `bt-mark-${nextMarkSerial()}`;
  const [poked, setPoked] = (0, import_react2.useState)(false);
  const [broken, setBroken] = (0, import_react2.useState)("");
  const image = look.image && look.image !== broken ? look.image : void 0;
  useGaze(ref, gaze);
  const common = {
    ref,
    className: poked ? "bt-mark bt-mark-poke" : "bt-mark",
    "data-shape": image ? "image" : shapeId(look.shape),
    "data-state": STATES.includes(state) ? state : "idle",
    "data-live": live ? "" : void 0,
    "data-fidget": live ? FIDGETS[fnv1a(`${bot?.id ?? ""}:fidget`) % FIDGETS.length] : void 0,
    "data-gaze": gaze ? "" : void 0,
    "data-poke": pokeable ? "" : void 0,
    style: { width: size, height: size, ...live ? { "--bt-delay": `${-(fnv1a(String(bot?.id ?? "")) % 5e3) / 1e3}s`, "--bt-fidget-delay": `${-(fnv1a(`${bot?.id ?? ""}:when`) % 9e3) / 1e3}s` } : {} },
    role: label ? "img" : void 0,
    "aria-label": label,
    "aria-hidden": label ? void 0 : true,
    onClick: pokeable ? () => setPoked(true) : void 0,
    onAnimationEnd: poked ? (event) => {
      if (/^bt-poke/.test(event.animationName)) setPoked(false);
    } : void 0
  };
  if (image) return (0, import_react2.createElement)("span", common, (0, import_react2.createElement)("img", { className: "bt-mark-img", src: image, alt: "", draggable: false, onError: () => setBroken(image) }));
  const box = shapeOf(look.shape).size;
  return (0, import_react2.createElement)("span", common, (0, import_react2.createElement)("svg", { viewBox: `0 0 ${box} ${box}`, dangerouslySetInnerHTML: { __html: characterMarkup(look.shape, look.color).replaceAll(MASK_ID, maskId.current) } }));
}
function StarIcon({ size = 8 }) {
  return (0, import_react2.createElement)(
    "svg",
    { width: size, height: size, viewBox: "0 0 10 10", "aria-hidden": true },
    (0, import_react2.createElement)("path", { d: "M5 .6l1.3 2.8 3 .3-2.3 2 .7 3L5 7.2 2.3 8.7l.7-3L.7 3.7l3-.3z", fill: "#fff" })
  );
}
function MainStar() {
  return (0, import_react2.createElement)(
    "svg",
    { viewBox: "0 0 20 20", "aria-hidden": true },
    (0, import_react2.createElement)("path", { d: "M10 2.4l2.29 5.04 5.51.63-4.09 3.74 1.11 5.42L10 14.5l-4.82 2.73 1.11-5.42L2.2 8.07l5.51-.63z" })
  );
}
function useSettled(state) {
  const prev = (0, import_react2.useRef)(state);
  const [settled, setSettled] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    const was = prev.current;
    prev.current = state;
    if (state !== "idle") {
      setSettled(false);
      return void 0;
    }
    if (was === "idle" || was === "alert") return void 0;
    setSettled(true);
    const timer = setTimeout(() => setSettled(false), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  return settled;
}
function BotAvatar({ bot, size, state = "idle", main, admin, badge = true, live = true, gaze = false, pokeable = false }) {
  const settled = useSettled(state);
  if (bot === void 0) return (0, import_react2.createElement)(BotMark, { size });
  const badgeKind = !badge ? null : state === "alert" ? "alert" : state !== "idle" && state !== "waiting" ? "working" : admin ? "admin" : main ? "main" : null;
  return (0, import_react2.createElement)(
    "span",
    { className: "bt-mark", style: { width: size, height: size, "--bt-size": `${size}px` } },
    (0, import_react2.createElement)(BotMark, { bot, size, state: settled ? "done" : state, live, gaze, pokeable }),
    badgeKind === "working" ? (0, import_react2.createElement)("span", { className: "bt-badge bt-badge-working", "aria-label": t("Working"), role: "img" }) : null,
    badgeKind === "alert" ? (0, import_react2.createElement)("span", { className: "bt-badge bt-badge-alert", "aria-label": t("Waiting for your answer"), role: "img" }, "?") : null,
    badgeKind === "admin" ? (0, import_react2.createElement)("span", { className: "bt-badge bt-badge-admin", "aria-label": t("Admin"), role: "img" }, (0, import_react2.createElement)(StarIcon)) : null,
    badgeKind === "main" ? (0, import_react2.createElement)("span", { className: "bt-badge bt-badge-main", "aria-label": t("Main Bot"), role: "img" }, (0, import_react2.createElement)(MainStar)) : null
  );
}
function clusterSeats(count, frame) {
  if (count === 1) return [[0, 0, frame]];
  if (count === 2) return [[0, 0, frame * 2 / 3], [frame / 3, frame / 3, frame * 2 / 3]];
  if (count === 3) {
    const size = frame * 5 / 9;
    const rest = frame - size;
    return [[rest / 2, 0, size], [0, rest, size], [rest, rest, size]];
  }
  const half = frame / 2;
  return [[0, 0, half], [half, 0, half], [0, half, half], [half, half, half]];
}
function RoomAvatar({ room, roster: roster2, size = 36 }) {
  const members = room.members.map((id) => roster2.byId[id]).filter(Boolean);
  const people = members.length === 1 ? [members[0], null] : members;
  const seat = (bot, seatSize, key) => bot ? (0, import_react2.createElement)(BotMark, { key, bot, size: seatSize }) : (0, import_react2.createElement)("span", { key, className: "bt-cluster-you", style: { width: seatSize * 0.92, height: seatSize * 0.92, margin: seatSize * 0.04 } });
  if (people.length === 0) return (0, import_react2.createElement)(BotMark, { size });
  if (size <= 20 && people.length > 1) {
    return (0, import_react2.createElement)(
      "span",
      { className: "bt-stack", style: { "--bt-stack-size": `${size}px` } },
      people.slice(0, 3).map((bot, index) => seat(bot, size, bot?.id ?? `you-${index}`)),
      people.length > 3 ? (0, import_react2.createElement)("span", { className: "bt-stack-more" }, `+${people.length - 3}`) : null
    );
  }
  const seats = clusterSeats(Math.min(people.length, 4), size);
  const overflow = people.length > 4 ? people.length - 3 : 0;
  const gap = size / 14;
  const rings = seats.map(([x, y, s]) => ({ cx: x + s / 2, cy: y + s / 2, r: s * 0.48 + gap }));
  return (0, import_react2.createElement)(
    "span",
    { className: "bt-cluster", style: { width: size, height: size } },
    seats.map(([x, y, s], index) => {
      const holes2 = rings.slice(index + 1).filter((ring) => Math.hypot(ring.cx - x - s / 2, ring.cy - y - s / 2) < ring.r + s * 0.46).map((ring) => `radial-gradient(circle at ${ring.cx - x}px ${ring.cy - y}px,transparent ${ring.r}px,#000 ${ring.r + 0.5}px)`);
      const style = { left: x, top: y, width: s, height: s };
      if (holes2.length > 0) Object.assign(style, { WebkitMaskImage: holes2.join(","), maskImage: holes2.join(","), WebkitMaskComposite: "source-in", maskComposite: "intersect" });
      if (overflow > 0 && index === 3) {
        return (0, import_react2.createElement)("span", { key: "more", className: "bt-cluster-more", style: { ...style, width: s * 0.92, height: s * 0.92, margin: s * 0.04, fontSize: Math.max(8, Math.round(s * 0.36)) } }, `+${overflow}`);
      }
      const bot = people[index];
      return (0, import_react2.createElement)("span", { key: bot?.id ?? "you", style }, seat(bot, s));
    })
  );
}

// src/client/cell-empty.js
var import_react3 = require("react");
var emptied = (slot, gone) => {
  let marks = 0;
  for (const node of slot.childNodes) {
    if (node === gone) continue;
    if (node.nodeType !== 1 || !node.hasAttribute("data-bt-empty")) return false;
    marks += 1;
  }
  return marks > 0;
};
function CellEmpty({ className }) {
  const ref = (0, import_react3.useRef)(null);
  (0, import_react3.useLayoutEffect)(() => {
    const marker = ref.current;
    const slot = marker?.closest("[data-slot]");
    if (!slot) return void 0;
    const sync = (gone) => emptied(slot, gone) ? slot.dataset.btEmptied = "" : delete slot.dataset.btEmptied;
    sync();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(() => sync()) : null;
    observer?.observe(slot, { childList: true });
    return () => {
      observer?.disconnect();
      sync(marker);
    };
  }, []);
  return (0, import_react3.createElement)("span", { ref, className, hidden: true, "data-bt-empty": true });
}

// src/client/questions.js
var import_react5 = require("react");

// src/client/card-hold.js
var import_react4 = require("react");
function useDockHold(sessionId, kind, requestId, actions, inline) {
  const release = (0, import_react4.useRef)(null);
  const note = actions.noteHeldCard;
  (0, import_react4.useLayoutEffect)(() => () => {
    const stop = release.current;
    release.current = null;
    stop?.();
  }, [sessionId, kind, requestId, note, inline]);
  return () => {
    if (inline || release.current || !note) return;
    release.current = () => note(sessionId, kind, requestId, -1);
    note(sessionId, kind, requestId, 1);
  };
}

// src/client/sources.js
function createSource(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      const resolved = typeof next === "function" ? next(value) : next;
      if (resolved === value) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    }
  };
}
var EMPTY_ROSTER = { revision: -1, mainBotId: null, mainBotIds: [], bots: [], rooms: [], agents: [], exchangeTurns: {}, questions: {}, btwCards: {}, sideChats: {}, learning: {}, secrets: [], capabilities: [], capabilityStatuses: {}, secretRequests: {}, models: [], defaultModel: null, modelsKey: null, prefs: {}, byId: {}, roomsById: {}, agentsById: {}, agentOf: {}, ready: false };
var heldCardKey = (kind, requestId) => JSON.stringify([kind, requestId]);

// src/client/questions.js
var keyLetter = (index) => String.fromCharCode(65 + index);
var optionsOf = (question) => (question?.options ?? []).map((option) => typeof option === "string" ? { label: option } : option);
var isTypingTarget = (node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || node instanceof HTMLElement && node.isContentEditable;
var optionKeyCards = createSource(0);
function useOptionKeys(count, onPick, ownRef) {
  const pick = (0, import_react5.useRef)(onPick);
  pick.current = onPick;
  const listening = (0, import_react5.useSyncExternalStore)(optionKeyCards.subscribe, optionKeyCards.getSnapshot);
  (0, import_react5.useEffect)(() => {
    if (count === 0) return void 0;
    optionKeyCards.set((value) => value + 1);
    const onKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.length !== 1) return;
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]') !== null) return;
      if (optionKeyCards.getSnapshot() !== 1) return;
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      if (index >= 0 && index < count) {
        event.preventDefault();
        pick.current(index);
      } else if (index === count && ownRef.current) {
        event.preventDefault();
        ownRef.current.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      optionKeyCards.set((value) => value - 1);
    };
  }, [count, ownRef]);
  return count > 0 && listening <= 1;
}
function QuestionView({ question, onAnswer, onDismiss, onInteract, busy = false, ownAnswer = false, raised = false }) {
  const [own, setOwn] = (0, import_react5.useState)("");
  const [picked, setPicked] = (0, import_react5.useState)([]);
  const ownRef = (0, import_react5.useRef)(null);
  const titleId = (0, import_react5.useId)();
  const options = optionsOf(question);
  const multi = question.multiSelect === true;
  const custom = own.trim();
  const canSubmit = multi ? picked.length > 0 || custom !== "" : custom !== "";
  const choose = (label) => {
    if (busy) return;
    onInteract?.();
    if (multi) {
      setPicked((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
      return;
    }
    onAnswer({ selected: [label] });
  };
  const submit = () => {
    if (!canSubmit || busy) return;
    onInteract?.();
    onAnswer({ selected: multi ? picked : [], ...custom ? { custom } : {} });
  };
  const hints = useOptionKeys(busy ? 0 : options.length, (index) => choose(options[index].label), ownRef);
  const ownLetter = options.length > 0 ? keyLetter(options.length) : void 0;
  const field = ownAnswer ? (0, import_react5.createElement)("textarea", {
    ref: ownRef,
    rows: 1,
    value: own,
    readOnly: busy,
    autoComplete: "off",
    spellCheck: false,
    className: "bt-q-input",
    "aria-label": t("Your own answer"),
    placeholder: t("Type your own answer"),
    "aria-keyshortcuts": hints ? ownLetter?.toLowerCase() : void 0,
    onChange: (event) => {
      if (!busy) {
        onInteract?.();
        setOwn(event.target.value);
      }
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      submit();
    }
  }) : null;
  const rows2 = options.map((option, optionIndex) => {
    const selected = multi && picked.includes(option.label);
    return (0, import_react5.createElement)(
      "button",
      {
        key: option.label,
        type: "button",
        className: "bt-q-opt",
        disabled: busy,
        "aria-pressed": multi ? selected : void 0,
        "aria-keyshortcuts": hints ? keyLetter(optionIndex).toLowerCase() : void 0,
        onClick: () => choose(option.label)
      },
      hints ? (0, import_react5.createElement)("span", { className: "bt-key", "aria-hidden": true }, keyLetter(optionIndex)) : null,
      (0, import_react5.createElement)(
        "span",
        { className: "bt-q-body" },
        (0, import_react5.createElement)("span", { className: "bt-q-label" }, option.label),
        option.description ? (0, import_react5.createElement)("span", { className: "bt-q-desc" }, option.description) : null
      ),
      selected && !raised ? (0, import_react5.createElement)("span", { className: "bt-q-check", title: t("Selected") }, (0, import_react5.createElement)(CheckIcon)) : null
    );
  });
  if (raised && field) {
    rows2.push((0, import_react5.createElement)(
      "label",
      { key: "own", className: "bt-q-opt bt-q-ownrow", "data-filled": custom !== "" ? "" : void 0 },
      hints && ownLetter ? (0, import_react5.createElement)("span", { className: "bt-key", "aria-hidden": true }, ownLetter) : null,
      (0, import_react5.createElement)("span", { className: "bt-q-body" }, field)
    ));
  }
  let foot = null;
  if (raised && multi) {
    foot = (0, import_react5.createElement)(
      "div",
      { className: "bt-q-foot" },
      (0, import_react5.createElement)("button", { type: "button", className: "bt-q-btn", onClick: onDismiss, disabled: busy }, t("Skip")),
      (0, import_react5.createElement)("button", { type: "submit", className: "bt-q-submit", disabled: !canSubmit || busy }, t("Submit"))
    );
  } else if ((raised || multi) && canSubmit) {
    foot = (0, import_react5.createElement)("div", { className: "bt-q-foot" }, (0, import_react5.createElement)("button", { type: "submit", className: "bt-q-submit", disabled: busy }, t("Submit")));
  }
  return (0, import_react5.createElement)(
    "form",
    {
      className: raised ? "bt-q bt-q-raised" : "bt-q",
      "aria-labelledby": titleId,
      "aria-busy": busy || void 0,
      onFocusCapture: onInteract,
      onPointerDownCapture: onInteract,
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      }
    },
    (0, import_react5.createElement)(
      "div",
      { className: "bt-q-head" },
      (0, import_react5.createElement)(
        "div",
        { className: "bt-q-text" },
        (0, import_react5.createElement)("p", { className: "bt-q-title", id: titleId }, question.header ? `${question.header} · ` : "", question.question),
        question.detail ? (0, import_react5.createElement)("div", { className: "bt-q-detail" }, question.detail) : null,
        raised && multi ? (0, import_react5.createElement)("div", { className: "bt-q-detail" }, t("Choose all that apply")) : null
      ),
      onDismiss ? (0, import_react5.createElement)("button", { type: "button", className: "bt-q-x", "aria-label": t("Dismiss question"), title: t("Dismiss"), onClick: onDismiss, disabled: busy }, (0, import_react5.createElement)(CloseIcon)) : null
    ),
    rows2.length > 0 ? (0, import_react5.createElement)("div", { className: "bt-q-list", role: "group" }, rows2) : null,
    field && !raised ? (0, import_react5.createElement)(
      "div",
      { className: "bt-q-custom" },
      (0, import_react5.createElement)("label", { className: "bt-q-field" }, field),
      !multi && canSubmit ? (0, import_react5.createElement)("button", { type: "submit", className: "bt-q-submit", disabled: busy }, t("Submit")) : null
    ) : null,
    foot
  );
}
function SettledQuestion({ question, answer }) {
  const options = optionsOf(question);
  const prompt = question?.question ?? "";
  const chosen = [...answer.selected ?? [], ...answer.custom ? [answer.custom] : []];
  if (chosen.length === 0) {
    return (0, import_react5.createElement)(
      "div",
      { className: "bt-q bt-q-settled bt-q-dismissed", role: "group", "aria-label": prompt },
      (0, import_react5.createElement)(
        "div",
        { className: "bt-q-head" },
        (0, import_react5.createElement)("div", { className: "bt-q-text" }, (0, import_react5.createElement)("p", { className: "bt-q-title" }, prompt)),
        (0, import_react5.createElement)("span", { className: "bt-q-badge" }, t("Dismissed"))
      )
    );
  }
  return (0, import_react5.createElement)(
    "div",
    { className: "bt-q bt-q-settled", role: "group", "aria-label": prompt },
    prompt ? (0, import_react5.createElement)("div", { className: "bt-q-head" }, (0, import_react5.createElement)("div", { className: "bt-q-text" }, (0, import_react5.createElement)("p", { className: "bt-q-title" }, prompt))) : null,
    (0, import_react5.createElement)("div", { className: "bt-q-list", role: "group", "aria-label": t("Your answer") }, chosen.map((label, index) => {
      const optionIndex = options.findIndex((option) => option.label === label);
      return (0, import_react5.createElement)(
        "div",
        { key: `${label}-${index}`, className: "bt-q-opt" },
        optionIndex >= 0 ? (0, import_react5.createElement)("span", { className: "bt-key", "aria-hidden": true }, keyLetter(optionIndex)) : null,
        (0, import_react5.createElement)("span", { className: "bt-q-body" }, (0, import_react5.createElement)("span", { className: "bt-q-label" }, label)),
        (0, import_react5.createElement)("span", { className: "bt-q-check", title: t("Selected") }, (0, import_react5.createElement)(CheckIcon))
      );
    }))
  );
}
function PendingQuestion({ sessionId, question, actions, inline }) {
  const [answered, setAnswered] = (0, import_react5.useState)(null);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const busyRef = (0, import_react5.useRef)(false);
  const hold = useDockHold(sessionId, "question", question.id, actions, inline);
  if (answered === question.id) return (0, import_react5.createElement)(CellEmpty);
  const run2 = (make) => {
    if (busyRef.current) return;
    hold();
    busyRef.current = true;
    setBusy(true);
    void Promise.resolve().then(make).then(() => setAnswered(question.id), () => setAnswered(null)).finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  };
  const onAnswer = (answer) => run2(() => actions.answerQuestion(sessionId, question.id, { selected: answer.selected ?? [], custom: answer.custom ?? "" }));
  const onDismiss = actions.dismissQuestion ? () => run2(() => actions.dismissQuestion(sessionId)) : void 0;
  return (0, import_react5.createElement)(
    "div",
    { className: inline ? "bt-q-inline" : "bt-q-dock" },
    (0, import_react5.createElement)(QuestionView, { key: question.id, question, onAnswer, onDismiss, onInteract: hold, busy, ownAnswer: question.allowCustom === true, raised: !inline })
  );
}
function AnsweredCell({ node }) {
  const data = node.data ?? {};
  const questions = Array.isArray(data.questions) ? data.questions : [];
  if (questions.length === 0) {
    return data.text ? (0, import_react5.createElement)("div", { className: "bt-urow" }, (0, import_react5.createElement)("div", { className: "bt-ububble" }, data.text)) : (0, import_react5.createElement)(CellEmpty);
  }
  const answers = Array.isArray(data.answers) ? data.answers : [];
  return (0, import_react5.createElement)("div", { className: "bt-q-inline" }, questions.map((question) => (0, import_react5.createElement)(SettledQuestion, {
    key: question.id,
    question,
    answer: answers.find((answer) => answer.id === question.id) ?? { selected: [] }
  })));
}

// src/client/widget-cell.js
var import_react11 = require("react");

// src/client/handoff-card.js
var import_react6 = require("react");
var titleOf = (reason) => {
  switch (reason) {
    case "login":
      return t("Sign-in needed");
    case "payment":
      return t("Payment needed");
    case "captcha":
      return t("Verification needed");
    default:
      return t("Help needed in the browser");
  }
};
function SettledHandoff({ handoff }) {
  const skipped = handoff.outcome === "skipped";
  const returned = handoff.outcome === "returned";
  const title = titleOf(handoff.reason);
  return (0, import_react6.createElement)(
    "div",
    { className: "bt-q-inline" },
    (0, import_react6.createElement)(
      "div",
      { className: skipped ? "bt-q bt-q-settled bt-q-dismissed" : "bt-q bt-q-settled", role: "group", "aria-label": title },
      (0, import_react6.createElement)(
        "div",
        { className: "bt-q-head" },
        (0, import_react6.createElement)("div", { className: "bt-q-text" }, (0, import_react6.createElement)("p", { className: "bt-q-title" }, title)),
        skipped || returned ? (0, import_react6.createElement)("span", { className: "bt-q-badge" }, t(skipped ? "Skipped" : "Returned")) : (0, import_react6.createElement)("span", { className: "bt-q-check", title: t("Done") }, (0, import_react6.createElement)(CheckIcon))
      )
    )
  );
}

// ../../app/node_modules/deep-view/src/react/ui.js
var import_react7 = require("react");
var FallbackMarkdown = ({ text }) => (0, import_react7.createElement)("span", null, String(text ?? ""));
var ViewUi = (0, import_react7.createContext)({ t: (key) => key, Markdown: FallbackMarkdown });
var useViewUi = () => (0, import_react7.useContext)(ViewUi);
var lineIcon2 = (paths) => function LineIcon() {
  return (0, import_react7.createElement)(
    "svg",
    { width: 15, height: 15, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    paths.map((d, index) => (0, import_react7.createElement)("path", { key: index, d }))
  );
};
var DotsIcon2 = lineIcon2(["M5 10h.01M10 10h.01M15 10h.01"]);
var CheckIcon2 = lineIcon2(["M4.5 10.5l3.5 3.5 7.5-8"]);
var DownloadIcon2 = lineIcon2(["M10 3.5v9", "M6.5 9.5L10 13l3.5-3.5", "M4 16h12"]);
var CopyIcon2 = lineIcon2(["M8.5 7h6A1.5 1.5 0 0 1 16 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 14.5v-6A1.5 1.5 0 0 1 8.5 7z", "M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4H13"]);
var InfoIcon2 = lineIcon2(["M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M10 9.25v4", "M10 6.6h.01"]);
function CloseIcon2() {
  return (0, import_react7.createElement)("svg", { width: 16, height: 16, viewBox: "0 0 20 20", "aria-hidden": true }, (0, import_react7.createElement)("path", { d: "M5 5l10 10M15 5L5 15", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }));
}
function Segmented({ label, value, className, children }) {
  return (0, import_react7.createElement)("div", { className: className ? `dv-seg ${className}` : "dv-seg", role: "group", "aria-label": label, "data-active": value }, children);
}
var keyLetter2 = (index) => String.fromCharCode(65 + index);
var isTypingTarget2 = (node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || node instanceof HTMLElement && node.isContentEditable;
var keyCards = /* @__PURE__ */ (() => {
  let count = 0;
  const listeners = /* @__PURE__ */ new Set();
  return {
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    getSnapshot: () => count,
    set: (change) => {
      count = change(count);
      for (const fn of listeners) fn();
    }
  };
})();
function useOptionKeys2(count, onPick, ownRef) {
  const pick = (0, import_react7.useRef)(onPick);
  pick.current = onPick;
  const listening = (0, import_react7.useSyncExternalStore)(keyCards.subscribe, keyCards.getSnapshot);
  (0, import_react7.useEffect)(() => {
    if (count === 0) return void 0;
    keyCards.set((value) => value + 1);
    const onKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.length !== 1) return;
      if (isTypingTarget2(event.target) || isTypingTarget2(document.activeElement)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]') !== null) return;
      if (keyCards.getSnapshot() !== 1) return;
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      if (index >= 0 && index < count) {
        event.preventDefault();
        pick.current(index);
      } else if (index === count && ownRef.current) {
        event.preventDefault();
        ownRef.current.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      keyCards.set((value) => value - 1);
    };
  }, [count, ownRef]);
  return count > 0 && listening <= 1;
}

// ../../app/node_modules/deep-view/src/react/card.js
var import_react10 = require("react");

// ../../app/node_modules/deep-view/src/react/chart.js
var import_react8 = require("react");

// ../../app/node_modules/deep-view/src/core/formula.js
var FUNCTIONS = {
  min: { args: [1, Infinity], run: (...values) => Math.min(...values.map(num)) },
  max: { args: [1, Infinity], run: (...values) => Math.max(...values.map(num)) },
  abs: { args: [1, 1], run: (value) => Math.abs(num(value)) },
  floor: { args: [1, 1], run: (value) => Math.floor(num(value)) },
  ceil: { args: [1, 1], run: (value) => Math.ceil(num(value)) },
  sqrt: { args: [1, 1], run: (value) => Math.sqrt(num(value)) },
  pow: { args: [2, 2], run: (base, power) => num(base) ** num(power) },
  round: { args: [1, 2], run: (value, digits = 0) => roundTo(num(value), digitsOf(digits)) },
  clamp: { args: [3, 3], run: (value, low, high) => Math.min(Math.max(num(value), num(low)), num(high)) },
  fixed: { args: [1, 2], run: (value, digits = 0) => roundTo(num(value), digitsOf(digits)).toFixed(digitsOf(digits)) },
  format: { args: [1, 2], run: (value, digits = 0) => grouped(num(value), digitsOf(digits)) },
  percent: { args: [1, 2], run: (value, digits = 0) => `${grouped(num(value) * 100, digitsOf(digits))}%` }
};
var FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);
var CONSTANTS = /* @__PURE__ */ new Map([["true", true], ["false", false]]);
var MAX_NESTING = 64;
var FormulaError = class extends Error {
};
var fail = (message) => {
  throw new FormulaError(message);
};
function num(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(parsed)) return parsed;
  return fail(`${JSON.stringify(value)} is not a number`);
}
var digitsOf = (digits) => {
  const value = num(digits);
  if (!Number.isInteger(value) || value < 0 || value > 10) fail("digits must be a whole number from 0 to 10");
  return value;
};
var roundTo = (value, digits) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
function grouped(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  const [whole, part] = Math.abs(roundTo(value, digits)).toFixed(digits).split(".");
  const sign = value < 0 && Number(whole + (part ?? "")) !== 0 ? "-" : "";
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${part ? `.${part}` : ""}`;
}
var IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
var isName = (value) => typeof value === "string" && IDENT.test(value);
var OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", ","];
function tokenize(source) {
  const tokens = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(at));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), at });
      at += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at));
    if (name) {
      tokens.push({ kind: "name", value: name[0], at });
      at += name[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = at + 1;
      let text = "";
      while (end < source.length && source[end] !== char) {
        if (source[end] === "\\" && end + 1 < source.length) {
          text += source[end + 1];
          end += 2;
          continue;
        }
        text += source[end];
        end += 1;
      }
      if (end >= source.length) fail(`unclosed string at ${at + 1}`);
      tokens.push({ kind: "string", value: text, at });
      at = end + 1;
      continue;
    }
    const operator = OPERATORS.find((op) => source.startsWith(op, at));
    if (operator === void 0) fail(`unexpected ${JSON.stringify(char)} at ${at + 1}`);
    tokens.push({ kind: "op", value: operator, at });
    at += operator.length;
  }
  return tokens;
}
var BINARY = [["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]];
function parse(source) {
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index];
  const isOp = (value) => peek()?.kind === "op" && peek().value === value;
  const expect = (value) => {
    if (!isOp(value)) fail(peek() ? `expected "${value}" at ${peek().at + 1}` : `expected "${value}" at the end`);
    index += 1;
  };
  const nest = (read) => {
    depth += 1;
    if (depth > MAX_NESTING) fail(`nested more than ${MAX_NESTING} levels`);
    const node = read();
    depth -= 1;
    return node;
  };
  const ternary = () => nest(() => {
    const test = binary2(0);
    if (!isOp("?")) return test;
    index += 1;
    const yes = ternary();
    expect(":");
    return { type: "if", test, yes, no: ternary() };
  });
  const binary2 = (level) => {
    if (level === BINARY.length) return unary();
    let left = binary2(level + 1);
    while (peek()?.kind === "op" && BINARY[level].includes(peek().value)) {
      const op = peek().value;
      index += 1;
      left = { type: "binary", op, left, right: binary2(level + 1) };
    }
    return left;
  };
  const unary = () => {
    if (isOp("-") || isOp("!") || isOp("+")) {
      const op = peek().value;
      index += 1;
      return nest(() => ({ type: "unary", op, value: unary() }));
    }
    return primary();
  };
  const primary = () => {
    const token = peek();
    if (token === void 0) fail("the formula ends too early");
    index += 1;
    if (token.kind === "number" || token.kind === "string") return { type: "value", value: token.value };
    if (token.kind === "op" && token.value === "(") {
      const inner = ternary();
      expect(")");
      return inner;
    }
    if (token.kind !== "name") fail(`unexpected "${token.value}" at ${token.at + 1}`);
    if (!isOp("(")) return CONSTANTS.has(token.value) ? { type: "value", value: CONSTANTS.get(token.value) } : { type: "name", name: token.value };
    const fn = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : void 0;
    if (fn === void 0) fail(`unknown function "${token.value}"; allowed: ${FORMULA_FUNCTIONS.join(", ")}`);
    index += 1;
    const args = [];
    if (!isOp(")")) {
      args.push(ternary());
      while (isOp(",")) {
        index += 1;
        args.push(ternary());
      }
    }
    expect(")");
    if (args.length < fn.args[0] || args.length > fn.args[1]) {
      fail(`${token.value}() takes ${fn.args[0] === fn.args[1] ? fn.args[0] : fn.args[1] === Infinity ? `at least ${fn.args[0]}` : `${fn.args[0]} or ${fn.args[1]}`} argument${fn.args[1] === 1 ? "" : "s"}; got ${args.length}`);
    }
    return { type: "call", name: token.value, args };
  };
  if (tokens.length === 0) fail("the formula is empty");
  const tree = ternary();
  if (index < tokens.length) fail(`unexpected "${peek().value}" at ${peek().at + 1}`);
  return tree;
}
function namesIn(node, found = /* @__PURE__ */ new Set()) {
  if (node.type === "name") found.add(node.name);
  else if (node.type === "unary") namesIn(node.value, found);
  else if (node.type === "binary") {
    namesIn(node.left, found);
    namesIn(node.right, found);
  } else if (node.type === "if") {
    namesIn(node.test, found);
    namesIn(node.yes, found);
    namesIn(node.no, found);
  } else if (node.type === "call") for (const arg of node.args) namesIn(arg, found);
  return found;
}
function compileFormula(source) {
  if (typeof source !== "string") return { error: "expected a formula string" };
  try {
    const tree = parse(source);
    return { tree, names: [...namesIn(tree)] };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    throw error;
  }
}
function run(node, lookup) {
  switch (node.type) {
    case "value":
      return node.value;
    case "name":
      return lookup(node.name);
    case "unary": {
      const value = run(node.value, lookup);
      if (node.op === "!") return !truthy(value);
      return node.op === "-" ? -num(value) : num(value);
    }
    case "if":
      return truthy(run(node.test, lookup)) ? run(node.yes, lookup) : run(node.no, lookup);
    case "call":
      return FUNCTIONS[node.name].run(...node.args.map((arg) => run(arg, lookup)));
    default:
      return binary(node, lookup);
  }
}
var truthy = (value) => typeof value === "string" ? value !== "" : Boolean(value);
function binary(node, lookup) {
  if (node.op === "&&") return truthy(run(node.left, lookup)) ? run(node.right, lookup) : false;
  if (node.op === "||") {
    const left2 = run(node.left, lookup);
    return truthy(left2) ? left2 : run(node.right, lookup);
  }
  const left = run(node.left, lookup);
  const right = run(node.right, lookup);
  switch (node.op) {
    case "+":
      return typeof left === "string" || typeof right === "string" ? `${show(left)}${show(right)}` : num(left) + num(right);
    case "-":
      return num(left) - num(right);
    case "*":
      return num(left) * num(right);
    case "/":
      return num(left) / num(right);
    case "%":
      return num(left) % num(right);
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return num(left) < num(right);
    case "<=":
      return num(left) <= num(right);
    case ">":
      return num(left) > num(right);
    default:
      return num(left) >= num(right);
  }
}
function show(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value);
  return String(value);
}
function createScope(inputs, lets) {
  const done = /* @__PURE__ */ new Map();
  const busy = /* @__PURE__ */ new Set();
  const lookup = (name) => {
    if (inputs.has(name)) return inputs.get(name);
    if (done.has(name)) return done.get(name);
    const tree = lets.get(name);
    if (tree === void 0) fail(`unknown name "${name}"`);
    if (busy.has(name)) fail(`"${name}" refers to itself`);
    busy.add(name);
    try {
      const value = run(tree, lookup);
      done.set(name, value);
      return value;
    } finally {
      busy.delete(name);
    }
  };
  return lookup;
}
function evaluate(tree, lookup) {
  try {
    return { value: run(tree, lookup) };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    if (error instanceof RangeError) return { error: "the formula is too deep to work out" };
    throw error;
  }
}

// ../../app/node_modules/deep-view/src/core/views.js
var LAYOUT = ["stack", "row"];
var DISPLAY = ["text", "metric", "table", "chart", "progress", "callout", "sources", "html"];
var INPUT_TYPES = ["slider", "choice", "toggle", "number"];
var ANSWERS = ["options", "confirm", "form", "submit"];
var COMPONENTS = [...LAYOUT, ...DISPLAY, ...INPUT_TYPES, ...ANSWERS];
var TONES = ["good", "warn", "bad"];
var TEXT_TONES = ["muted"];
var CALLOUT_TONES = ["info", "good", "warn", "bad"];
var CHART_KINDS = ["bar", "hbar", "line", "area", "donut"];
var INTERACTIVE = new Set(ANSWERS);
var INPUTS = new Set(INPUT_TYPES);
var PROPS = {
  stack: ["children", "let"],
  row: ["children", "let"],
  text: ["text", "tone"],
  metric: ["label", "value", "tone", "caption"],
  table: ["columns", "rows"],
  chart: ["kind", "categories", "series", "unit", "caption"],
  progress: ["label", "percent", "value", "max", "valueLabel", "tone"],
  callout: ["text", "tone"],
  sources: ["items"],
  html: ["html", "summary", "height"],
  slider: ["id", "label", "min", "max", "step", "value", "unit"],
  choice: ["id", "label", "options", "value"],
  toggle: ["id", "label", "value"],
  number: ["id", "label", "min", "max", "step", "value", "unit"],
  options: ["id", "options", "multi"],
  confirm: ["id", "confirmLabel", "cancelLabel"],
  form: ["id", "fields", "submitLabel"],
  submit: ["id", "label"]
};
var MAX_DEPTH = 8;
var MAX_NODES = 64;
var MAX_CHILDREN = 16;
var MAX_TEXT = 2e3;
var MAX_CELL = 200;
var MAX_COLUMNS = 8;
var MAX_ROWS = 50;
var MAX_OPTIONS = 8;
var MAX_FIELDS = 6;
var RESERVED = /* @__PURE__ */ new Set(["true", "false"]);
var VIEW_BYTE_LIMIT = 8192;
var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var quoted = (value) => JSON.stringify(value);
var allowed = (list) => list.join(", ");
var isNumber = (value) => typeof value === "number" && Number.isFinite(value);
var isScalar = (value) => typeof value === "string" || typeof value === "boolean" || isNumber(value);
var isFormula = (value) => isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "=");
function viewBytes(title, view) {
  return new TextEncoder().encode(`${JSON.stringify(view) ?? ""}${title ?? ""}`).length;
}
var NUMERIC = ["value", "percent", "min", "max", "step", "height"];
var numeric = (value) => typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
function normalizeView(value) {
  if (Array.isArray(value)) return value.map(normalizeView);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "item") {
    const inner = normalizeView(value.item);
    if (Array.isArray(inner)) return inner;
  }
  const out = {};
  for (const key of keys) Object.defineProperty(out, key, { value: normalizeView(value[key]), writable: true, enumerable: true, configurable: true });
  for (const field of NUMERIC) if (Object.hasOwn(out, field)) out[field] = numeric(out[field]);
  if (Array.isArray(out.values)) out.values = out.values.map(numeric);
  return out;
}
function validateView(view) {
  const ctx = { ids: /* @__PURE__ */ new Set(), nodes: 0, interactive: false, inputs: /* @__PURE__ */ new Map(), lets: /* @__PURE__ */ new Map(), formulas: [] };
  const error = checkNode(view, "view", 1, ctx) ?? checkFormulas(ctx);
  return error === void 0 ? { ok: true, interactive: ctx.interactive } : { ok: false, error };
}
function checkShownView(title, sent) {
  let bytes;
  try {
    bytes = viewBytes(title, sent);
  } catch {
    return { error: "The view is not JSON data." };
  }
  if (bytes > VIEW_BYTE_LIMIT) return { error: `The view is ${bytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` };
  if (title !== void 0 && title !== null && typeof title !== "string") return { error: "title: expected a string" };
  const named = String(title ?? "").trim();
  const view = normalizeView(sent);
  const checked = validateView(view);
  if (!checked.ok) return { error: checked.error };
  return { title: named, view, interactive: checked.interactive };
}
function checkNode(node, path, depth, ctx) {
  if (!isRecord(node)) return `${path}: expected a component object`;
  if (depth > MAX_DEPTH) return `${path}: ${depth} levels exceeds the limit of ${MAX_DEPTH}`;
  ctx.nodes += 1;
  if (ctx.nodes > MAX_NODES) return `${path}: ${ctx.nodes} components exceeds the limit of ${MAX_NODES}`;
  const type = node.type;
  if (!COMPONENTS.includes(type)) return `${path}.type: unknown component ${quoted(type)}; allowed: ${allowed(COMPONENTS)}`;
  const props = PROPS[type];
  for (const key of Object.keys(node)) {
    if (key === "type" || props.includes(key)) continue;
    return `${path}.${key}: unknown property ${quoted(key)}; allowed: ${allowed(props)}`;
  }
  if (INTERACTIVE.has(type)) ctx.interactive = true;
  switch (type) {
    case "stack":
    case "row":
      return checkLayout(node, path, depth, ctx);
    case "text":
      return checkText(node, path, ctx);
    case "metric":
      return checkMetric(node, path, ctx);
    case "table":
      return checkTable(node, path, ctx);
    case "chart":
      return checkChart(node, path, ctx);
    case "progress":
      return checkProgress(node, path, ctx);
    case "callout":
      return checkCallout(node, path, ctx);
    case "sources":
      return checkSources(node, path);
    case "html":
      return checkHtml(node, path);
    case "slider":
    case "number":
      return checkNumberInput(node, path, ctx);
    case "choice":
      return checkChoice(node, path, ctx);
    case "toggle":
      return checkToggle(node, path, ctx);
    case "options":
      return checkOptions(node, path, ctx);
    case "confirm":
      return checkConfirm(node, path, ctx);
    case "form":
      return checkForm(node, path, ctx);
    default:
      return checkSubmit(node, path, ctx);
  }
}
function checkLayout(node, path, depth, ctx) {
  if (node.let !== void 0) {
    if (depth !== 1) return `${path}.let: only the outermost component can define names`;
    if (!isRecord(node.let)) return `${path}.let: expected an object of names to formulas`;
    for (const [name, source] of Object.entries(node.let)) {
      if (!isName(name) || RESERVED.has(name)) return `${path}.let.${name}: a name is letters, digits and _, and starts with a letter or _`;
      if (typeof source !== "string") return `${path}.let.${name}: expected a formula string`;
      ctx.lets.set(name, { source, path: `${path}.let.${name}` });
    }
  }
  if (!Array.isArray(node.children)) return `${path}.children: expected an array of 1 to ${MAX_CHILDREN} components`;
  if (node.children.length < 1 || node.children.length > MAX_CHILDREN) return `${path}.children: expected 1 to ${MAX_CHILDREN} children; got ${node.children.length}`;
  for (let index = 0; index < node.children.length; index += 1) {
    const error = checkNode(node.children[index], `${path}.children[${index}]`, depth + 1, ctx);
    if (error !== void 0) return error;
  }
  return void 0;
}
function checkValue(node, key, path, ctx, kind, { required = false, max = MAX_TEXT } = {}) {
  const value = node[key];
  const at = `${path}.${key}`;
  if (value === void 0) return required ? `${at}: ${expected(kind)}` : void 0;
  if (isFormula(value)) {
    ctx.formulas.push({ source: value["="], path: at, kind });
    return void 0;
  }
  if (kind === "number") return isNumber(value) ? void 0 : `${at}: ${expected(kind)}`;
  if (Array.isArray(kind)) return kind.includes(value) ? void 0 : `${at}: unknown tone ${quoted(value)}; allowed: ${allowed(kind)}`;
  if (kind === "string") {
    if (typeof value !== "string") return `${at}: ${expected(kind)}`;
    return value.length > max ? `${at}: ${value.length} characters exceeds the limit of ${max}` : void 0;
  }
  if (!isScalar(value)) return `${at}: ${expected(kind)}`;
  return void 0;
}
var expected = (kind) => kind === "number" ? "expected a number" : kind === "string" ? "expected a string" : Array.isArray(kind) ? `expected one of ${allowed(kind)}` : "expected a string or a number";
function checkText(node, path, ctx) {
  return checkValue(node, "text", path, ctx, "string", { required: true }) ?? checkValue(node, "tone", path, ctx, TEXT_TONES);
}
function checkMetric(node, path, ctx) {
  if (typeof node.label !== "string") return `${path}.label: expected a string`;
  if (node.value === void 0) return `${path}.value: expected a string or a number`;
  if (typeof node.value === "number" && !Number.isFinite(node.value)) return `${path}.value: expected a finite number`;
  return checkValue(node, "value", path, ctx, "scalar") ?? checkValue(node, "tone", path, ctx, TONES) ?? checkValue(node, "caption", path, ctx, "string");
}
function checkTable(node, path, ctx) {
  if (!Array.isArray(node.columns)) return `${path}.columns: expected an array of at most ${MAX_COLUMNS} columns`;
  if (node.columns.length > MAX_COLUMNS) return `${path}.columns: ${node.columns.length} columns exceeds the limit of ${MAX_COLUMNS}`;
  for (let index = 0; index < node.columns.length; index += 1) {
    const column = node.columns[index];
    const at = `${path}.columns[${index}]`;
    if (!isRecord(column)) return `${at}: expected a column object`;
    for (const key of Object.keys(column)) {
      if (key !== "key" && key !== "label") return `${at}.${key}: unknown property ${quoted(key)}; allowed: key, label`;
    }
    if (typeof column.key !== "string" || column.key === "") return `${at}.key: expected a non-empty string`;
    if (typeof column.label !== "string") return `${at}.label: expected a string`;
  }
  if (!Array.isArray(node.rows)) return `${path}.rows: expected an array of at most ${MAX_ROWS} rows`;
  if (node.rows.length > MAX_ROWS) return `${path}.rows: ${node.rows.length} rows exceeds the limit of ${MAX_ROWS}`;
  for (let row = 0; row < node.rows.length; row += 1) {
    const cells = node.rows[row];
    if (!Array.isArray(cells)) return `${path}.rows[${row}]: expected an array of cells`;
    for (let column = 0; column < cells.length; column += 1) {
      const at = `${path}.rows[${row}][${column}]`;
      if (isFormula(cells[column])) {
        ctx.formulas.push({ source: cells[column]["="], path: at, kind: "scalar" });
        continue;
      }
      const text = cellText(cells[column]);
      if (text.length > MAX_CELL) return `${at}: ${text.length} characters exceeds the limit of ${MAX_CELL}`;
    }
  }
  return void 0;
}
function checkChart(node, path, ctx) {
  if (node.kind !== void 0 && !CHART_KINDS.includes(node.kind)) return `${path}.kind: unknown chart ${quoted(node.kind)}; allowed: ${allowed(CHART_KINDS)}`;
  if (!Array.isArray(node.categories) || node.categories.length === 0) return `${path}.categories: expected a non-empty array of labels`;
  for (let index = 0; index < node.categories.length; index += 1) {
    const label = node.categories[index];
    if (typeof label !== "string" && !isNumber(label)) return `${path}.categories[${index}]: expected a string`;
  }
  if (!Array.isArray(node.series) || node.series.length === 0) return `${path}.series: expected a non-empty array of { name?, values }`;
  if (node.kind === "donut" && node.series.length > 1) return `${path}.series: a donut takes one series; got ${node.series.length}`;
  for (let index = 0; index < node.series.length; index += 1) {
    const series = node.series[index];
    const at = `${path}.series[${index}]`;
    if (!isRecord(series)) return `${at}: expected a series object`;
    for (const key of Object.keys(series)) {
      if (key !== "name" && key !== "values") return `${at}.${key}: unknown property ${quoted(key)}; allowed: name, values`;
    }
    if (series.name !== void 0 && typeof series.name !== "string") return `${at}.name: expected a string`;
    if (!Array.isArray(series.values)) return `${at}.values: expected an array of numbers`;
    if (series.values.length !== node.categories.length) return `${at}.values: ${series.values.length} values for ${node.categories.length} categories`;
    for (let item = 0; item < series.values.length; item += 1) {
      const value = series.values[item];
      if (isFormula(value)) ctx.formulas.push({ source: value["="], path: `${at}.values[${item}]`, kind: "number" });
      else if (!isNumber(value)) return `${at}.values[${item}]: expected a number`;
    }
  }
  if (node.unit !== void 0 && typeof node.unit !== "string") return `${path}.unit: expected a string`;
  if (node.caption !== void 0 && typeof node.caption !== "string") return `${path}.caption: expected a string`;
  return void 0;
}
function checkProgress(node, path, ctx) {
  if (node.label !== void 0 && typeof node.label !== "string") return `${path}.label: expected a string`;
  if (node.percent === void 0 === (node.value === void 0)) return `${path}: give percent (0 to 100), or value with max`;
  if (node.percent !== void 0 && !isFormula(node.percent)) {
    if (typeof node.percent !== "number" || !Number.isFinite(node.percent) || node.percent < 0 || node.percent > 100) return `${path}.percent: expected a number from 0 to 100`;
  }
  if (node.value !== void 0 && node.max === void 0) return `${path}.max: expected a number with value`;
  if (node.value === void 0 && node.max !== void 0) return `${path}.value: expected a number with max`;
  return checkValue(node, "percent", path, ctx, "number") ?? checkValue(node, "value", path, ctx, "number") ?? checkValue(node, "max", path, ctx, "number") ?? checkValue(node, "valueLabel", path, ctx, "scalar") ?? checkValue(node, "tone", path, ctx, TONES);
}
function checkCallout(node, path, ctx) {
  return checkValue(node, "text", path, ctx, "string", { required: true }) ?? checkValue(node, "tone", path, ctx, CALLOUT_TONES);
}
function checkSources(node, path) {
  if (!Array.isArray(node.items) || node.items.length === 0) return `${path}.items: expected a non-empty array of { label, url }`;
  for (let index = 0; index < node.items.length; index += 1) {
    const item = node.items[index];
    const at = `${path}.items[${index}]`;
    if (!isRecord(item)) return `${at}: expected a { label, url } object`;
    for (const key of Object.keys(item)) {
      if (key !== "label" && key !== "url") return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, url`;
    }
    if (typeof item.label !== "string" || item.label.trim() === "") return `${at}.label: expected a non-empty string`;
    if (typeof item.url !== "string" || !/^https?:\/\/[^\s]+$/i.test(item.url)) return `${at}.url: expected an http(s) address`;
  }
  return void 0;
}
function checkHtml(node, path) {
  if (typeof node.html !== "string" || node.html.trim() === "") return `${path}.html: expected a non-empty string`;
  if (typeof node.summary !== "string" || node.summary.trim() === "") return `${path}.summary: expected one line that says what the view shows`;
  if (node.height !== void 0 && (!isNumber(node.height) || node.height <= 0)) return `${path}.height: expected a positive number of pixels`;
  return void 0;
}
function checkInputId(node, path, ctx) {
  if (!isName(node.id) || RESERVED.has(node.id)) return `${path}.id: an input id is letters, digits and _, and starts with a letter or _, so formulas can use it`;
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`;
  ctx.ids.add(node.id);
  if (typeof node.label !== "string") return `${path}.label: expected a string`;
  return void 0;
}
function checkNumberInput(node, path, ctx) {
  const idError = checkInputId(node, path, ctx);
  if (idError !== void 0) return idError;
  for (const key of ["min", "max", "step"]) {
    if (node[key] !== void 0 && !isNumber(node[key])) return `${path}.${key}: expected a number`;
  }
  if (node.type === "slider" && (node.min === void 0 || node.max === void 0)) return `${path}: a slider needs min and max`;
  if (node.min !== void 0 && node.max !== void 0 && node.max <= node.min) return `${path}.max: expected more than min (${node.min})`;
  if (node.step !== void 0 && node.step <= 0) return `${path}.step: expected more than 0`;
  if (!isNumber(node.value)) return `${path}.value: expected a number`;
  if (node.min !== void 0 && node.value < node.min || node.max !== void 0 && node.value > node.max) return `${path}.value: expected a number from ${node.min ?? "-∞"} to ${node.max ?? "∞"}`;
  if (node.unit !== void 0 && typeof node.unit !== "string") return `${path}.unit: expected a string`;
  ctx.inputs.set(node.id, node.value);
  return void 0;
}
function checkChoice(node, path, ctx) {
  const idError = checkInputId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (!Array.isArray(node.options) || node.options.length === 0) return `${path}.options: expected a non-empty array of { label, value }`;
  const labels = /* @__PURE__ */ new Set();
  const values = /* @__PURE__ */ new Set();
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index];
    const at = `${path}.options[${index}]`;
    if (!isRecord(option)) return `${at}: expected a { label, value } object`;
    for (const key of Object.keys(option)) {
      if (key !== "label" && key !== "value") return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, value`;
    }
    if (typeof option.label !== "string" || option.label.trim() === "") return `${at}.label: expected a non-empty string`;
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`;
    labels.add(option.label);
    const value = option.value ?? option.label;
    if (!isScalar(value)) return `${at}.value: expected a string, a number or true/false`;
    if (values.has(value)) return `${at}.value: duplicate value ${quoted(value)}`;
    values.add(value);
  }
  const chosen = node.value ?? choiceValue(node.options[0]);
  if (!values.has(chosen)) return `${path}.value: expected one of the options' values`;
  ctx.inputs.set(node.id, chosen);
  return void 0;
}
function checkToggle(node, path, ctx) {
  const idError = checkInputId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (node.value !== void 0 && typeof node.value !== "boolean") return `${path}.value: expected true or false`;
  ctx.inputs.set(node.id, node.value === true);
  return void 0;
}
function checkOptions(node, path, ctx) {
  const idError = checkId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (node.multi !== void 0 && typeof node.multi !== "boolean") return `${path}.multi: expected a boolean`;
  if (!Array.isArray(node.options)) return `${path}.options: expected an array of 1 to ${MAX_OPTIONS} options`;
  if (node.options.length < 1 || node.options.length > MAX_OPTIONS) return `${path}.options: expected 1 to ${MAX_OPTIONS} options; got ${node.options.length}`;
  const labels = /* @__PURE__ */ new Set();
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index];
    const at = `${path}.options[${index}]`;
    if (!isRecord(option)) return `${at}: expected an option object`;
    for (const key of Object.keys(option)) {
      if (key !== "label" && key !== "description") return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, description`;
    }
    if (typeof option.label !== "string" || option.label.trim() === "") return `${at}.label: expected a non-empty string`;
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`;
    labels.add(option.label);
    if (option.description !== void 0 && typeof option.description !== "string") return `${at}.description: expected a string`;
  }
  return void 0;
}
function checkConfirm(node, path, ctx) {
  const idError = checkId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (node.confirmLabel !== void 0 && typeof node.confirmLabel !== "string") return `${path}.confirmLabel: expected a string`;
  if (node.cancelLabel !== void 0 && typeof node.cancelLabel !== "string") return `${path}.cancelLabel: expected a string`;
  return void 0;
}
function checkForm(node, path, ctx) {
  const idError = checkId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (node.submitLabel !== void 0 && typeof node.submitLabel !== "string") return `${path}.submitLabel: expected a string`;
  if (!Array.isArray(node.fields)) return `${path}.fields: expected an array of at most ${MAX_FIELDS} fields`;
  if (node.fields.length > MAX_FIELDS) return `${path}.fields: ${node.fields.length} fields exceeds the limit of ${MAX_FIELDS}`;
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < node.fields.length; index += 1) {
    const field = node.fields[index];
    const at = `${path}.fields[${index}]`;
    if (!isRecord(field)) return `${at}: expected a field object`;
    for (const key of Object.keys(field)) {
      if (key !== "id" && key !== "label" && key !== "placeholder") return `${at}.${key}: unknown property ${quoted(key)}; allowed: id, label, placeholder`;
    }
    if (typeof field.id !== "string" || field.id === "") return `${at}.id: expected a non-empty string`;
    if (field.id === "__proto__") return `${at}.id: "__proto__" cannot be an id`;
    if (seen.has(field.id)) return `${at}.id: duplicate field id ${quoted(field.id)}`;
    seen.add(field.id);
    if (typeof field.label !== "string") return `${at}.label: expected a string`;
    if (field.placeholder !== void 0 && typeof field.placeholder !== "string") return `${at}.placeholder: expected a string`;
  }
  return void 0;
}
function checkSubmit(node, path, ctx) {
  const idError = checkId(node, path, ctx);
  if (idError !== void 0) return idError;
  if (node.label !== void 0 && typeof node.label !== "string") return `${path}.label: expected a string`;
  return void 0;
}
function checkId(node, path, ctx) {
  if (typeof node.id !== "string" || node.id === "") return `${path}.id: expected a non-empty string`;
  if (node.id === "__proto__") return `${path}.id: "__proto__" cannot be an id`;
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`;
  ctx.ids.add(node.id);
  return void 0;
}
function checkFormulas(ctx) {
  const known = /* @__PURE__ */ new Set([...ctx.inputs.keys(), ...ctx.lets.keys()]);
  const lets = /* @__PURE__ */ new Map();
  for (const [name, entry] of ctx.lets) {
    if (ctx.inputs.has(name)) return `${entry.path}: ${quoted(name)} is already an input id`;
    const compiled2 = compileFormula(entry.source);
    if (compiled2.error !== void 0) return `${entry.path}: ${compiled2.error}`;
    const unknown = compiled2.names.find((item) => !known.has(item));
    if (unknown !== void 0) return `${entry.path}: unknown name ${quoted(unknown)}; known: ${allowed([...known]) || "(none)"}`;
    lets.set(name, compiled2.tree);
  }
  const lookup = createScope(ctx.inputs, lets);
  for (const [name, entry] of ctx.lets) {
    const result = evaluate(lets.get(name), lookup);
    if (result.error !== void 0) return `${entry.path}: ${result.error}`;
  }
  for (const formula of ctx.formulas) {
    const compiled2 = compileFormula(formula.source);
    if (compiled2.error !== void 0) return `${formula.path}: ${compiled2.error}`;
    const unknown = compiled2.names.find((item) => !known.has(item));
    if (unknown !== void 0) return `${formula.path}: unknown name ${quoted(unknown)}; known: ${allowed([...known]) || "(none)"}`;
    const result = evaluate(compiled2.tree, lookup);
    if (result.error !== void 0) return `${formula.path}: ${result.error}`;
    const problem = kindProblem(result.value, formula.kind);
    if (problem !== void 0) return `${formula.path}: the formula gives ${quoted(result.value)}; ${problem}`;
  }
  return void 0;
}
function kindProblem(value, kind) {
  if (kind === "number") return isNumber(value) ? void 0 : "expected a number";
  if (Array.isArray(kind)) return kind.includes(value) ? void 0 : `expected one of ${allowed(kind)}`;
  if (kind === "string") return isScalar(value) ? void 0 : "expected text";
  return isScalar(value) ? void 0 : "expected a string or a number";
}
function cellText(value) {
  if (typeof value === "string") return value;
  const text = JSON.stringify(value);
  return typeof text === "string" ? text : "";
}
var compiled = /* @__PURE__ */ new WeakMap();
var treeOf = (formula) => {
  let entry = compiled.get(formula);
  if (entry === void 0) {
    entry = compileFormula(formula["="]);
    compiled.set(formula, entry);
  }
  return entry;
};
var choiceValue = (option) => option?.value ?? option?.label;
function walk(node, visit) {
  if (!isRecord(node)) return;
  visit(node);
  if (LAYOUT.includes(node.type) && Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
}
function viewInputs(view) {
  const found = [];
  walk(view, (node) => {
    if (INPUTS.has(node.type)) found.push(node);
  });
  return found;
}
function inputDefault(node) {
  if (node.type === "toggle") return node.value === true;
  if (node.type === "choice") return node.value ?? choiceValue(Array.isArray(node.options) ? node.options[0] : void 0);
  return node.value;
}
function viewScope(view, values = {}) {
  const inputs = /* @__PURE__ */ new Map();
  for (const node of viewInputs(view)) inputs.set(node.id, Object.hasOwn(values, node.id) ? values[node.id] : inputDefault(node));
  const lets = /* @__PURE__ */ new Map();
  for (const [name, source] of Object.entries(isRecord(view?.let) ? view.let : {})) {
    const entry = compileFormula(source);
    if (entry.tree !== void 0) lets.set(name, entry.tree);
  }
  return createScope(inputs, lets);
}
function resolve(value, lookup, fallback = void 0) {
  if (!isFormula(value)) return value;
  const entry = treeOf(value);
  if (entry.tree === void 0) return fallback;
  const result = evaluate(entry.tree, lookup);
  return result.error === void 0 ? result.value : fallback;
}
var asText = (value) => value === void 0 || value === null ? "" : show(value);

// ../../app/node_modules/deep-view/src/react/chart.js
var PALETTE = ["var(--dv-accent)", "var(--dv-ink-tangerine)", "var(--dv-ink-green)", "var(--dv-ink-violet)", "var(--dv-ink-sky)", "var(--dv-ink-rose)", "var(--dv-ink-yellow)", "var(--dv-ink-cyan)", "var(--dv-ink-magenta)"];
var colorAt = (index) => PALETTE[index % PALETTE.length];
var TICK = 10;
var LABEL = 11;
var textWidth = (text, size) => [...String(text)].reduce((sum, char) => sum + (char.charCodeAt(0) > 11904 ? size : size * 0.58), 0);
var fit = (text, room, size) => {
  if (textWidth(text, size) <= room) return text;
  let out = "";
  for (const char of String(text)) {
    if (textWidth(`${out}${char}…`, size) > room) break;
    out += char;
  }
  return out === "" ? "" : `${out}…`;
};
function formatNumber(value) {
  if (!Number.isFinite(value)) return asText(value);
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(value.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}
var withUnit = (value, unit) => unit ? unit === "%" ? `${formatNumber(value)}%` : `${formatNumber(value)} ${unit}` : formatNumber(value);
function niceTicks(low, high) {
  let lo = low;
  let hi = high;
  if (lo === hi) {
    lo = Math.min(0, lo);
    hi = hi === 0 ? 1 : Math.max(0, hi);
  }
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((scale) => scale * magnitude).find((candidate) => candidate >= raw);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
function chartData(node, lookup) {
  const categories = (Array.isArray(node.categories) ? node.categories : []).map(asText);
  const series = (Array.isArray(node.series) ? node.series : []).map((item, index) => ({
    name: typeof item?.name === "string" ? item.name : "",
    color: colorAt(index),
    values: categories.map((_, at) => {
      const value = Number(resolve(Array.isArray(item?.values) ? item.values[at] : void 0, lookup, 0));
      return Number.isFinite(value) ? value : 0;
    })
  }));
  return { kind: node.kind ?? "bar", categories, series, unit: typeof node.unit === "string" ? node.unit : "" };
}
var csvCell = (value) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
function chartCsv({ categories, series, unit }, t2 = (key) => key) {
  const head = ["", ...series.map((item, index) => item.name || (series.length === 1 ? unit || t2("Value") : `${t2("Series")} ${index + 1}`))];
  const rows2 = categories.map((label, at) => [label, ...series.map((item) => String(item.values[at]))]);
  return [head, ...rows2].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
}
function valueAxis(values, zero) {
  const finite = values.length > 0 ? values : [0];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  if (zero) return niceTicks(Math.min(0, low), Math.max(0, high));
  const pad = (high - low) * 0.1 || Math.abs(high) * 0.1 || 1;
  return niceTicks(low - pad, high + pad);
}
function columns({ categories, series, unit, kind }, width, active, shown) {
  const visible = series.filter((_, index) => shown[index]);
  const ticks = valueAxis(visible.flatMap((item) => item.values), kind !== "line");
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const left = Math.ceil(Math.max(...ticks.map((tick) => textWidth(withUnit(tick, unit), TICK)))) + 10;
  const top = 8;
  const height = 220;
  const bottom = 24;
  const plot = { x: left, y: top, w: Math.max(40, width - left - 4), h: height - top - bottom };
  const y = (value) => plot.y + plot.h - (value - lo) / (hi - lo) * plot.h;
  const band = plot.w / categories.length;
  const parts = [];
  for (const tick of ticks) {
    parts.push((0, import_react8.createElement)("line", { key: `g${tick}`, className: "dv-chart-grid", x1: plot.x, x2: plot.x + plot.w, y1: y(tick), y2: y(tick) }));
    parts.push((0, import_react8.createElement)("text", { key: `t${tick}`, className: "dv-chart-tick", x: plot.x - 8, y: y(tick) + 3, textAnchor: "end" }, withUnit(tick, unit)));
  }
  const points = [];
  categories.forEach((label, at) => {
    const cx = plot.x + band * at + band / 2;
    parts.push((0, import_react8.createElement)("text", { key: `c${at}`, className: "dv-chart-label", x: cx, y: height - 7, textAnchor: "middle" }, fit(label, band - 4, LABEL)));
    points.push({ x: cx, y: y(Math.max(...visible.map((item) => item.values[at]), lo)) });
  });
  if (kind === "bar") {
    const group = band * 0.72;
    const gap = visible.length > 1 ? 2 : 0;
    const barW = Math.max(2, (group - gap * (visible.length - 1)) / visible.length);
    const zero = y(Math.max(lo, Math.min(0, hi)));
    categories.forEach((_, at) => {
      visible.forEach((item, row) => {
        const value = item.values[at];
        const x = plot.x + band * at + (band - group) / 2 + row * (barW + gap);
        const top2 = Math.min(y(value), zero);
        const tall = Math.max(1, Math.abs(y(value) - zero));
        const r = Math.min(4, barW / 2, tall);
        const up = value >= 0;
        const d = up ? `M${x},${top2 + tall}V${top2 + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${top2 + tall}z` : `M${x},${top2}V${top2 + tall - r}q0,${r} ${r},${r}h${barW - 2 * r}q${r},0 ${r},-${r}V${top2}z`;
        parts.push((0, import_react8.createElement)("path", { key: `b${at}-${row}`, className: "dv-chart-mark", "data-dim": active !== null && active !== at ? "" : void 0, d, style: { fill: item.color } }));
      });
    });
  } else {
    const xs = categories.map((_, at) => plot.x + band * at + band / 2);
    visible.forEach((item, row) => {
      const line = item.values.map((value, at) => `${at === 0 ? "M" : "L"}${xs[at]},${y(value)}`).join("");
      if (kind === "area") {
        const base = y(Math.max(lo, Math.min(0, hi)));
        parts.push((0, import_react8.createElement)("path", { key: `a${row}`, className: "dv-chart-area", d: `${line}L${xs.at(-1)},${base}L${xs[0]},${base}z`, style: { fill: item.color } }));
      }
      parts.push((0, import_react8.createElement)("path", { key: `l${row}`, className: "dv-chart-line", d: line, style: { stroke: item.color } }));
      item.values.forEach((value, at) => {
        parts.push((0, import_react8.createElement)("circle", { key: `p${row}-${at}`, className: "dv-chart-dot", cx: xs[at], cy: y(value), r: active === at ? 4 : 2.5, style: { fill: item.color } }));
      });
    });
    if (active !== null) parts.unshift((0, import_react8.createElement)("line", { key: "guide", className: "dv-chart-guide", x1: xs[active], x2: xs[active], y1: plot.y, y2: plot.y + plot.h }));
  }
  const hits = categories.map((_, at) => ({ x: plot.x + band * at, y: plot.y, w: band, h: plot.h }));
  return { parts, height, points, hits };
}
function rows({ categories, series, unit }, width, active, shown) {
  const visible = series.filter((_, index) => shown[index]);
  const ticks = valueAxis(visible.flatMap((item) => item.values), true);
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const labelW = Math.min(width * 0.38, Math.ceil(Math.max(...categories.map((label) => textWidth(label, LABEL)))) + 10);
  const valueW = Math.ceil(Math.max(...visible.flatMap((item) => item.values).map((value) => textWidth(withUnit(value, unit), LABEL)))) + 10;
  const barH = 14;
  const rowH = 10 + visible.length * barH + (visible.length - 1) * 2;
  const top = 4;
  const height = top + rowH * categories.length + 22;
  const plot = { x: labelW, y: top, w: Math.max(40, width - labelW - valueW), h: rowH * categories.length };
  const x = (value) => plot.x + (value - lo) / (hi - lo) * plot.w;
  const parts = [];
  for (const tick of ticks) {
    parts.push((0, import_react8.createElement)("line", { key: `g${tick}`, className: "dv-chart-grid", x1: x(tick), x2: x(tick), y1: plot.y, y2: plot.y + plot.h }));
    parts.push((0, import_react8.createElement)("text", { key: `t${tick}`, className: "dv-chart-tick", x: x(tick), y: height - 6, textAnchor: "middle" }, withUnit(tick, unit)));
  }
  const points = [];
  const zero = x(Math.max(lo, Math.min(0, hi)));
  categories.forEach((label, at) => {
    const rowY = plot.y + rowH * at + 5;
    parts.push((0, import_react8.createElement)("text", { key: `c${at}`, className: "dv-chart-label", x: labelW - 10, y: rowY + (rowH - 10) / 2 + 4, textAnchor: "end" }, fit(label, labelW - 12, LABEL)));
    visible.forEach((item, row) => {
      const value = item.values[at];
      const by = rowY + row * (barH + 2);
      const left = Math.min(x(value), zero);
      const long = Math.max(1, Math.abs(x(value) - zero));
      parts.push((0, import_react8.createElement)("rect", { key: `b${at}-${row}`, className: "dv-chart-mark", "data-dim": active !== null && active !== at ? "" : void 0, x: left, y: by, width: long, height: barH, rx: Math.min(4, long / 2), style: { fill: item.color } }));
      parts.push((0, import_react8.createElement)("text", { key: `v${at}-${row}`, className: "dv-chart-value", x: left + long + 6, y: by + barH - 3 }, withUnit(value, unit)));
    });
    points.push({ x: Math.max(...visible.map((item) => x(item.values[at])), zero), y: rowY });
  });
  const hits = categories.map((_, at) => ({ x: 0, y: plot.y + rowH * at, w: width, h: rowH }));
  return { parts, height, points, hits };
}
function donut({ categories, series }, width, active, hover) {
  const values = (series[0]?.values ?? []).map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const size = Math.min(180, Math.max(120, width * 0.42));
  const r = size / 2;
  const inner = r * 0.62;
  const cx = r;
  const cy = r;
  const parts = [];
  const points = [];
  let angle = -Math.PI / 2;
  values.forEach((value, at) => {
    const sweep = total > 0 ? value / total * Math.PI * 2 : 0;
    const end = angle + sweep;
    const mid = angle + sweep / 2;
    points.push({ x: cx + Math.cos(mid) * (r - (r - inner) / 2), y: cy + Math.sin(mid) * (r - (r - inner) / 2) });
    if (sweep > 0) {
      const large = sweep > Math.PI ? 1 : 0;
      const full = sweep >= Math.PI * 2 - 1e-6;
      const p = (radius, theta) => `${cx + Math.cos(theta) * radius},${cy + Math.sin(theta) * radius}`;
      const d = full ? `M${p(r, angle)}A${r},${r} 0 1 1 ${p(r, angle + Math.PI)}A${r},${r} 0 1 1 ${p(r, angle)}M${p(inner, angle)}A${inner},${inner} 0 1 0 ${p(inner, angle + Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, angle)}z` : `M${p(r, angle)}A${r},${r} 0 ${large} 1 ${p(r, end)}L${p(inner, end)}A${inner},${inner} 0 ${large} 0 ${p(inner, angle)}z`;
      parts.push((0, import_react8.createElement)("path", { key: `s${at}`, className: "dv-chart-mark", "data-dim": active !== null && active !== at ? "" : void 0, d, fillRule: "evenodd", style: { fill: colorAt(at) }, onPointerEnter: () => hover(at) }));
    }
    angle = end;
  });
  return { parts, height: size, size, points, total, values, categories };
}
function useWidth(box, initial) {
  const [width, setWidth] = (0, import_react8.useState)(initial);
  (0, import_react8.useLayoutEffect)(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver !== "function") return void 0;
    const measure = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return width;
}
var INLINE = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "font-size", "font-family", "font-weight"];
function saveImage(svg, name) {
  const clone = svg.cloneNode(true);
  const live = [svg, ...svg.querySelectorAll("*")];
  const copy = [clone, ...clone.querySelectorAll("*")];
  live.forEach((node, index) => {
    const style = getComputedStyle(node);
    copy[index].setAttribute("style", INLINE.map((prop) => `${prop}:${style.getPropertyValue(prop)}`).join(";"));
  });
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const page = getComputedStyle(document.body);
  const background = page.getPropertyValue("--dv-main").trim() || page.backgroundColor;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  const image = new Image();
  image.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const paint = canvas.getContext("2d");
    paint.fillStyle = background;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1e3);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}
var TableIcon = () => (0, import_react8.createElement)(
  "svg",
  { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
  (0, import_react8.createElement)("path", { d: "M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4z" }),
  (0, import_react8.createElement)("path", { d: "M3 8.5h14M8 8.5V16" })
);
function ChartTable({ data }) {
  const ui2 = useViewUi();
  const { categories, series, unit } = data;
  const heads = series.map((item, index) => item.name || (series.length === 1 ? unit || ui2.t("Value") : `${ui2.t("Series")} ${index + 1}`));
  return (0, import_react8.createElement)(
    "div",
    { className: "dv-widget-table" },
    (0, import_react8.createElement)(
      "table",
      null,
      (0, import_react8.createElement)("thead", null, (0, import_react8.createElement)("tr", null, (0, import_react8.createElement)("th", { scope: "col" }), heads.map((head, index) => (0, import_react8.createElement)("th", { key: index, scope: "col", className: "dv-num" }, head)))),
      (0, import_react8.createElement)("tbody", null, categories.map((label, at) => (0, import_react8.createElement)(
        "tr",
        { key: at },
        (0, import_react8.createElement)("th", { scope: "row" }, label),
        series.map((item, index) => (0, import_react8.createElement)("td", { key: index, className: "dv-num" }, withUnit(item.values[at], series.length === 1 && !item.name ? "" : unit)))
      )))
    )
  );
}
function WidgetChart({ node, lookup, registerChart, refreshCharts }) {
  const ui2 = useViewUi();
  const data = chartData(node, lookup);
  const { kind, categories, series, unit } = data;
  const box = (0, import_react8.useRef)(null);
  const svg = (0, import_react8.useRef)(null);
  const width = useWidth(box, 520);
  const [active, setActive] = (0, import_react8.useState)(null);
  const [hidden, setHidden] = (0, import_react8.useState)([]);
  const [asTable, setAsTable] = (0, import_react8.useState)(false);
  const [copied, setCopied] = (0, import_react8.useState)(false);
  const labelId = (0, import_react8.useId)();
  const menuKey = (0, import_react8.useId)();
  const table = (0, import_react8.useRef)(asTable);
  table.current = asTable;
  const shown = series.map((_, index) => !hidden.includes(index));
  const toggle = (index) => {
    if (hidden.includes(index)) setHidden(hidden.filter((item) => item !== index));
    else if (shown.filter(Boolean).length > 1) setHidden([...hidden, index]);
  };
  const label = typeof node.caption === "string" && node.caption !== "" ? node.caption : ui2.t("Chart");
  const isDonut = kind === "donut";
  const legendBeside = isDonut && width >= 360;
  const drawn = isDonut ? donut(data, legendBeside ? width - 200 : width, active, setActive) : kind === "hbar" ? rows(data, width, active, shown) : columns(data, width, active, shown);
  const svgWidth = isDonut ? drawn.size : width;
  const move = (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (keys[event.key] === void 0) return;
    event.preventDefault();
    setActive((current) => current === null ? 0 : (current + keys[event.key] + categories.length) % categories.length);
  };
  const point = active === null ? null : drawn.points[active];
  const share = (at) => unit === "%" ? withUnit(drawn.values[at], unit) : `${withUnit(drawn.values[at], unit)} · ${drawn.total > 0 ? Math.round(drawn.values[at] / drawn.total * 100) : 0}%`;
  const tipRows = active === null || isDonut ? [] : series.filter((_, index) => shown[index]).map((item) => ({ color: item.color, name: item.name, value: withUnit(item.values[active], unit) }));
  const copy = () => {
    void navigator.clipboard?.writeText(chartCsv(data, ui2.t)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  const toggleTable = () => {
    table.current = !table.current;
    setAsTable(table.current);
  };
  const menuLabel = typeof node.caption === "string" && node.caption !== "" ? node.caption : null;
  const action = (0, import_react8.useRef)(null);
  action.current = { label: menuLabel, copy, save: () => {
    if (svg.current) saveImage(svg.current, "chart.png");
  }, toggleTable };
  (0, import_react8.useEffect)(() => registerChart?.(menuKey, {
    get label() {
      return action.current.label;
    },
    get asTable() {
      return table.current;
    },
    toggleTable: () => action.current.toggleTable(),
    copy: () => action.current.copy(),
    save: () => action.current.save()
  }), [registerChart, menuKey]);
  (0, import_react8.useEffect)(() => refreshCharts?.(), [refreshCharts, asTable, menuLabel]);
  const legend = isDonut ? (0, import_react8.createElement)("div", { className: "dv-chart-legend dv-chart-legend-list" }, categories.map((name, at) => (0, import_react8.createElement)(
    "div",
    {
      key: at,
      className: "dv-chart-key",
      "data-dim": active !== null && active !== at ? "" : void 0,
      onPointerEnter: () => setActive(at),
      onPointerLeave: () => setActive(null)
    },
    (0, import_react8.createElement)("i", { style: { background: colorAt(at) } }),
    (0, import_react8.createElement)("span", { className: "dv-chart-key-name" }, name),
    (0, import_react8.createElement)("span", { className: "dv-chart-key-value" }, share(at))
  ))) : series.length > 1 ? (0, import_react8.createElement)("div", { className: "dv-chart-legend" }, series.map((item, index) => (0, import_react8.createElement)("button", {
    key: index,
    type: "button",
    className: "dv-chart-key",
    "aria-pressed": shown[index],
    onClick: () => toggle(index)
  }, (0, import_react8.createElement)("i", { style: { background: item.color } }), item.name || `${ui2.t("Series")} ${index + 1}`))) : null;
  const plot = (0, import_react8.createElement)(
    "div",
    { className: "dv-chart-plot", style: isDonut ? { width: svgWidth } : void 0 },
    (0, import_react8.createElement)(
      "svg",
      {
        ref: svg,
        className: "dv-chart-svg",
        width: svgWidth,
        height: drawn.height,
        viewBox: `0 0 ${svgWidth} ${drawn.height}`,
        role: "img",
        "aria-labelledby": labelId,
        tabIndex: 0,
        onKeyDown: move,
        onBlur: () => setActive(null),
        onPointerLeave: () => setActive(null)
      },
      drawn.parts,
      isDonut ? active === null ? (0, import_react8.createElement)("text", { className: "dv-chart-center", x: svgWidth / 2, y: drawn.height / 2 + 5, textAnchor: "middle" }, unit === "%" ? "" : withUnit(drawn.total, unit)) : (0, import_react8.createElement)(
        import_react8.Fragment,
        null,
        (0, import_react8.createElement)("text", { className: "dv-chart-center-name", x: svgWidth / 2, y: drawn.height / 2 - 4, textAnchor: "middle" }, fit(categories[active], drawn.size * 0.56, LABEL)),
        (0, import_react8.createElement)("text", { className: "dv-chart-center", x: svgWidth / 2, y: drawn.height / 2 + 14, textAnchor: "middle" }, share(active))
      ) : drawn.hits.map((hit, at) => (0, import_react8.createElement)("rect", { key: `h${at}`, className: "dv-chart-hit", x: hit.x, y: hit.y, width: hit.w, height: hit.h, onPointerEnter: () => setActive(at) }))
    ),
    point && !asTable && !isDonut ? (0, import_react8.createElement)(
      "div",
      { className: "dv-chart-tip", role: "status", style: { left: point.x, top: point.y } },
      (0, import_react8.createElement)("b", null, categories[active]),
      tipRows.map((row, index) => (0, import_react8.createElement)("span", { key: index }, (0, import_react8.createElement)("i", { style: { background: row.color } }), row.name ? `${row.name}  ` : "", row.value))
    ) : null
  );
  const body = asTable ? (0, import_react8.createElement)(ChartTable, { data }) : isDonut ? (0, import_react8.createElement)("div", { className: legendBeside ? "dv-chart-donut dv-chart-donut-beside" : "dv-chart-donut", onPointerLeave: () => setActive(null) }, plot, legend) : (0, import_react8.createElement)(import_react8.Fragment, null, legend, plot);
  return (0, import_react8.createElement)(
    "figure",
    { ref: box, className: "dv-chart", "data-kind": kind },
    (0, import_react8.createElement)("span", { id: labelId, hidden: true }, label),
    body,
    // The SVG stays mounted under the table, so the image can still be saved from it.
    asTable ? (0, import_react8.createElement)("div", { hidden: true }, plot) : null,
    copied ? (0, import_react8.createElement)("span", { className: "dv-chart-copied", role: "status" }, ui2.t("Copied")) : null,
    typeof node.caption === "string" && node.caption !== "" ? (0, import_react8.createElement)("figcaption", { className: "dv-view-caption" }, node.caption) : null
  );
}
var CHART_CSS = `
.dv-chart{position:relative;margin:0;min-width:0;display:flex;flex-direction:column;gap:8px}
.dv-chart-plot{position:relative;min-width:0}
.dv-chart-svg{display:block;overflow:visible;outline:none;font-family:inherit}
.dv-chart-svg text{pointer-events:none}
.dv-chart-svg:focus-visible{outline:2px solid var(--dv-accent);outline-offset:4px;border-radius:4px}
.dv-chart-grid{stroke:var(--dv-line);stroke-width:1;stroke-dasharray:3 3}
.dv-chart-tick{font-size:${TICK}px;fill:var(--dv-ink-3);font-variant-numeric:tabular-nums}
.dv-chart-label{font-size:${LABEL}px;fill:var(--dv-ink-2)}
.dv-chart-value{font-size:${LABEL}px;fill:var(--dv-ink-2);font-variant-numeric:tabular-nums}
.dv-chart-center{font-size:15px;font-weight:600;fill:var(--dv-ink);font-variant-numeric:tabular-nums}
.dv-chart-center-name{font-size:${LABEL}px;fill:var(--dv-ink-2)}
.dv-chart-mark{transition:opacity .12s ease}
.dv-chart-mark[data-dim]{opacity:.28}
.dv-chart-line{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dv-chart-area{opacity:.14}
.dv-chart-dot{transition:r .12s ease}
.dv-chart-guide{stroke:var(--dv-line-2);stroke-width:1}
.dv-chart-hit{fill:transparent}
.dv-chart-tip{position:absolute;z-index:4;pointer-events:none;transform:translate(-50%,calc(-100% - 8px));display:flex;flex-direction:column;gap:2px;padding:6px 10px;border-radius:10px;background:var(--dv-main);border:.5px solid var(--dv-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);font-size:12px;line-height:16px;color:var(--dv-ink);white-space:nowrap;font-variant-numeric:tabular-nums;animation:dv-veil-in .12s ease-out}
.dv-chart-tip b{font-weight:600}
.dv-chart-tip span{display:flex;align-items:center;gap:6px;color:var(--dv-ink-2)}
.dv-chart-tip i,.dv-chart-key i{flex:none;width:8px;height:8px;border-radius:50%;corner-shape:round}
.dv-chart-legend{display:flex;flex-wrap:wrap;gap:4px 12px;padding-right:32px}
.dv-chart-key{display:inline-flex;align-items:center;gap:6px;min-height:20px;padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:16px;color:var(--dv-ink-2);cursor:pointer;transition:opacity .12s ease}
.dv-chart-key[aria-pressed=false]{opacity:.4}
.dv-chart-key:focus-visible{outline:2px solid var(--dv-accent);outline-offset:2px;border-radius:4px}
.dv-chart-legend-list{flex-direction:column;flex-wrap:nowrap;gap:6px;padding:0;min-width:0}
.dv-chart-legend-list .dv-chart-key{cursor:default;width:100%}
.dv-chart-legend-list .dv-chart-key[data-dim]{opacity:.4}
.dv-chart-key-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dv-ink)}
.dv-chart-key-value{flex:none;font-variant-numeric:tabular-nums}
.dv-chart-donut{display:flex;flex-direction:column;align-items:center;gap:12px}
.dv-chart-donut-beside{flex-direction:row;align-items:center;gap:24px}
.dv-chart-donut-beside .dv-chart-legend-list{flex:1 1 auto;max-width:280px}
.dv-chart-copied{position:absolute;top:2px;right:36px;font-size:12px;line-height:16px;color:var(--dv-ink-2);animation:dv-veil-in .16s ease-out}
.dv-widget-table .dv-num{text-align:end;font-variant-numeric:tabular-nums}
.dv-widget-table tbody th{padding:6px 10px;font-weight:400;text-align:start;color:var(--dv-ink);border-bottom:0}
@media (prefers-reduced-motion:reduce){.dv-chart-mark,.dv-chart-dot{transition:none}.dv-chart-tip{animation:none}}
`;

// ../../app/node_modules/deep-view/src/react/frame.js
var import_react9 = require("react");
var THEME_VARS = [
  ["--view-ink", "--bt-ink", "--dv-ink"],
  ["--view-ink-2", "--bt-ink-2", "--dv-ink-2"],
  ["--view-ink-3", "--bt-ink-3", "--dv-ink-3"],
  ["--view-line", "--bt-line", "--dv-line"],
  ["--view-line-2", "--bt-line-2", "--dv-line-2"],
  ["--view-card", "--bt-card", "--dv-card"],
  ["--view-main", "--bt-main", "--dv-main"],
  ["--view-hover", "--bt-hover", "--dv-hover"],
  ["--view-accent", "--bt-accent", "--dv-accent"],
  ["--view-accent-ink", "--bt-accent-ink", "--dv-accent-ink"],
  ["--view-green", "--bt-green", "--dv-green"],
  ["--view-star", "--bt-star", "--dv-star"],
  ["--view-danger", "--bt-danger", "--dv-danger"]
];
var FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";
var HEIGHT = "dv-view-height";
var THEME = "dv-view-theme";
var MIN_HEIGHT = 24;
function themeVars() {
  if (typeof getComputedStyle !== "function" || typeof document === "undefined" || !document.body) return {};
  const style = getComputedStyle(document.body);
  const vars = {};
  for (const [view, legacy, source] of THEME_VARS) {
    const value = style.getPropertyValue(source).trim();
    if (value === "") continue;
    vars[view] = value;
    vars[legacy] = value;
  }
  vars["color-scheme"] = style.getPropertyValue("color-scheme").trim() || "normal";
  return vars;
}
var cssValue = (value) => String(value).replace(/[<>{};]/g, "");
function frameDocument(html, vars = {}) {
  const root = Object.entries(vars).map(([name, value]) => `${name}:${cssValue(value)}`).join(";");
  const report = `(()=>{const send=()=>parent.postMessage({type:${JSON.stringify(HEIGHT)},height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*');new ResizeObserver(send).observe(document.documentElement);addEventListener('load',send);addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.type!==${JSON.stringify(THEME)})return;for(const[k,v]of Object.entries(e.data.vars||{}))document.documentElement.style.setProperty(k,String(v))})})()`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><style>:root{${root}}html,body{margin:0;padding:0;background:transparent;color:var(--view-ink,var(--bt-ink));font:14px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}*{box-sizing:border-box}</style><script>${report}<\/script></head><body>${html}</body></html>`;
}
function HtmlFrame({ node }) {
  const ui2 = useViewUi();
  const frame = (0, import_react9.useRef)(null);
  const loads = (0, import_react9.useRef)(0);
  const [height, setHeight] = (0, import_react9.useState)(Number.isFinite(node.height) ? node.height : 120);
  const [stopped, setStopped] = (0, import_react9.useState)(false);
  const doc = (0, import_react9.useMemo)(() => frameDocument(String(node.html ?? ""), themeVars()), [node.html]);
  (0, import_react9.useEffect)(() => {
    const onMessage = (event) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== HEIGHT) return;
      const next = Number(event.data.height);
      if (Number.isFinite(next)) setHeight(Math.max(MIN_HEIGHT, Math.ceil(next)));
    };
    window.addEventListener("message", onMessage);
    const retheme = () => frame.current?.contentWindow?.postMessage({ type: THEME, vars: themeVars() }, "*");
    const observer = typeof MutationObserver === "function" ? new MutationObserver(retheme) : null;
    observer?.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "style", "class"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer?.disconnect();
    };
  }, []);
  if (stopped) return (0, import_react9.createElement)("p", { className: "dv-view-frame-stopped" }, ui2.t("This view tried to open a page and was stopped."));
  return (0, import_react9.createElement)("iframe", {
    ref: frame,
    className: "dv-view-frame",
    title: String(node.summary ?? ""),
    sandbox: "allow-scripts",
    srcDoc: doc,
    referrerPolicy: "no-referrer",
    style: { height: `${height}px` },
    onLoad: () => {
      loads.current += 1;
      if (loads.current > 1) setStopped(true);
    }
  });
}
var HTML_CSS = `
.dv-view-frame{display:block;width:100%;border:0;background:transparent}
.dv-view-frame-stopped{margin:0;font-size:13px;line-height:18px;color:var(--dv-ink-2)}
`;

// ../../app/node_modules/deep-view/src/react/card.js
var mdLabels = (ui2) => ({ code: { copyLabel: ui2.t("Copy"), copiedLabel: ui2.t("Copied") }, footnotes: ui2.t("Footnotes") });
var TONES2 = ["good", "warn", "bad"];
var CALLOUT_TONES2 = ["info", "good", "warn", "bad"];
var optionsOf2 = (node) => (Array.isArray(node?.options) ? node.options : []).map((option) => typeof option === "string" ? { label: option } : option).filter((option) => option !== null && typeof option === "object" && option.label !== void 0);
var fieldsOf = (node) => (Array.isArray(node?.fields) ? node.fields : []).filter((field) => field !== null && typeof field === "object" && field.id !== void 0);
var cellText2 = (value) => value === null || value === void 0 ? "" : typeof value === "object" ? JSON.stringify(value) : asText(value);
var NUMERIC_CELL = /^[-+]?[\d.,]+\s?(%|[a-zA-Z]{1,4})?$/;
var countType = (node, type) => {
  if (node === null || typeof node !== "object") return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return (node.type === type ? 1 : 0) + children.reduce((sum, child) => sum + countType(child, type), 0);
};
var ANSWER_TYPES = /* @__PURE__ */ new Set(["options", "confirm", "form", "submit", "slider", "choice", "toggle", "number"]);
var hasControls = (node) => {
  if (node === null || typeof node !== "object") return false;
  if (ANSWER_TYPES.has(node.type)) return true;
  return Array.isArray(node.children) && node.children.some(hasControls);
};
var answerValues = (answer, node) => answer?.action === node.id ? answer.values : void 0;
function OptionsInput({ node, onSubmit, keys, busy = false }) {
  const ui2 = useViewUi();
  const [picked, setPicked] = (0, import_react10.useState)([]);
  const options = optionsOf2(node);
  const multi = node.multi === true;
  const choose = (label) => {
    if (busy) return;
    if (multi) {
      setPicked((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
      return;
    }
    onSubmit?.(node.id, { selected: [label] });
  };
  const submit = () => {
    if (!busy && picked.length > 0) onSubmit?.(node.id, { selected: picked });
  };
  const ownRef = (0, import_react10.useRef)(null);
  const hints = useOptionKeys2(busy || !keys ? 0 : options.length, (index) => choose(options[index].label), ownRef);
  return (0, import_react10.createElement)(
    import_react10.Fragment,
    null,
    (0, import_react10.createElement)("div", { className: "dv-q-list", role: "group" }, options.map((option, index) => {
      const selected = multi && picked.includes(option.label);
      return (0, import_react10.createElement)(
        "button",
        {
          key: option.label,
          type: "button",
          className: "dv-q-opt",
          disabled: busy,
          "aria-pressed": multi ? selected : void 0,
          "aria-keyshortcuts": hints ? keyLetter2(index).toLowerCase() : void 0,
          onClick: () => choose(option.label)
        },
        hints ? (0, import_react10.createElement)("span", { className: "dv-key", "aria-hidden": true }, keyLetter2(index)) : null,
        (0, import_react10.createElement)(
          "span",
          { className: "dv-q-body" },
          (0, import_react10.createElement)("span", { className: "dv-q-label" }, option.label),
          option.description ? (0, import_react10.createElement)("span", { className: "dv-q-desc" }, option.description) : null
        ),
        selected ? (0, import_react10.createElement)("span", { className: "dv-q-check", title: ui2.t("Selected") }, (0, import_react10.createElement)(CheckIcon2)) : null
      );
    })),
    multi ? (0, import_react10.createElement)(
      "div",
      { className: "dv-q-foot" },
      (0, import_react10.createElement)("button", { type: "button", className: "dv-q-submit", disabled: busy || picked.length === 0, onClick: submit }, ui2.t("Submit"))
    ) : null
  );
}
function SettledOptions({ node, answer }) {
  const ui2 = useViewUi();
  const selected = answerValues(answer, node)?.selected;
  const chosen = Array.isArray(selected) ? selected : [];
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-q-list", role: "group", "aria-label": ui2.t("Your answer") },
    optionsOf2(node).map((option) => (0, import_react10.createElement)(
      "div",
      { key: option.label, className: "dv-q-opt" },
      (0, import_react10.createElement)(
        "span",
        { className: "dv-q-body" },
        (0, import_react10.createElement)("span", { className: "dv-q-label" }, option.label),
        option.description ? (0, import_react10.createElement)("span", { className: "dv-q-desc" }, option.description) : null
      ),
      chosen.includes(option.label) ? (0, import_react10.createElement)("span", { className: "dv-q-check", title: ui2.t("Selected") }, (0, import_react10.createElement)(CheckIcon2)) : null
    ))
  );
}
function ConfirmInput({ node, onSubmit, busy = false }) {
  const ui2 = useViewUi();
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-q-foot" },
    (0, import_react10.createElement)("button", { type: "button", className: "dv-q-btn", disabled: busy, onClick: () => onSubmit?.(node.id, { confirmed: false }) }, node.cancelLabel ?? ui2.t("Cancel")),
    (0, import_react10.createElement)("button", { type: "button", className: "dv-q-submit", disabled: busy, onClick: () => onSubmit?.(node.id, { confirmed: true }) }, node.confirmLabel ?? ui2.t("Confirm"))
  );
}
function SettledConfirm({ node, answer }) {
  const ui2 = useViewUi();
  const confirmed = answerValues(answer, node)?.confirmed;
  if (confirmed !== true && confirmed !== false) {
    return (0, import_react10.createElement)(
      "div",
      { className: "dv-q-foot" },
      (0, import_react10.createElement)("button", { type: "button", className: "dv-q-btn", disabled: true }, node.cancelLabel ?? ui2.t("Cancel")),
      (0, import_react10.createElement)("button", { type: "button", className: "dv-q-submit", disabled: true }, node.confirmLabel ?? ui2.t("Confirm"))
    );
  }
  const label = confirmed ? node.confirmLabel ?? ui2.t("Confirm") : node.cancelLabel ?? ui2.t("Cancel");
  return (0, import_react10.createElement)("span", { className: "dv-q-badge" }, label);
}
function FormInput({ node, onSubmit, busy = false }) {
  const ui2 = useViewUi();
  const fields = fieldsOf(node);
  const [draft, setDraft] = (0, import_react10.useState)({});
  const submit = () => {
    if (!busy) onSubmit?.(node.id, { fields: Object.fromEntries(fields.map((field) => [field.id, draft[field.id] ?? ""])) });
  };
  return (0, import_react10.createElement)(
    "form",
    {
      className: "dv-widget-form",
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      }
    },
    fields.map((field) => (0, import_react10.createElement)(
      "label",
      { key: field.id, className: "dv-widget-field" },
      (0, import_react10.createElement)("span", { className: "dv-widget-field-label" }, field.label),
      (0, import_react10.createElement)(
        "span",
        { className: "dv-q-field" },
        (0, import_react10.createElement)("input", {
          className: "dv-q-input",
          type: "text",
          value: draft[field.id] ?? "",
          autoComplete: "off",
          spellCheck: false,
          readOnly: busy,
          "aria-label": field.label,
          placeholder: field.placeholder ?? void 0,
          onChange: (event) => {
            if (!busy) setDraft((current) => ({ ...current, [field.id]: event.target.value }));
          },
          onKeyDown: (event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }
        })
      )
    )),
    (0, import_react10.createElement)("div", { className: "dv-q-foot" }, (0, import_react10.createElement)("button", { type: "submit", className: "dv-q-submit", disabled: busy }, node.submitLabel ?? ui2.t("Submit")))
  );
}
function SettledForm({ node, answer }) {
  const fields = answerValues(answer, node)?.fields;
  const values = fields !== null && typeof fields === "object" ? fields : {};
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-widget-form" },
    fieldsOf(node).map((field) => (0, import_react10.createElement)(
      "label",
      { key: field.id, className: "dv-widget-field" },
      (0, import_react10.createElement)("span", { className: "dv-widget-field-label" }, field.label),
      (0, import_react10.createElement)(
        "span",
        { className: "dv-q-field" },
        (0, import_react10.createElement)("input", { className: "dv-q-input", type: "text", value: values[field.id] ?? "", disabled: true, readOnly: true, "aria-label": field.label })
      )
    ))
  );
}
function SubmitInput({ node, ctx }) {
  const ui2 = useViewUi();
  if (ctx.settled) return null;
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-q-foot" },
    (0, import_react10.createElement)("button", { type: "button", className: "dv-q-submit", disabled: ctx.busy, onClick: () => ctx.onSubmit?.(node.id, {}) }, node.label || ui2.t("Send"))
  );
}
function WidgetTable({ node, lookup }) {
  const columns2 = (Array.isArray(node.columns) ? node.columns : []).filter((column) => column !== null && typeof column === "object");
  const rows2 = (Array.isArray(node.rows) ? node.rows : []).map((row) => (Array.isArray(row) ? row : []).map((cell) => resolve(cell, lookup, "")));
  const numeric2 = columns2.map((_, index) => {
    const cells = rows2.map((row) => row[index]).filter((cell) => cell !== void 0 && cell !== "");
    return cells.length > 0 && cells.every((cell) => typeof cell === "number" || typeof cell === "string" && NUMERIC_CELL.test(cell.trim()));
  });
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-widget-table" },
    (0, import_react10.createElement)(
      "table",
      null,
      (0, import_react10.createElement)("thead", null, (0, import_react10.createElement)("tr", null, columns2.map((column, index) => (0, import_react10.createElement)("th", { key: column.key ?? index, scope: "col", className: numeric2[index] ? "dv-num" : void 0 }, column.label)))),
      (0, import_react10.createElement)("tbody", null, rows2.map((row, rowIndex) => (0, import_react10.createElement)(
        "tr",
        { key: rowIndex },
        columns2.map((column, columnIndex) => (0, import_react10.createElement)("td", { key: column.key ?? columnIndex, className: numeric2[columnIndex] ? "dv-num" : void 0 }, cellText2(row[columnIndex])))
      )))
    )
  );
}
function WidgetProgress({ node, lookup }) {
  const ui2 = useViewUi();
  let percent;
  if (node.percent !== void 0) percent = Number(resolve(node.percent, lookup, 0));
  else {
    const max = Number(resolve(node.max, lookup, 0));
    percent = max > 0 ? Number(resolve(node.value, lookup, 0)) / max * 100 : 0;
  }
  percent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const tone = resolve(node.tone, lookup);
  const right = node.valueLabel !== void 0 ? asText(resolve(node.valueLabel, lookup, "")) : `${Math.round(percent)}%`;
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-widget-progress", "data-tone": TONES2.includes(tone) ? tone : void 0 },
    (0, import_react10.createElement)("span", { className: "dv-widget-progress-label" }, (0, import_react10.createElement)("span", { className: "dv-widget-progress-name" }, node.label), (0, import_react10.createElement)("span", null, right)),
    (0, import_react10.createElement)("div", {
      className: "dv-widget-progress-track",
      role: "progressbar",
      "aria-valuenow": Math.round(percent),
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-label": node.label ?? ui2.t("Progress"),
      "aria-valuetext": right
    }, (0, import_react10.createElement)("div", { className: "dv-widget-progress-fill", style: { width: `${percent}%` } }))
  );
}
function WidgetMetric({ node, lookup }) {
  const tone = resolve(node.tone, lookup);
  const caption = node.caption === void 0 ? "" : asText(resolve(node.caption, lookup, ""));
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-widget-metric", "data-tone": TONES2.includes(tone) ? tone : void 0 },
    (0, import_react10.createElement)("span", { className: "dv-widget-metric-label" }, node.label),
    (0, import_react10.createElement)("span", { className: "dv-widget-metric-value" }, asText(resolve(node.value, lookup, "—"))),
    caption !== "" ? (0, import_react10.createElement)("span", { className: "dv-view-caption" }, caption) : null
  );
}
function WidgetCallout({ node, lookup }) {
  const ui2 = useViewUi();
  const tone = resolve(node.tone, lookup);
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-callout", "data-tone": CALLOUT_TONES2.includes(tone) ? tone : "info" },
    (0, import_react10.createElement)("span", { className: "dv-view-callout-icon", "aria-hidden": true }, (0, import_react10.createElement)(InfoIcon2)),
    (0, import_react10.createElement)("div", { className: "dv-view-callout-text" }, (0, import_react10.createElement)(ui2.Markdown, { text: asText(resolve(node.text, lookup, "")), labels: mdLabels(ui2), variant: "compact" }))
  );
}
var LinkIcon = () => (0, import_react10.createElement)(
  "svg",
  { width: 12, height: 12, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
  (0, import_react10.createElement)("path", { d: "M8.5 11.5l3-3" }),
  (0, import_react10.createElement)("path", { d: "M7 9.5L5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13" }),
  (0, import_react10.createElement)("path", { d: "M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7" })
);
function WidgetSources({ node }) {
  const ui2 = useViewUi();
  const items = (Array.isArray(node.items) ? node.items : []).filter((item) => typeof item?.url === "string" && /^https?:\/\//i.test(item.url));
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-sources", role: "list", "aria-label": ui2.t("Sources") },
    items.map((item, index) => (0, import_react10.createElement)("a", { key: index, role: "listitem", className: "dv-view-source", href: item.url, target: "_blank", rel: "noopener noreferrer", title: item.url }, (0, import_react10.createElement)(LinkIcon), item.label))
  );
}
function InputHead({ id, label, value }) {
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-input-head" },
    (0, import_react10.createElement)("label", { htmlFor: id, className: "dv-view-input-label" }, label),
    value !== void 0 ? (0, import_react10.createElement)("output", { htmlFor: id, className: "dv-view-input-value" }, value) : null
  );
}
var withUnit2 = (value, unit) => `${asText(value)}${unit ? ` ${unit}` : ""}`;
var grouped2 = (value) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : asText(value);
function SliderInput({ node, ctx }) {
  const id = (0, import_react10.useId)();
  const value = Number(ctx.values[node.id]);
  const percent = node.max > node.min ? (value - node.min) / (node.max - node.min) * 100 : 0;
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-input" },
    (0, import_react10.createElement)(InputHead, { id, label: node.label, value: withUnit2(grouped2(value), node.unit) }),
    (0, import_react10.createElement)("input", {
      id,
      type: "range",
      className: "dv-view-range",
      min: node.min,
      max: node.max,
      step: node.step ?? "any",
      value,
      disabled: ctx.locked,
      style: { "--dv-fill": `${percent}%` },
      onChange: (event) => ctx.setInput(node.id, Number(event.target.value))
    })
  );
}
function NumberInput({ node, ctx }) {
  const id = (0, import_react10.useId)();
  const [draft, setDraft] = (0, import_react10.useState)(null);
  const value = ctx.values[node.id];
  const accept = (raw) => {
    setDraft(raw);
    const next = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(next)) return;
    if (node.min !== void 0 && next < node.min || node.max !== void 0 && next > node.max) return;
    ctx.setInput(node.id, next);
  };
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-input" },
    (0, import_react10.createElement)(InputHead, { id, label: node.label }),
    (0, import_react10.createElement)(
      "span",
      { className: "dv-q-field dv-view-number" },
      (0, import_react10.createElement)("input", {
        id,
        className: "dv-q-input",
        type: "number",
        inputMode: "decimal",
        value: draft ?? asText(value),
        min: node.min,
        max: node.max,
        step: node.step ?? "any",
        disabled: ctx.locked,
        onChange: (event) => accept(event.target.value),
        onBlur: () => setDraft(null)
      }),
      node.unit ? (0, import_react10.createElement)("span", { className: "dv-view-unit" }, node.unit) : null
    )
  );
}
function ChoiceInput({ node, ctx }) {
  const labelId = (0, import_react10.useId)();
  const options = optionsOf2(node);
  const current = ctx.values[node.id];
  const side = options.length <= 4 && options.every((option) => [...option.label].length <= 14);
  const pick = (option) => () => {
    if (!ctx.locked) ctx.setInput(node.id, choiceValue(option));
  };
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-input" },
    (0, import_react10.createElement)("span", { className: "dv-view-input-label", id: labelId }, node.label),
    side ? (0, import_react10.createElement)(
      Segmented,
      { label: node.label, value: options.findIndex((option) => choiceValue(option) === current), className: "dv-view-seg" },
      options.map((option) => (0, import_react10.createElement)("button", { key: option.label, type: "button", "aria-pressed": choiceValue(option) === current, disabled: ctx.locked, onClick: pick(option) }, option.label))
    ) : (0, import_react10.createElement)(
      "div",
      { className: "dv-view-radios", role: "radiogroup", "aria-labelledby": labelId },
      options.map((option) => (0, import_react10.createElement)("button", {
        key: option.label,
        type: "button",
        role: "radio",
        className: "dv-view-radio",
        "aria-checked": choiceValue(option) === current,
        disabled: ctx.locked,
        onClick: pick(option)
      }, (0, import_react10.createElement)("span", { className: "dv-view-radio-dot", "aria-hidden": true }), option.label))
    )
  );
}
function ToggleInput({ node, ctx }) {
  const on = ctx.values[node.id] === true;
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-view-toggle" },
    (0, import_react10.createElement)("span", { className: "dv-view-input-label" }, node.label),
    (0, import_react10.createElement)(
      "button",
      { type: "button", role: "switch", className: "dv-switch", "aria-checked": on, "aria-label": node.label, disabled: ctx.locked, onClick: () => ctx.setInput(node.id, !on) },
      (0, import_react10.createElement)("span", { className: "dv-switch-knob", "aria-hidden": true })
    )
  );
}
function WidgetNode({ node, ctx }) {
  const ui2 = useViewUi();
  if (node === null || typeof node !== "object") return null;
  const { lookup } = ctx;
  switch (node.type) {
    case "stack":
    case "row": {
      const children = Array.isArray(node.children) ? node.children : [];
      return (0, import_react10.createElement)(
        "div",
        { className: node.type === "row" ? "dv-view-row" : "dv-widget-stack" },
        children.map((child, index) => (0, import_react10.createElement)(WidgetNode, { key: child?.id ?? index, node: child, ctx }))
      );
    }
    case "text": {
      const text = (0, import_react10.createElement)(ui2.Markdown, { text: asText(resolve(node.text, lookup, "")), labels: mdLabels(ui2), variant: "compact" });
      return node.tone === "muted" ? (0, import_react10.createElement)("div", { className: "dv-view-muted" }, text) : text;
    }
    case "metric":
      return (0, import_react10.createElement)(WidgetMetric, { node, lookup });
    case "table":
      return (0, import_react10.createElement)(WidgetTable, { node, lookup });
    case "chart":
      return (0, import_react10.createElement)(WidgetChart, { node, lookup, registerChart: ctx.registerChart, refreshCharts: ctx.refreshCharts });
    case "progress":
      return (0, import_react10.createElement)(WidgetProgress, { node, lookup });
    case "callout":
      return (0, import_react10.createElement)(WidgetCallout, { node, lookup });
    case "sources":
      return (0, import_react10.createElement)(WidgetSources, { node });
    case "html":
      return (0, import_react10.createElement)(HtmlFrame, { node });
    case "slider":
      return (0, import_react10.createElement)(SliderInput, { node, ctx });
    case "number":
      return (0, import_react10.createElement)(NumberInput, { node, ctx });
    case "choice":
      return (0, import_react10.createElement)(ChoiceInput, { node, ctx });
    case "toggle":
      return (0, import_react10.createElement)(ToggleInput, { node, ctx });
    case "submit":
      return (0, import_react10.createElement)(SubmitInput, { node, ctx });
    case "options":
      return ctx.settled ? (0, import_react10.createElement)(SettledOptions, { node, answer: ctx.answer }) : (0, import_react10.createElement)(OptionsInput, { node, onSubmit: ctx.onSubmit, keys: ctx.keys, busy: ctx.busy });
    case "confirm":
      return ctx.settled ? (0, import_react10.createElement)(SettledConfirm, { node, answer: ctx.answer }) : (0, import_react10.createElement)(ConfirmInput, { node, onSubmit: ctx.onSubmit, busy: ctx.busy });
    case "form":
      return ctx.settled ? (0, import_react10.createElement)(SettledForm, { node, answer: ctx.answer }) : (0, import_react10.createElement)(FormInput, { node, onSubmit: ctx.onSubmit, busy: ctx.busy });
    default:
      return null;
  }
}
function WidgetView({ view, onSubmit, settled = false, answer = null, busy = false, registerChart, refreshCharts }) {
  const inputs = viewInputs(view);
  const [values, setValues] = (0, import_react10.useState)(() => Object.fromEntries(inputs.map((node) => [node.id, inputDefault(node)])));
  const sent = answer?.values?.inputs;
  const current = settled && sent !== null && typeof sent === "object" ? { ...values, ...sent } : values;
  const submit = (action, extra) => onSubmit?.(action, inputs.length > 0 ? { ...extra, inputs: current } : extra);
  const ctx = {
    onSubmit: submit,
    settled,
    answer,
    busy,
    keys: !settled && countType(view, "options") === 1,
    lookup: viewScope(view, current),
    values: current,
    locked: settled || busy,
    setInput: (id, value) => setValues((before) => ({ ...before, [id]: value })),
    registerChart,
    refreshCharts
  };
  return (0, import_react10.createElement)(WidgetNode, { node: view, ctx });
}
function useChartHandles() {
  const [, bump] = (0, import_react10.useState)(0);
  const charts = (0, import_react10.useRef)(/* @__PURE__ */ new Map());
  const fns = (0, import_react10.useRef)(null);
  if (fns.current === null) {
    const refresh = () => bump((value) => value + 1);
    fns.current = {
      registerChart: (key, handle) => {
        charts.current.set(key, handle);
        refresh();
        return () => {
          charts.current.delete(key);
          refresh();
        };
      },
      refreshCharts: refresh
    };
  }
  return { charts: [...charts.current.values()], ...fns.current };
}
function ViewMenuList({ charts, pick }) {
  const ui2 = useViewUi();
  return (0, import_react10.createElement)(
    "div",
    { className: "dv-menu dv-view-menu", role: "menu" },
    charts.map((chart, index) => (0, import_react10.createElement)(
      import_react10.Fragment,
      { key: index },
      charts.length > 1 ? (0, import_react10.createElement)(
        import_react10.Fragment,
        null,
        index > 0 ? (0, import_react10.createElement)("div", { className: "dv-menu-sep", role: "separator" }) : null,
        (0, import_react10.createElement)("div", { className: "dv-view-menu-label" }, chart.label ?? ui2.t("Chart {n}", { n: index + 1 }))
      ) : null,
      (0, import_react10.createElement)("button", { type: "button", role: "menuitem", onClick: pick(chart.toggleTable) }, (0, import_react10.createElement)(TableIcon), chart.asTable ? ui2.t("View as chart") : ui2.t("View as table")),
      (0, import_react10.createElement)("button", { type: "button", role: "menuitem", onClick: pick(chart.copy) }, (0, import_react10.createElement)(CopyIcon2), ui2.t("Copy data")),
      (0, import_react10.createElement)("button", { type: "button", role: "menuitem", onClick: pick(chart.save) }, (0, import_react10.createElement)(DownloadIcon2), ui2.t("Download image"))
    ))
  );
}
function ViewMenu({ charts }) {
  const ui2 = useViewUi();
  const [open, setOpen] = (0, import_react10.useState)(false);
  const root = (0, import_react10.useRef)(null);
  (0, import_react10.useEffect)(() => {
    if (!open) return void 0;
    const away = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const pick = (run2) => () => {
    setOpen(false);
    run2();
  };
  return (0, import_react10.createElement)(
    "div",
    { ref: root, className: "dv-view-tools", "data-open": open ? "" : void 0 },
    (0, import_react10.createElement)("button", { type: "button", className: "dv-view-more", "aria-label": ui2.t("Chart options"), "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen((value) => !value) }, (0, import_react10.createElement)(DotsIcon2)),
    open ? (0, import_react10.createElement)(ViewMenuList, { charts, pick }) : null
  );
}
function WidgetCard({ title, view, onSubmit, onDismiss, busy = false, raised = false, settled = false, answer = null }) {
  const ui2 = useViewUi();
  const titleId = (0, import_react10.useId)();
  const { charts, registerChart, refreshCharts } = useChartHandles();
  const framed = raised || hasControls(view);
  const className = ["dv-view", framed ? "dv-q" : "dv-view-bare", settled ? "dv-q-settled" : "", raised ? "dv-q-raised" : ""].filter(Boolean).join(" ");
  const head = title || onDismiss || countType(view, "chart") > 0 ? (0, import_react10.createElement)(
    "div",
    { className: "dv-view-head" },
    title ? (0, import_react10.createElement)("p", { className: "dv-view-title", id: titleId }, title) : (0, import_react10.createElement)("span", { className: "dv-view-title" }),
    countType(view, "chart") > 0 ? (0, import_react10.createElement)(ViewMenu, { charts }) : null,
    onDismiss ? (0, import_react10.createElement)("button", { type: "button", className: "dv-q-x", "aria-label": ui2.t("Dismiss view"), title: ui2.t("Dismiss"), onClick: onDismiss, disabled: busy }, (0, import_react10.createElement)(CloseIcon2)) : null
  ) : null;
  return (0, import_react10.createElement)(
    "div",
    {
      className,
      role: "group",
      "aria-labelledby": title ? titleId : void 0,
      "aria-label": title ? void 0 : ui2.t("View"),
      "aria-busy": busy || void 0
    },
    head,
    (0, import_react10.createElement)("div", { className: "dv-view-body" }, (0, import_react10.createElement)(WidgetView, { view, onSubmit, settled, answer, busy, registerChart, refreshCharts }))
  );
}
var WIDGET_CSS = `
.dv-view{min-width:0}
.dv-view-bare{display:flex;flex-direction:column;gap:8px;width:100%;color:var(--dv-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:dv-veil-in .2s ease-out backwards}
.dv-view-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.dv-view-title{flex:1 1 0;min-width:0;margin:0;font-size:13px;line-height:18px;font-weight:500;color:var(--dv-ink);overflow-wrap:anywhere}
.dv-q-settled .dv-view-title{color:var(--dv-ink-2)}
.dv-view-tools{position:relative;flex:none;align-self:flex-start;opacity:0;transition:opacity .12s ease}
.dv-view:hover .dv-view-tools,.dv-view-tools:focus-within,.dv-view-tools[data-open]{opacity:1}
@media (hover:none){.dv-view-tools{opacity:1}}
.dv-view-more{width:28px;height:28px;padding:0;border:0;border-radius:50%;background:none;color:var(--dv-ink-2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.dv-view-more:hover,.dv-view-tools[data-open] .dv-view-more{background:var(--dv-hover);color:var(--dv-ink)}
.dv-view-more:focus-visible{outline:2px solid var(--dv-accent);outline-offset:1px}
.dv-view-more svg{width:16px;height:16px}
.dv-menu.dv-view-menu{position:absolute;top:32px;right:0;--dv-origin:top right;min-width:180px}
.dv-menu.dv-view-menu button{gap:8px}
.dv-view-menu-label{padding:2px 8px;font-size:11px;line-height:14px;color:var(--dv-ink-3);white-space:nowrap}
.dv-view-body{min-width:0}
.dv-widget-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.dv-view-row{display:flex;flex-wrap:wrap;gap:12px 24px;min-width:0}
.dv-view-row>*{flex:1 1 160px;min-width:0}
.dv-widget-metric{display:flex;flex-direction:column;gap:1px;min-width:0}
.dv-widget-metric-label{font-size:12px;line-height:16px;color:var(--dv-ink-2)}
.dv-widget-metric-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dv-ink);overflow-wrap:anywhere}
.dv-widget-metric[data-tone=good] .dv-widget-metric-value{color:var(--dv-green)}
.dv-widget-metric[data-tone=warn] .dv-widget-metric-value{color:var(--dv-star)}
.dv-widget-metric[data-tone=bad] .dv-widget-metric-value{color:var(--dv-danger)}
.dv-view-caption{font-size:12px;line-height:16px;color:var(--dv-ink-2);overflow-wrap:anywhere}
.dv-view-muted{font-size:12px;line-height:16px;color:var(--dv-ink-2)}
.dv-view-muted *{font-size:inherit!important;line-height:inherit!important;color:inherit!important}
.dv-widget-table{max-width:100%;overflow-x:auto;border:.5px solid var(--dv-line-2);border-radius:10px}
.dv-widget-table table{border-collapse:collapse;min-width:100%;font-size:13px;line-height:18px}
.dv-widget-table th{padding:6px 10px;font-weight:500;text-align:start;white-space:nowrap;color:var(--dv-ink-2);border-bottom:.5px solid var(--dv-line-2)}
.dv-widget-table td{padding:6px 10px;max-width:280px;color:var(--dv-ink);overflow-wrap:anywhere}
.dv-widget-table tbody tr+tr>*{border-top:.5px solid var(--dv-line)}
.dv-widget-table .dv-num{text-align:end;font-variant-numeric:tabular-nums}
.dv-widget-form{display:flex;flex-direction:column;gap:8px;margin:0}
.dv-widget-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dv-widget-field-label{font-size:12px;line-height:16px;color:var(--dv-ink-2)}
.dv-widget-field .dv-q-field:has(.dv-q-input:disabled){cursor:default;opacity:.75}
.dv-widget-progress{display:flex;flex-direction:column;gap:5px;min-width:0}
.dv-widget-progress-label{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:16px;color:var(--dv-ink-2);font-variant-numeric:tabular-nums}
.dv-widget-progress-name{color:var(--dv-ink);font-weight:500}
.dv-widget-progress-track{height:6px;border-radius:999px;background:var(--dv-hover);overflow:hidden}
.dv-widget-progress-fill{height:100%;border-radius:inherit;background:var(--dv-accent);transition:width .12s ease,background-color .12s ease}
.dv-widget-progress[data-tone=good] .dv-widget-progress-fill{background:var(--dv-green)}
.dv-widget-progress[data-tone=warn] .dv-widget-progress-fill{background:var(--dv-star)}
.dv-widget-progress[data-tone=bad] .dv-widget-progress-fill{background:var(--dv-danger)}
.dv-widget-progress[data-tone=bad] .dv-widget-progress-label>span:last-child{color:var(--dv-danger)}
.dv-view-callout{display:flex;gap:8px;padding:8px 12px;border-radius:10px;--dv-tone:var(--dv-accent);background:color-mix(in srgb,var(--dv-tone) 8%,transparent);color:var(--dv-ink)}
.dv-view-callout[data-tone=good]{--dv-tone:var(--dv-green)}
.dv-view-callout[data-tone=warn]{--dv-tone:var(--dv-star)}
.dv-view-callout[data-tone=bad]{--dv-tone:var(--dv-danger)}
.dv-view-callout-icon{flex:none;display:flex;padding-top:3px;color:var(--dv-tone)}
.dv-view-callout-icon svg{width:16px;height:16px}
.dv-view-callout-text{flex:1 1 auto;min-width:0}
.dv-view-sources{display:flex;flex-wrap:wrap;gap:6px}
.dv-view-source{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:20px;padding:0 6px;border-radius:4px;background:var(--dv-tag-bg,var(--dv-hover));color:var(--dv-ink-2);font-size:11px;line-height:16px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background-color .12s ease,color .12s ease}
.dv-view-source:hover{background:var(--dv-hover);color:var(--dv-ink)}
.dv-view-source:focus-visible{outline:2px solid var(--dv-accent);outline-offset:1px}
.dv-view-input{display:flex;flex-direction:column;gap:6px;min-width:0}
.dv-view-input-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.dv-view-input-label{font-size:12px;line-height:16px;color:var(--dv-ink-2)}
.dv-view-input-value{font-size:15px;line-height:20px;font-weight:600;color:var(--dv-ink);font-variant-numeric:tabular-nums}
.dv-view-range{-webkit-appearance:none;appearance:none;width:100%;height:20px;margin:0;background:transparent;cursor:pointer}
.dv-view-range:disabled{cursor:default;opacity:.6}
.dv-view-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,var(--dv-accent) var(--dv-fill,0%),var(--dv-hover) var(--dv-fill,0%))}
.dv-view-range::-moz-range-track{height:6px;border-radius:999px;background:var(--dv-hover)}
.dv-view-range::-moz-range-progress{height:6px;border-radius:999px;background:var(--dv-accent)}
.dv-view-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;corner-shape:round;background:var(--dv-knob);box-shadow:0 1px 3px rgba(0,0,0,.25),0 0 0 .5px rgba(0,0,0,.12)}
.dv-view-range::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--dv-knob);box-shadow:0 1px 3px rgba(0,0,0,.25),0 0 0 .5px rgba(0,0,0,.12)}
.dv-view-range:focus-visible{outline:2px solid var(--dv-accent);outline-offset:2px;border-radius:6px}
.dv-view-number{max-width:200px;align-items:center;gap:6px}
.dv-view-number .dv-q-input{font-variant-numeric:tabular-nums}
.dv-view-unit{flex:none;font-size:13px;color:var(--dv-ink-2)}
.dv-seg.dv-view-seg{align-self:flex-start;max-width:100%}
.dv-seg.dv-view-seg button{flex:none;padding:0 12px;white-space:nowrap}
.dv-view-radios{display:flex;flex-direction:column;gap:2px}
.dv-view-radio{display:flex;align-items:center;gap:8px;min-height:30px;padding:4px 8px;margin:0 -8px;border:0;border-radius:8px;background:none;font:inherit;font-size:14px;line-height:20px;color:var(--dv-ink);text-align:start;cursor:pointer;transition:background-color .12s ease}
.dv-view-radio:hover:not(:disabled){background:var(--dv-hover)}
.dv-view-radio:disabled{cursor:default}
.dv-view-radio:focus-visible{outline:2px solid var(--dv-accent);outline-offset:-2px}
.dv-view-radio-dot{flex:none;width:16px;height:16px;border-radius:50%;corner-shape:round;box-shadow:inset 0 0 0 1.5px var(--dv-line-2);transition:box-shadow .12s ease}
.dv-view-radio[aria-checked=true] .dv-view-radio-dot{box-shadow:inset 0 0 0 5px var(--dv-accent)}
.dv-view-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}
.dv-view-toggle .dv-view-input-label{font-size:14px;line-height:20px;color:var(--dv-ink)}
.dv-q.dv-view{gap:10px}
.dv-q.dv-view:not(.dv-q-raised):not(.dv-q-settled)>.dv-view-head:has(.dv-view-title:empty){margin-bottom:-6px}
.dv-q-raised .dv-view-head{padding:14px 16px 4px 20px}
.dv-q-raised .dv-view-body{padding:0 16px 14px 20px}
.dv-q-raised .dv-view-body .dv-q-list{padding:0;margin:0 -8px}
.dv-q-inline .dv-view{margin:0;width:100%;max-width:min(100%,max(calc(var(--dv-msg-w,.8) * 100%),560px));order:0}
body[data-dv-layout=flat] .dv-q-inline .dv-view{max-width:calc(var(--dv-flat-w,1) * 100%)}
.dv-q-inline:has(>.dv-view-bare){margin:8px 0 12px}
@media (prefers-reduced-motion:reduce){.dv-widget-progress-fill,.dv-view-radio-dot,.dv-view-tools,.dv-view-more{transition:none}.dv-view-bare{animation:none}}
${CHART_CSS}
${HTML_CSS}
`;

// ../../app/node_modules/deep-view/src/react/styles.js
var THEME_CSS = `
body{
--dv-ink:var(--dsw-alias-label-primary);
--dv-ink-2:var(--dsw-alias-label-secondary);
--dv-ink-3:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-caption));
--dv-line:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);
--dv-line-2:color-mix(in srgb,var(--dsw-alias-label-primary) 15%,transparent);
--dv-card:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base)));
--dv-main:var(--dsw-alias-bg-base);
--dv-hover:var(--dsw-alias-interactive-bg-hover);
--dv-active:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));
--dv-accent:var(--dsw-alias-state-business-primary);
--dv-accent-ink:var(--dsw-alias-label-primary-inverted,#fff);
--dv-green:var(--dsw-alias-state-success-primary);
--dv-star:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warn-label));
--dv-danger:var(--dsw-alias-state-error-primary);
--dv-knob:var(--dsw-alias-label-primary-inverted,#fff);
--dv-tag-bg:var(--dsw-alias-interactive-bg-hover);
--dv-ink-tangerine:var(--dsw-alias-brand-text,var(--dsw-alias-state-warn-primary));
--dv-ink-green:var(--dsw-alias-state-success-primary);
--dv-ink-violet:color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,var(--dsw-alias-state-error-primary));
--dv-ink-sky:var(--dsw-alias-link,var(--dsw-alias-state-business-primary));
--dv-ink-rose:var(--dsw-alias-state-error-primary);
--dv-ink-yellow:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary));
--dv-ink-cyan:var(--dsw-alias-state-success-tertiary,var(--dsw-alias-state-success-primary));
--dv-ink-magenta:var(--dsw-alias-state-error-secondary,var(--dsw-alias-state-error-primary));
color-scheme:light}
body[data-ds-dark-theme]{color-scheme:dark}
.dv-q-inline .dv-view{max-width:100%}
`;
var QUESTION_CSS = `
.dv-q{margin:0 auto 8px;width:100%;max-width:var(--dsh-chat-content-width,748px);display:flex;flex-direction:column;gap:12px;--dv-q-edge:color-mix(in srgb,var(--dv-ink) 10%,transparent);--dv-q-rule:color-mix(in srgb,var(--dv-ink) 8%,transparent);--dv-q-rule-2:color-mix(in srgb,var(--dv-ink) 5%,transparent);background:var(--dv-card);box-shadow:0 1px 3px rgba(20,20,20,.04),inset 0 0 0 1px var(--dv-q-edge);border-radius:16px;padding:14px 16px;box-sizing:border-box;color:var(--dv-ink);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);animation:dv-veil-in .2s ease-out backwards}
body[data-ds-dark-theme] .dv-q{--dv-q-edge:rgba(255,255,255,.16);--dv-q-rule:rgba(255,255,255,.12);--dv-q-rule-2:rgba(255,255,255,.08)}
.dv-q-settled{animation:none}
.dv-q-x{flex:none;width:20px;height:20px;border:0;padding:0;border-radius:6px;background:none;color:var(--dv-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.dv-q-x svg{width:14px;height:14px}
.dv-q-x:hover{background:var(--dv-hover);color:var(--dv-ink)}
.dv-q-x:focus-visible,.dv-q-opt:focus-visible{outline:2px solid var(--dv-accent);outline-offset:-2px}
.dv-q-list{display:flex;flex-direction:column;gap:1px;min-width:0;box-sizing:border-box;margin:0 -8px}
.dv-q-opt{position:relative;display:flex;align-items:flex-start;gap:16px;width:100%;min-width:0;box-sizing:border-box;margin:0;border:0;border-radius:12px;background:transparent;padding:10px 8px;font:inherit;color:var(--dv-ink);text-align:start;cursor:pointer;transition:background-color .12s ease}
.dv-q-opt+.dv-q-opt::before{content:"";position:absolute;left:calc(var(--dv-key,24px) + 24px);right:8px;top:-1px;height:1px;background:var(--dv-q-rule-2);pointer-events:none}
button.dv-q-opt:hover::before,button.dv-q-opt:hover+.dv-q-opt::before,.dv-q-opt[aria-pressed=true]::before,.dv-q-opt[aria-pressed=true]+.dv-q-opt::before{opacity:0}
button.dv-q-opt:hover{background:var(--dv-hover)}
button.dv-q-opt:active{background:var(--dv-active)}
.dv-q-opt[aria-pressed=true]{background:var(--dv-active)}
.dv-key{flex:none;box-sizing:border-box;width:var(--dv-key,24px);height:var(--dv-key,24px);border-radius:8px;background:var(--dv-hover);color:var(--dv-ink-2);font-size:12px;line-height:var(--dv-key,24px);font-weight:500;text-align:center;font-variant-numeric:tabular-nums;transition:background-color .12s ease,color .12s ease}
.dv-q-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:2px}
.dv-q-opt:has(.dv-q-desc){--dv-key:34px}
.dv-q-opt:has(.dv-q-desc) .dv-key{margin-top:2px;border-radius:10px;font-size:13px}
.dv-q-opt:has(.dv-q-desc) .dv-q-body{padding-top:0}
.dv-q-label{font-size:14px;line-height:20px;font-weight:500;white-space:normal;overflow-wrap:anywhere}
.dv-q-desc{font-size:12px;line-height:17px;color:var(--dv-ink-2);overflow-wrap:anywhere}
.dv-q-check{flex:none;display:inline-flex;align-items:center;color:var(--dv-ink-2);animation:dv-check-pop .18s ease-out backwards}
.dv-q-settled .dv-q-check{animation:none}
.dv-q-check svg{width:16px;height:16px}
.dv-q-settled .dv-key{opacity:.4}
.dv-q-settled .dv-q-label{color:color-mix(in srgb,var(--dv-ink) 45%,transparent)}
.dv-q.dv-q-settled{gap:6px;padding:12px 16px}
.dv-q-settled .dv-q-opt{padding:4px 8px}
.dv-q-badge{flex:none;height:20px;padding:0 7px;border-radius:999px;border:1px dotted var(--dv-line-2);color:var(--dv-ink-2);font-size:12px;line-height:18px;box-sizing:border-box}
.dv-q-field{flex:1 1 0;min-width:0;display:flex;box-sizing:border-box;min-height:32px;padding:5px 11px;border-radius:8px;border:.5px solid var(--dv-line-2);background:none;cursor:text;transition:border-color .12s ease}
.dv-q-field:focus-within{border-color:color-mix(in srgb,var(--dv-ink) 30%,transparent)}
.dv-q-input{flex:1;width:100%;min-width:0;max-height:120px;margin:0;padding:0;border:0;outline:none;background:transparent;color:var(--dv-ink);font:inherit;font-size:14px;line-height:20px;resize:none;overflow-y:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.dv-q-input::placeholder{color:var(--dv-ink-3)}
.dv-q-submit,.dv-q-btn{flex:none;height:36px;padding:0 14px;border:0;border-radius:999px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:opacity .12s ease,background-color .12s ease}
.dv-q-submit{background:var(--dv-accent);color:var(--dv-accent-ink,#fff);animation:dv-veil-in .16s ease-out backwards}
.dv-q-submit:hover:not(:disabled){opacity:.86}
.dv-q-submit:disabled{opacity:.4;cursor:default}
.dv-q-btn{background:var(--dv-hover);color:var(--dv-ink)}
.dv-q-btn:hover{background:var(--dv-active)}
.dv-q-foot{display:flex;justify-content:flex-end;gap:8px}
.dv-menu{position:fixed;pointer-events:auto;z-index:60;min-width:200px;padding:6px;border-radius:12px;background:var(--dv-main);border:.5px solid var(--dv-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1),0 0 0 1px rgba(228,228,228,.04);display:flex;flex-direction:column;gap:2px;transform-origin:var(--dv-origin,top left);animation:dv-veil-in .14s ease-out;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);box-sizing:border-box}
.dv-menu.dv-view-menu{position:absolute;z-index:4}
.dv-menu button{display:flex;align-items:center;gap:4px;width:100%;min-height:30px;text-align:left;border:0;background:none;border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;line-height:18px;color:var(--dv-ink);cursor:pointer;box-sizing:border-box}
.dv-menu button:hover{background:var(--dv-hover)}
.dv-menu 
.dv-menu button{display:flex;align-items:center;gap:4px;width:100%;min-height:30px;text-align:left;border:0;background:none;border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;line-height:18px;color:var(--dv-ink);cursor:pointer;box-sizing:border-box}
.dv-menu button:hover{background:var(--dv-hover)}
.dv-menu button svg{flex:none;width:16px;height:16px;margin:0 1px}
.dv-menu-sep{height:.5px;flex:none;background:var(--dv-line-2);margin:4px 8px}
.dv-seg{position:relative;display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--dv-hover)}
.dv-seg button{position:relative;z-index:1;flex:1;height:30px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--dv-ink-2);cursor:pointer;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease}
.dv-seg button[aria-pressed=true]{background:var(--dv-card);color:var(--dv-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.dv-seg button:disabled{opacity:.4;cursor:default}
.dv-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dv-line-2);cursor:pointer;transition:background-color .15s ease}
.dv-switch[aria-checked=true]{background:var(--dv-accent)}
.dv-switch:disabled{opacity:.4;cursor:default}
.dv-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dv-knob);box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease}
.dv-switch[aria-checked=true] .dv-switch-knob{transform:translateX(16px)}
.dv-switch:focus-visible{outline:2px solid var(--dv-accent);outline-offset:2px}
.dv-gone{display:none}
@keyframes dv-veil-in{from{opacity:0;filter:blur(6px)}}
@keyframes dv-check-pop{from{opacity:0;scale:.4}}
@media (prefers-reduced-motion:reduce){.dv-q,.dv-view-bare,.dv-q-submit,.dv-menu,.dv-q-check{animation:none}}
`;

// ../../app/node_modules/deep-view/src/react/index.js
var DEEP_VIEW_CSS = THEME_CSS + QUESTION_CSS + WIDGET_CSS;

// src/client/widget-cell.js
var viewT = (key, params) => key === "Send" ? t("Send to Bot") : t(key, params);
var VIEW_UI = { t: viewT, Markdown: import_dsh_client_ui_primitives.MarkdownText };
var Card = (props) => (0, import_react11.createElement)(ViewUi.Provider, { value: VIEW_UI }, (0, import_react11.createElement)(WidgetCard, props));
var withUi = (Component) => (props) => (0, import_react11.createElement)(ViewUi.Provider, { value: VIEW_UI }, (0, import_react11.createElement)(Component, props));
var WidgetView2 = withUi(WidgetView);
var ViewMenuList2 = withUi(ViewMenuList);
function PendingView({ sessionId, view, actions, inline }) {
  const [answered, setAnswered] = (0, import_react11.useState)(null);
  const busyRef = (0, import_react11.useRef)(false);
  const hold = useDockHold(sessionId, "view", view.id, actions, inline);
  const flying = answered === view.id;
  const run2 = (make) => {
    if (busyRef.current) return;
    busyRef.current = true;
    hold();
    setAnswered(view.id);
    void Promise.resolve().then(make).catch(() => setAnswered(null)).finally(() => {
      busyRef.current = false;
    });
  };
  const onSubmit = (action, values) => run2(() => actions.answerView(sessionId, view.id, action, values));
  const onDismiss = () => run2(() => actions.dismissView(sessionId));
  return (0, import_react11.createElement)(
    "div",
    { className: inline ? "bt-q-inline" : "bt-q-dock", style: flying ? { display: "none" } : void 0, onFocusCapture: hold, onPointerDownCapture: hold },
    (0, import_react11.createElement)(Card, { key: view.id, title: view.title ?? "", view: view.view, onSubmit, onDismiss, busy: flying, raised: !inline })
  );
}
function WidgetCell({ sessionId, callId, args, done, isError, roster: roster2, actions, heldCards }) {
  const record = roster2.views?.[sessionId];
  if (record !== void 0 && record.callId === callId) {
    if (heldCards?.[heldCardKey("view", record.id)] > 0) return (0, import_react11.createElement)(CellEmpty);
    return (0, import_react11.createElement)(PendingView, { sessionId, view: record, actions, inline: true });
  }
  if (done && isError) return (0, import_react11.createElement)(CellEmpty, { className: "bt-q-gone" });
  const shown = checkShownView(args?.text?.("title"), args?.value?.("view"));
  if (shown.error !== void 0 || shown.interactive || args?.value?.("await_reply") === true) {
    return (0, import_react11.createElement)(CellEmpty, { className: "bt-q-gone" });
  }
  return (0, import_react11.createElement)("div", { className: "bt-q-inline" }, (0, import_react11.createElement)(Card, { title: shown.title, view: shown.view }));
}
function AnsweredView2({ node }) {
  const data = node.data ?? {};
  let payload = null;
  if (Array.isArray(data.views)) payload = data;
  else {
    try {
      payload = typeof data.text === "string" ? JSON.parse(data.text) : null;
    } catch {
      payload = null;
    }
    if (payload?.kind !== "answer_to_pending_view") payload = null;
  }
  const view = payload?.views?.[0];
  if (view === null || typeof view !== "object" || view.view === void 0) return (0, import_react11.createElement)(CellEmpty);
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  const answer = answers.find((entry) => entry?.id === view.id) ?? answers[0] ?? null;
  return (0, import_react11.createElement)("div", { className: "bt-q-inline" }, (0, import_react11.createElement)(Card, { title: view.title ?? "", view: view.view, settled: true, answer }));
}
function AnsweredReply({ node }) {
  const data = node?.data ?? {};
  if (Array.isArray(data.views) && data.views.length > 0) return (0, import_react11.createElement)(AnsweredView2, { node });
  if (typeof data.handoff?.reason === "string") return (0, import_react11.createElement)(SettledHandoff, { handoff: data.handoff });
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    let parsed = null;
    try {
      parsed = typeof data.text === "string" ? JSON.parse(data.text) : null;
    } catch {
      parsed = null;
    }
    if (parsed?.kind === "answer_to_pending_view") return (0, import_react11.createElement)(AnsweredView2, { node });
    if (parsed?.kind === "answer_to_pending_handoff" && typeof parsed.reason === "string") {
      return (0, import_react11.createElement)(SettledHandoff, { handoff: { reason: parsed.reason, note: parsed.note ?? "", outcome: parsed.outcome } });
    }
  }
  return (0, import_react11.createElement)(AnsweredCell, { node });
}
var WIDGET_CSS2 = `${DEEP_VIEW_CSS}
body{
--dv-ink:var(--bt-ink);--dv-ink-2:var(--bt-ink-2);--dv-ink-3:var(--bt-ink-3);
--dv-line:var(--bt-line);--dv-line-2:var(--bt-line-2);
--dv-card:var(--bt-card);--dv-main:var(--bt-main);
--dv-hover:var(--bt-hover);--dv-active:var(--bt-active);
--dv-accent:var(--bt-accent);--dv-accent-ink:var(--bt-accent-ink);
--dv-green:var(--bt-green);--dv-star:var(--bt-star);--dv-danger:var(--bt-danger);
--dv-knob:var(--bt-knob);--dv-tag-bg:var(--bt-tag-bg);
--dv-ink-tangerine:var(--bt-ink-tangerine);--dv-ink-green:var(--bt-ink-green);
--dv-ink-violet:var(--bt-ink-violet);--dv-ink-sky:var(--bt-ink-sky);
--dv-ink-rose:var(--bt-ink-rose);--dv-ink-yellow:var(--bt-ink-yellow);
--dv-ink-cyan:var(--bt-ink-cyan);--dv-ink-magenta:var(--bt-ink-magenta)}
.bt-q-inline .dv-view{margin:0;width:100%;max-width:min(100%,max(calc(var(--bt-msg-w,.8) * 100%),560px));order:0}
.bt-q-inline .dv-q{margin:0;max-width:min(550px,86%);order:0}
body[data-bt-layout=flat] .bt-q-inline .dv-view{max-width:calc(var(--bt-flat-w,1) * 100%)}
.bt-q-inline:has(>.dv-view-bare){margin:8px 0 12px}
/* A row of segmented options is only as wide as its labels; at phone widths a
   few longer ones would spill past the card. Let them wrap and let a label wrap
   inside its own button instead. */
.dv-seg.dv-view-seg{flex-wrap:wrap}
.dv-seg.dv-view-seg button{flex:0 1 auto;height:auto;min-height:30px;min-width:0;padding-block:5px;white-space:normal;overflow-wrap:anywhere}
`;

// src/client/secret-card.js
var import_react14 = require("react");

// src/client/motion.js
var import_react13 = require("react");
var noHover = () => window.matchMedia?.("(hover: none)").matches === true;
var viewBottom = () => window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : window.innerHeight;
function useViewport() {
  const [tick, setTick] = (0, import_react13.useState)(0);
  (0, import_react13.useEffect)(() => {
    const viewport = window.visualViewport;
    if (!viewport) return void 0;
    const bump = () => setTick((value) => value + 1);
    viewport.addEventListener("resize", bump);
    viewport.addEventListener("scroll", bump);
    return () => {
      viewport.removeEventListener("resize", bump);
      viewport.removeEventListener("scroll", bump);
    };
  }, []);
  return tick;
}
function springEasing(stiffness, damping) {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  const at = (t2) => {
    if (zeta >= 1) return 1 - (1 + w0 * t2) * Math.exp(-w0 * t2);
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t2) * (Math.cos(wd * t2) + zeta * w0 / wd * Math.sin(wd * t2));
  };
  let end = 0.05;
  while (end < 2 && Math.abs(1 - at(end)) > 1e-3) end += 0.01;
  const points = Array.from({ length: 25 }, (_, index) => (index === 24 ? 1 : at(end * index / 24)).toFixed(4));
  return { duration: Math.round(end * 1e3), easing: `linear(${points.join(",")})`, stiffness, damping };
}
var SPRING_SHAPE = springEasing(400, 31.2);
var SPRING_TAP = springEasing(900, 48);
var SPRING_LIST = springEasing(484, 35.2);
var SPRING_STRETCH = springEasing(320, 20);
var SPRING_POP = springEasing(500, 22);
var SPRING_LEAD = springEasing(784, 48.2);
var SPRING_TRAIL = springEasing(289, 29.2);
var QUICK_EDGES = { lead: springEasing(900, 51), trail: springEasing(400, 34) };
var spring = (curve, ...properties) => properties.map((property) => `${property} ${curve.duration}ms ${curve.easing}`).join(",");

// src/client/secret-card.js
var MASK_BY_CSS = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("-webkit-text-security", "disc");
var SECRET_CSS = `
.bt-secret-head{align-items:center;gap:10px}
.bt-secret-who{position:relative;flex:none;display:inline-flex}
.bt-secret-lock{position:absolute;right:-5px;bottom:-4px;width:16px;height:16px;border-radius:50%;background:var(--bt-main);color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px var(--bt-bubble)}
.bt-secret-lock svg{width:11px;height:11px}
.bt-secret-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:16px;padding:1px 6px;border-radius:5px;background:var(--bt-hover);color:var(--bt-ink)}
.bt-secret-body{display:flex;flex-direction:column;gap:8px}
.bt-secret-field{align-items:center;min-height:36px}
.bt-secret-input{flex:1;width:100%;min-width:0;margin:0;padding:0;border:0;outline:none;background:transparent;color:var(--bt-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;line-height:20px;letter-spacing:.04em}
.bt-secret-input[data-masked]{-webkit-text-security:disc}
.bt-secret-input::placeholder{color:var(--bt-ink-3);font-family:var(--bt-font);letter-spacing:0}
.bt-secret-scope{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;align-self:flex-start;padding:2px;border-radius:999px;background:var(--bt-hover)}
.bt-secret-glide{position:absolute;top:2px;bottom:2px;left:2px;width:calc(50% - 2px);border-radius:999px;background:var(--bt-main);box-shadow:0 1px 3px rgba(20,20,20,.08),inset 0 0 0 .5px color-mix(in srgb,var(--bt-ink) 6%,transparent);transition:${spring(SPRING_SHAPE, "transform")}}
.bt-secret-glide[data-at="1"]{transform:translateX(100%)}
.bt-secret-seg{position:relative;z-index:1;height:28px;padding:0 14px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;transition:color .16s ease}
.bt-secret-seg[aria-checked=true]{color:var(--bt-ink);font-weight:500}
.bt-secret-seg:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
/* A key card asks the user to act, so the process group carrying it stays open in every
   work-details mode (same override as .bt-group-replies in styles.js). */
[data-step-process]:has(.bt-secret)>div:first-child{display:none!important}
[data-step-process]:has(.bt-secret)>[data-step-process-body]{display:block!important;content-visibility:visible!important;max-height:none!important;overflow:visible!important;mask-image:none!important;scrollbar-gutter:auto!important}
.bt-secret-ok{display:flex;align-items:center;gap:4px;margin-top:6px;animation:bt-secret-in .22s cubic-bezier(.22,1,.36,1)}
.bt-secret-ok svg{width:13px;height:13px;color:#16a34a}
@keyframes bt-secret-in{from{opacity:0;transform:translateY(-2px)}}
.bt-secret-saved{display:flex;align-items:center;gap:6px;font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-secret-note{font-size:12px;line-height:17px;color:var(--bt-ink-3)}
.bt-secret-note code,.bt-secret-about code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.bt-secret-warn{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;font-size:12px;line-height:16px;color:#b25e09;background:color-mix(in srgb,#f59e0b 12%,transparent)}
.bt-secret-error{font-size:12px;line-height:16px;color:var(--bt-danger)}
.bt-secret .bt-q-btn:disabled{opacity:.5;cursor:default}
.bt-secret-done .bt-q-head{align-items:center}
.bt-secret-done .bt-q-title{font-size:13px;line-height:18px;color:var(--bt-ink-2);font-weight:500}
.bt-secret-scope-tag{font-weight:400;color:var(--bt-ink-3)}
.bt-secret-check{color:var(--bt-green,#22a06b);animation:bt-secret-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-secret-done{animation:bt-secret-settle .32s cubic-bezier(.22,1,.36,1) backwards}
@keyframes bt-secret-pop{from{opacity:0;transform:scale(.4)}}
@keyframes bt-secret-settle{from{opacity:.4;transform:scale(.985)}}
.bt-secret-event{display:inline-flex;align-items:center;gap:5px}
.bt-secret-dock{flex-direction:column;align-items:center}
.bt-secret-dock .bt-q{max-width:min(550px,calc(100% - 32px))}
.bt-secret-about{margin:0 0 12px;padding:0 4px;font-size:12px;line-height:17px;color:var(--bt-ink-2)}
.bt-secret-title{display:flex;align-items:center;gap:6px;min-width:0;color:var(--bt-ink)}
.bt-secret-title svg{flex:none;color:var(--bt-ink-2)}
.bt-secret-purpose{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.bt-secret-faces{display:inline-flex}
.bt-secret-faces>*+*{margin-left:-6px}
.bt-secret-edit{display:flex;flex-direction:column;gap:14px;padding:4px 12px 14px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-secret-edit-block{display:flex;flex-direction:column;gap:8px}
.bt-secret-edit-label{font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-secret-radios{display:flex;gap:16px;font-size:13px}
.bt-secret-radio{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.bt-secret-bots{display:flex;flex-wrap:wrap;gap:6px}
.bt-secret-bot{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px 0 5px;border-radius:999px;border:.5px solid var(--bt-line);background:var(--bt-card);color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}
.bt-secret-bot[aria-pressed=true]{background:var(--bt-active);color:var(--bt-ink);border-color:var(--bt-line-2)}
.bt-secret-bot svg{width:13px;height:13px}
.bt-secret-inline{display:flex;gap:8px;align-items:center}
.bt-secret-inline .bt-input{flex:1;height:34px}
.bt-secret-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.bt-secret-row-actions .bt-set-hint{flex:1}
.bt-secret-danger{color:var(--bt-danger);display:inline-flex;align-items:center;gap:4px}
.bt-secret-danger svg{width:13px;height:13px}
.bt-secret-add .bt-input{height:34px}
@media (prefers-reduced-motion:reduce){.bt-secret-glide{transition:none}.bt-secret-check,.bt-secret-done,.bt-secret-ok,.bt-secret-edit{animation:none}}
`;

// src/client/fold.js
var import_react15 = require("react");
var FOLD_AT = { chars: 1500, lines: 25 };
var FOLD_HUGE = { chars: 2e4, lines: Infinity };
var ALWAYS = { chars: -1, lines: 0 };
var PREVIEW_LINES = 10;
var PREVIEW_CHARS = 600;
var FENCE = /^ {0,3}(`{3,}|~{3,})/;
var CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
var closes = (line, open) => {
  const marker = CLOSE.exec(line)?.[1];
  return marker !== void 0 && marker[0] === open[0] && marker.length >= open.length;
};
function cutAt(text, end) {
  const code = text.charCodeAt(end - 1);
  return text.slice(0, code >= 55296 && code <= 56319 ? end - 1 : end);
}
function moreLines(text, max) {
  let lines = 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    if (++lines > max) return true;
  }
  return false;
}
function openedFence(lines) {
  let open = null;
  let openLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const marker = FENCE.exec(lines[i])?.[1];
    if (marker === void 0) continue;
    if (open === null) {
      open = marker;
      openLine = i;
    } else if (closes(lines[i], open)) open = null;
  }
  return open === null ? null : { marker: open, line: openLine };
}
function blockCode(body, fenceLine, open) {
  const lines = body.split("\n");
  const indent = /^ */.exec(lines[fenceLine])[0].length;
  const code = [];
  for (let i = fenceLine + 1; i < lines.length; i += 1) {
    if (closes(lines[i], open)) break;
    code.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ""));
  }
  return code.join("\n");
}
function foldView(text, limit = FOLD_AT, markdown = true) {
  if (text.length <= limit.chars && !moreLines(text, limit.lines)) return null;
  const body = text.replace(/^(\s*\n)+/, "");
  if (body.trim() === "") return null;
  let head = body.split("\n", PREVIEW_LINES).join("\n");
  if (head.length > PREVIEW_CHARS) {
    const cut = head.lastIndexOf("\n", PREVIEW_CHARS);
    head = cutAt(head, cut > 0 ? cut : PREVIEW_CHARS);
  }
  if (head.trim() === "") head = cutAt(body, PREVIEW_CHARS);
  if (!markdown) return { head };
  let opened = openedFence(head.split("\n"));
  if (opened !== null && head.split("\n").slice(opened.line + 1).join("").trim() === "") {
    head = cutAt(body, PREVIEW_CHARS);
    opened = openedFence(head.split("\n"));
  }
  if (opened === null) return { head };
  const lines = head.split("\n");
  lines[opened.line] = opened.marker;
  return {
    head: `${lines.join("\n")}
${opened.marker}`,
    // The markdown before the block and the part of the block the preview
    // keeps: the half block is drawn outside the host's Markdown, whose own
    // copy control would hold only the part shown.
    prose: lines.slice(0, opened.line).join("\n"),
    codeHead: lines.slice(opened.line + 1).join("\n"),
    code: blockCode(body, opened.line, opened.marker)
  };
}
var stripLongNote = (text) => text.replace(/^\[A long message: \d+ characters\.[^\]\n]*\]\n/, "");
function useFold(text, { limit = FOLD_AT, whole, live = false, markdown = true } = {}) {
  const [open, setOpen] = (0, import_react15.useState)(false);
  const [read, setRead] = (0, import_react15.useState)();
  const cut = whole !== void 0 && whole.length > text.length;
  const view = (0, import_react15.useMemo)(() => live ? null : foldView(text, cut ? ALWAYS : limit, markdown), [text, live, limit, markdown, cut]);
  if (view === null) return { shown: text, control: null };
  const code = cut ? void 0 : view.code;
  const shown = code === void 0 ? view.head : view.prose;
  const count = (cut ? whole.length : text.length).toLocaleString();
  if (!open) {
    const show2 = async () => {
      setOpen(true);
      if (!cut || read !== void 0 || whole.load === void 0) return;
      setRead("loading");
      setRead(await whole.load() ?? { whole: false });
    };
    return { shown, folded: true, code, codeHead: view.codeHead, control: (0, import_react15.createElement)("span", { className: "bt-fold" }, (0, import_react15.createElement)("button", { type: "button", className: "bt-more", onClick: show2 }, t("Show all · {count} characters", { count }))) };
  }
  const loaded = typeof read?.text === "string" ? read : void 0;
  const note = !cut || read === void 0 || read === "loading" || loaded?.whole ? null : loaded !== void 0 && loaded.text.length > text.length ? t("Showing the first {count} characters", { count: loaded.text.length.toLocaleString() }) : t("Only the start of this message is kept here");
  return {
    shown: loaded?.text ?? text,
    control: (0, import_react15.createElement)(
      "span",
      { className: "bt-fold" },
      note ? (0, import_react15.createElement)("span", { className: "bt-fold-note" }, note) : null,
      (0, import_react15.createElement)("button", { type: "button", className: "bt-more", onClick: () => setOpen(false) }, t("Show less"))
    )
  };
}

// src/client/btw.js
var import_react16 = require("react");
var mdLabels2 = () => ({ code: { copyLabel: t("Copy"), copiedLabel: t("Copied") }, footnotes: t("Footnotes") });
function failureText(card) {
  const raw = typeof card.error === "string" ? card.error : card.error?.message;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text !== "" ? hostText(text) : t("Could not answer.");
}
function stampOf(card) {
  const time = Number.isFinite(card.finishedAt) ? card.finishedAt : card.createdAt;
  return Number.isFinite(time) ? time : void 0;
}
function BtwCardView({ card, compact = false, sessionId, actions, onDeleted }) {
  const [open, setOpen] = (0, import_react16.useState)(card?.status !== "answering");
  const [deleting, setDeleting] = (0, import_react16.useState)(false);
  (0, import_react16.useEffect)(() => {
    if (card?.status && card.status !== "answering") setOpen(true);
  }, [card?.status]);
  if (!card) return null;
  const question = typeof card.question === "string" ? card.question : "";
  const answer = typeof card.answer === "string" ? card.answer : "";
  const when = stampOf(card);
  const answering = card.status === "answering";
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await actions.deleteBtw(card.partId ?? sessionId, card.id);
      if (result?.deleted) onDeleted?.(card.id);
      else setDeleting(false);
    } catch (error) {
      actions.reportError(error, "btw-delete");
      setDeleting(false);
    }
  };
  return (0, import_react16.createElement)(
    "div",
    {
      className: compact ? "bt-btw bt-btw-compact" : "bt-btw",
      "data-open": open || void 0,
      "data-status": card.status,
      role: "region",
      "aria-label": t("Side chat")
    },
    (0, import_react16.createElement)(
      "div",
      { className: "bt-btw-head" },
      (0, import_react16.createElement)(
        "button",
        {
          type: "button",
          className: "bt-btw-toggle",
          "aria-expanded": open,
          onClick: () => setOpen((value) => !value)
        },
        (0, import_react16.createElement)("span", { className: "bt-btw-chevron", "aria-hidden": true }),
        (0, import_react16.createElement)("span", { className: "bt-btw-q" }, question)
      ),
      when !== void 0 ? (0, import_react16.createElement)("time", { className: "bt-btw-time", dateTime: new Date(when).toISOString() }, messageClock(when)) : null,
      answering ? (0, import_react16.createElement)("span", { className: "bt-shimmer" }, t("Answering…")) : null,
      card.status === "cancelled" ? (0, import_react16.createElement)("span", { className: "bt-btw-status" }, t("Cancelled")) : null,
      (0, import_react16.createElement)("button", {
        type: "button",
        className: "bt-icon-btn bt-btw-delete",
        disabled: deleting,
        "aria-label": t("Delete side chat"),
        title: t("Delete side chat"),
        onClick: () => {
          void remove();
        }
      }, (0, import_react16.createElement)(CloseIcon))
    ),
    (0, import_react16.createElement)("p", { className: "bt-btw-note" }, t("Answered from progress so far; nothing was run")),
    open ? (0, import_react16.createElement)(
      "div",
      { className: "bt-btw-body" },
      card.status === "failed" ? (0, import_react16.createElement)("p", { className: "bt-btw-fail" }, failureText(card)) : null,
      answer !== "" ? (0, import_react16.createElement)("div", { className: "bt-btw-answer" }, (0, import_react16.createElement)(import_dsh_client_ui_primitives.MarkdownText, { text: answer, labels: mdLabels2(), variant: "compact" })) : null
    ) : null
  );
}

// src/client/themes.js
var THEMES = {
  deepseek: {
    label: "DeepSeek",
    light: { bg: "#fcfcfc", sidebar: "#f7f7f7", bubble: "#eeeeee", card: "#ffffff", text: "#141414", user: "#070707", userText: "#fcfcfc", accent: "#4d6bfe" },
    dark: { bg: "#141414", sidebar: "#1b1b1b", bubble: "#262626", card: "#1f1f1f", text: "#f2f2f2", user: "#f2f2f2", userText: "#141414", accent: "#5b7bff" }
  },
  mono: {
    label: "Mono",
    light: { bg: "#ffffff", sidebar: "#f9f9f9", bubble: "#f0f0f0", card: "#ffffff", text: "#0d0d0d", user: "#0d0d0d", userText: "#ffffff", accent: "#0d0d0d" },
    dark: { bg: "#0f0f0f", sidebar: "#171717", bubble: "#242424", card: "#1c1c1c", text: "#f4f4f4", user: "#f4f4f4", userText: "#0f0f0f", accent: "#f4f4f4" }
  },
  paper: {
    label: "Paper",
    light: { bg: "#faf9f5", sidebar: "#f3f0e8", bubble: "#ebe7dc", card: "#ffffff", text: "#1f1e1b", user: "#2b2a26", userText: "#faf9f5", accent: "#d97757" },
    dark: { bg: "#1f1e1b", sidebar: "#262521", bubble: "#34322d", card: "#2a2925", text: "#f3f0e8", user: "#f3f0e8", userText: "#1f1e1b", accent: "#e08a6d" }
  },
  moonlight: {
    label: "Moonlight",
    light: { bg: "#f7f9fc", sidebar: "#eef2f8", bubble: "#e5ebf5", card: "#ffffff", text: "#121826", user: "#1e3a8a", userText: "#ffffff", accent: "#1e86ff" },
    dark: { bg: "#0b1020", sidebar: "#10172a", bubble: "#1a2340", card: "#141c33", text: "#e8edf7", user: "#3b6fd8", userText: "#ffffff", accent: "#4f9dff" }
  }
};
var DARK_INK = "#141414";
var accentInk = (accent) => (luminance(accent) + 0.05) ** 2 > 1.05 * (luminance(DARK_INK) + 0.05) ? DARK_INK : "#ffffff";
var rgba = (hex, alpha) => `rgba(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(",")},${alpha})`;
function themeVars2(mode, dark, accent = mode.accent) {
  return {
    "--bt-ink": mode.text,
    "--bt-ink-2": rgba(mode.text, 0.6),
    "--bt-ink-3": rgba(mode.text, 0.36),
    "--bt-bubble": mode.bubble,
    "--bt-sidebar": mode.sidebar,
    "--bt-main": mode.bg,
    "--bt-card": mode.card,
    "--bt-line": rgba(mode.text, 0.08),
    "--bt-line-2": rgba(mode.text, 0.15),
    "--bt-hover": dark ? "rgba(160,160,160,.12)" : "rgba(119,119,119,.09)",
    "--bt-active": dark ? "rgba(160,160,160,.2)" : "rgba(119,119,119,.17)",
    "--bt-accent": accent,
    "--bt-accent-ink": accentInk(accent),
    "--bt-user": mode.user,
    "--bt-user-ink": mode.userText,
    "--bt-tag-bg": rgba(mode.text, dark ? 0.09 : 0.06),
    "--bt-tag-ink": rgba(mode.text, 0.58)
  };
}
var declarations = (vars) => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");
var darkAccent = (accent) => {
  const ink = ACCENT_INKS.find((id) => INKS[id][0] === accent);
  return ink === void 0 ? accent : INKS[ink][1];
};
var themeCss = (theme, accent) => `html body{${declarations(themeVars2(theme.light, false, accent ?? theme.light.accent))}}
html body[data-ds-dark-theme]{${declarations(themeVars2(theme.dark, true, darkAccent(accent) ?? theme.dark.accent))}}
${theme.css ?? ""}`;
var customThemes = {};
var registry = createSource(0);
var allThemes = () => ({ ...THEMES, ...customThemes });
var layoutOf = (prefs) => prefs?.layout === "flat" ? "flat" : "bubble";

// src/client/cells.js
var mdLabels3 = () => ({ code: { copyLabel: t("Copy"), copiedLabel: t("Copied") }, footnotes: t("Footnotes") });
function Bubbles({ texts, roster: roster2, selfId, actions, streaming, sessionId, msgKey, useUi, lead, mentions, fold = FOLD_AT, whole }) {
  const onClick = (event) => {
    const target = mentionTarget(event);
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    actions.openSession(target);
  };
  const reactions = useUi ? useUi((state) => msgKey ? state.reactions?.[msgKey] ?? null : null) : null;
  return (0, import_react17.createElement)(
    "div",
    { className: "bt-astack", "data-lead": lead ? "" : void 0, onClickCapture: onClick },
    texts.map((text, index) => {
      const last = index === texts.length - 1;
      return (0, import_react17.createElement)(Bubble, {
        key: index,
        text,
        index,
        roster: roster2,
        selfId,
        actions,
        sessionId,
        msgKey,
        mentions,
        fold,
        picked: msgKey ? reactions?.[index] ?? [] : [],
        live: streaming && last,
        lead: lead && last ? lead : null,
        whole: last ? whole : void 0
      });
    })
  );
}
function FoldCodeCopy({ code, actions }) {
  const [copied, setCopied] = (0, import_react17.useState)(false);
  const copy = () => {
    void (0, import_dsh_client_ui_primitives.writeClipboard)(code).then((ok) => {
      if (!ok) {
        actions?.reportError?.(new Error("Could not copy the code block"), "copy");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1e3);
    }, () => actions?.reportError?.(new Error("Could not copy the code block"), "copy"));
  };
  return (0, import_react17.createElement)("button", { type: "button", className: "bt-tool bt-fold-copy", "aria-label": copied ? t("Copied") : t("Copy"), title: copied ? t("Copied") : t("Copy"), onClick: copy }, copied ? (0, import_react17.createElement)(CheckIcon) : (0, import_react17.createElement)(CopyIcon));
}
var foldArea = (body, code, codeHead, actions) => code === void 0 ? body : (0, import_react17.createElement)(
  "div",
  { className: "bt-fold-code" },
  body,
  (0, import_react17.createElement)("pre", { className: "bt-fold-pre" }, (0, import_react17.createElement)("code", null, codeHead)),
  (0, import_react17.createElement)(FoldCodeCopy, { code, actions })
);
function Bubble({ text, index, roster: roster2, selfId, actions, sessionId, msgKey, mentions, fold, picked, live, lead, whole }) {
  const { shown, folded, control, code, codeHead } = useFold(text, { limit: fold, whole, live });
  const key = msgKey ? `${msgKey}:${index}` : void 0;
  const body = shown === "" ? null : (0, import_react17.createElement)(import_dsh_client_ui_primitives.MarkdownText, { text: linkMentions(shown, roster2.bots, selfId), streaming: live, labels: mdLabels3(), variant: "compact", fileMentions: mentions });
  const row = (0, import_react17.useRef)(null);
  const [toolsOpen, setToolsOpen] = (0, import_react17.useState)(false);
  useDismiss(toolsOpen, () => setToolsOpen(false), [row]);
  const tapTools = (event) => {
    if (!noHover() || event.target instanceof Element && event.target.closest("a,button,input,textarea,select,pre,code,[role=button],[role=link]")) return;
    setToolsOpen((value) => !value);
  };
  const area = foldArea(body, code, codeHead, actions);
  return (0, import_react17.createElement)(
    "div",
    { ref: row, className: "bt-msg", onClick: tapTools },
    (0, import_react17.createElement)(
      "div",
      { className: "bt-msg-line" },
      lead,
      (0, import_react17.createElement)(
        "div",
        { className: "bt-bubble", "data-folded": folded || void 0 },
        control ? (0, import_react17.createElement)("div", { className: "bt-fold-body" }, area) : area,
        control
      ),
      live ? null : (0, import_react17.createElement)(MessageTools, { text: folded ? text : shown, name: roster2.byId[selfId]?.name ?? t("Bot"), sessionId, react: key ? (emoji) => actions.toggleReaction(msgKey, index, emoji) : void 0, actions, open: toolsOpen })
    ),
    picked.length ? (0, import_react17.createElement)("div", { className: "bt-reacts" }, picked.map((emoji) => (0, import_react17.createElement)("button", {
      key: emoji,
      type: "button",
      className: "bt-react",
      "aria-label": t("Remove reaction {emoji}", { emoji }),
      onClick: () => actions.toggleReaction(msgKey, index, emoji)
    }, emoji))) : null
  );
}
var REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
var STRIP_HALF = (REACTIONS.length * 34 + 10) / 2 + 8;
function useDismiss(open, close, refs) {
  (0, import_react17.useEffect)(() => {
    if (!open) return void 0;
    const onDown = (event) => {
      if (refs.some((ref) => ref.current?.contains(event.target))) return;
      close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}
function MessageTools({ text, name, sessionId, react, actions, open: tapped }) {
  const [panel, setPanel] = (0, import_react17.useState)(null);
  const [copied, setCopied] = (0, import_react17.useState)(false);
  const tools = (0, import_react17.useRef)(null);
  const pop = (0, import_react17.useRef)(null);
  const tick = useViewport();
  const close = () => setPanel(null);
  useDismiss(panel !== null, close, [tools, pop]);
  const open = (kind, event) => {
    if (panel?.kind === kind) {
      close();
      return;
    }
    setPanel({ kind, node: event.currentTarget });
  };
  const place = (0, import_react17.useMemo)(() => {
    if (!panel) return null;
    const rect = panel.node.getBoundingClientRect();
    const below = rect.bottom + 220 < viewBottom();
    return panel.kind === "react" ? { left: Math.min(Math.max(rect.left + rect.width / 2, STRIP_HALF), window.innerWidth - STRIP_HALF), top: rect.top - 6, "--bt-origin": "bottom center" } : { left: Math.min(rect.left, window.innerWidth - 208), ...below ? { top: rect.bottom + 4 } : { bottom: viewBottom() - rect.top + 4, "--bt-origin": "bottom left" } };
  }, [panel, tick]);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1e3);
    });
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${name}-message.md` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };
  const item = (label, Icon, run2) => (0, import_react17.createElement)("button", { key: label, type: "button", role: "menuitem", onClick: () => {
    close();
    run2();
  } }, (0, import_react17.createElement)(Icon), label);
  return (0, import_react17.createElement)(
    "div",
    { ref: tools, className: "bt-tools", "data-open": panel !== null || tapped || void 0 },
    react ? (0, import_react17.createElement)("button", { type: "button", className: "bt-tool", "aria-label": t("Add reaction"), title: t("Add reaction"), "aria-expanded": panel?.kind === "react", onClick: (event) => open("react", event) }, (0, import_react17.createElement)(SmileIcon)) : null,
    sessionId ? (0, import_react17.createElement)("button", { type: "button", className: "bt-tool", "aria-label": t("Reply"), title: t("Reply"), onClick: () => actions.quote(sessionId, text) }, (0, import_react17.createElement)(ReplyIcon)) : null,
    (0, import_react17.createElement)("button", { type: "button", className: "bt-tool", "aria-label": t("More message actions"), title: t("More"), "aria-haspopup": "menu", "aria-expanded": panel?.kind === "more", onClick: (event) => open("more", event) }, copied ? (0, import_react17.createElement)(CheckIcon) : (0, import_react17.createElement)(DotsIcon)),
    panel?.kind === "react" ? (0, import_react_dom.createPortal)((0, import_react17.createElement)(
      "div",
      { ref: pop, className: "bt-react-strip", role: "menu", "aria-label": t("Reactions"), style: place },
      REACTIONS.map((emoji) => (0, import_react17.createElement)("button", { key: emoji, type: "button", role: "menuitem", "aria-label": emoji, onClick: () => {
        close();
        react(emoji);
      } }, emoji))
    ), document.body) : null,
    panel?.kind === "more" ? (0, import_react_dom.createPortal)((0, import_react17.createElement)(
      "div",
      { ref: pop, className: "bt-menu", role: "menu", "aria-label": t("Message actions"), style: place },
      item(t("Copy"), CopyIcon, copy),
      item(t("Download"), DownloadIcon, download)
    ), document.body) : null
  );
}
function EventLine({ prefix, bots, joiner = t("and"), onOpen, whole = false }) {
  if (whole && bots.length === 1) {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event" },
      (0, import_react17.createElement)(
        "button",
        { type: "button", className: "bt-event-whole", title: bots[0].name, onClick: () => onOpen?.(bots[0]) },
        (0, import_react17.createElement)("span", null, prefix),
        (0, import_react17.createElement)(BotMark, { bot: bots[0], size: 16 }),
        (0, import_react17.createElement)("span", { className: "bt-event-name" }, bots[0].name)
      )
    );
  }
  const parts = [];
  parts.push((0, import_react17.createElement)("span", { key: "p" }, prefix));
  bots.forEach((bot, index) => {
    if (index > 0) parts.push((0, import_react17.createElement)("span", { key: `j${index}` }, joiner));
    parts.push((0, import_react17.createElement)(
      "button",
      { key: bot.id ?? index, type: "button", onClick: () => onOpen?.(bot) },
      (0, import_react17.createElement)(BotMark, { bot, size: 16 }),
      bot.name
    ));
  });
  return (0, import_react17.createElement)("div", { className: "bt-event" }, parts);
}
function SpeakerHead({ bot, time }) {
  return (0, import_react17.createElement)(
    "div",
    { className: "bt-group-name" },
    (0, import_react17.createElement)("span", { className: "bt-lead" }, (0, import_react17.createElement)(BotMark, { bot, size: 22 })),
    bot.name,
    Number.isFinite(time) ? (0, import_react17.createElement)("span", { className: "bt-group-time", title: clockLabel(time) }, messageClock(time)) : null
  );
}
function GroupMessage({ bot, text, texts = [text], room, roster: roster2, actions, msgKey, useUi, whole, time, duration }) {
  const lead = (0, import_react17.createElement)(
    "button",
    { type: "button", className: "bt-lead", "aria-label": t("Open {name}'s chat", { name: bot.name }), onClick: () => actions.openSession(bot.id) },
    (0, import_react17.createElement)(BotMark, { bot, size: 22 })
  );
  const flat = layoutOf(roster2.prefs) === "flat";
  const took = Number.isFinite(duration) ? elapsedLabel(duration) : void 0;
  return (0, import_react17.createElement)(
    "div",
    { className: "bt-group-msg" },
    (0, import_react17.createElement)(
      "span",
      { className: "bt-group-name", style: flat ? void 0 : { color: inkText(colorOf(bot)) } },
      flat ? lead : null,
      bot.name,
      room?.admin === bot.id ? (0, import_react17.createElement)("span", { className: "bt-group-role" }, t("Admin")) : null,
      Number.isFinite(time) ? (0, import_react17.createElement)("span", { className: "bt-group-time", title: clockLabel(time) }, messageClock(time)) : null,
      took ? (0, import_react17.createElement)("span", { className: "bt-group-took", title: t("Ran for {duration}", { duration: took }) }, took) : null
    ),
    (0, import_react17.createElement)(Bubbles, { texts, roster: roster2, selfId: bot.id, actions, sessionId: room?.id, msgKey, useUi, lead: flat ? null : lead, whole })
  );
}
function GroupEvent({ prefix, room, name, roster: roster2, actions }) {
  return (0, import_react17.createElement)(
    "div",
    { className: "bt-event" },
    (0, import_react17.createElement)("span", null, prefix),
    room ? (0, import_react17.createElement)("button", { type: "button", onClick: () => actions.openSession(room.id) }, (0, import_react17.createElement)(RoomAvatar, { room, roster: roster2, size: 16 }), room.name) : name ? (0, import_react17.createElement)("span", null, name) : null
  );
}
function PartLine({ time }) {
  return (0, import_react17.createElement)("div", { className: "bt-part-line", role: "separator" }, Number.isFinite(time) ? (0, import_react17.createElement)("span", null, dayLabel(time)) : null);
}
function EarlierUser({ row, actions }) {
  const { shown, folded, control, code, codeHead } = useFold(row.text ?? "");
  const body = row.text && shown !== "" ? (0, import_react17.createElement)(import_dsh_client_ui_primitives.MarkdownText, { text: shown, labels: mdLabels3(), variant: "compact" }) : null;
  const area = foldArea(body, code, codeHead, actions);
  return (0, import_react17.createElement)("div", { className: "bt-urow" }, (0, import_react17.createElement)(
    "div",
    { className: "bt-ububble", "data-folded": folded || void 0 },
    control ? (0, import_react17.createElement)("div", { className: "bt-fold-body" }, area) : area,
    control,
    row.images ? (0, import_react17.createElement)("span", { className: "bt-uimages" }, row.images === 1 ? t("1 image") : t("{count} images", { count: row.images })) : null
  ));
}
function ChatRows({ items, sessionId, roster: roster2, actions, useUi, clock: clock2 = false, onBtwDelete }) {
  const selfId = roster2.byId[sessionId]?.id;
  const rows2 = [];
  for (const item of items) {
    const last = rows2.at(-1);
    if (item.kind === "bot" && last?.kind === "bot") {
      last.texts.push(item.text);
      last.end = item.time;
    } else rows2.push(item.kind === "bot" ? { kind: "bot", texts: [item.text], time: item.time, end: item.time } : item);
  }
  let before;
  return rows2.flatMap((row, index) => {
    const key = rows2.length - index;
    const shown = chatRow(row, key, { sessionId, selfId, roster: roster2, actions, useUi, onBtwDelete });
    if (row.kind === "divider") {
      before = void 0;
      return [shown];
    }
    const pause = clock2 && Number.isFinite(row.time) && (before === void 0 || row.time - before >= SEPARATOR_GAP_MS);
    if (Number.isFinite(row.end ?? row.time)) before = row.end ?? row.time;
    return pause ? [(0, import_react17.createElement)("div", { key: `${key}:clock`, className: "bt-time-sep", role: "separator" }, clockLabel(row.time)), shown] : [shown];
  });
}
function chatRow(row, key, { sessionId, selfId, roster: roster2, actions, useUi, onBtwDelete }) {
  switch (row.kind) {
    case "divider":
      return (0, import_react17.createElement)(PartLine, { key, time: row.time });
    case "user":
      return (0, import_react17.createElement)(EarlierUser, { key, row, actions });
    case "answer":
      return (0, import_react17.createElement)(AnsweredReply, { key, node: { data: row } });
    // A display-only view replays from the blueprint the host kept on the call.
    case "view":
      return (0, import_react17.createElement)(WidgetCell, { key, sessionId, callId: row.callId, args: { text: (name) => name === "title" ? row.title : void 0, value: (name) => name === "view" ? row.view : void 0 }, done: true, isError: false, roster: roster2, actions });
    case "bot": {
      const bubbles = (0, import_react17.createElement)(Bubbles, { key, texts: row.texts, roster: roster2, selfId, actions, sessionId: useUi ? sessionId : void 0, msgKey: useUi ? `${sessionId}:${row.time}` : void 0, useUi, fold: FOLD_HUGE });
      const speaker = layoutOf(roster2.prefs) === "flat" ? roster2.byId[selfId] : void 0;
      return speaker ? (0, import_react17.createElement)(import_react17.Fragment, { key }, (0, import_react17.createElement)(SpeakerHead, { bot: speaker, time: row.time }), bubbles) : bubbles;
    }
    case "btw":
      return (0, import_react17.createElement)(BtwCardView, { key, card: row.card, sessionId, actions, onDeleted: onBtwDelete });
    case "post": {
      const poster = roster2.byId[row.botId] ?? { id: row.botId, name: row.name ?? t("a Bot"), color: "gray" };
      return (0, import_react17.createElement)(GroupMessage, {
        key,
        bot: poster,
        text: row.file ? stripLongNote(row.text) : row.text,
        texts: row.texts,
        room: roster2.roomsById[sessionId],
        roster: roster2,
        actions,
        msgKey: `${sessionId}:post:${row.seq ?? row.time}`,
        time: row.time,
        duration: row.duration,
        whole: row.file ? { length: row.length, load: () => actions.fileText(row.file) } : void 0
      });
    }
    case "relay": {
      const reply = row.reply;
      const speaker = roster2.byId[reply.botId] ?? { id: reply.botId, name: reply.name ?? t("a Bot"), color: reply.color ?? "gray" };
      return (0, import_react17.createElement)(RelayEvent, { key, reply, bot: speaker, sessionId, actions });
    }
    case "event": {
      if (row.role === "report") return (0, import_react17.createElement)(GroupEvent, { key, prefix: t("Replies from"), room: roster2.roomsById[row.roomId], name: t("a group chat"), roster: roster2, actions });
      const other = roster2.byId[row.botId] ?? { id: row.botId, name: row.name ?? t("a Bot"), color: "gray" };
      const prefix = { stopped: t("Stopped by"), reply: t("Reply from") }[row.role] ?? t("Message from");
      return (0, import_react17.createElement)(EventLine, { key, prefix, bots: [other], onOpen: () => {
        if (selfId && other.id) actions.openExchange(selfId, other.id);
      }, whole: true });
    }
    default:
      return null;
  }
}
var SEPARATOR_GAP_MS = 30 * 60 * 1e3;
function RelayEvent({ reply, bot, sessionId, actions }) {
  if (reply.kind === "failed") {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event bt-event-error", role: "status", title: [reply.code, reply.status, reply.text].filter(Boolean).join(" · ") },
      t("{name} could not answer: {reason}", { name: bot.name, reason: failureLabel(reply.code, reply.text) })
    );
  }
  if (reply.kind === "lookup") {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event" },
      reply.text ? t("{name} looked up its own chat for “{text}”", { name: bot.name, text: reply.text }) : t("{name} looked up its own chat", { name: bot.name })
    );
  }
  if (reply.kind === "missed") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, t("{name} didn't answer in time", { name: bot.name }));
  }
  if (reply.kind === "admin-passed") {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event" },
      t("{name} did not answer or call anyone; call a member with @Name", { name: bot.name })
    );
  }
  if (reply.kind === "paused") {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event" },
      t("Paused after {count} Bot relays. Waiting: {names}", { count: reply.count, names: (reply.names ?? []).join(t(" and ")) })
    );
  }
  if (reply.kind === "resumed") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, t("{name} was cut off by a restart and picked its work back up", { name: bot.name }));
  }
  if (reply.kind === "cut") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, t("{name} was cut off by a restart again and stopped", { name: bot.name }));
  }
  if (reply.kind === "approval" || reply.kind === "working") {
    return (0, import_react17.createElement)(
      "div",
      { className: "bt-event" },
      (0, import_react17.createElement)(
        "button",
        { type: "button", className: "bt-event-whole", onClick: () => actions.showDetails(sessionId) },
        (0, import_react17.createElement)(BotMark, { bot, size: 16 }),
        (0, import_react17.createElement)("span", { className: "bt-event-name" }, t(reply.kind === "working" ? "{name} started on it" : "{name} paused for your approval", { name: bot.name }))
      )
    );
  }
  if (reply.kind === "folder") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, reply.text);
  }
  if (reply.kind === "stopped") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, t("You stopped {name}'s work", { name: bot.name }));
  }
  if (reply.kind === "done") {
    return (0, import_react17.createElement)("div", { className: "bt-event" }, t("{name} finished its work", { name: bot.name }));
  }
  return null;
}

// src/client/feed.js
function mergePage(current, page) {
  const items = new Map(current.items.map((item) => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return { ...page, items: [...items.values()].sort((left, right) => (left.time ?? 0) - (right.time ?? 0) || left.id.localeCompare(right.id)) };
}
function createFeed(call2, changed) {
  let snapshot = { items: [], tickets: [] };
  let pending;
  return {
    snapshot: () => snapshot,
    refresh(signal) {
      if (pending) return pending;
      pending = (async () => {
        let page;
        do {
          page = await call2("state", snapshot.cursor ? { cursor: snapshot.cursor } : {}, signal);
          snapshot = mergePage(snapshot, page);
          changed(snapshot);
        } while (page.hasMore);
      })().finally(() => {
        pending = void 0;
      });
      return pending;
    }
  };
}

// src/client/superagent-chat.js
var roster = { ...EMPTY_ROSTER, ready: true };
function Evidence({ item }) {
  const [pages, setPages] = (0, import_react18.useState)([]);
  const [error, setError] = (0, import_react18.useState)(null);
  const [busy, setBusy] = (0, import_react18.useState)(false);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const after = pages.at(-1)?.pagination.cursor;
      const page = await call("evidence", { ticketId: item.ticketId, ref: item.evidence, ...after ? { after } : {} });
      setPages((current) => [...current, page]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (0, import_react18.createElement)(
    "details",
    { onToggle: (event) => {
      if (event.currentTarget.open && pages.length === 0 && !busy) void load();
    } },
    (0, import_react18.createElement)("summary", null, t("Evidence")),
    pages.map((page, index) => (0, import_react18.createElement)("pre", { key: index, className: "bt-q-detail" }, page.text)),
    error ? (0, import_react18.createElement)("p", { role: "alert" }, error) : null,
    pages.at(-1)?.pagination.truncated || error ? (0, import_react18.createElement)("button", { type: "button", className: "bt-soft", disabled: busy, onClick: () => {
      void load();
    } }, error ? t("Retry") : t("Read more")) : null
  );
}
function Composer({ onSend, disabled }) {
  const [text, setText] = (0, import_react18.useState)("");
  const [error, setError] = (0, import_react18.useState)(null);
  const field = (0, import_react18.useRef)(null);
  const pending = (0, import_react18.useRef)(null);
  const sending = (0, import_react18.useRef)(false);
  (0, import_react18.useLayoutEffect)(() => {
    const node = field.current;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [text]);
  const submit = async () => {
    const value = text.trim();
    if (value === "" || disabled || sending.current) return;
    sending.current = true;
    setError(null);
    if (pending.current?.text !== value) pending.current = { requestId: crypto.randomUUID(), text: value };
    try {
      await onSend(pending.current);
      pending.current = null;
      setText("");
    } catch (failure) {
      setError(failure.message);
    } finally {
      sending.current = false;
    }
  };
  return (0, import_react18.createElement)(
    "div",
    { className: "dsb-composer-wrap" },
    error ? (0, import_react18.createElement)("p", { className: "dsb-composer-error", role: "alert" }, error) : null,
    (0, import_react18.createElement)(
      "div",
      { className: "dsb-composer", "data-composer-card": "", "data-multiline": text.includes("\n") || void 0 },
      (0, import_react18.createElement)(
        "div",
        { className: "dsb-composer-input", "data-input-scroll": "" },
        (0, import_react18.createElement)("textarea", {
          ref: field,
          rows: 1,
          value: text,
          disabled,
          placeholder: t("Message Super-agent"),
          "aria-label": t("Message Super-agent"),
          "data-composer-input": "",
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }
        })
      ),
      (0, import_react18.createElement)(
        "div",
        { className: "dsb-composer-trailing" },
        (0, import_react18.createElement)("button", { type: "button", className: "dsb-send", disabled: disabled || text.trim() === "", "aria-label": t("Send message"), title: t("Send message"), onClick: () => {
          void submit();
        } }, (0, import_react18.createElement)(ArrowUpIcon))
      )
    )
  );
}
function SuperagentChat() {
  const [view, setView] = (0, import_react18.useState)({ items: [], tickets: [] });
  const [error, setError] = (0, import_react18.useState)(null);
  const [ready, setReady] = (0, import_react18.useState)(false);
  const [busy, setBusy] = (0, import_react18.useState)(false);
  const feed = (0, import_react18.useMemo)(() => createFeed(call, setView), []);
  const commands = (0, import_react18.useRef)(/* @__PURE__ */ new Map());
  const scroller = (0, import_react18.useRef)(null);
  const follow = (0, import_react18.useRef)(true);
  (0, import_react18.useEffect)(() => {
    const controller = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        await feed.refresh(controller.signal);
        setError(null);
        setReady(true);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 1e3);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [feed]);
  (0, import_react18.useLayoutEffect)(() => {
    if (follow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [view]);
  const command = async (endpoint, payload) => {
    setBusy(true);
    const key = JSON.stringify([endpoint, payload]);
    if (!commands.current.has(key)) commands.current.set(key, crypto.randomUUID());
    try {
      await call(endpoint, { ...payload, requestId: commands.current.get(key) });
      commands.current.delete(key);
      await feed.refresh();
    } catch (failure) {
      setError(failure.message);
      throw failure;
    } finally {
      setBusy(false);
    }
  };
  const actions = {
    answerQuestion: (_sessionId, attentionId, answer) => {
      const ticket = view.tickets.find((item) => item.attention?.id === attentionId);
      return command("answer", { ticketId: ticket.ticketId, attentionId, text: [...answer.selected, answer.custom].filter(Boolean).join("\n") });
    }
  };
  return (0, import_react18.createElement)(
    "main",
    { className: "dsb-main dsb-superagent" },
    (0, import_react18.createElement)("div", { className: "dsb-head" }, (0, import_react18.createElement)("div", { className: "bt-head" }, (0, import_react18.createElement)("div", { className: "bt-pill" }, (0, import_react18.createElement)("span", { className: "bt-pill-name" }, "Super-agent")))),
    (0, import_react18.createElement)(
      "div",
      { className: "dsb-chat" },
      (0, import_react18.createElement)("div", { ref: scroller, className: "dsb-scroll", "data-conversation-scroll": "", onScroll: () => {
        const node = scroller.current;
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      } }, (0, import_react18.createElement)(
        "div",
        { className: "dsb-column" },
        (0, import_react18.createElement)(
          "div",
          { className: "dsb-flow", "data-chat-flow": "", role: "feed", "aria-label": t("Super-agent conversation") },
          view.items.map((item) => (0, import_react18.createElement)(
            "div",
            { key: item.id, "data-message-id": item.id },
            (0, import_react18.createElement)(ChatRows, { items: [item], roster, actions }),
            item.evidence ? (0, import_react18.createElement)(Evidence, { item }) : null
          )),
          view.tickets.map((ticket) => (0, import_react18.createElement)(
            "section",
            { key: ticket.ticketId, "aria-label": t("Work status") },
            (0, import_react18.createElement)("p", { className: "bt-q-detail", role: "status" }, t(ticket.status)),
            ticket.attention ? (0, import_react18.createElement)(PendingQuestion, {
              key: ticket.attention.id,
              sessionId: ticket.ticketId,
              inline: true,
              question: { id: ticket.attention.id, question: ticket.attention.question, options: ticket.attention.options, allowCustom: true },
              actions
            }) : null,
            ticket.canStop || ticket.canResume ? (0, import_react18.createElement)("button", {
              type: "button",
              className: "bt-soft",
              disabled: busy,
              onClick: () => {
                void command(ticket.canResume ? "resume" : "stop", { ticketId: ticket.ticketId }).catch(() => {
                });
              }
            }, ticket.canResume ? t("Resume") : t("Stop")) : null
          )),
          error ? (0, import_react18.createElement)("p", { role: "alert", className: "dsb-composer-error" }, error) : null
        )
      )),
      (0, import_react18.createElement)("div", { className: "dsb-composer-root" }, (0, import_react18.createElement)(Composer, { disabled: !ready || busy, onSend: async (payload) => {
        await call("send", payload);
        await feed.refresh();
      } }))
    )
  );
}
var CHAT_CSS = `
.dsb-main{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bt-main);--dsh-chat-content-width:min(960px,100%)}
.dsb-superagent{height:100%;width:100%;color:var(--bt-ink)}
.dsb-head{position:absolute;top:0;left:0;right:0;z-index:8;display:flex;justify-content:center;padding:4px 0 0;pointer-events:none}
.dsb-head .bt-head{flex:1 1 auto;width:100%}
.dsb-chat{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.dsb-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-gutter:stable;margin-right:2px;padding:60px 11px 16px 16px}
.dsb-column{max-width:min(960px,100%);margin:0 auto}
.dsb-flow{display:flex;flex-direction:column;gap:6px}
.dsb-composer-root{display:flex;flex-direction:column;align-items:center;padding:0 11px 13px 16px}
.dsb-composer-wrap{width:100%;max-width:min(992px,100%)}
.dsb-composer{position:relative}
.dsb-composer[data-multiline]{border-radius:18px!important}
.dsb-composer-input{display:flex;flex:1 1 0;min-width:0;padding:0 8px}
.dsb-composer-input textarea{flex:1;width:100%;max-height:168px;margin:0;border:0;outline:0;resize:none;background:none;color:var(--bt-ink);font:inherit;font-size:14px;line-height:24px;overflow-y:auto}
.dsb-composer-input textarea:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px;border-radius:4px}
.dsb-composer-input textarea::placeholder{color:color-mix(in srgb,var(--bt-ink) 36%,transparent)}
.dsb-composer-trailing{order:3;display:flex;flex:none;align-self:flex-end;align-items:center;gap:8px}
.dsb-send{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;display:inline-grid;place-items:center;background:var(--bt-accent);color:var(--bt-accent-ink);cursor:pointer;transition:opacity .15s ease}
.dsb-send:hover{opacity:.9}
.dsb-send svg{width:14px;height:14px}
.dsb-send:disabled{visibility:hidden}
.dsb-composer-error{margin:0 0 6px 4px;font-size:12px;line-height:16px;color:var(--bt-danger)}
.dsb-superagent pre{white-space:pre-wrap;overflow-wrap:anywhere}
`;

// src/client/styles.js
var SHELL_CSS = `
body{--bt-ink:#141414;--bt-danger:#e02135;--bt-ink-2:rgba(20,20,20,.6);--bt-ink-3:rgba(20,20,20,.36);--bt-bubble:#eeeeee;--bt-sidebar:#f7f7f7;--bt-main:#fcfcfc;--bt-line:rgba(20,20,20,.08);--bt-line-2:rgba(20,20,20,.15);--bt-line-weak:rgba(20,20,20,.1);--bt-hover:rgba(119,119,119,.09);--bt-active:rgba(119,119,119,.17);--bt-card:#ffffff;--bt-accent:#4d6bfe;--bt-green:#00c972;--bt-star:#ff9800;--bt-user:#070707;--bt-user-ink:#fcfcfc;--bt-tag-bg:rgba(20,20,20,.06);--bt-tag-ink:rgba(20,20,20,.56);--bt-knob:#ffffff;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;--bt-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
/* iOS waits out a double-tap zoom on buttons; the plugin's own controls never zoom. */
:is(.bt-tool,.bt-uaction,.bt-menu button,.bt-menu-item,.bt-icon-btn,.bt-round,.bt-pill,.bt-account,.bt-set-row,.bt-settings-item,.bt-react-strip button,.bt-palette-row,.bt-palette-clear,.bt-tab,.bt-ptab,.bt-ptab-x,.bt-bcard-x,.bt-plus,.bt-q-btn,.bt-q-x,.bt-x,.bt-nc-send,.bt-send,.bt-soft,.bt-mini,.bt-shape,.bt-swatch,.bt-color,.bt-newchat,.bt-task-day,.bt-task-remove,.bt-fb-btn){touch-action:manipulation}
body[data-ds-dark-theme]{--bt-ink:#f2f2f2;--bt-ink-2:rgba(242,242,242,.6);--bt-ink-3:rgba(242,242,242,.36);--bt-bubble:#262626;--bt-sidebar:#1b1b1b;--bt-main:#141414;--bt-line:rgba(255,255,255,.08);--bt-line-2:rgba(255,255,255,.15);--bt-line-weak:rgba(255,255,255,.1);--bt-hover:rgba(160,160,160,.12);--bt-active:rgba(160,160,160,.2);--bt-card:#1f1f1f;--bt-user:#f2f2f2;--bt-user-ink:#141414;--bt-tag-bg:rgba(255,255,255,.09);--bt-tag-ink:rgba(242,242,242,.62)}
${Object.entries(INKS).map(([name, [light]]) => `body{--bt-ink-${name}:${light}}`).join("")}
${Object.entries(INKS).map(([name, [, dark]]) => `body[data-ds-dark-theme]{--bt-ink-${name}:${dark}}`).join("")}
.bt-mark{display:inline-block;flex:none;position:relative;line-height:0}
.bt-mark svg{width:100%;height:100%;overflow:visible}
.bt-mark-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;box-shadow:inset 0 0 0 1px var(--bt-line)}
.bt-mark .bt-b,.bt-mark .bt-eye,.bt-mark .bt-eyes,.bt-mark .bt-gaze{transform-box:fill-box}
.bt-mark .bt-b{transform-origin:50% 100%}
.bt-mark .bt-eye,.bt-mark .bt-eyes{transform-origin:center}
/* Motion levels (Settings → Bots → Animation) set body[data-bt-motion]: quiet moves a
   mark only for its state; normal, the default, adds petting, pokes and eyes that follow
   the pointer; lively adds blinks and fidgets at rest and a question riding on the head. */
body[data-bt-motion=lively] .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye{animation:bt-blink-idle 5s linear infinite;animation-delay:var(--bt-delay,0s)}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle]:is([data-fidget=hop],[data-fidget=sway],[data-fidget=stretch]) :is(.bt-b,.bt-mark-img){animation:var(--bt-fidget) 9s ease-in-out var(--bt-fidget-delay,0s) infinite}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=hop]{--bt-fidget:bt-fidget-hop}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=sway]{--bt-fidget:bt-fidget-sway}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=stretch]{--bt-fidget:bt-fidget-stretch}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=look] .bt-eyes{animation:bt-fidget-look 9s ease-in-out var(--bt-fidget-delay,0s) infinite}
@keyframes bt-fidget-hop{0%,8%,100%{transform:none}3%{transform:translateY(-10%) scale(.97,1.04)}5.5%{transform:translateY(0) scale(1.05,.95)}}
@keyframes bt-fidget-sway{0%,10%,100%{transform:none}2.5%{transform:rotate(-8deg)}5%{transform:rotate(7deg)}7.5%{transform:rotate(-3deg)}}
@keyframes bt-fidget-stretch{0%,9%,100%{transform:none}4%{transform:scale(.94,1.08)}7%{transform:scale(1.03,.97)}}
@keyframes bt-fidget-look{0%,22%,100%{transform:none}3%,9%{transform:translateX(-14%)}12%,19%{transform:translateX(14%)}}
body[data-bt-motion=lively] .bt-badge-alert{right:auto;bottom:auto;left:50%;top:calc(var(--bt-size,36px) * -.14);translate:-50% 0;animation:bt-q-ride 1.3s cubic-bezier(.3,.7,.4,1) infinite}
body[data-bt-motion=lively] :is(.bt-row,.bt-tile)>.bt-mark:hover .bt-badge-alert{animation:none}
@keyframes bt-q-ride{0%,55%,100%{transform:translateY(0)}20%{transform:translateY(calc(var(--bt-size,36px) * -.14))}40%{transform:translateY(0)}}
/* Petting: with the pointer on a sidebar avatar or just around it (a ring a fifth of its
   size wide), a resting mark leans into the pointer and keeps nuzzling it, its eyes
   closed in a happy arc, and springs back when the pointer leaves. */
:is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster)::before{content:'';position:absolute;inset:-20%;border-radius:50%}
.bt-mark[data-live] .bt-b,.bt-mark[data-live] .bt-mark-img{transition:rotate .5s cubic-bezier(.34,1.56,.64,1),translate .5s cubic-bezier(.34,1.56,.64,1),scale .3s ease-out}
.bt-mark[data-live] .bt-eye{transition:scale .14s ease-in}
.bt-mark[data-live] .bt-eye-happy{transition:opacity .12s ease-out}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]):not(.bt-mark-poke) :is(.bt-b,.bt-mark-img){rotate:8deg;translate:5% -1%;animation:bt-nuzzle .78s ease-in-out .32s infinite}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye{scale:1 0;animation:none}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye-happy{opacity:1;transition-delay:.1s}
@keyframes bt-nuzzle{50%{rotate:14deg;translate:8% -3%;scale:1.03 .97}}
.bt-mark[data-gaze] .bt-b{translate:calc(var(--bt-gx,0) * 5%) calc(var(--bt-gy,0) * 4%);transition:translate .18s ease-out}
.bt-mark[data-gaze] .bt-gaze{transform:translate(calc(var(--bt-gx,0) * 12%),calc(var(--bt-gy,0) * 11%));transition:transform .18s ease-out}
body[data-bt-motion=quiet] .bt-mark[data-gaze] .bt-b{translate:none}
body[data-bt-motion=quiet] .bt-mark[data-gaze] .bt-gaze{transform:none}
.bt-mark[data-state=thinking] .bt-b{animation:bt-ponder 2.2s ease-in-out infinite}
.bt-mark[data-state=thinking] .bt-eyes{animation:bt-squint 2.2s ease-in-out infinite}
.bt-mark[data-state=searching] .bt-b{animation:bt-seek 1s ease-in-out infinite}
.bt-mark[data-state=searching] .bt-eyes{animation:bt-scan 1.6s ease-in-out infinite}
.bt-mark[data-state=working] .bt-b{animation:bt-bob 1.6s ease-in-out infinite}
.bt-mark[data-state=working]:is([data-shape=star],[data-shape=hex],[data-shape=plus],[data-shape=gem],[data-shape=magnet],[data-shape=ring]) .bt-b{animation:bt-wiggle 1.4s ease-in-out infinite;transform-origin:50% 50%}
.bt-mark[data-state=working]:is([data-shape=gumdrop],[data-shape=peanut],[data-shape=cushion],[data-shape=squircle],[data-shape=moon],[data-shape=wave]) .bt-b{animation:bt-squash 1.2s ease-in-out infinite}
.bt-mark[data-state=working] .bt-eye{animation:bt-blink 2.4s ease-in-out infinite}
.bt-mark[data-state=sending] .bt-b{animation:bt-dash 1.1s cubic-bezier(.4,0,.2,1) infinite}
/* Waiting for teammates to hand back work circles like coordinating them. */
.bt-mark:is([data-state=orbit],[data-state=waiting]) .bt-b{animation:bt-sway 2.6s ease-in-out infinite;transform-origin:50% 50%}
.bt-mark:is([data-state=orbit],[data-state=waiting]) .bt-eyes{animation:bt-roll 2.6s linear infinite}
/* A question for you hops twice when it arrives and the badge keeps it in view after;
   a lively mark keeps hopping. */
.bt-mark[data-state=alert] .bt-b{animation:bt-hop 1.3s cubic-bezier(.3,.7,.4,1) 2}
.bt-mark[data-shape=image]:not([data-state=idle]) .bt-mark-img{animation:bt-bob 1.6s ease-in-out infinite}
.bt-mark[data-shape=image][data-state=alert] .bt-mark-img{animation:bt-hop 1.3s cubic-bezier(.3,.7,.4,1) 2}
body[data-bt-motion=lively] .bt-mark[data-state=alert] :is(.bt-b,.bt-mark-img){animation-iteration-count:infinite}
.bt-mark[data-state=done] .bt-b{animation:bt-done 1.8s linear 1}
.bt-mark[data-shape=image][data-state=done] .bt-mark-img{animation:bt-done 1.8s linear 1;transform-origin:50% 100%}
@keyframes bt-done{0%{transform:none;animation-timing-function:cubic-bezier(.4,0,.2,1)}13.3%{transform:scale(1.12,.88);animation-timing-function:cubic-bezier(.4,0,.2,1)}25.6%{transform:scale(.93,1.09);animation-timing-function:cubic-bezier(.4,0,.2,1)}37.8%{transform:scale(1.04,.97);animation-timing-function:cubic-bezier(.4,0,.2,1)}51.1%,100%{transform:none}}
.bt-mark-poke .bt-b{animation:bt-poke .8s cubic-bezier(.3,.7,.4,1) 1!important;transform-origin:50% 60%!important}
.bt-mark-poke .bt-mark-img{animation:bt-poke-img .6s ease-out 1!important}
.bt-mark[data-poke]{cursor:pointer}
body[data-bt-motion=quiet] .bt-mark-poke :is(.bt-b,.bt-mark-img){animation:none!important}
body[data-bt-motion=quiet] .bt-mark[data-poke]{cursor:default}
@keyframes bt-bob{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-4%) rotate(-5deg)}65%{transform:translateY(0) rotate(4deg)}}
@keyframes bt-wiggle{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-12deg) scale(1.04)}75%{transform:rotate(12deg) scale(1.04)}}
@keyframes bt-squash{0%,100%{transform:scale(1,1)}30%{transform:scale(1.08,.9)}55%{transform:translateY(-4%) scale(.94,1.08)}80%{transform:scale(1.02,.98)}}
@keyframes bt-ponder{0%,100%{transform:translateY(0) rotate(4deg)}50%{transform:translateY(-3%) rotate(7deg)}}
@keyframes bt-squint{0%,100%{transform:translate(0,-4%) scaleY(.7)}50%{transform:translate(5%,-5%) scaleY(.78)}}
@keyframes bt-seek{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-5%) rotate(-1deg)}}
@keyframes bt-scan{0%,100%{transform:translateX(-12%)}50%{transform:translateX(12%)}}
@keyframes bt-dash{0%,100%{transform:translateX(0) rotate(0)}35%{transform:translateX(9%) rotate(7deg)}55%{transform:translateX(-2%) rotate(-3deg)}}
@keyframes bt-sway{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes bt-roll{0%,100%{transform:translate(12%,0)}25%{transform:translate(0,9%)}50%{transform:translate(-12%,0)}75%{transform:translate(0,-9%)}}
@keyframes bt-hop{0%,55%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(-14%) scale(.96,1.05)}40%{transform:translateY(0) scale(1.06,.94)}}
@keyframes bt-poke{0%{transform:none}55%{transform:translateY(-16%) rotate(360deg)}78%{transform:translateY(0) scale(1.08,.92) rotate(360deg)}100%{transform:rotate(360deg)}}
@keyframes bt-poke-img{0%,100%{transform:scale(1)}40%{transform:scale(1.14) rotate(-6deg)}}
/* Idle clip: two .26s blinks (lid to 3%, then a 6% overshoot) at 1.48s and 3.46s. */
@keyframes bt-blink-idle{0%,29.6%,35%,69.2%,74.6%,100%{transform:scaleY(1)}32.2%,71.8%{transform:scaleY(.03)}33.8%,73.4%{transform:scaleY(1.06)}}
@keyframes bt-blink{0%,42%,50%,100%{transform:scaleY(1)}46%{transform:scaleY(.03)}48%{transform:scaleY(1.06)}}
@media (prefers-reduced-motion:reduce){.bt-mark *{animation:none!important;transition:none!important}}
.bt-badge{position:absolute;right:0;bottom:0;width:12px;height:12px;border-radius:50%;corner-shape:round;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-badge-admin{background:color-mix(in srgb,var(--bt-star) 82%,var(--bt-sidebar))}
.bt-badge-admin svg{width:7px;height:7px}
.bt-badge-main{right:calc(var(--bt-size,36px) * -.07);bottom:calc(var(--bt-size,36px) * -.07);width:clamp(14px,calc(var(--bt-size,36px) * .36),22px);height:clamp(14px,calc(var(--bt-size,36px) * .36),22px);border-radius:0;box-shadow:none}
.bt-badge-main svg{width:100%;height:100%;overflow:visible}
.bt-badge-main path{fill:var(--bt-star);stroke:var(--bt-sidebar);stroke-width:2.6;stroke-linejoin:round;paint-order:stroke}
.bt-badge-alert{background:color-mix(in srgb,var(--bt-accent) 78%,var(--bt-sidebar));color:var(--bt-accent-ink,#fff);font-size:8.5px;line-height:12px;font-weight:600;font-family:var(--bt-font)}
.bt-badge-working{background:color-mix(in srgb,var(--bt-green) 82%,var(--bt-sidebar));width:8px;height:8px;right:1px;bottom:1px}
.bt-cluster{position:relative;display:inline-block;flex:none;line-height:0}
.bt-cluster>*{position:absolute}
.bt-cluster-more,.bt-cluster-you{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bt-active);color:var(--bt-ink-3);font-family:var(--bt-font);font-weight:500;line-height:1;font-variant-numeric:tabular-nums}
.bt-cluster-you{background:color-mix(in srgb,var(--bt-ink) 12%,transparent)}
.bt-stack{display:inline-flex;align-items:center;flex:none;line-height:0}
.bt-stack>*+*{margin-left:calc(var(--bt-stack-size) * -.3)}
.bt-stack-more{font-size:11px;line-height:16px;color:var(--bt-ink-3);margin-left:3px!important}

.bt-side{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:2px;padding:0 12px 8px 0;color:var(--bt-ink);font-family:var(--bt-font)}
.bt-side-top{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:6px 5px 0 0}
.bt-brand{display:inline-flex;align-items:center;gap:6px;margin-right:auto;padding:4px 8px 4px 4px;border:0;border-radius:8px;background:none;cursor:pointer;font-family:inherit;font-size:15px;line-height:20px;font-weight:600;letter-spacing:-.01em;color:var(--bt-ink);white-space:nowrap}
.bt-brand-whale{display:inline-flex;color:var(--bt-accent)}
.bt-round{width:36px;height:36px;border-radius:50%;border:1px solid var(--bt-line);background:var(--bt-main);color:var(--bt-ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background-color .12s ease,transform .12s ease}
.bt-round:hover{background:var(--bt-hover)}
.bt-round:active{transform:scale(.94)}
.bt-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;min-height:0;flex:1 1 auto}
/* Chromium ignores ::-webkit-scrollbar when scrollbar-width or scrollbar-color (inherited) is non-auto. */
.bt-side:not(.bt-rail)>.bt-list{margin-right:-12px;scrollbar-gutter:stable;scrollbar-width:auto;scrollbar-color:auto}
.bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar{width:12px}
.bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar-track{background:transparent}
.bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar-thumb{border:4px solid transparent;border-radius:6px;background:color-mix(in srgb,var(--bt-ink) 16%,transparent) padding-box}
.bt-side:not(.bt-rail)>.bt-list:hover::-webkit-scrollbar-thumb{background-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)}
.bt-tile-wrap{display:flex;justify-content:center;padding:20px 0 15px}
.bt-tile{display:flex;flex-direction:column;align-items:center;gap:4px;width:95px;padding:6px 8px 4px;border-radius:12px;border:0;background:transparent;color:var(--bt-ink);cursor:pointer;font-family:inherit;transition:background-color .12s ease}
.bt-tile:hover{background:var(--bt-hover)}
.bt-tile[aria-current=page]{background:var(--bt-active)}
.bt-tile-name{font-size:13px;line-height:18px;font-weight:400;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-chip{font-size:11px;line-height:16px;padding:1px 4px;border-radius:4px;background:var(--bt-hover);border:1px solid var(--bt-line);color:var(--bt-ink-2);white-space:nowrap;max-width:84px;overflow:hidden;text-overflow:ellipsis}
.bt-row{display:flex;align-items:center;gap:8px;min-height:54px;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer;width:100%;box-sizing:border-box;font-family:inherit;transition:background-color .12s ease}
.bt-row:hover{background:var(--bt-hover)}
.bt-row[aria-current=page]{background:var(--bt-active)}
.bt-row-body{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.bt-row-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;line-height:20px;font-weight:400}
.bt-row-title{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-tag{flex:none;max-width:96px;font-size:12px;line-height:16px;font-weight:400;padding:1px 6px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-row-preview{font-size:13px;line-height:18px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-unread{width:8px;height:8px;border-radius:50%;background:var(--bt-accent);flex:none;margin-right:2px;animation:bt-fade .13s cubic-bezier(.22,1,.36,1)}
.bt-unread-wait{background:var(--bt-star)}
/* Our own left column, portalled over the shell's collapsed sidebar. It reaches
   the window's top edge so the title band and the column share one fill (under
   Mica the app styles DSH's sidebar the same way, via --bt-leftcol-fill there);
   it stays under the shell's title-bar switch (z 30) and the popovers (z 60),
   and the floating drawer keeps the opaque fill over the conversation. */
.bt-leftcol{position:fixed;left:0;top:0;bottom:0;z-index:25;display:flex;--bt-lc-clear:var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px));background:var(--bt-leftcol-fill,var(--bt-sidebar));border-right:.5px solid var(--bt-line);box-sizing:border-box;padding:calc(var(--bt-lc-clear) + 6px) 12px 6px;color:var(--bt-ink);font-family:var(--bt-font)}
html[data-windows-titlebar] .bt-leftcol,html[data-platform=darwin] .bt-leftcol{border-right:none}
.bt-leftcol-grip{position:absolute;right:-4px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:3;touch-action:none}
.bt-leftcol-grip:hover,.bt-leftcol-grip:active{background:linear-gradient(to right,transparent 3px,var(--bt-line-2) 3px,var(--bt-line-2) 5px,transparent 5px)}
/* The shell's collapsed sidebar keeps no track in the Bot view, so a hidden
   column leaves nothing behind (the shell's right column, when open, keeps its
   own geometry). Our own collapse of it lands without the shell's slide. */
[class*="_frame"][data-sidebar-collapsed][data-rightbar-collapsed]:has(>[class*="_sidebarCol"]){grid-template-columns:0px minmax(0,1fr) 0px!important}
html[data-bt-collapsing] [class*="_frame"]:has(>[class*="_sidebarCol"]){transition:none!important}
.bt-leftcol[data-left=drawer]{background:var(--bt-sidebar);box-shadow:8px 0 24px rgba(0,0,0,.14)}
.bt-leftcol>.bt-side{width:100%}
.bt-leftcol-foot{display:flex;align-items:center;gap:9px;padding-top:8px;flex:none}
.bt-rail{align-items:center;padding:0}
.bt-rail .bt-row{justify-content:center;width:56px;height:56px;min-height:56px;padding:0;border-radius:16px}
.bt-rail-top{display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:8px}
.bt-rail-sep{width:24px;height:1px;flex:none;background:var(--bt-line)}
.bt-rail .bt-agent-ava{width:44px;height:44px}
.bt-rail .bt-list{align-self:stretch;align-items:center;gap:4px}
/* The rail's list spans the whole column: the badges and dots that sit on a row's
   edge need room beside the 56px rows, or the list scrolls sideways. */
.bt-leftcol[data-left=rail]{padding:calc(var(--bt-lc-clear) + 8px) 0 8px}
.bt-leftcol-foot-rail{flex-direction:column;gap:6px}
/* A drag that crosses the rail's snap line rides the spring to its target: the
   content is pinned at the target size so only the column's edge moves. */
.bt-leftcol[data-folding]{overflow:hidden;transition:width ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-leftcol[data-folding]>.bt-side{flex:none;width:calc(var(--bt-lc-w) - 24px)}
.bt-leftcol[data-left=rail][data-folding]>.bt-side{width:var(--bt-lc-w);margin-inline:auto}
.bt-dot{position:absolute;top:4px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--bt-accent);box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-dot-wait{background:var(--bt-star)}
.bt-side-foot{display:flex;padding-top:8px}

.bt-head{position:relative;display:flex;justify-content:center;align-items:center;height:40px;flex:none;pointer-events:none}
.bt-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:7.5px 13.5px 7.5px 7.5px;border-radius:999px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 2px 8px -1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);color:var(--bt-ink);font-family:inherit;font-size:14px;line-height:20px;cursor:pointer;max-width:70%;box-sizing:border-box;transition:background-color .12s ease,transform ${SPRING_TAP.duration}ms ${SPRING_TAP.easing}}
.bt-pill:hover{background:color-mix(in srgb,var(--bt-main),#777 9%)}
.bt-pill:active{transform:scale(.965)}
.bt-pill-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.bt-pill-mem{flex:none;display:inline-flex;width:0;margin-left:-8px;overflow:hidden;transition:${spring(SPRING_SHAPE, "width", "margin-left")}}
.bt-pill[data-memory=updated] .bt-pill-mem{width:var(--bt-mem-w);margin-left:0;transition:${spring(SPRING_STRETCH, "width", "margin-left")}}
.bt-pill-mem-in{flex:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;color:var(--bt-ink-2);font-size:13px;font-weight:500;opacity:0;filter:blur(6px);transform:translateX(-8px);transition:opacity .14s ease,filter .18s ease,${spring(SPRING_SHAPE, "transform")}}
.bt-pill-mem-in::before{content:"";flex:none;width:1px;height:14px;margin-right:4px;background:var(--bt-line-2)}
.bt-pill[data-memory=updated] .bt-pill-mem-in{opacity:1;filter:none;transform:none;transition-delay:70ms}
.bt-pill-mem-ico{flex:none;display:inline-flex;width:16px;height:16px;color:var(--bt-accent)}
.bt-pill-mem-ico svg{width:16px;height:16px}
.bt-pill[data-memory=updated] .bt-pill-mem-ico{animation:bt-mem-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} 90ms both}
@keyframes bt-mem-pop{from{transform:scale(.4) rotate(-14deg)}to{transform:none}}
.bt-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){.bt-pill-mem,.bt-pill-mem-in{transition:none!important}.bt-pill-mem-in{filter:none;transform:none}.bt-pill[data-memory=updated] .bt-pill-mem-ico{animation:none}}
.bt-swap{color:var(--bt-ink-3);font-size:12px}
.bt-pill-go{flex:none;display:inline-flex;align-items:center;justify-content:flex-end;width:0;margin-left:-8px;overflow:hidden;opacity:0;filter:blur(6px);transform:translateX(-6px);color:var(--bt-ink-2);transition:width ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},margin-left ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},transform ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},opacity .18s ease,filter .18s ease}
.bt-pill-go svg{flex:none;transition:transform ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-pill:hover .bt-pill-go,.bt-pill:focus-visible .bt-pill-go,.bt-pill[aria-expanded=true] .bt-pill-go{width:18px;margin-left:0;opacity:1;filter:none;transform:none}
.bt-pill[aria-expanded=true] .bt-pill-go svg{transform:rotate(180deg)}
.bt-pill[data-memory=updated]:is(:hover,:focus-visible,[aria-expanded=true]) .bt-pill-go{width:0;margin-left:-8px;opacity:0;filter:blur(6px);transform:translateX(-6px)}
@media (prefers-reduced-motion:reduce){.bt-pill,.bt-pill-go,.bt-pill-go svg{transition:none!important}.bt-pill-go{filter:none}.bt-pill:active{transform:none}}

/* The width settings: the share of the column a bubble may take, and the flat text. */
body{--bt-msg-w:.8;--bt-flat-w:1}
.bt-astack{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin:0}
.bt-bubble{max-width:min(calc(var(--bt-msg-w) * 100%),calc(100% - 82px));background:var(--bt-bubble);color:var(--bt-ink);border-radius:18px;padding:7px 12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(var(--dsh-content-font-size,14px) + 10px);box-sizing:border-box;overflow-wrap:anywhere;text-wrap:pretty;text-autospace:normal}
.bt-msg:not(:first-child)>.bt-msg-line>.bt-bubble{border-start-start-radius:6px}
.bt-msg:not(:last-child)>.bt-msg-line>.bt-bubble{border-end-start-radius:6px}
.bt-bubble [class*="_markdown"]>*+*{margin-top:10px}
.bt-bubble [class*="_markdown"]{color:inherit!important;font-size:inherit!important;line-height:inherit!important}
.bt-bubble p{margin:0}
.bt-bubble p + p{margin-top:6px}
.bt-bubble ul,.bt-bubble ol{margin:4px 0;padding-left:20px}
.bt-bubble [class*="_markdown"] li+li{margin-top:6px}
.bt-bubble [class*="_markdown"] li::marker{color:var(--bt-ink-2)}
/* line-height:1 keeps the monospace line box from making an inline code line taller. */
.bt-bubble [class*="_markdown"] :not(pre)>code{line-height:1;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.bt-bubble :is(img,video),.bt-ububble :is(img,video),[data-chat-flow] [class*="_bubble"] :is(img,video){max-width:100%;height:auto}
.bt-bubble a[href^="${MENTION_ORIGIN}"]{text-decoration:none;font-weight:400;cursor:pointer;white-space:nowrap}
.bt-bubble a[href^="${MENTION_ORIGIN}"]::before{content:"";display:inline-block;width:16px;height:16px;margin-right:3px;vertical-align:-3px;background:currentColor;-webkit-mask:${DEFAULT_MASK} center/contain no-repeat;mask:${DEFAULT_MASK} center/contain no-repeat}
.bt-group-msg{display:flex;flex-direction:column;gap:4px;margin:16px 0 0}
.bt-group-msg:first-child{margin-top:0}
.bt-lead{flex:none;display:flex;margin-bottom:1px}
button.bt-lead{border:0;background:none;padding:0;cursor:pointer}
/* Rows without the avatar start where the bubble beside it starts: 22px avatar + 8px gap. */
.bt-astack[data-lead]>.bt-msg:not(:last-child)>.bt-msg-line,.bt-astack[data-lead] .bt-reacts{margin-left:30px}
.bt-group-name{font-size:12px;line-height:16px;font-weight:500;margin-left:42px}
.bt-group-name:has(>.bt-lead){display:flex;align-items:center;margin:0 0 2px;font-size:13px;line-height:22px;font-weight:600;color:var(--bt-ink)}
.bt-group-name>.bt-lead{margin:0 8px 0 0}
.bt-group-time,.bt-group-took{margin-left:6px;font-size:11px;line-height:16px;font-weight:400;color:var(--bt-ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-x{border:0;background:none;color:var(--bt-ink-2);cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:16px;line-height:24px;padding:0;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, "scale")}}
.bt-x:hover{background:var(--bt-hover);color:var(--bt-ink)}

.bt-q{margin:0 auto 8px;width:100%;max-width:var(--dsh-chat-content-width,748px);display:flex;flex-direction:column;gap:12px;--bt-q-edge:color-mix(in srgb,var(--bt-ink) 10%,transparent);--bt-q-rule:color-mix(in srgb,var(--bt-ink) 8%,transparent);--bt-q-rule-2:color-mix(in srgb,var(--bt-ink) 5%,transparent);background:var(--bt-card);box-shadow:0 1px 3px rgba(20,20,20,.04),inset 0 0 0 1px var(--bt-q-edge);border-radius:16px;padding:14px 16px;box-sizing:border-box;color:var(--bt-ink);font-family:var(--bt-font);animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
body[data-ds-dark-theme] .bt-q{--bt-q-edge:rgba(255,255,255,.16);--bt-q-rule:rgba(255,255,255,.12);--bt-q-rule-2:rgba(255,255,255,.08)}
@keyframes bt-q-in{from{transform:translateY(10px) scale(.97)}}
.bt-q-settled{animation:none}
.bt-q-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.bt-q-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.bt-q-title{margin:0;font-size:15px;line-height:22px;font-weight:600;overflow-wrap:anywhere}
.bt-q-detail{font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-q-x{flex:none;width:20px;height:20px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, "scale")}}
.bt-q-x svg{width:14px;height:14px}
.bt-q-x:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-q-x:focus-visible,.bt-q-opt:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-q-list{display:flex;flex-direction:column;gap:1px;min-width:0;box-sizing:border-box;margin:0 -8px}
.bt-q-opt{position:relative;display:flex;align-items:flex-start;gap:16px;width:100%;min-width:0;box-sizing:border-box;margin:0;border:0;border-radius:12px;background:transparent;padding:10px 8px;font:inherit;color:var(--bt-ink);text-align:start;cursor:pointer;transition:background-color .12s ease}
.bt-q:not(.bt-q-raised)>.bt-q-head:has(+.bt-q-list){padding-bottom:12px;border-bottom:1px solid var(--bt-q-rule)}
.bt-q:not(.bt-q-raised)>.bt-q-head+.bt-q-list{margin-top:-6px}
.bt-q-opt+.bt-q-opt::before{content:"";position:absolute;left:calc(var(--bt-key,24px) + 24px);right:8px;top:-1px;height:1px;background:var(--bt-q-rule-2);transition:opacity .12s ease;pointer-events:none}
button.bt-q-opt:hover::before,button.bt-q-opt:hover+.bt-q-opt::before,.bt-q-opt[aria-pressed=true]::before,.bt-q-opt[aria-pressed=true]+.bt-q-opt::before{opacity:0}
.bt-q-raised .bt-q-opt::before{display:none}
button.bt-q-opt:hover{background:var(--bt-hover)}
button.bt-q-opt:active{background:var(--bt-active)}
.bt-q-opt[aria-pressed=true]{background:var(--bt-active)}
.bt-q:not(.bt-q-raised) :is(button.bt-q-opt:hover,.bt-q-opt[aria-pressed=true]) .bt-key{background:var(--bt-card);color:var(--bt-ink)}
.bt-key{flex:none;box-sizing:border-box;width:var(--bt-key,24px);height:var(--bt-key,24px);border-radius:8px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:12px;line-height:var(--bt-key,24px);font-weight:500;text-align:center;font-variant-numeric:tabular-nums;transition:background-color .12s ease,color .12s ease}
.bt-q-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:2px}
/* With a description the key spans the two text lines less 2px above and below. */
.bt-q-opt:has(.bt-q-desc){--bt-key:34px}
.bt-q-opt:has(.bt-q-desc) .bt-key{margin-top:2px;border-radius:10px;font-size:13px}
.bt-q-opt:has(.bt-q-desc) .bt-q-body{padding-top:0}
.bt-q-label{font-size:14px;line-height:20px;font-weight:500;white-space:normal;overflow-wrap:anywhere}
.bt-q-desc{font-size:12px;line-height:17px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-q-check{flex:none;display:inline-flex;align-items:center;color:var(--bt-ink-2);animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-q-settled .bt-q-check{animation:none}
.bt-q-check svg{width:16px;height:16px}
.bt-q-settled .bt-key{opacity:.4}
.bt-q-settled .bt-q-label{color:color-mix(in srgb,var(--bt-ink) 45%,transparent)}
.bt-q-dismissed .bt-q-title{color:var(--bt-ink-2)}
.bt-q.bt-q-settled{gap:6px;padding:12px 16px}
.bt-q-settled .bt-q-title{font-size:14px;line-height:20px;font-weight:500}
.bt-q.bt-q-settled>.bt-q-head:has(+.bt-q-list){padding-bottom:0;border-bottom:0}
.bt-q.bt-q-settled>.bt-q-head+.bt-q-list{margin-top:0}
.bt-q-settled .bt-q-opt{padding:4px 8px}
.bt-q-badge{flex:none;height:20px;padding:0 7px;border-radius:999px;border:1px dotted var(--bt-line-2);color:var(--bt-ink-2);font-size:12px;line-height:18px;box-sizing:border-box}
.bt-q-custom{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0}
.bt-q-field{flex:1 1 0;min-width:0;display:flex;box-sizing:border-box;min-height:32px;padding:5px 11px;border-radius:8px;border:.5px solid var(--bt-line-2);background:none;cursor:text;transition:border-color .12s ease}
.bt-q-field:focus-within{border-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)}
.bt-q-input{flex:1;width:100%;min-width:0;max-height:120px;margin:0;padding:0;border:0;outline:none;background:transparent;color:var(--bt-ink);font:inherit;font-size:14px;line-height:20px;resize:none;overflow-y:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.bt-q-input:not(:placeholder-shown){field-sizing:content}
.bt-q-input::placeholder{color:var(--bt-ink-3)}
.bt-q-submit,.bt-q-btn{flex:none;height:36px;padding:0 14px;border:0;border-radius:999px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:opacity .12s ease,background-color .12s ease,${spring(SPRING_TAP, "scale")}}
.bt-q-submit{background:var(--bt-accent);color:var(--bt-accent-ink,#fff);animation:bt-q-submit-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing} backwards,bt-veil-in .16s ease-out backwards}
@keyframes bt-q-submit-in{from{transform:translateX(8px) scale(.9)}}
.bt-q-submit:hover:not(:disabled){opacity:.86}
.bt-q-submit:disabled{opacity:.4;cursor:default}
.bt-q-btn{background:var(--bt-hover);color:var(--bt-ink)}
.bt-q-btn:hover{background:var(--bt-active)}
.bt-q-submit:focus-visible,.bt-q-btn:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-q-foot{display:flex;justify-content:flex-end;gap:8px}
.bt-q-raised{width:calc(var(--dsh-chat-content-width,748px) - 32px);max-width:calc(100% - 32px);gap:0;padding:0;box-shadow:0 2px 8px rgba(20,20,20,.035),inset 0 0 0 .5px color-mix(in srgb,var(--bt-ink) 5%,transparent)}
.bt-q-raised .bt-q-head{padding:14px 16px 4px 20px}
.bt-q-raised .bt-q-head:last-child{padding-bottom:16px}
.bt-q-raised .bt-q-list{gap:1px;margin:0;padding:8px}
.bt-q-raised .bt-q-opt{gap:4px;padding:7px;border-radius:16px;color:var(--bt-ink-2)}
.bt-q-raised button.bt-q-opt:hover{color:var(--bt-ink)}
.bt-q-raised .bt-q-opt[aria-pressed=true]{background:transparent;color:var(--bt-ink)}
.bt-q-raised .bt-q-opt[aria-pressed=true]:hover{background:var(--bt-hover)}
.bt-q-raised .bt-q-opt[aria-pressed=true] .bt-key,.bt-q-ownrow:focus-within .bt-key,.bt-q-ownrow[data-filled] .bt-key{background:var(--bt-user);color:var(--bt-user-ink)}
.bt-q-raised .bt-q-body{padding:2px 6px 0}
.bt-q-raised .bt-q-desc{color:color-mix(in srgb,var(--bt-ink) 61%,transparent)}
.bt-q-ownrow{cursor:text}
.bt-q-ownrow .bt-q-input{color:var(--bt-ink)}
.bt-q-raised .bt-q-foot{padding:0 8px 8px}
@media (prefers-reduced-motion:reduce){.bt-q{animation:bt-fade .12s ease-out backwards}.bt-q-settled{animation:none}.bt-q-submit{animation:none}}

.bt-newchat{flex:1;display:flex;flex-direction:column;min-width:0;position:relative;animation:bt-veil-in .18s ease-out}
.bt-to{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--bt-line);font-size:14px;box-sizing:border-box}
.bt-to-label{color:var(--bt-ink-2)}
.bt-to input{flex:1;min-width:120px;border:0;outline:none;background:none;color:var(--bt-ink);font-size:14px;height:26px}
.bt-token{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px 0 4px;border-radius:999px;background:var(--bt-hover);font-size:13px;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-token button{border:0;background:none;color:var(--bt-ink-2);cursor:pointer;padding:0 2px}
.bt-admin-star{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border-radius:50%;corner-shape:round;background:color-mix(in srgb,var(--bt-star) 82%,var(--bt-sidebar));vertical-align:-1px}
.bt-to-star{display:inline-flex;margin-right:-2px;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-to .bt-to-create{flex:none;height:28px;padding:0 12px;font-size:13px;animation:bt-q-submit-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
.bt-drop{position:absolute;top:48px;left:32px;width:min(550px,calc(100% - 64px));display:flex;flex-direction:column;padding:6px;max-height:min(420px,60vh);overflow-y:auto;background:var(--bt-card);border:1px solid var(--bt-line-2);border-radius:12px;box-shadow:0 6px 20px -4px rgba(0,0,0,.12);box-sizing:border-box;z-index:1;transform-origin:24px 0;animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out}
.bt-option{display:flex;align-items:center;gap:10px;border:0;background:none;border-radius:8px;padding:7px 8px;min-height:36px;box-sizing:border-box;font-size:13px;line-height:18px;color:var(--bt-ink);cursor:pointer;text-align:left;width:100%}
.bt-option[aria-selected=true]{background:var(--bt-active)}
.bt-drop-list>.bt-option:not([aria-selected=true]):hover{background:var(--bt-hover)}
.bt-option-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-option-hint{font-size:11px;color:var(--bt-ink-2);flex:none;animation:bt-veil-in .16s ease-out}
.bt-option-icon{width:22px;height:22px;border-radius:50%;background:var(--bt-hover);color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;flex:none}
.bt-hint{padding:14px;text-align:center;font-size:13px;color:var(--bt-ink-2)}
.bt-nc-spacer{flex:1}
.bt-nc-compose{padding:0 16px 14px;display:flex;justify-content:center}
.bt-nc-card{display:flex;align-items:flex-end;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,748px);min-height:44px;padding:4px 6px;border-radius:22px;border:1px solid var(--bt-line-2);background:var(--bt-main);box-shadow:0 2px 8px -2px rgba(0,0,0,.06);box-sizing:border-box}
.bt-nc-plus{width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-2);background:var(--bt-hover);flex:none}
.bt-nc-card textarea{flex:1;resize:none;border:0;outline:none;background:none;color:var(--bt-ink);font:inherit;font-size:14px;line-height:20px;padding:7px 4px;min-height:34px;max-height:140px;box-sizing:border-box}
.bt-nc-send{width:34px;height:34px;border-radius:50%;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.bt-nc-send:disabled{opacity:.3;cursor:default}
.bt-create{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-create-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--bt-line);box-sizing:border-box}
.bt-create-gap{width:28px}
.bt-create-title{font-size:14px;line-height:20px;font-weight:500}
.bt-create-body{flex:1;overflow-y:auto;padding:28px 16px 32px;display:flex;justify-content:center}
.bt-create-card{width:100%;max-width:400px;display:flex;flex-direction:column;gap:18px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} both,bt-veil-in .22s ease-out both}
.bt-create-preview{display:flex;flex-direction:column;align-items:center;gap:10px}
.bt-create-pop{display:inline-flex;animation:bt-create-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} both}
@keyframes bt-create-pop{from{transform:scale(.72);opacity:.4}}
.bt-create-name{font-size:17px;line-height:24px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-create-step{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-bottom:-10px}
.bt-create-looks{display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-create-lookbar{justify-content:center}
.bt-create-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
.bt-create-go{height:36px;padding:0 20px}
@media (prefers-reduced-motion:reduce){.bt-create-card,.bt-create-pop{animation:none}}
.bt-send{height:40px;min-width:40px;border-radius:999px;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-size:14px;padding:0 14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-send:disabled{opacity:.35;cursor:default}
.bt-error{padding:0 14px 10px;color:var(--bt-danger);font-size:12px}

/* Side panels keep their content clear of the Windows caption buttons. A host may set the
   chrome top to 0 so that dialog masks also cover the caption band; the panel then reaches
   the top edge, its own surface under the buttons, and the band over it still drags the
   window. Where the chrome top already clears the title bar the band is 0. */
html[data-windows-titlebar]:not([data-fullscreen]) :is(.bt-pane,.bt-panel){--bt-caption-band:calc(var(--dsh-windows-titlebar-height,0px) - var(--dsh-frame-chrome-top,0px));padding-top:var(--bt-caption-band)}
html[data-windows-titlebar]:not([data-fullscreen]) :is(.bt-pane,.bt-panel)::before{content:"";position:absolute;top:0;left:0;right:0;height:var(--bt-caption-band);-webkit-app-region:drag}
.bt-pane{position:fixed;top:var(--dsh-frame-chrome-top,0px);right:0;bottom:0;z-index:45;pointer-events:auto;background:var(--bt-main);color:var(--bt-ink);display:flex;font-family:var(--bt-font)}
.bt-dialog{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-dialog .bt-head{height:62px}
.bt-dialog-log{flex:1;overflow-y:auto;padding:8px 16px 20px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;box-sizing:border-box}
.bt-dialog-foot{display:flex;justify-content:center;padding:10px 10px 16px}
.bt-exchange{animation:bt-sheet-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} both,bt-veil-in .24s ease-out both}
.bt-exchange[data-leaving]{animation:bt-sheet-out .22s cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
@keyframes bt-sheet-in{from{transform:translateY(24px)}}
@keyframes bt-sheet-out{to{opacity:0;transform:translateY(16px);filter:blur(4px)}}
.bt-exchange .bt-dialog{position:relative}
.bt-exchange .bt-dialog-log{max-width:none;margin:0;padding:39px max(16px,calc((100% - 960px)/2)) 116px;scrollbar-width:thin}
.bt-exchange .bt-tools{display:none}
.bt-fold{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin-top:4px;white-space:normal}
.bt-fold-code{position:relative}
.bt-fold-code>.bt-tool{position:absolute;right:6px;bottom:6px}
/* The part of a cut code block the preview keeps, drawn by DS Bot so the host's
   Markdown draws no copy control of its own for it. */
.bt-fold-code>.bt-fold-pre{margin:0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:20px;overflow-x:auto}
.bt-fold-code>*+.bt-fold-pre{margin-top:6px}
.bt-fold-note{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
[data-folded] .bt-fold-body{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent)}
.bt-ubody .bt-fold .bt-more,.bt-ububble .bt-fold .bt-more,.bt-ubody .bt-fold-note,.bt-ububble .bt-fold-note{color:inherit;opacity:.7}
.bt-ubody .bt-fold .bt-more:hover,.bt-ububble .bt-fold .bt-more:hover{opacity:1}
.bt-ubody .bt-fold-code>.bt-tool,.bt-ububble .bt-fold-code>.bt-tool{color:inherit;opacity:.7}
.bt-ubody .bt-fold-code>.bt-tool:hover,.bt-ububble .bt-fold-code>.bt-tool:hover{color:inherit;opacity:1}
.bt-exchange .bt-dialog-foot{position:absolute;left:0;right:0;bottom:0;height:76px;box-sizing:border-box;align-items:flex-end;padding:0 0 28px;background:var(--bt-main);z-index:3;animation:bt-foot-in .3s cubic-bezier(.22,1,.36,1) .3s both}
.bt-exchange .bt-dialog-foot::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:40px;background:linear-gradient(to top,var(--bt-main),transparent);pointer-events:none}
.bt-exchange[data-leaving] .bt-dialog-foot{animation:bt-foot-out .22s cubic-bezier(.4,0,1,1) forwards}
@keyframes bt-foot-in{from{opacity:0;transform:translateY(6px)}}
@keyframes bt-foot-out{to{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){.bt-exchange,.bt-exchange .bt-dialog-foot{animation-duration:.01s}}
.bt-soft{height:36px;border-radius:999px;border:0;background:var(--bt-hover);color:var(--bt-ink);padding:0 16px;font-size:14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-soft:hover{background:var(--bt-active)}
.bt-time{display:block;text-align:center;font-size:12px;line-height:16px;color:var(--bt-ink-2);padding:6px 0}

.bt-panel{position:fixed;top:var(--dsh-frame-chrome-top,0px);right:0;bottom:0;width:var(--bt-panel-w,320px);pointer-events:auto;z-index:40;background:var(--bt-main);border-left:.5px solid var(--bt-line-2);display:flex;flex-direction:column;color:var(--bt-ink);font-family:var(--bt-font);box-sizing:border-box;animation:bt-pane-in .3s cubic-bezier(.2,0,0,1);transition:width ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-panel[data-leaving]{transform:translateX(100%);transition:transform .3s cubic-bezier(.2,0,0,1);pointer-events:none}
.bt-panel[data-instant]{transition:none}
@keyframes bt-pane-in{from{transform:translateX(100%)}}
/* The right margin glides with the Bot panel's slide; the left one lands at once,
   as our left column appears, folds and hides without a slide of its own. */
[class*="_centerCol"]{transition:margin-right ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-panel-grip{position:absolute;left:-5px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:3;touch-action:none}
.bt-panel-grip:hover,.bt-panel[data-dragging] .bt-panel-grip{background:linear-gradient(to right,transparent 4px,var(--bt-line-2) 4px,var(--bt-line-2) 6px,transparent 6px)}
.bt-drag-shield{position:fixed;inset:0;z-index:45;cursor:col-resize}
.bt-panel-view{flex:1;min-height:0;display:flex;flex-direction:column}
.bt-drawer-top{display:flex;justify-content:flex-end;gap:8px;padding:12px 17px 6px 12px}
.bt-drawer-id{display:flex;flex-direction:column;align-items:center;padding:14px 16px 0}
.bt-drawer-id>.bt-mark,.bt-drawer-id>.bt-cluster,.bt-drawer-id>.bt-pile{margin-bottom:16px}
.bt-pile{display:flex;align-items:center;justify-content:center;line-height:0}
.bt-pile-face{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;border-radius:50%;background:var(--bt-main);box-shadow:0 0 0 3px var(--bt-main);animation:bt-pile-in .36s cubic-bezier(.34,1.56,.64,1) backwards}
.bt-pile-face+.bt-pile-face{margin-left:-10px}
.bt-pile-more{background:var(--bt-hover);color:var(--bt-ink-2);font-size:13px;line-height:1;font-weight:500;font-variant-numeric:tabular-nums}
@keyframes bt-pile-in{from{opacity:0;transform:translateY(6px) scale(.85)}}
@media (prefers-reduced-motion:reduce){.bt-pile-face{animation:none}}
.bt-drawer-name{font-size:17px;line-height:24px;font-weight:500;border:0;background:none;color:inherit;cursor:text;padding:0 6px;border-radius:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-drawer-name:hover{background:var(--bt-hover)}
.bt-drawer-name-input{font-size:17px;line-height:24px;text-align:center;border:.5px solid var(--bt-line-2);border-radius:6px;padding:0 6px;background:var(--bt-main);color:var(--bt-ink);outline:none;font-weight:500}
.bt-drawer-role{font-size:12px;line-height:16px;color:var(--bt-ink-3);margin-top:6px;text-align:center}
.bt-tabs{position:relative;display:flex;justify-content:center;gap:2px;margin:16px 16px 0}
.bt-tab{position:relative;z-index:1;border:0;background:none;border-radius:9999px;padding:4px 8px;font-size:13px;line-height:20px;color:var(--bt-ink-2);cursor:pointer;white-space:nowrap}
.bt-tab:hover{color:var(--bt-ink)}
.bt-tab[aria-selected=true]{background:var(--bt-hover);color:var(--bt-ink)}
.bt-tabs>.bt-thumb{top:0;bottom:0;border-radius:9999px;background:var(--bt-hover)}
.bt-tabs[data-glide] .bt-tab[aria-selected=true]{background:transparent}
.bt-drawer-body{flex:1;overflow-y:auto;padding:20px 16px 16px;font-size:13px;line-height:18px;display:flex;flex-direction:column;gap:16px}
.bt-empty{text-align:center;color:var(--bt-ink-3);font-size:13px;line-height:18px;padding:8px 12px}
.bt-section-title{font-size:12px;color:var(--bt-ink-2);margin-bottom:6px}
.bt-muted{color:var(--bt-ink-2)}
.bt-swatches{display:flex;flex-wrap:wrap;gap:6px}
.bt-swatch{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-swatch[aria-pressed=true]{border-color:var(--bt-ink)}
.bt-textarea{width:100%;box-sizing:border-box;min-height:120px;border:1px solid var(--bt-line);border-radius:8px;padding:8px;background:var(--bt-card);color:var(--bt-ink);font:inherit;resize:vertical}
.bt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bt-kv{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:20px;color:var(--bt-ink-2)}
.bt-kv span:last-child{color:var(--bt-ink);font-variant-numeric:tabular-nums}
.bt-run-stats{display:flex;flex-wrap:wrap;justify-content:center;gap:0 6px;margin-top:-6px;font-size:12px;line-height:18px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-run-sep{color:var(--bt-ink-3)}
.bt-danger{color:var(--bt-danger)}

/* Bot settings: fields, the avatar editor popover, and the details-pane sub-view. */
.bt-field{display:flex;flex-direction:column;gap:6px}
.bt-field-label{font-size:13px;line-height:18px;font-weight:500}
.bt-input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--bt-line);border-radius:8px;padding:0 10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13px;outline:none}
.bt-input:focus{border-color:var(--bt-line-2)}
.bt-input-area{height:auto;min-height:96px;padding:8px 10px;line-height:18px;resize:vertical}
.bt-note{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-soft-sm{height:28px;padding:0 12px;font-size:12px}
.bt-set-avatar{display:flex;justify-content:center;padding:4px 0}
.bt-avatar-anchor{position:relative}
.bt-avatar-trigger{position:relative;width:64px;height:64px;border:0;border-radius:50%;background:none;cursor:pointer;padding:0}
.bt-avatar-pencil{position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:var(--bt-main);border:1px solid var(--bt-line-2);color:var(--bt-ink-2);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.bt-avedit{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:300px;background:var(--bt-main);border:1px solid var(--bt-line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:10px;z-index:70;display:flex;flex-direction:column;gap:10px;color:var(--bt-ink);transform-origin:top center;animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
.bt-bs .bt-avedit{transform-origin:32px 0}
.bt-avedit-top{display:flex;align-items:center;justify-content:space-between}
.bt-avedit-tabs{position:relative;display:flex;gap:2px;background:var(--bt-hover);border-radius:999px;padding:2px}
.bt-avedit-tab{position:relative;z-index:1;border:0;background:none;border-radius:999px;padding:3px 10px;font-size:12px;line-height:16px;color:var(--bt-ink-2);cursor:pointer}
.bt-avedit-tab[aria-selected=true]{background:var(--bt-main);color:var(--bt-ink)}
.bt-avedit-tabs>.bt-thumb{top:2px;bottom:2px;border-radius:999px;background:var(--bt-main);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.bt-avedit-tabs[data-glide] .bt-avedit-tab[aria-selected=true]{background:transparent}
.bt-avedit-reset{color:var(--bt-ink-3)}
.bt-avedit-reset:hover{color:var(--bt-ink)}
.bt-shapes{display:flex;flex-direction:column;gap:2px}
.bt-shape-row{display:grid;grid-template-columns:repeat(6,1fr);gap:2px}
.bt-shape{position:relative;aspect-ratio:1;border:0;border-radius:8px;background:none;color:var(--bt-ink);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.bt-shape:hover{background:var(--bt-hover)}
.bt-shape .bt-ring{position:absolute;left:50%;top:50%;width:36px;height:36px;translate:-50% -50%;overflow:visible;opacity:0;scale:.82;pointer-events:none;transition:opacity .14s ease,${spring(SPRING_POP, "scale")}}
.bt-shape[aria-pressed=true] .bt-ring{opacity:1;scale:1}
.bt-colors{display:flex;justify-content:space-between}
.bt-color{width:22px;height:22px;border-radius:50%;border:2px solid transparent;padding:2px;background:none;cursor:pointer;box-sizing:border-box;transition:border-color .14s ease,${spring(SPRING_TAP, "scale")}}
.bt-color[aria-pressed=true] span{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-color span{display:block;width:100%;height:100%;border-radius:50%}
.bt-color[aria-pressed=true]{border-color:var(--bt-ink)}
.bt-dropzone{border:1.5px dashed var(--bt-line-2);border-radius:10px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12px;line-height:16px;text-align:center}
.bt-dropzone[data-over]{border-color:var(--bt-accent);color:var(--bt-ink)}
.bt-dropzone img{width:64px;height:64px;border-radius:50%;object-fit:cover}
.bt-set-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bt-about{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.bt-about[data-open]{display:block;-webkit-line-clamp:unset}
.bt-more{border:0;background:none;color:var(--bt-ink-3);font-size:12px;line-height:16px;cursor:pointer;padding:2px 0}
.bt-more:hover{color:var(--bt-ink)}
.bt-subhead{display:flex;align-items:center;gap:4px;padding:10px 12px 4px}
.bt-subhead-title{flex:1;font-size:15px;line-height:24px;font-weight:600;padding-left:4px}
.bt-icon-btn{width:28px;height:28px;border-radius:50%;border:0;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.bt-icon-btn:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-set-body{gap:20px}
.bt-drawer-model{display:flex;flex-direction:column}
.bt-drawer-model .bt-note{margin-top:6px}
.bt-drawer-permission{display:flex;flex-direction:column}
.bt-seg button.bt-perm-danger,.bt-seg button.bt-perm-danger[aria-pressed=true],.bt-kv span.bt-perm-danger{color:var(--bt-danger)}

/* Settings dialog: a 198px page list beside the page. */
.bt-settings-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:60;display:flex;align-items:center;justify-content:center;font-family:var(--bt-font)}
.bt-scrim{position:absolute;inset:0;background:rgba(0,0,0,.32);animation:bt-fade .22s ease-out}
body[data-ds-dark-theme] .bt-scrim{background:rgba(0,0,0,.5)}
.bt-settings{--bt-set-w:min(1100px,calc(100vw - 48px));--bt-set-h:min(780px,calc(100vh - 2*max(32px,var(--dsh-frame-overlay-top,32px))));position:relative;width:var(--bt-set-w);height:var(--bt-set-h);background:var(--bt-main);border-radius:16px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px rgba(0,0,0,.24);display:flex;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving]{pointer-events:none}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving] .bt-scrim{opacity:0;transition:opacity .16s ease-in}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving]>[role=dialog]{animation:bt-dialog-sink .16s cubic-bezier(.4,0,1,1) forwards}
@keyframes bt-dialog-rise{from{transform:translateY(12px) scale(.96)}}
@keyframes bt-dialog-sink{to{opacity:0;transform:translateY(6px) scale(.975);filter:blur(3px)}}
@media (prefers-reduced-motion:reduce){.bt-settings,.bt-scrim,.bt-settings-page>*{animation:bt-fade .12s ease-out!important}}
.bt-settings-nav{position:relative;width:198px;flex:none;padding:16px 8px;border-right:.5px solid var(--bt-line);display:flex;flex-direction:column;gap:2px;background:var(--bt-sidebar);box-sizing:border-box}
.bt-settings-item{position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left;transition:background-color .12s ease,color .12s ease}
.bt-settings-item:hover{color:var(--bt-ink);background:var(--bt-hover)}
.bt-settings-item[aria-current=page]{background:var(--bt-active);color:var(--bt-ink)}
.bt-settings-nav>.bt-thumb{left:8px;right:8px;border-radius:8px;background:var(--bt-active)}
.bt-settings-nav[data-glide] .bt-settings-item[aria-current=page]{background:transparent}
.bt-settings-shell{margin-top:auto}
/* Usage while another page is open: out of the flow, so it keeps its layout, and not
   rendered. */
.bt-settings-usage[data-off]{position:absolute;top:0;left:198px;width:calc(var(--bt-set-w) - 198px);height:100%;box-sizing:border-box;content-visibility:hidden;pointer-events:none}
.bt-settings-main{flex:none;display:flex;flex-direction:column;min-width:0;width:calc(var(--bt-set-w) - 198px);height:var(--bt-set-h)}
.bt-settings-head{display:flex;align-items:center;gap:6px;padding:16px 56px 4px 20px}
.bt-settings-head h2{margin:0;font-size:15px;line-height:24px;font-weight:600;animation:bt-veil-in .2s ease-out}
.bt-settings-head>.bt-icon-btn{animation:bt-back-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
@keyframes bt-back-in{from{translate:6px 0;scale:.8}}
.bt-settings-scroll{flex:1;overflow-y:auto;padding:12px 20px 24px;display:flex;flex-direction:column;gap:20px;scrollbar-width:thin}
.bt-settings-page>:not(.bt-us){animation:bt-page-up ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .22s ease-out backwards}
.bt-settings-page[data-move=in]>:not(.bt-us){animation-name:bt-page-in,bt-veil-in}
.bt-settings-page[data-move=out]>:not(.bt-us){animation-name:bt-page-out,bt-veil-in}
.bt-settings-page>:nth-child(2){animation-delay:30ms}
.bt-settings-page>:nth-child(3){animation-delay:60ms}
.bt-settings-page>:nth-child(4){animation-delay:90ms}
.bt-settings-page>:nth-child(n+5){animation-delay:120ms}
@keyframes bt-page-up{from{transform:translateY(10px)}}
@keyframes bt-page-in{from{transform:translateX(18px)}}
@keyframes bt-page-out{from{transform:translateX(-18px)}}
.bt-settings-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:0;background:var(--bt-hover);color:var(--bt-ink-2);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.bt-settings-close:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-settings-form{display:flex;flex-direction:column;gap:16px}
.bt-set-section h3{font-size:13px;line-height:18px;font-weight:600;margin:0 0 8px;padding:0 4px}
.bt-set-card{border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);display:flex;flex-direction:column}
.bt-set-card>*+*{border-top:.5px solid var(--bt-line)}
.bt-set-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:18px;text-align:left;width:100%;box-sizing:border-box;border-radius:0}
button.bt-set-row{cursor:pointer}
button.bt-set-row:hover{background:var(--bt-hover)}
.bt-set-card>.bt-set-row+.bt-set-row{border-top:.5px solid var(--bt-line)}
.bt-set-row:first-child{border-top-left-radius:12px;border-top-right-radius:12px}
.bt-set-row:last-child{border-bottom-left-radius:12px;border-bottom-right-radius:12px}
.bt-set-copy{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-set-hint{font-size:12px;line-height:16px;color:color-mix(in srgb,var(--bt-ink-2) 50%,var(--bt-ink-3))}
.bt-set-control{flex:none;display:flex;align-items:center;gap:6px}
.bt-set-places .bt-set-control{flex:0 1 auto;max-width:50%;min-width:0}
.bt-set-places .bt-set-hint{overflow-wrap:anywhere}
.bt-set-value{font-size:13px;color:var(--bt-ink-2);text-align:right}
.bt-set-bot{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
.bt-browser-note{margin:0;padding:10px 12px;color:var(--bt-ink-2);font-size:12px;line-height:17px}
.bt-browser-grant{display:flex;align-items:center;gap:12px;padding:10px 12px}
.bt-browser-grant+.bt-browser-grant{border-top:.5px solid var(--bt-line)}
.bt-browser-grant-who{display:flex;align-items:center;gap:8px;flex:0 0 150px;min-width:0;font-size:13px}
.bt-browser-grant-who>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-browser-grant-meta{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.bt-browser-grant-site{font-size:13px;overflow-wrap:anywhere}
.bt-browser-grant-kinds{display:flex;gap:4px;flex-wrap:wrap}
.bt-browser-grant-expired{opacity:.5}
.bt-browser-action-list,.bt-browser-duration{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bt-browser-action-choice{display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}
.bt-browser-duration-choice{border:1px solid var(--bt-line);border-radius:8px;padding:5px 8px;background:var(--bt-card);color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-browser-duration-choice[aria-pressed=true]{background:var(--bt-hover);color:var(--bt-ink)}
.bt-browser-form>.bt-set-row>.bt-set-control{flex:1;min-width:0}
.bt-browser-form>.bt-set-row+.bt-set-row{border-top:.5px solid var(--bt-line)}
.bt-browser-site{max-width:320px}
.bt-browser-form-foot{display:flex;justify-content:flex-end;padding:10px 12px;border-top:.5px solid var(--bt-line)}
@media(max-width:700px){.bt-browser-grant{flex-wrap:wrap}.bt-browser-grant-who{flex:1}.bt-browser-grant-meta{order:3;flex:1 0 100%}}
.bt-set-paste{flex-direction:column;align-items:stretch;gap:8px}
.bt-chevron{color:var(--bt-ink-3);display:inline-flex;flex:none}

/* Settings → Connectors. */
.bt-connector{display:flex;flex-direction:column;gap:10px;padding:12px}
.bt-connector-head{display:flex;align-items:center;gap:12px;min-width:0}
.bt-connector-mark{flex:none;width:36px;height:36px;border-radius:10px;background:var(--bt-card);border:.5px solid var(--bt-line);display:flex;align-items:center;justify-content:center;color:var(--bt-ink)}
.bt-connector-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-connector-name{font-size:14px;line-height:20px;font-weight:500}
.bt-connector-status{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-connector[data-state=ready] .bt-connector-status{color:var(--bt-ink-2)}
.bt-connector[data-state=error] .bt-connector-status{color:var(--bt-danger);white-space:normal}
.bt-connector-actions{flex:none;display:flex;gap:6px}
.bt-connector-form{display:flex;flex-direction:column;gap:8px;padding-left:48px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-connector-form-row{display:flex;align-items:center;gap:6px}
.bt-connector-link{flex:1;font-size:12px;color:var(--bt-ink-2)}
.bt-connector-error{padding-left:48px;font-size:12px;line-height:16px;color:var(--bt-danger)}

/* Shell chrome reshaped for the team view. Selectors use stable data attributes where the
   shell offers them and CSS-module name suffixes elsewhere. */
[class*="_newSession"],nav[class*="_panelList"],[class*="_logoRow"]>[class*="_brand"],[class*="_logoRow"]:not(:has([class*="_toggle"])){display:none!important}
/* The shell's sidebar switch stays where the shell puts it whenever the sidebar is
   collapsed: on the rail, or fixed in a Windows title bar, where it also stays while
   the sidebar is open. Elsewhere an open sidebar uses the team's own top row. */
html:not([data-windows-titlebar]) :not([class*="_collapsed"])>[class*="_logoRow"]{display:none!important}
html[data-windows-titlebar] :not([class*="_collapsed"])>[class*="_logoRow"]{height:0!important;margin:0!important}
html[data-windows-titlebar] .bt-side-collapse{display:none}
/* Under a Windows title bar our own switch replaces the shell's: the shell's
   toggle expands the shell sidebar first, and pulling it back afterwards is a
   visible flash of the shell's column. */
html[data-windows-titlebar] [class*="_logoRow"]>[class*="_toggle"]{display:none!important}
html[data-windows-titlebar] .bt-title-toggle{position:fixed;left:12px;top:calc((var(--dsh-windows-titlebar-height,0px) - 28px) / 2);width:28px;height:28px;z-index:30;-webkit-app-region:no-drag;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;padding:0;background:transparent;color:var(--bt-ink);cursor:pointer;font-family:var(--bt-font)}
html[data-windows-titlebar] .bt-title-toggle:hover{background:var(--bt-hover)}
/* Elsewhere the switch shows only while the column is hidden, where the column's
   own top row had it. */
html:not([data-windows-titlebar]) .bt-title-toggle{position:fixed;left:12px;top:calc(var(--dsh-frame-top-clearance,0px) + 6px);z-index:30}
/* The footer ends in the Bot row: the whale's settings seat, then the account menu
   when no plugin holds that seat. Every other plugin's entry takes a whole row above
   it, in the shell's order, so none of them squeezes the Bot row. */
[class*="_footArea"]{grid-template-columns:auto minmax(0,1fr);grid-auto-flow:row dense;align-items:center;gap:4px 9px;padding:8px 6px 6px!important}
/* DSH hides the footer of a collapsed sidebar under a Windows title bar; the grid
   stays out of that one place. */
html:not([data-windows-titlebar]) [class*="_footArea"],:not([class*="_collapsed"])>[class*="_footArea"]{display:grid!important}
[class*="_footArea"]>[class*="_footerActions"],[class*="_footArea"]>[class*="_footerActions"]>div{display:contents!important}
[class*="_footArea"]>[class*="_footerActions"]>div>*{grid-column:1/-1}
[class*="_footArea"]>[class*="_settingsArea"]{grid-column:1;order:1;width:auto!important}
[class*="_footArea"] button[aria-label="Settings"]{width:auto!important;padding:0!important;background:none!important;border-radius:50%!important;height:auto!important}
[class*="_widthHandle"]{display:none!important}

.bt-voice-pane{flex-direction:column;align-items:center;justify-content:center;animation:bt-fade .2s ease-out}
.bt-voice-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;max-width:560px;text-align:center}
.bt-voice-orb{position:relative;width:200px;height:200px;display:grid;place-items:center;margin-bottom:8px}
.bt-voice-ring{position:absolute;inset:34px;border-radius:50%;background:var(--bt-hover);transform:scale(calc(1 + var(--bt-level,0) * .55));transition:transform .08s linear}
.bt-voice-ring-2{inset:14px;background:none;box-shadow:inset 0 0 0 1px var(--bt-line-2);transform:scale(calc(.94 + var(--bt-level,0) * .3));opacity:.8}
.bt-voice-stage[data-phase=thinking] .bt-voice-ring{animation:bt-voice-breathe 1.6s ease-in-out infinite}
.bt-voice-stage[data-phase=speaking] .bt-voice-ring{animation:bt-voice-speak .9s ease-in-out infinite}
@keyframes bt-voice-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes bt-voice-speak{0%,100%{transform:scale(1.04)}30%{transform:scale(1.2)}60%{transform:scale(1.1)}}
.bt-voice-orb>.bt-mark{position:relative}
.bt-voice-name{font-size:16px;line-height:22px;font-weight:500}
.bt-voice-status{font-size:13px;line-height:18px;color:var(--bt-ink-2);min-height:18px}
.bt-voice-caption{min-height:44px;font-size:15px;line-height:22px;color:var(--bt-ink);animation:bt-blur-in .25s ease-out;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.bt-voice-note{font-size:12px;color:var(--bt-danger)}
.bt-voice-setup{height:32px;padding:0 14px;border-radius:16px;border:0;background:var(--bt-hover);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;transition:background-color .15s ease}
.bt-voice-setup:hover{background:var(--bt-active)}
.bt-voice-bar{display:flex;gap:16px;padding:0 0 32px}
.bt-voice-btn{position:relative;width:52px;height:52px;border-radius:50%;border:0;background:var(--bt-hover);color:var(--bt-ink);display:grid;place-items:center;cursor:pointer;transition:background-color .15s ease,transform .12s ease}
.bt-voice-btn:hover{background:var(--bt-active)}
.bt-voice-btn:active{transform:scale(.94)}
.bt-voice-btn[aria-pressed=true]{background:var(--bt-user);color:var(--bt-user-ink)}
.bt-voice-slash{position:absolute;width:24px;height:2px;border-radius:1px;background:currentColor;transform:rotate(-45deg)}
.bt-voice-end{background:#ff3e51;color:#fff}
.bt-voice-end:hover{background:#e02135}
@keyframes bt-fade{from{opacity:0}to{opacity:1}}
@keyframes bt-blur-in{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:blur(0)}}
@media (prefers-reduced-motion:reduce){.bt-voice-pane,.bt-voice-caption,.bt-voice-ring{animation:none!important}}
/* A bubble takes the set share of the column, as the user's does; 82px stays free for
   the hover toolbar beside it: a 6px margin and three 24px tools 2px apart. */
.bt-msg{display:flex;flex-direction:column;align-items:flex-start;max-width:min(calc(var(--bt-msg-w) * 100%),calc(100% - 82px))}
/* The bubble's row: reactions hang below it, so the hover toolbar (and a group
   sender's avatar) line up with the bubble alone. */
.bt-msg-line{position:relative;display:flex;align-items:flex-end;gap:8px;max-width:100%}
.bt-msg-line>.bt-bubble{max-width:none;min-width:0}
/* The same bubble width as beside an avatar column: the share of (100% - 30px), plus the 30px. */
.bt-astack[data-lead]>.bt-msg{max-width:min(calc(var(--bt-msg-w) * (100% - 30px) + 30px),calc(100% - 52px))}
.bt-tools{position:absolute;top:50%;left:100%;margin-left:6px;transform:translateY(-50%);display:flex;gap:2px;opacity:0;visibility:hidden;transition:opacity .12s ease,visibility .12s}
/* The hover bridge spans only the 6px gap (plus a little overlap) between the
   bubble's edge and the toolbar: wider, it sits over the bubble's tail and
   blocks text selection and link clicks there. */
.bt-tools::after{content:"";position:absolute;top:-8px;bottom:-8px;right:100%;width:10px;z-index:-1}
.bt-msg:hover>.bt-msg-line>.bt-tools,.bt-msg:focus-within>.bt-msg-line>.bt-tools,.bt-tools[data-open]{opacity:1;visibility:visible}
/* The flat layout: a Bot's text has no bubble and takes its own share of the column
   (the whole of it unless set). The toolbar floats over the message's top right. */
body[data-bt-layout=flat] .bt-astack{align-items:stretch;gap:10px}
body[data-bt-layout=flat] .bt-msg,body[data-bt-layout=flat] .bt-astack[data-lead]>.bt-msg{align-items:stretch;max-width:calc(var(--bt-flat-w) * 100%)}
body[data-bt-layout=flat] .bt-bubble{background:none;padding:0;border-radius:0}
body[data-bt-layout=flat] .bt-tools{top:-14px;right:0;left:auto;margin-left:0;transform:none;padding:2px;border-radius:999px;background:var(--bt-card);box-shadow:inset 0 0 0 .5px var(--bt-line-2),0 4px 14px rgba(0,0,0,.14)}
body[data-bt-layout=flat] .bt-tools::after{display:none}
.bt-tool{width:24px;height:24px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-tool:hover,.bt-tool[aria-expanded=true]{background:var(--bt-hover);color:var(--bt-ink)}
.bt-tool:active{background:var(--bt-active)}
.bt-tool:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-react-strip{position:fixed;z-index:60;pointer-events:auto;display:flex;gap:2px;padding:4px;border-radius:999px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.08),0 4px 6px -4px rgba(0,0,0,.06);transform:translate(-50%,-100%);transform-origin:bottom center;animation:bt-pop-lift ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out}
.bt-react-strip button{width:32px;height:32px;border:0;border-radius:50%;background:none;font-size:18px;line-height:1;cursor:pointer;transition:background-color .12s ease,${spring(SPRING_POP, "transform")};animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-react-strip button:nth-child(2){animation-delay:20ms}
.bt-react-strip button:nth-child(3){animation-delay:40ms}
.bt-react-strip button:nth-child(4){animation-delay:60ms}
.bt-react-strip button:nth-child(n+5){animation-delay:80ms}
.bt-react-strip button:hover{background:var(--bt-hover);transform:scale(1.15)}
.bt-react-strip button:active{transform:scale(.92)}
.bt-reacts{display:flex;gap:4px;margin-top:4px}
.bt-react{height:22px;min-width:30px;padding:0 6px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);font-size:13px;line-height:20px;cursor:pointer;animation:bt-react-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing};transition:background-color .12s ease,${spring(SPRING_TAP, "scale")}}
.bt-react:hover{background:var(--bt-hover)}
.bt-react:active{scale:.92}
@keyframes bt-react-pop{from{transform:scale(.6);opacity:0}}
.bt-bubble a[href^="${MENTION_ORIGIN}"] svg{display:none}
.bt-you{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bt-ink) 5%,var(--bt-sidebar));color:var(--bt-ink-2);box-shadow:inset 0 0 0 1px var(--bt-line);transition:background-color .12s ease}
button:hover .bt-you{background:color-mix(in srgb,var(--bt-ink) 9%,var(--bt-sidebar))}
.bt-you-wrap{display:inline-flex;padding:0}

.bt-menu{position:fixed;pointer-events:auto;z-index:60;min-width:200px;padding:6px;border-radius:12px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1),0 0 0 1px rgba(228,228,228,.04);display:flex;flex-direction:column;gap:2px;transform-origin:var(--bt-origin,top left);animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out;font-family:var(--bt-font);box-sizing:border-box}
.bt-menu button{display:flex;align-items:center;gap:4px;width:100%;min-height:30px;text-align:left;border:0;background:none;border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;line-height:18px;color:var(--bt-ink);cursor:pointer;box-sizing:border-box}
.bt-menu button:hover{background:var(--bt-hover)}
.bt-menu button svg{flex:none;width:16px;height:16px;margin:0 1px}
.bt-menu .bt-danger{color:var(--bt-danger)}
.bt-menu-sep{height:.5px;flex:none;background:var(--bt-line-2);margin:4px 8px}
.bt-menu-up{--bt-origin:bottom left;animation-name:bt-pop-lift,bt-veil-in}
.bt-menu[data-leaving]{pointer-events:none;animation:bt-pop-out .12s cubic-bezier(.4,0,1,1) forwards}
.bt-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-menu-hint{flex:none;color:var(--bt-ink-3);font-size:12px;font-variant-numeric:tabular-nums}
.bt-palette-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:70;pointer-events:auto;font-family:var(--bt-font)}
.bt-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.46);animation:bt-fade .22s ease-out}
.bt-palette{position:absolute;top:50%;left:50%;width:min(560px,92vw);transform:translate(-50%,-50%);display:flex;flex-direction:column;border-radius:12px;background:var(--bt-main);border:1px solid var(--bt-line-2);box-shadow:0 24px 48px -12px rgba(0,0,0,.25);overflow:hidden;color:var(--bt-ink);animation:bt-palette-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-palette-layer[data-leaving]{pointer-events:none}
.bt-palette-layer[data-leaving] .bt-backdrop{opacity:0;transition:opacity .16s ease-in}
.bt-palette-layer[data-leaving] .bt-palette{animation:bt-dialog-sink .16s cubic-bezier(.4,0,1,1) forwards}
@keyframes bt-palette-in{from{translate:0 -10px;scale:.96}}
.bt-palette-head{display:flex;align-items:center;gap:4px;padding:14px 10px 14px 14px;border-bottom:.5px solid var(--bt-line-2)}
.bt-palette-glyph{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;color:var(--bt-ink-3);margin-right:4px}
.bt-palette-head input{flex:1;min-width:0;border:0;outline:none;background:none;color:var(--bt-ink);font:inherit;font-size:15px;line-height:22px;padding:0}
.bt-palette-head input::placeholder{color:var(--bt-ink-3)}
.bt-palette-clear{width:18px;height:18px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.bt-palette-clear:hover{color:var(--bt-ink)}
.bt-palette-clear svg{width:12px;height:12px}
.bt-palette-list{position:relative;height:402px;height:min(402px,54vh);height:min(402px,54dvh);overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.bt-palette-list>.bt-thumb,.bt-drop-list>.bt-thumb{left:0;right:0;border-radius:8px;background:var(--bt-active)}
.bt-palette-list>.bt-thumb{left:8px;right:8px}
:is(.bt-palette-list,.bt-drop-list)[data-glide] [aria-selected=true]{background:transparent}
:is(.bt-palette-row,.bt-palette-section,.bt-drop-list>.bt-option){position:relative;z-index:1}
.bt-palette-section{padding:8px 8px 4px;font-size:12px;line-height:16px;color:var(--bt-ink-3);flex:none}
.bt-palette-section:first-of-type{padding-top:0}
.bt-palette-row{flex:none;display:flex;align-items:center;gap:8px;height:49px;padding:6px 10px 6px 8px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;width:100%}
.bt-palette-row[aria-selected=true]{background:var(--bt-active)}
.bt-palette-lead{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center}
.bt-palette-cmd{width:24px;height:24px;border-radius:50%;background:var(--bt-hover);display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-2)}
.bt-palette-cmd svg{width:14px;height:14px}
.bt-palette-agent{width:24px;height:24px;border-radius:50%;background:var(--bt-hover);display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink)}
.bt-palette-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-palette-title{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-palette-sub{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-palette-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.bt-palette-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:0 16px;text-align:center;animation:bt-veil-in .22s ease-out}
.bt-palette-empty-icon{color:var(--bt-line-2)}
.bt-palette-empty-icon svg{width:32px;height:32px}
.bt-palette-empty-label{font-size:14px;font-weight:500;color:var(--bt-ink-2)}
.bt-palette-empty-hint{font-size:13px;line-height:16px;color:var(--bt-ink-3)}
@media (prefers-reduced-motion:reduce){.bt-palette{animation:bt-fade .1s ease-out}}
.bt-account-menu{width:224px}
.bt-account{flex:none;width:36px;height:36px;border:0;padding:0;background:none;border-radius:50%;cursor:pointer;display:inline-flex}
.bt-account:hover .bt-you,.bt-account[aria-expanded=true] .bt-you{background:color-mix(in srgb,var(--bt-ink) 9%,var(--bt-sidebar))}
/* Popover keyframes move translate and scale, which compose with a transform the popover
   already has. */
@keyframes bt-pop-drop{from{translate:0 -4px;scale:.96}}
@keyframes bt-pop-lift{from{translate:0 4px;scale:.96}}
@keyframes bt-pop-out{to{opacity:0;scale:.97;filter:blur(2px)}}
@keyframes bt-veil-in{from{opacity:0;filter:blur(6px)}}
@keyframes bt-check-pop{from{opacity:0;scale:.4}}
@media (prefers-reduced-motion:reduce){.bt-menu,.bt-avedit,.bt-react-strip{animation:bt-fade .1s ease-out}.bt-react-strip button,.bt-q-check,.bt-color[aria-pressed=true] span{animation:none}}
.bt-brand:hover{background:var(--bt-hover)}
.bt-drop-list{position:relative;display:flex;flex-direction:column;gap:2px}
.bt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.bt-pick{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 2px 6px;border-radius:10px;border:1px solid transparent;background:none;color:var(--bt-ink);cursor:pointer;font:inherit;font-size:11px;line-height:14px;min-width:0}
.bt-pick:hover{background:var(--bt-hover)}
.bt-pick[aria-pressed=true]{border-color:var(--bt-line-2);background:var(--bt-hover)}
.bt-pick>span:last-child:not(.bt-mark){max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-pick:hover .bt-mark[data-state=idle] .bt-eye{animation:bt-blink .5s linear 1}
.bt-select{width:100%;height:34px;box-sizing:border-box;border-radius:8px;border:1px solid var(--bt-line);background:var(--bt-card);color:var(--bt-ink);padding:0 8px;font:inherit;font-size:13px}
.bt-note{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-top:6px}
.bt-swatch-sep{width:1px;height:22px;background:var(--bt-line-2);margin:0 2px}
.bt-swatch-custom{position:relative;overflow:hidden;background:conic-gradient(#ff3e51,#ffaf38,#00c972,#1cc3b0,#2a92fe,#a97efe,#ff5eb1,#ff3e51);box-sizing:border-box}
.bt-swatch-custom[data-on=true]{border-color:var(--bt-ink)}
.bt-swatch-custom input{position:absolute;inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px);opacity:0;cursor:pointer;border:0;padding:0}
.bt-swatch-default{background:linear-gradient(135deg,var(--bt-card) 0 46%,var(--bt-line-2) 46% 54%,var(--bt-card) 54%);box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-states{display:flex;flex-wrap:wrap;gap:4px}
.bt-state{border:1px solid var(--bt-line);background:none;border-radius:999px;font:inherit;font-size:11px;line-height:16px;padding:2px 8px;color:var(--bt-ink-2);cursor:pointer}
.bt-state:hover{color:var(--bt-ink)}
.bt-state[aria-pressed=true]{background:var(--bt-active);border-color:var(--bt-line-2);color:var(--bt-ink)}
.bt-theme-chip{position:relative;width:46px;height:30px;border-radius:8px;box-shadow:inset 0 0 0 1px var(--bt-line-2);background:linear-gradient(90deg,var(--ls) 0 36%,var(--lb) 36%);overflow:hidden}
.bt-theme-chip i{position:absolute;right:7px;bottom:7px;width:10px;height:10px;border-radius:50%;background:var(--la)}
body[data-ds-dark-theme] .bt-theme-chip{background:linear-gradient(90deg,var(--ds) 0 36%,var(--db) 36%)}
body[data-ds-dark-theme] .bt-theme-chip i{background:var(--da)}
.bt-tabs{flex-wrap:wrap}
.bt-soft:disabled{opacity:.4;cursor:default}
.bt-group-role{margin-left:6px;font-size:11px;line-height:14px;padding:1px 5px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);vertical-align:1px}
.bt-mini{flex:none;border:0;background:none;border-radius:6px;padding:2px 6px;font:inherit;font-size:12px;line-height:18px;color:var(--bt-ink-2);cursor:pointer}
.bt-mini:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-add{color:var(--bt-ink-2);margin-top:2px}
.bt-add:hover,.bt-addlist .bt-option:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-addlist{display:flex;flex-direction:column;margin-top:4px;padding:4px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-card);animation:bt-rise .16s ease-out}
.bt-seg{position:relative;display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--bt-hover)}
.bt-motion-seg,.bt-look-seg{width:216px}
/* A range input: the track fills with the accent up to the thumb (--bt-fill). */
.bt-range{display:flex;align-items:center;gap:10px;width:216px}
.bt-range input{flex:1;min-width:0;height:20px;margin:0;background:none;-webkit-appearance:none;appearance:none;cursor:pointer}
.bt-range input::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:linear-gradient(to right,var(--bt-accent) var(--bt-fill),var(--bt-active) var(--bt-fill))}
.bt-range input::-moz-range-track{height:4px;border-radius:999px;background:linear-gradient(to right,var(--bt-accent) var(--bt-fill),var(--bt-active) var(--bt-fill))}
.bt-range input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;border:0;border-radius:50%;corner-shape:round;background:var(--bt-card);box-shadow:inset 0 0 0 .5px var(--bt-line-2),0 1px 3px rgba(0,0,0,.08);transition:${spring(SPRING_TAP, "scale")}}
.bt-range input::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--bt-card);box-shadow:inset 0 0 0 .5px var(--bt-line-2),0 1px 3px rgba(0,0,0,.08)}
.bt-range input:active::-webkit-slider-thumb{scale:1.15}
.bt-range input:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px;border-radius:999px}
.bt-range output{flex:none;width:38px;text-align:right;font-size:13px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-seg button{position:relative;z-index:1;flex:1;height:30px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--bt-ink-2);cursor:pointer;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease,${spring(SPRING_TAP, "scale")}}
.bt-seg button[aria-pressed=true]{background:var(--bt-card);color:var(--bt-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.bt-seg button:disabled{opacity:.4;cursor:default}
.bt-seg button:active:not(:disabled){scale:.96}
.bt-seg>.bt-thumb{top:2px;bottom:2px;border-radius:8px;background:var(--bt-card);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.bt-seg[data-glide] button[aria-pressed=true]{background:transparent;box-shadow:none}
@keyframes bt-rise{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.bt-addlist{animation:none}}

/* Memory dialog: a summary of every entry, the entries behind the menu, "Ask or update" below. */
.bt-mem-row{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 8px 0 10px;border:.5px solid var(--bt-line-2);border-radius:10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;box-sizing:border-box;transition:background-color .12s ease}
.bt-mem-row:hover{background:var(--bt-hover)}
.bt-mem-row>svg{flex:none;color:var(--bt-ink-2)}
.bt-mem-row-copy{flex:1;text-align:left}
.bt-mem-row-go{display:inline-flex;align-items:center;gap:2px;color:var(--bt-ink-3);font-size:12px;flex:none;white-space:nowrap}
.bt-mem-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:61;display:flex;align-items:center;justify-content:center;font-family:var(--bt-font)}
.bt-mem-scrim{animation:bt-fade .2s ease-out}
.bt-mem{position:relative;width:min(680px,calc(100vw - 48px));height:min(760px,calc(100vh - 2*max(32px,var(--dsh-frame-overlay-top,32px))));background:var(--bt-main);border-radius:20px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-mem-head{position:relative;display:flex;align-items:center;gap:8px;height:60px;flex:none;padding:0 14px 0 24px;border-bottom:.5px solid var(--bt-line);box-sizing:border-box}
.bt-mem-head .bt-icon-btn{width:32px;height:32px;flex:none}
.bt-mem-head [aria-haspopup] svg{width:18px;height:18px;stroke-width:2.6}
.bt-mem-head>.bt-icon-btn:first-child{margin-left:-10px}
.bt-mem-head h2{margin:0;font-size:17px;line-height:24px;font-weight:600;white-space:nowrap}
.bt-mem-status{font-size:13px;line-height:18px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}
.bt-mem-head-gap{flex:1}
.bt-mem-menu{position:absolute;top:52px;right:50px;min-width:220px;--bt-origin:top right}
.bt-mem-menu button:disabled{opacity:.4;cursor:default;background:none}
.bt-mem-body{flex:1;overflow-y:auto;padding:22px 28px 24px;scrollbar-width:thin;display:flex;flex-direction:column;gap:12px}
.bt-mem-summary{transition:opacity .3s ease}
.bt-mem-summary[data-stale]{opacity:.55}
.bt-mem-summary h3{margin:20px 0 6px;font-size:17px;line-height:26px;font-weight:600}
.bt-mem-summary h3:first-child{margin-top:0}
.bt-mem-summary p{margin:0;font-size:15px;line-height:26px}
.bt-mem-summary>*{animation:bt-mem-line .45s cubic-bezier(.16,1,.3,1) both}
.bt-mem-summary>:nth-child(2){animation-delay:.03s}
.bt-mem-summary>:nth-child(3){animation-delay:.06s}
.bt-mem-summary>:nth-child(4){animation-delay:.09s}
.bt-mem-summary>:nth-child(5){animation-delay:.12s}
.bt-mem-summary>:nth-child(6){animation-delay:.15s}
.bt-mem-summary>:nth-child(n+7){animation-delay:.18s}
@keyframes bt-mem-line{from{opacity:0;transform:translateY(4px)}}
.bt-mem-skel{display:flex;flex-direction:column;gap:24px}
.bt-mem-skel-block{display:flex;flex-direction:column;gap:10px}
.bt-mem-skel-block span{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--bt-hover) 25%,var(--bt-active) 50%,var(--bt-hover) 75%);background-size:200% 100%;animation:bt-mem-skel 1.4s ease-in-out infinite}
.bt-mem-skel-block .bt-mem-skel-head{width:30%;height:16px;margin-bottom:2px}
@keyframes bt-mem-skel{from{background-position:150% 0}to{background-position:-50% 0}}
.bt-mem-skel-label{font-size:13px;line-height:18px;color:var(--bt-ink-3)}
.bt-mem-empty{margin:auto;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:24px 0;animation:bt-mem-line .45s cubic-bezier(.16,1,.3,1) both}
.bt-mem-empty-mark{width:48px;height:48px;border-radius:50%;background:var(--bt-hover);display:flex;align-items:center;justify-content:center;color:var(--bt-ink-2);margin-bottom:4px}
.bt-mem-empty-mark svg{width:22px;height:22px}
.bt-mem-empty-title{font-size:15px;line-height:22px;font-weight:600}
.bt-mem-empty-text{font-size:13px;line-height:20px;color:var(--bt-ink-2)}
.bt-mem-failed{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:var(--bt-hover);font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-mem-failed>span{flex:1;min-width:0;overflow-wrap:anywhere}
.bt-mem-entries{display:flex;flex-direction:column;gap:28px;animation:bt-page-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .22s ease-out}
.bt-mem-section-head{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
.bt-mem-section-head h3{margin:0;font-size:15px;line-height:22px;font-weight:600}
.bt-mem-section-head span{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-mem-section-head .bt-mem-size{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-mem-topic{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin:14px 0 2px 4px;font-weight:500}
.bt-mem-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.bt-mem-entry{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:.5px solid var(--bt-line);transition:opacity .2s ease}
.bt-mem-entry[data-busy]{opacity:.4}
.bt-mem-entry-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-mem-entry-text{font-size:14px;line-height:20px;overflow-wrap:anywhere}
.bt-mem-entry-meta{font-size:12px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.bt-mem-remove{flex:none;height:28px;min-width:28px;border-radius:999px;border:0;background:none;color:var(--bt-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0 6px;font:inherit;font-size:12px;opacity:0;transition:opacity .12s ease,background-color .12s ease,color .12s ease}
.bt-mem-entry:hover .bt-mem-remove,.bt-mem-remove:focus-visible,.bt-mem-remove[data-confirm]{opacity:1}
.bt-mem-remove:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-mem-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--bt-danger);padding:0 10px}
@media (hover:none){.bt-mem-remove{opacity:1}}
.bt-mem-none{font-size:13px;line-height:18px;color:var(--bt-ink-3);padding:8px 4px}
.bt-mem-foot{flex:none;padding:8px 20px 20px;display:flex;flex-direction:column;gap:10px}
.bt-mem-reply{border-radius:16px;background:var(--bt-hover);padding:8px 8px 12px 16px;display:flex;flex-direction:column;gap:6px;max-height:36vh;max-height:36dvh;overflow-y:auto;scrollbar-width:thin;transform-origin:50% 100%;animation:bt-pop-lift ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-mem-reply-head{display:flex;align-items:center;gap:8px;min-height:24px}
.bt-mem-reply-asked{flex:1;min-width:0;font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mem-reply .bt-icon-btn{width:24px;height:24px;flex:none}
.bt-mem-reply-text{font-size:14px;line-height:21px;padding-right:8px;overflow-wrap:anywhere}
.bt-mem-changes{list-style:none;margin:2px 0 0;padding:0 8px 0 0;display:flex;flex-direction:column;gap:4px}
.bt-mem-changes li{display:flex;align-items:flex-start;gap:6px;font-size:13px;line-height:18px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-mem-changes li svg{flex:none;margin-top:1px;color:var(--bt-danger);animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} .12s backwards}
.bt-mem-changes li[data-ok] svg{color:var(--bt-green)}
.bt-mem-ask{display:flex;align-items:center;gap:8px;height:52px;padding:0 8px 0 22px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 4px 16px rgba(0,0,0,.06);box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease}
.bt-mem-ask:focus-within{border-color:var(--bt-ink-3);box-shadow:0 4px 20px rgba(0,0,0,.1)}
.bt-mem-input{flex:1;min-width:0;border:0;background:none;outline:none;color:var(--bt-ink);font:inherit;font-size:15px;line-height:22px;padding:0}
.bt-mem-input::placeholder{color:var(--bt-ink-3)}
.bt-mem-send{flex:none;width:36px;height:36px;border-radius:50%;border:0;background:var(--bt-ink);color:var(--bt-main);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:opacity .15s ease,${spring(SPRING_TAP, "scale")}}
.bt-mem-send:disabled{opacity:.22;cursor:default}
.bt-mem-send:not(:disabled):active{scale:.92}
.bt-mem-send>*{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-mem-spin{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;box-sizing:border-box;animation:bt-mem-spin .7s linear infinite}
@keyframes bt-mem-spin{to{transform:rotate(360deg)}}
@media (max-width:640px){.bt-mem{width:100vw;height:100%;border-radius:0;border:0}.bt-mem-body{padding:18px 18px 20px}.bt-mem-foot{padding:8px 12px 12px}}
@media (prefers-reduced-motion:reduce){.bt-mem,.bt-mem-scrim,.bt-mem-summary>*,.bt-mem-empty,.bt-mem-reply,.bt-mem-skel-block span,.bt-mem-entries,.bt-mem-send>*,.bt-mem-changes li svg{animation:none}}

.bt-thumb{position:absolute;left:0;top:0;z-index:0;pointer-events:none;transition:opacity .14s ease}
.bt-thumb[data-hidden]{opacity:0}
[data-morph]{overflow:hidden!important}
.bt-veil{animation:bt-veil-in .22s ease-out}
.bt-with-icon{display:inline-flex;align-items:center;gap:4px}
.bt-with-icon svg{width:14px;height:14px}
.bt-tag-admin{display:inline-flex;align-items:center;gap:4px}
.bt-create-inline{padding:18px 16px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-create-inline .bt-create-card{max-width:none}
.bt-panel-view>[data-move=in]{animation:bt-page-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-panel-view>[data-move=out]{animation:bt-page-out ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-panel-view>:is([data-move=in],[data-move=out]):nth-child(2){animation-delay:25ms}
.bt-panel-view>:is([data-move=in],[data-move=out]):nth-child(n+3){animation-delay:50ms}
.bt-panel-view>.bt-drawer-body[data-move=tab]{animation:bt-veil-in .2s ease-out}
.bt-drawer-name-input{animation:bt-veil-in .16s ease-out}
.bt-pop-in{display:inline-flex;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
:is(.bt-soft,.bt-send,.bt-icon-btn,.bt-settings-close,.bt-mini,.bt-tab,.bt-nc-send,.bt-avedit-tab,.bt-shape,.bt-pick,.bt-swatch,.bt-palette-clear){transition:background-color .12s ease,color .12s ease,border-color .12s ease,opacity .12s ease,${spring(SPRING_TAP, "scale")}}
:is(.bt-icon-btn,.bt-settings-close,.bt-nc-send,.bt-shape,.bt-swatch,.bt-color,.bt-x,.bt-q-x,.bt-palette-clear):active:not(:disabled){scale:.9}
:is(.bt-soft,.bt-send,.bt-mini,.bt-tab,.bt-avedit-tab,.bt-pick,.bt-q-submit,.bt-q-btn):active:not(:disabled){scale:.96}
@media (prefers-reduced-motion:reduce){.bt-thumb{transition:none}.bt-panel-view>[data-move],.bt-drawer-name-input,.bt-veil,.bt-pop-in,.bt-token,.bt-drop,.bt-newchat,.bt-option-hint,.bt-connector-form,.bt-settings-head>*{animation:none}}
/* Phone-width viewports: the settings dialog takes the whole screen, its page
   list becomes a horizontal strip across the top, and fixed-width pages wrap
   or scroll instead of overflowing. These rules sit at the end of the sheet:
   the base column widths below would otherwise win the cascade back. */
@media (max-width:640px){
  .bt-settings-layer{align-items:stretch;justify-content:stretch}
  .bt-settings{--bt-set-w:100vw;--bt-set-h:100vh;width:100vw;height:100vh;height:100dvh;border-radius:0;border-width:0;flex-direction:column}
  /* Right padding is not honored inside a scrolling flex row; a transparent
     right border keeps the last tab clear of the close button. */
  .bt-settings-nav{width:100%;flex:none;flex-direction:row;align-items:center;overflow-x:auto;padding:8px;border:0;border-right:52px solid transparent;border-bottom:.5px solid var(--bt-line);scrollbar-width:thin;box-sizing:border-box}
  .bt-settings-item{flex:none}
  .bt-settings-shell{margin-top:0;margin-left:auto;flex:none}
  .bt-settings-main{width:100%;flex:1;min-height:0;height:auto}
  .bt-settings-usage[data-off]{left:0;width:100%}
  .bt-settings-scroll{overflow-x:clip}
  .bt-set-row{flex-direction:column;align-items:stretch;gap:8px}
  .bt-set-row>.bt-set-copy{width:100%}
  .bt-avedit{width:min(300px,calc(100vw - 32px))}
  .bt-shape-row{grid-template-columns:repeat(4,1fr)}
}
/* Follow the visible viewport, not the layout one: dvh where the browser knows
   it (the earlier vh value is the fallback), and safe-area padding where
   full-screen layers and bottom regions meet the device's own bars. */
.bt-settings{--bt-set-h:min(780px,calc(100dvh - 2*max(32px,var(--dsh-frame-overlay-top,32px))))}
.bt-mem{height:min(760px,calc(100dvh - 2*max(32px,var(--dsh-frame-overlay-top,32px))))}
.bt-settings-layer,.bt-mem-layer,.bt-palette-layer{padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}
.bt-panel{padding-bottom:env(safe-area-inset-bottom,0px)}
.bt-settings-scroll{padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}
.bt-voice-bar{padding-bottom:calc(32px + env(safe-area-inset-bottom,0px))}
.bt-exchange .bt-dialog-foot{padding-bottom:calc(28px + env(safe-area-inset-bottom,0px))}
/* iOS zooms the whole page on focused inputs under 16px. */
@media (max-width:640px) and (pointer:coarse){
  .bt-input,.bt-bs-input,.bt-browser-address input,.bt-folder-input,.bt-secret-input,.bt-q-input,.bt-to input,.bt-palette-head input,.bt-mem-input{font-size:16px}
}
`;
var CONVERSATION_CSS = `
.bt-think{font-size:13px;line-height:18px;color:var(--bt-ink-2);margin:2px 0 4px;max-width:calc(var(--bt-msg-w) * 100%)}
body[data-bt-layout=flat] .bt-think{max-width:calc(var(--bt-flat-w) * 100%)}
.bt-think summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px}
.bt-think summary::-webkit-details-marker{display:none}
.bt-think-time{font-variant-numeric:tabular-nums;white-space:nowrap}
/* Five lines of the 18px line height; the rest scrolls inside the box. */
.bt-think-text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px;padding-left:10px;border-left:2px solid var(--bt-line-2);max-height:90px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;outline:none}
.bt-think-text:focus-visible{border-left-color:var(--bt-ink-2)}
.bt-think-text[data-fade=top]{mask-image:linear-gradient(to bottom,transparent,#000 18px)}
.bt-think-text[data-fade=bottom]{mask-image:linear-gradient(to top,transparent,#000 18px)}
.bt-think-text[data-fade=both]{mask-image:linear-gradient(to bottom,transparent,#000 18px,#000 calc(100% - 18px),transparent)}
.bt-event{display:flex;justify-content:center;align-items:center;gap:2px;min-height:24px;margin:2px 0;font-size:12px;line-height:16px;color:var(--bt-ink-2);flex-wrap:wrap}
.bt-event>span{padding:0 2px}
.bt-event button:not(.bt-soft){border:0;background:none;color:inherit;font:inherit;display:inline-flex;align-items:center;gap:4px;cursor:pointer;height:24px;padding:4px 6px 4px 4px;border-radius:999px;box-sizing:border-box;transition:background-color .12s ease}
.bt-event button:not(.bt-soft):hover{background:var(--bt-hover)}
.bt-event button:not(.bt-soft):active{background:var(--bt-active)}
.bt-event .bt-soft{margin-left:6px}
.bt-event button.bt-event-whole{min-width:0;max-width:100%;padding:4px 6px 4px 8px}
.bt-event-whole>*{flex:none}
.bt-event-whole>span:first-child{margin-right:2px}
/* One button cannot wrap like separate parts, so a long name is cut to fit the chat. */
.bt-event-whole>.bt-event-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-time-sep{display:flex;justify-content:center;align-items:center;height:28px;margin:14px 0 8px;font-size:12px;line-height:16px;color:var(--bt-ink-2);white-space:nowrap}
[class*="_scroll"]>[class*="_column"]::before{content:var(--bt-first-sep,none);display:block;flex:none;height:28px;margin:17px 0 12px;font-size:12px;line-height:28px;text-align:center;color:var(--bt-ink-2);white-space:nowrap}
.bt-activity{display:flex;align-items:center;gap:10px;margin:8px 0 4px 2px;font-size:14px;color:var(--bt-ink-2)}
.bt-group-replies{display:contents}
/* A Bot chat is flat in every work-details mode, without changing the user's mode
   (it is a DSH-wide setting): step groups lose their header and stay open, and what a
   mode folds away in a finished turn stays shown. TurnProcessCell also opens that
   fold; these rules cover the first frame before it does. */
[data-step-process]>div:first-child{display:none!important}
[data-step-process]>[data-step-process-body]{display:block!important;content-visibility:visible!important;max-height:none!important;overflow:visible!important;mask-image:none!important;scrollbar-gutter:auto!important}
:is([data-step-process],[data-turn-process-hidden])[hidden]{content-visibility:visible!important}
[class*="_flowItem"]:has(> [data-slot="conversation.chat.node"]:empty, > [data-slot="conversation.chat.node"][data-bt-emptied]){display:none!important}
/* A turn's process seat is a flow child of its own, not a flowItem: a seat whose
   member cells all emptied themselves (a hidden exchange turn, a turn whose
   calls draw nothing) still kept its margin, stacking a blank band per hidden
   call. Only the slot a DS Bot cell marked counts, so a seat another renderer
   fills — even with plain text and no element child — is never taken for empty. */
[data-step-process]:has(> [data-step-process-body] [data-slot="conversation.chat.node"][data-bt-emptied]):not(:has(> [data-step-process-body] [data-slot="conversation.chat.node"]:not([data-bt-emptied]))){display:none!important}
[class*="_header"]:has(.bt-head){border-bottom-color:transparent!important;box-shadow:none!important}
/* The transcript runs under a floating header pill. */
header[class*="_header"]:has(.bt-head){position:absolute!important;top:0;left:0;right:0;z-index:8;display:flex!important;padding:10px 0 0!important;background:transparent!important;pointer-events:none;justify-content:center}
header[class*="_header"]:has(.bt-head)::before{content:"";position:absolute;inset:0 0 auto;height:calc(60px + env(safe-area-inset-top,0px));background:linear-gradient(to bottom,var(--bt-main),color-mix(in srgb,var(--bt-main) 0%,transparent));pointer-events:none;z-index:-1}
header[class*="_header"]:has(.bt-head)>[class*="_headerLeading"]{position:absolute;left:12px;top:10px;pointer-events:auto}
header[class*="_header"] .bt-head{flex:1 1 auto;width:100%}
/* On macOS the shell's header row is the window's drag strip (data-window-drag
   becomes -webkit-app-region:drag). The floating header stays click-through, so
   the transcript under it still takes links and the wheel. Only the 40px .bt-head
   bar the pill sits in is hit again and carries the drag mark; controls inside
   keep no-drag. The data-slot anchor must not take no-drag, or the bar inherits it. */
html[data-platform=darwin] header[class*="_header"]:has(.bt-head) .bt-head{pointer-events:auto;-webkit-app-region:drag}
html[data-platform=darwin] header[class*="_header"]:has(.bt-head) :is(a,button,input,textarea,select,[role=button],[role=menuitem],[role=menu],[contenteditable=true]){-webkit-app-region:no-drag}
[class*="_body"]:has(> [class*="_scrollBody"]){--dsh-chat-content-width:min(960px,100%)}
/* The shell writes the column's width on the conversation root at every resize, only to
   derive the content width that the rule above replaces. Inherited, each write restyled
   the whole conversation: once a frame while the details panel glides, most in a long
   group chat. Kept on the root alone, a write restyles one element. */
@property --dsh-conversation-column-width{syntax:"*";inherits:false}
@property --dsh-chat-user-width{syntax:"*";inherits:false}
/* DSH's turn tail keeps what plugins put in it (delivered files, the Bot's separators),
   without its copy and branch row; a tail with nothing in it takes no room. */
[data-turn-tail]>:not([data-slot="conversation.chat.turnTail"]){display:none!important}
[class*="_flowItem"][data-chat-flow-kind="turn-tail"]:not(:has([data-slot="conversation.chat.turnTail"]:not(:empty))){display:none!important}
/* Every team Session belongs to a Bot or a group, so a blank one is an empty chat, not
   the shell's new-session hero: no headline, no workspace or mode picker, and the
   composer stays docked at the bottom. */
[data-content-phase=hero] [class*="_scrollBody"]{justify-content:flex-end!important}
[data-content-phase=hero] [class*="_composerHero"]{align-self:stretch!important;width:auto!important;padding-bottom:0!important}
[data-content-phase=hero] [class*="_composerHero"]>[class$="_root"],[data-content-phase=hero] [class*="_heroWorkspaceRow"]{display:none!important}
[data-content-phase=hero] [class*="_composerHero"] [class*="_input"]{min-height:0!important}
/* The right sides give back the scrollbar gutter so both edges sit 16px from the column. */
[class*="_scroll"]:has(> [class*="_column"]){padding:calc(60px + env(safe-area-inset-top,0px)) calc(11px + env(safe-area-inset-right,0px)) calc(16px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px))!important}
/* The shell's running status only hosts the activity row (.bt-typing). */
[data-chat-running]{display:block!important;width:100%;min-height:0!important;margin:0!important;padding:0!important}
[data-chat-running]>span:not([role=status]){display:none!important}
[data-chat-running]:has(> .bt-typing){margin-top:var(--dsh-chat-flow-gap,12px)!important}
.bt-typing{display:flex;align-items:center;gap:12px;height:36px;min-width:0;padding-inline-start:8px;transform-origin:0 50%;animation:bt-typing-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing} backwards}
.bt-typing[data-exiting]{animation:bt-typing-out .14s cubic-bezier(.22,1,.36,1) forwards}
.bt-typing>.bt-mark,.bt-typing>.bt-cluster{flex-shrink:0}
.bt-typing>.bt-mark{cursor:pointer;transition:filter .16s ease-out}
.bt-typing>.bt-mark:hover{filter:drop-shadow(0 2px 4px rgba(0,0,0,.18))}
.bt-typing>.bt-mark .bt-eyes{transition:scale .28s cubic-bezier(.4,.06,.18,1)}
.bt-typing>.bt-mark:hover .bt-eyes{scale:1.18}
.bt-typing-text{display:flex;align-items:center;flex:1 1 auto;min-width:0;animation:bt-typing-label .22s ease-out .2s backwards}
.bt-typing-label{display:inline-flex;align-items:center;gap:6px;min-width:0;animation:bt-typing-label .22s ease-out backwards}
.bt-typing-label>.bt-shimmer{font-size:14px;line-height:22px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-typing-time{flex-shrink:0;margin-left:6px;font-size:12px;line-height:22px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
@keyframes bt-typing-in{from{opacity:0;transform:scale(.9)}}
@keyframes bt-typing-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.92);filter:blur(3px)}}
@keyframes bt-typing-label{from{opacity:0;filter:blur(5px);transform:translateY(3px)}}
/* Shimmer: a stepped sweep clipped to the text. */
.bt-shimmer{color:transparent;background:linear-gradient(90deg,var(--bt-shimmer-base) 0%,var(--bt-shimmer-base) 25%,var(--bt-ink) 60%,var(--bt-shimmer-base) 75%,var(--bt-shimmer-base) 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;animation:bt-shimmer 2.2s steps(60) infinite;--bt-shimmer-base:color-mix(in srgb,var(--bt-ink) 40%,transparent)}
@keyframes bt-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
/* New rows slide up; a reply that replaces the activity row grows out of its corner. */
[data-bt-enter="new"]{animation:bt-row-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
[data-bt-enter="after-collapse"]{transform-origin:0 100%;animation:bt-row-after .24s cubic-bezier(.23,1,.32,1) .38s backwards}
@keyframes bt-row-in{from{transform:translateY(12px)}to{transform:none}}
@keyframes bt-row-after{0%{opacity:0;transform:translateY(12px) scale(.94)}55%{opacity:1}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
.bt-typing,.bt-typing[data-exiting]{animation-name:bt-fade-in;animation-duration:.12s;transform:none}
.bt-typing[data-exiting]{animation-name:bt-fade-out}
.bt-typing-text,.bt-typing-label{animation-name:bt-fade-in;animation-delay:0s}
.bt-shimmer{animation:none;background:none;color:var(--bt-ink-2)}
[data-bt-enter="new"]{animation:none}
[data-bt-enter="after-collapse"]{animation:bt-fade-in .12s ease-out}
}
@keyframes bt-fade-in{from{opacity:0}to{opacity:1}}
@keyframes bt-fade-out{from{opacity:1}to{opacity:0}}
[data-composer-card]{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:0!important;min-height:44px!important;border-radius:22px!important;padding:7.5px!important;box-sizing:border-box;background:var(--bt-main)!important;border:.5px solid var(--bt-line-2)!important;box-shadow:0 2px 8px -1px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.03),0 0 0 1px rgba(228,228,228,.04)!important;transition:border-color .15s ease,background-color .15s ease,${spring(SPRING_SHAPE, "border-radius")}!important}
[data-composer-card]:hover,[data-composer-card]:focus-within{border-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)!important}
[data-composer-card]:has(> [data-slot="conversation.input.attachments"] *),[data-composer-card]:has([data-composer-input] br + *),[data-composer-card]:has([data-composer-input] > :nth-child(2)){border-radius:18px!important}
[class*="_root"]:has(> [data-composer-card]){padding:0 11px 13px 16px!important}
[class*="_root"]:has(> [data-composer-card])>[data-composer-card]{max-width:min(992px,100%)!important}
[data-composer-card]>[class*="_row"]{display:contents!important}
[data-composer-card] [class*="_tools"]{order:1!important;flex:none!important;align-self:flex-end!important;margin:0!important}
[data-composer-card]>[data-input-scroll]{order:2!important;flex:1 1 0!important;min-width:0!important;padding:0 8px!important;margin:0!important}
[data-composer-card] [class*="_trailing"]{order:3!important;flex:none!important;align-self:flex-end!important;margin:0!important}
/* The slot anchor is display:contents, so the rail inside it is the flex item. */
[data-composer-card]>[data-slot="conversation.input.attachments"]>[class*="_rail"]{order:0!important;flex:0 0 100%!important;margin:0!important;padding:2px 8px 6px!important}
[data-composer-card]:has(> [data-slot="conversation.input.attachments"] > [class*="_rail"])>[data-input-scroll]{order:1!important;flex:0 0 100%!important;margin:0 0 6px!important}
[data-composer-card]:has(> [data-slot="conversation.input.attachments"] > [class*="_rail"]) [class*="_tools"]{order:2!important}
[data-composer-card]:has(> [data-slot="conversation.input.attachments"] > [class*="_rail"]) [class*="_trailing"]{margin-left:auto!important}
[data-composer-card] [data-composer-input]{min-height:24px!important;padding:2px 0!important}
[data-composer-card] [data-composer-placeholder]{left:0!important;top:2px!important}
[data-composer-placeholder]{font-size:0!important;line-height:0!important}
/* The name sits on ::before so that ::after stays free for other composer skins. */
[data-composer-placeholder]::before{content:var(--bt-placeholder,"Message")!important;display:block!important;font-size:14px!important;line-height:24px!important;color:color-mix(in srgb,var(--bt-ink) 36%,transparent)!important}
/* The team's "+" (ComposerPlus) takes the seat of the shell's command-menu button. */
[data-composer-card] button[class*="_add"]{display:none!important}
.bt-plus{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bt-ink) 5%,transparent);box-shadow:inset 0 0 0 .5px var(--bt-line);color:var(--bt-ink-2);cursor:pointer;transition:background-color .15s ease,color .15s ease,${spring(SPRING_TAP, "scale")}}
.bt-plus:hover,.bt-plus[aria-expanded=true]{background:color-mix(in srgb,var(--bt-ink) 10%,transparent);color:var(--bt-ink)}
.bt-plus:active{scale:.9}
.bt-plus svg{width:14px;height:14px;transition:${spring(SPRING_POP, "rotate")}}
.bt-plus[aria-expanded=true] svg{rotate:45deg}
.bt-plus-menu{min-width:180px}
[data-composer-card] [class*="_tools"]{gap:0!important}
[data-composer-card] [class*="_modes"]:empty{display:none!important}
[data-composer-card] [class*="_activity"]:not(:has([data-slot] > *)){display:none!important}
[data-composer-card] [class*="_trailing"]{gap:8px!important}
/* No display here: DSH hides these controls with [hidden] while the Bot works. */
[data-composer-card] [class*="_standardControls"]{align-items:center!important;gap:8px!important}
[data-composer-card] button[class*="_primary"]{width:28px!important;height:28px!important;background:var(--bt-accent)!important;color:var(--bt-accent-ink,#fff)!important;border-radius:50%!important;transition:opacity .15s ease,${spring(SPRING_TAP, "scale")};animation:bt-icon-swap ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
[data-composer-card] button[class*="_primary"]:hover:not(:disabled){opacity:.9}
[data-composer-card] button[class*="_primary"]:active:not(:disabled){scale:.9}
@keyframes bt-icon-swap{from{opacity:0;transform:scale(.5) rotate(-30deg)}}
[data-composer-card] button[class*="_primary"] svg{width:14px;height:14px}
[data-composer-card] button[class*="_primary"]:disabled{display:none!important}
[data-composer-dock]{display:none!important}
.bt-mic,.bt-voice{flex:none;width:28px;height:28px;border-radius:50%;border:0;padding:0;display:inline-grid;place-items:center;cursor:pointer;transition:background-color .15s ease,color .15s ease,${spring(SPRING_TAP, "scale")}}
.bt-mic{background:color-mix(in srgb,var(--bt-ink) 5%,transparent);box-shadow:inset 0 0 0 .5px var(--bt-line);color:var(--bt-ink-2)}
.bt-mic:hover{background:color-mix(in srgb,var(--bt-ink) 10%,transparent);color:var(--bt-ink)}
.bt-mic[aria-pressed=true]{background:#ff3e51;color:#fff;animation:bt-mic-pulse 1.4s ease-in-out infinite}
@keyframes bt-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,62,81,.35)}50%{box-shadow:0 0 0 5px rgba(255,62,81,0)}}
.bt-voice{display:none;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);animation:bt-icon-swap ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-voice:hover{opacity:.9}
.bt-mic:active,.bt-voice:active{scale:.9}
/* Touch devices never hover: tap-open toolbars (data-open on the message), always
   visible icon buttons and 44px targets replace the hover affordances. */
@media (hover:none){
  .bt-tools{left:auto;right:4px;margin-left:0;border-radius:999px;padding:2px;background:var(--bt-card);box-shadow:inset 0 0 0 .5px var(--bt-line-2),0 4px 14px rgba(0,0,0,.14)}
  .bt-tools::after{display:none}
  .bt-tool{width:44px;height:44px}
  .bt-menu button,.bt-menu [role=menuitem],.bt-react-strip button{min-height:44px}
  .bt-utools[data-open]{opacity:1;visibility:visible}
  .bt-utools button{width:44px;height:44px}
  [data-chat-flow-kind=user] [class*="_actions"] button{width:44px;height:44px}
}
[data-composer-card]:has(button[class*="_primary"]:disabled) .bt-voice{display:inline-grid}
body[data-bt-room] .bt-voice{display:none!important}
body[data-bt-room] [data-composer-card]:has(button[class*="_primary"]:disabled) .bt-mic:not([aria-pressed=true]){background:var(--bt-accent);color:var(--bt-accent-ink,#fff)}
.bt-mic-note{position:absolute;right:12px;bottom:calc(100% + 8px);padding:5px 10px;border-radius:8px;background:var(--bt-user);color:var(--bt-user-ink);font-size:12px;line-height:16px;white-space:nowrap;pointer-events:none;animation:bt-rise .16s ease-out}
[data-chain-overlay-fallback="conversation.composer"]:has(~ .bt-q){display:block!important;order:2}
.bt-q{order:1}
div:has(> nav [class*="_marks"]){display:none!important}
/* Every user-side bubble (sent, steering mid-turn, not yet admitted, question replies)
   takes its surface and its text from the one --bt-user pair: a skin that repaints
   the host's bubble surface alone would otherwise leave the text unreadable. */
[class*="_userRow"] [class*="_bubble"],[data-chat-flow-kind=question-reply] [class*="_bubble"],[data-chat-flow-kind=command-input] [class*="_bubble"]{background:var(--bt-user)!important;color:var(--bt-user-ink)!important;border-radius:18px!important;padding:7px 12px!important;font-size:var(--dsh-content-font-size,14px)!important;line-height:calc(var(--dsh-content-font-size,14px) + 8px)!important}
[class*="_userRow"] [class*="_bubble"] [class*="_markdown"],[class*="_userRow"] [class*="_bubble"] a{color:inherit}
/* Sent messages get the hover toolbar below; steering and unsent bubbles keep none. */
[class*="_userRow"] [class*="_actions"]{display:none!important}
/* A steering message the Bot has not read yet shows a small unread label under
   its bubble's right edge; --bt-steer-unread is set per window (header.js), and
   the none fallback means no English can leak into a Chinese window. */
[data-pending-steering]{flex-wrap:wrap}
[data-pending-steering]::after{content:var(--bt-steer-unread,none);display:block;flex-basis:100%;width:100%;order:99;margin-top:4px;font-size:11px;line-height:14px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
[data-chat-flow-kind=user] [class*="_userRow"]{flex-direction:row-reverse;align-items:center;justify-content:flex-start}
[data-chat-flow-kind=user] [class*="_actions"]{display:flex!important;height:24px!important;gap:2px!important;opacity:0!important;visibility:hidden;transition:opacity .12s ease,visibility .12s!important;flex:none}
[data-chat-flow-kind=user] [class*="_userRow"]:hover [class*="_actions"],[data-chat-flow-kind=user] [class*="_userRow"]:focus-within [class*="_actions"]{opacity:1!important;visibility:visible}
@media (hover:none){[data-chat-flow-kind=user] [class*="_actions"]{opacity:1!important;visibility:visible}}
[data-chat-flow-kind=user] [class*="_actions"] [class*="_timeStart"]{display:none}
[data-chat-flow-kind=user] [class*="_actions"] button{width:24px;height:24px;border-radius:6px;color:var(--bt-ink-2)}
[data-chat-flow-kind=user] [class*="_actions"] button:hover{background:var(--bt-hover);color:var(--bt-ink)}
[data-chat-flow-kind=user] [class*="_actions"] svg{width:15px;height:15px}
.bt-q-inline{display:flex;margin:4px 0 6px}
[data-chat-flow-kind=assistant-step]+[data-step-process]:has(.bt-q-inline){margin-top:0!important}
[data-chat-flow-kind=question-reply]:has(.bt-q-inline),[data-chat-group-key]:has([data-chat-flow-kind=question-reply] .bt-q-inline),[data-chat-group-key]:has(.bt-q-gone){margin-top:0!important}
.bt-q-inline .bt-q{margin:0;max-width:min(550px,86%);order:0}
.bt-q-dock{width:100%;display:flex;justify-content:center}
.bt-q-dock .bt-q{margin:0 auto 8px}
[class*="_toBottomSlot"]{justify-content:center!important;padding-right:0!important}
[data-conversation-scroll] [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,152px) + 8px)!important}
[class*="_toBottomSlot"]>button{width:36px!important;height:36px!important;margin-top:-36px!important;background:var(--bt-main)!important;color:var(--bt-ink)!important;box-shadow:0 0 0 .5px var(--bt-line-2),0 2px 8px -2px rgba(0,0,0,.12)!important;animation:bt-tobottom-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out;transition:background-color .12s ease,${spring(SPRING_TAP, "scale")}}
[class*="_toBottomSlot"]>button:active{scale:.9}
[class*="_toBottomSlot"]>button:hover{background:color-mix(in srgb,var(--bt-ink) 4%,var(--bt-main))!important}
[class*="_toBottomSlot"]>button svg{display:none}
[class*="_toBottomSlot"]>button::before{content:"";width:20px;height:20px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4v12M5 11l5 5 5-5'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4v12M5 11l5 5 5-5'/%3E%3C/svg%3E") center/contain no-repeat}
@keyframes bt-tobottom-in{from{translate:0 8px;scale:.8}}
[data-bt-news] [class*="_toBottomSlot"]>button{visibility:hidden!important;pointer-events:none!important}
.bt-news{position:fixed;z-index:30;transform:translateX(-50%);display:inline-flex;align-items:center;overflow:hidden;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);box-shadow:inset 0 0 0 1px rgba(20,20,20,.05),0 1px 3px 0 rgba(0,0,0,.12);font-family:var(--bt-font);animation:bt-news-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
@keyframes bt-news-in{from{translate:0 8px;scale:.9}}
.bt-news[data-direction=up]{animation-name:bt-news-in-up,bt-veil-in}
@keyframes bt-news-in-up{from{translate:0 -8px;scale:.9}}
.bt-news-jump{display:inline-flex;align-items:center;gap:2px;margin:0;padding:4px 26px 4px 4px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;white-space:nowrap;cursor:pointer;outline:none}
.bt-news-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px}
.bt-news-ico svg{width:16px;height:16px}
.bt-news-x{position:absolute;right:4px;top:50%;z-index:1;transform:translateY(-50%);width:20px;height:20px;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.75;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.bt-news-x svg{width:12px;height:12px}
.bt-news-x:hover{opacity:1;background:rgba(20,20,20,.5)}
@media (prefers-reduced-motion:reduce){.bt-news,[class*="_toBottomSlot"]>button{animation:none}}
.bt-new-sep{display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding:2px 0;font-size:11px;line-height:14px;font-weight:500;letter-spacing:.02em;text-transform:uppercase;color:var(--bt-accent);font-family:var(--bt-font)}
.bt-new-sep::before,.bt-new-sep::after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--bt-accent) 20%,transparent)}
.bt-open-new{display:flex;flex-direction:column}
.bt-open-new .bt-new-sep{margin:18px 0 0}
.bt-open-new .bt-time-sep{height:16px;margin:32px 0 2px}
.bt-earlier{display:flex;flex-direction:column;gap:6px}
.bt-earlier-top{display:flex;justify-content:center;align-items:center;height:34px;flex:none}
.bt-earlier-top:empty{display:none}
.bt-earlier-top .bt-soft{height:28px;font-size:12px;padding:0 12px}
.bt-urow{display:flex;justify-content:flex-end}
.bt-ububble{max-width:calc(var(--bt-msg-w) * 100%);background:var(--bt-user);color:var(--bt-user-ink);border-radius:18px;padding:7px 12px;font-size:14px;line-height:24px;box-sizing:border-box;overflow-wrap:anywhere;text-wrap:pretty;text-autospace:normal}
.bt-ububble [class*="_markdown"],.bt-ububble a{color:inherit!important}
.bt-ububble p{margin:0;line-height:24px}
.bt-uimages{display:block;font-size:12px;opacity:.7}
.bt-utime{margin-top:-4px;font-size:11px;line-height:14px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-earlier .bt-event{margin:4px 0}
.bt-part-line{display:flex;align-items:center;gap:10px;margin:10px 0 6px;font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-part-line::before,.bt-part-line::after{content:"";flex:1;height:1px;background:var(--bt-line)}
/* The dock wrapper also holds the context meter, so it stays hidden until a side question is in it. */
[data-composer-dock]:has(.bt-btw){display:flex!important;flex-direction:column;align-items:center;width:100%;max-width:var(--dsh-composer-card-max-width,748px)}
[data-composer-dock]:has(.bt-btw)>:not([data-slot="conversation.composer.dock"]){display:none!important}
.bt-btw-dock,.bt-btw-stack{display:flex;flex-direction:column;gap:6px;width:100%;max-width:var(--dsh-composer-card-max-width,748px)}
.bt-btw{box-sizing:border-box;width:100%;margin:6px auto;padding:8px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);color:var(--bt-ink)}
.bt-btw-dock .bt-btw,.bt-btw-stack .bt-btw{margin:0}
.bt-btw-compact{padding:6px 10px}
.bt-btw-head{display:flex;align-items:center;gap:8px;min-width:0}
.bt-btw-toggle{display:flex;align-items:center;gap:8px;flex:1;min-width:0;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bt-btw-chevron{flex:none;width:7px;height:7px;border-right:1.5px solid var(--bt-ink-3);border-bottom:1.5px solid var(--bt-ink-3);transform:rotate(-45deg)}
.bt-btw[data-open] .bt-btw-chevron{transform:rotate(45deg)}
.bt-btw-q{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px}
.bt-btw[data-open] .bt-btw-q{white-space:normal}
.bt-btw-time,.bt-btw-status{flex:none;color:var(--bt-ink-3);font-size:11px;line-height:14px;font-variant-numeric:tabular-nums}
.bt-btw-cancel{margin-left:auto}
.bt-btw-cancel:disabled{opacity:.55;cursor:default}
.bt-btw-delete{flex:none;margin:-4px}
.bt-btw-note{margin:4px 0 0;color:var(--bt-ink-3);font-size:12px;line-height:16px}
.bt-btw-body{margin-top:6px}
.bt-btw-answer{font-size:14px;line-height:20px}
.bt-btw-answer p{margin:0}
.bt-btw-fail{margin:0 0 6px;color:var(--bt-danger);font-size:13px;line-height:18px}
@media (prefers-reduced-motion:reduce){.bt-btw-chevron{transition:none}}
`;
var PLUGIN_ID = "ds-superagent-ui";
function installStyles(text, tag) {
  const style = document.createElement("style");
  style.dataset.dshBot = tag;
  style.dataset.plugin = PLUGIN_ID;
  style.textContent = text;
  document.head.appendChild(style);
  return style;
}
var FRAGMENT_SELECTOR = /\[class\*="(_[\w-]+)"\]/g;
var CLASS_TOKEN = /\.((?:\\.|[\w-])+)/g;
function sheetClassNames(sheet) {
  const names = [];
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) for (const match of rule.selectorText.matchAll(CLASS_TOKEN)) names.push(match[1]);
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  try {
    visit(sheet.cssRules);
  } catch {
  }
  return names;
}
function compileFragmentSelectors(text, names) {
  const compiled2 = /* @__PURE__ */ new Map();
  return text.replace(FRAGMENT_SELECTOR, (whole, fragment) => {
    if (!compiled2.has(fragment)) {
      const exact = [];
      for (const name of names) if (name.includes(fragment)) exact.push(`.${name}`);
      compiled2.set(fragment, exact.length ? `:is(${exact.join(",")})` : whole);
    }
    return compiled2.get(fragment);
  });
}
function installCompiledStyles(text, tag) {
  const style = installStyles("", tag);
  let disposed = false;
  const cache = /* @__PURE__ */ new WeakMap();
  const render = () => {
    if (disposed) return;
    if (!style.isConnected) document.head.appendChild(style);
    const names = /* @__PURE__ */ new Set();
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode?.dataset?.dshBot) continue;
      let list = cache.get(sheet);
      if (!list) {
        list = sheetClassNames(sheet);
        cache.set(sheet, list);
      }
      for (const name of list) names.add(name);
    }
    const next = compileFragmentSelectors(text, names);
    if (style.textContent !== next) style.textContent = next;
  };
  render();
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  };
  const onLoad = (event) => {
    if (event.target instanceof HTMLLinkElement) schedule();
  };
  const shell = (node) => node.dataset?.dshBot === void 0;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => [...record.removedNodes].includes(style))) render();
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(shell))) schedule();
  });
  observer.observe(document.head, { childList: true });
  document.addEventListener("load", onLoad, true);
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener("load", onLoad, true);
    clearTimeout(timer);
    style.remove();
  };
}

// src/client/user-message.js
var import_react19 = require("react");
var ui = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
var USER_MESSAGE_CSS = `
.bt-umsg{display:flex;flex-direction:row-reverse;align-items:center;justify-content:flex-start;gap:4px}
.bt-ustack{min-width:0;max-width:calc(var(--bt-msg-w) * 100%);display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.bt-ubody{max-width:100%;box-sizing:border-box;background:var(--bt-user);color:var(--bt-user-ink);border-radius:18px;padding:7px 12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(var(--dsh-content-font-size,14px) + 10px);white-space:pre-wrap;word-break:break-word;text-wrap:pretty;text-autospace:normal}
.bt-ubody a{color:inherit}
.bt-umention{display:inline-flex;align-items:center;gap:3px;vertical-align:-3px;max-width:100%;padding:0 1px;border:0;background:none;color:inherit;font:inherit;font-weight:600;line-height:inherit;cursor:pointer;border-radius:6px;white-space:nowrap}
.bt-umention:hover{text-decoration:underline;text-underline-offset:2px}
.bt-umention>:first-child{flex:none}
.bt-uattach{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%}
.bt-ufile{display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;width:240px;min-height:64px;padding:8px 12px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card)}
.bt-ufile-icon{flex:none;width:28px;height:28px}
.bt-ufile-text{display:flex;flex-direction:column;min-width:0}
.bt-ufile-name{font-size:14px;line-height:22px;font-weight:500;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-ufile-meta{font-size:12px;line-height:15px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-urefs{font-size:13px;line-height:18px;color:var(--bt-ink-3)}
.bt-utools{display:flex;flex:none;gap:2px;opacity:0;visibility:hidden;transition:opacity .12s ease,visibility .12s}
.bt-umsg:hover .bt-utools,.bt-umsg:focus-within .bt-utools{opacity:1;visibility:visible}
`;

// src/client/sidebar.js
var import_react21 = require("react");
var import_react_dom3 = require("react-dom");

// src/client/activity-row.js
var import_react20 = require("react");
var import_react_dom2 = require("react-dom");

// src/client/frame-layout.js
var RAIL_WIDTH = 88;
var SIDEBAR_MIN = 264;
var RAIL_SNAP = (RAIL_WIDTH + SIDEBAR_MIN) / 2;

// src/client/sidebar.js
var GLIDE = springEasing(1e3, 63);
function SingleConversation({ open }) {
  const bot = { id: "superagent", name: "Super-agent" };
  return (0, import_react21.createElement)("div", { className: "bt-list" }, (0, import_react21.createElement)("div", { className: "bt-tile-wrap" }, (0, import_react21.createElement)("button", {
    type: "button",
    className: "bt-tile",
    "aria-label": bot.name,
    "aria-current": "page",
    onClick: open
  }, (0, import_react21.createElement)(BotAvatar, { bot, size: 60, state: "idle", main: true }), (0, import_react21.createElement)("span", { className: "bt-tile-name" }, bot.name))));
}
var SIDEBAR_CSS = `
.bt-confirm{width:260px;max-width:72vw;padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px}
.bt-confirm-text{margin:0;font-size:13px;line-height:19px;color:var(--bt-ink-2)}
.bt-confirm-error{margin:0;font-size:12px;line-height:17px;color:var(--bt-danger);overflow-wrap:anywhere}
.bt-confirm-row{display:flex;justify-content:flex-end;gap:8px}
.bt-menu .bt-confirm button{width:auto;min-height:0}
.bt-confirm-go{height:28px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .12s ease}
.bt-confirm-go:hover:not(:disabled){opacity:.9}
.bt-confirm-go:disabled{opacity:.6;cursor:default}
.bt-side-top .bt-brand{cursor:default;padding-left:6px}
.bt-side-top .bt-brand:hover{background:none}
.bt-brand .bt-mark{flex:none}
.bt-pin{flex:none;display:inline-flex;color:var(--bt-ink-3)}
.bt-rail .bt-row{position:relative}
.bt-rail .bt-pin{position:absolute;top:1px;left:calc(50% + 14px)}
.bt-side .bt-read-only{margin:4px 8px 6px;padding:8px 10px;border-radius:10px;background:var(--bt-hover);font-size:12px;line-height:1.45;text-align:left}
[class*="_footArea"]:has(.bt-foot-account){grid-template-columns:auto minmax(0,1fr) auto;column-gap:6px}
[class*="_footArea"]>[class*="_footerActions"]>div>.bt-foot-account{grid-column:1;order:1;display:inline-flex}
[class*="_footArea"]:has(.bt-foot-account)>[class*="_settingsArea"]{grid-column:3}
[class*="_footArea"]:has(.bt-foot-account)>[class*="_settingsArea"] button[class*="_trigger"] [class*="_label"]{display:none!important}

/* The update cloud springs in when a newer DS Bot shows up; its arrow drops in a
   loop while the install runs. */
.bt-round.bt-update{position:relative;color:var(--bt-accent,#4D6BFE);animation:bt-update-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-round.bt-update svg{width:17px;height:17px}
.bt-round.bt-update[data-phase=installed]{color:var(--bt-ink-2)}
@keyframes bt-update-in{from{opacity:0;transform:scale(.6);filter:blur(4px)}}
.bt-update[data-phase=installing] .bt-cloud-arrow{animation:bt-cloud-drop 1.1s cubic-bezier(.45,0,.55,1) infinite}
@keyframes bt-cloud-drop{0%{transform:translateY(-3px);opacity:0}35%{opacity:1}70%{transform:translateY(1px);opacity:1}100%{transform:translateY(2px);opacity:0}}
.bt-update-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#E5484D;box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-update-pop{position:fixed;z-index:60;width:280px;padding:14px 14px 12px;border-radius:14px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);color:var(--bt-ink);box-sizing:border-box;transform-origin:top left;font-family:var(--bt-font);animation:bt-update-pop ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
@keyframes bt-update-pop{from{opacity:0;transform:scale(.96);filter:blur(4px)}}
.bt-update-title{font-size:14px;line-height:20px;font-weight:600}
.bt-update-text{margin-top:2px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.bt-update-error{margin-top:8px;font-size:12px;line-height:17px;color:var(--bt-danger);overflow-wrap:anywhere;max-height:90px;overflow:auto}
.bt-update-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px}
.bt-update-notes{margin-right:auto;font-size:12.5px;color:var(--bt-ink-2);text-decoration:none}
.bt-update-notes:hover{color:var(--bt-ink);text-decoration:underline}
.bt-update-go{height:30px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-accent,#4D6BFE);color:var(--bt-accent-ink,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .12s ease,transform .12s ease}
.bt-update-go:hover:not(:disabled){opacity:.9}
.bt-update-go:active:not(:disabled){transform:scale(.96)}
.bt-update-go:disabled{opacity:.6;cursor:default}
.bt-update-dsh:not(:first-child){margin-top:12px;padding-top:12px;border-top:.5px solid var(--bt-line-2)}
@media (prefers-reduced-motion:reduce){.bt-round.bt-update,.bt-update-pop,.bt-update .bt-cloud-arrow{animation:none}}

/* The DSH Agent row and its expanding Session list. The black whale is the
   harness's own mark, so the row reads as "plain dsh" next to the Bot marks. */
.bt-agent-ava{flex:none;width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--bt-hover);color:var(--bt-ink)}
.bt-agent-ava.bt-run{animation:bt-agent-pulse 1.4s ease-in-out infinite}
@keyframes bt-agent-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.bt-agent-sub{display:grid;grid-template-rows:0fr;transition:grid-template-rows ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-agent-sub[data-open]{grid-template-rows:1fr}
.bt-agent-sub-in{overflow:hidden;min-height:0;margin-left:44px}
.bt-agent-sub-row{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px 5px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.bt-agent-sub-row:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-agent-sub-row[aria-current=page]{background:var(--bt-hover);color:var(--bt-ink);font-weight:500}
.bt-agent-sub-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-agent-sub-time{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-agent-new{color:var(--bt-ink-3)}
.bt-agent-new svg{width:14px;height:14px;flex:none}
.bt-agent-edit{padding:3px 10px 3px 4px}
.bt-agent-edit input{width:100%;border:0;border-radius:6px;background:var(--bt-hover);color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;padding:2px 8px;outline:none;box-shadow:inset 0 0 0 .5px var(--bt-line-2)}
.bt-agent-sub[data-open] .bt-agent-sub-row{animation:bt-agent-row-in .24s ease both;animation-delay:calc(var(--i, 0)*30ms)}
@keyframes bt-agent-row-in{from{opacity:0;filter:blur(4px)}to{opacity:1;filter:blur(0)}}
@media (prefers-reduced-motion:reduce){.bt-agent-sub{transition:none}.bt-agent-sub .bt-agent-sub-row{animation:none}}
`;

// src/client/index.js
var inject = ["slots", "layout"];
function apply(ctx) {
  ctx.effect(() => installLocale(ctx.get("locale")));
  ctx.effect(() => installCompiledStyles(SHELL_CSS + CONVERSATION_CSS + USER_MESSAGE_CSS + SIDEBAR_CSS + themeCss(allThemes().deepseek) + CHAT_CSS, "superagent"));
  ctx.effect(() => ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
    name: "sidebar.workspaces",
    priority: -100,
    inject: () => ({ open: () => ctx.layout.selectPanel(null) })
  }, SingleConversation)));
  ctx.effect(() => ctx.slots.inject("sidebar.settings", () => ctx.slots.register({
    name: "sidebar.settings",
    priority: -100
  }, () => null)));
  ctx.effect(() => ctx.slots.inject("main.conversation", () => ctx.slots.register({
    name: "main.conversation",
    priority: -100
  }, SuperagentChat)));
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
