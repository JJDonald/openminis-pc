// =============================================================================
// OpenMinis PC - Internationalization (i18n)
// Supports: English (en), Simplified Chinese (zh)
// Language preference is stored in localStorage and applied to the DOM.
// =============================================================================

const SUPPORTED_LANGS = ['en', 'zh'];
const LANG_OPTIONS = ['auto', 'en', 'zh']; // 'auto' = follow system
const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'openminis-lang';

// ---- Translation dictionaries ----
const TRANSLATIONS = {
  en: {
    // Nav
    'nav.chat': 'Chat',
    'nav.settings': 'Settings',
    'nav.about': 'About',

    // Sidebar
    'sidebar.chats': 'Chats',
    'sidebar.newChat': 'New Chat',
    'sidebar.searchPlaceholder': 'Search conversations...',
    'sidebar.clear': 'Clear',
    'sidebar.noConversations': 'No conversations yet',
    'sidebar.ready': 'Ready',
    'sidebar.processing': 'Processing...',

    // Chat welcome
    'chat.welcomeTitle': 'Welcome to OpenMinis PC',
    'chat.welcomeDesc': 'Your private, on-device AI agent with a real shell.',
    'chat.listFiles': 'List files',
    'chat.systemInfo': 'System info',
    'chat.pythonScript': 'Python script',
    'chat.listFilesPrompt': 'List files in the current directory',
    'chat.systemInfoPrompt': 'What is my operating system and hardware?',
    'chat.pythonScriptPrompt': 'Create a simple Python web server script',

    // Chat input
    'chat.modelLabel': 'Model:',
    'chat.noModel': '— No model configured —',
    'chat.refresh': 'Refresh',
    'chat.inputPlaceholder': 'Ask Minis anything... (Shift+Enter for new line)',
    'chat.send': 'Send (Enter)',
    'chat.stop': 'Stop',
    'chat.inputHint': 'Enter to send · Shift+Enter for new line · Switch model above ↖',

    // Chat dynamic
    'chat.thinking': 'Thinking...',
    'chat.running': 'running...',
    'chat.done': '✓ done',
    'chat.error': '✗ error',
    'chat.preparing': 'Preparing...',
    'chat.you': 'You',
    'chat.minis': 'Minis',
    'chat.cancelled': '⏹ Task cancelled.',
    'chat.truncated': '... (truncated)',

    // Settings - General
    'settings.general': 'General',
    'settings.language': 'Language',
    'settings.languageEn': 'English',
    'settings.languageZh': '简体中文',
    'settings.followSystem': 'Follow System',

    // Settings - Appearance
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',

    // Settings - Memory
    'settings.memory': 'Memory',
    'settings.memoryCount': '{n} memory files',
    'settings.noMemories': 'No memories yet',
    'settings.clearMemories': 'Clear All Memories',
    'settings.clearMemoriesConfirm': 'Delete all memory files? This cannot be undone.',

    // Settings - Soul
    'settings.soul': 'Soul',
    'settings.soulHint': "Define your agent's persona. This text is injected into the system prompt.",
    'settings.soulPlaceholder': 'e.g. You are a helpful coding assistant that explains things clearly.',
    'settings.soulSaved': 'Persona saved!',

    // Settings - Skills / Plugins
    'settings.skills': 'Skills',
    'settings.skillsHint': 'Workspace skills are loaded from SKILL.md files and injected into the agent prompt.',
    'settings.addSkill': '+ Add Skill',
    'settings.editSkill': 'Edit Skill',
    'settings.skillName': 'Skill Name',
    'settings.skillContentPlaceholder': '---\nname: code-review\ndescription: Review code for correctness\n---\n\n# Instructions\n...',
    'settings.noSkills': 'No skills installed',
    'settings.plugins': 'Plugins / MCP',
    'settings.pluginsHint': 'Connect MCP servers over stdio or HTTP and expose their tools to the agent.',
    'settings.addPlugin': '+ Add Plugin',
    'settings.editPlugin': 'Edit Plugin',
    'settings.pluginName': 'Plugin Name',
    'settings.transport': 'Transport',
    'settings.command': 'Command',
    'settings.arguments': 'Arguments (JSON array)',
    'settings.environment': 'Environment (JSON object)',
    'settings.headers': 'Headers (JSON object)',
    'settings.noPlugins': 'No plugins configured',
    'settings.connected': 'Connected',
    'settings.disconnected': 'Disconnected',
    'settings.toolsCount': '{n} tools',
    'settings.inspect': 'Test Connection',
    'settings.deleteConfirm': 'Delete this item?',
    'settings.enabled': 'Enabled',
    'settings.disabled': 'Disabled',
    'settings.edit': 'Edit',
    'settings.delete': 'Delete',

    // Settings - Storage
    'settings.storage': 'Storage',
    'settings.storageSessions': 'Sessions',
    'settings.storageMessages': 'Messages',
    'settings.storageMemory': 'Memory files',
    'settings.storageSkills': 'Skills',
    'settings.storageMcp': 'MCP servers',
    'settings.storageTotal': 'Total used',

    // Settings - Logs
    'settings.logs': 'Logs',
    'settings.clearLogs': 'Clear Logs',
    'settings.noLogs': 'No logs yet',
    'settings.refresh': 'Refresh',

    // Settings - Models
    'settings.aiModels': 'AI Models',
    'settings.addModel': '+ Add Model',
    'settings.noModels': 'No models configured yet. Click "+ Add Model" to get started.',
    'settings.addModelTitle': 'Add Model',
    'settings.editModelTitle': 'Edit Model',
    'settings.displayName': 'Display Name',
    'settings.displayNamePlaceholder': 'e.g. Claude for coding, GPT for writing',
    'settings.provider': 'Provider',
    'settings.modelId': 'Model ID',
    'settings.apiKey': 'API Key',
    'settings.apiKeyHint': 'Leave blank to keep existing key',
    'settings.baseURL': 'Base URL (optional, for custom endpoints)',
    'settings.baseURLPlaceholder': 'Auto-detected from provider',
    'settings.save': 'Save',
    'settings.cancel': 'Cancel',
    'settings.testConnection': 'Test Connection',
    'settings.testing': 'Testing...',
    'settings.connectionPassed': 'Connection successful',

    // About
    'about.title': 'About OpenMinis PC',
    'about.desc1': 'OpenMinis PC is a desktop port of the <a href="https://openminis.app" target="_blank">OpenMinis</a> iOS/Android app.',
    'about.desc2': 'It brings leading AI models into a native desktop experience with a real shell, file system access, and web browsing capabilities.',
    'about.features': 'Features',
    'about.feature1': '🔧 Real shell access (cmd.exe / bash)',
    'about.feature2': '📁 File system operations (read, write, edit)',
    'about.feature3': '🌐 Web content fetching',
    'about.feature4': '🧠 Persistent memory across sessions',
    'about.feature5': '🤖 Multi-model: configure multiple AI profiles and switch on the fly',
    'about.techStack': 'Tech Stack',
    'about.builtWith': 'Built with TypeScript, Node.js, and vanilla web technologies. Wrapped in Electron for a native desktop experience.',
    'about.license': 'Open Source under GPLv3 · <a href="https://github.com/OpenMinis/OpenMinis" target="_blank">GitHub</a>',

    // Time
    'time.justNow': 'Just now',
    'time.minAgo': '{n}m ago',
    'time.hourAgo': '{n}h ago',
    'time.dayAgo': '{n}d ago',

    // Search / Sessions
    'search.noResults': 'No results found',
    'search.deleteConfirm': 'Delete this conversation?',

    // Profiles
    'profile.deleteConfirm': 'Delete this model profile?',
    'profile.modelIdRequired': 'Model ID is required.',
    'profile.unnamed': 'Unnamed',
    'profile.addModelsHint': '⚙️ Add models in Settings',
  },

  zh: {
    // 导航
    'nav.chat': '聊天',
    'nav.settings': '设置',
    'nav.about': '关于',

    // 侧边栏
    'sidebar.chats': '对话',
    'sidebar.newChat': '新对话',
    'sidebar.searchPlaceholder': '搜索对话...',
    'sidebar.clear': '清除',
    'sidebar.noConversations': '暂无对话',
    'sidebar.ready': '就绪',
    'sidebar.processing': '处理中...',

    // 聊天欢迎页
    'chat.welcomeTitle': '欢迎使用 OpenMinis PC',
    'chat.welcomeDesc': '你的本地 AI 智能体，拥有真实的命令行环境。',
    'chat.listFiles': '列出文件',
    'chat.systemInfo': '系统信息',
    'chat.pythonScript': 'Python 脚本',
    'chat.listFilesPrompt': '列出当前目录下的文件',
    'chat.systemInfoPrompt': '我的操作系统和硬件配置是什么？',
    'chat.pythonScriptPrompt': '创建一个简单的 Python 网页服务器脚本',

    // 聊天输入
    'chat.modelLabel': '模型：',
    'chat.noModel': '— 未配置模型 —',
    'chat.refresh': '刷新',
    'chat.inputPlaceholder': '向 Minis 提问...（Shift+Enter 换行）',
    'chat.send': '发送 (Enter)',
    'chat.stop': '停止',
    'chat.inputHint': 'Enter 发送 · Shift+Enter 换行 · 在上方切换模型 ↖',

    // 聊天动态
    'chat.thinking': '思考中...',
    'chat.running': '运行中...',
    'chat.done': '✓ 完成',
    'chat.error': '✗ 错误',
    'chat.preparing': '准备中...',
    'chat.you': '你',
    'chat.minis': 'Minis',
    'chat.cancelled': '⏹ 任务已取消。',
    'chat.truncated': '... （已截断）',

    // 设置 - 通用
    'settings.general': '通用',
    'settings.language': '语言',
    'settings.languageEn': 'English',
    'settings.languageZh': '简体中文',
    'settings.followSystem': '跟随系统',

    // 设置 - 外观
    'settings.appearance': '外观',
    'settings.theme': '主题',
    'settings.themeDark': '深色',
    'settings.themeLight': '浅色',

    // 设置 - 记忆
    'settings.memory': '记忆',
    'settings.memoryCount': '{n} 个记忆文件',
    'settings.noMemories': '暂无记忆',
    'settings.clearMemories': '清空全部记忆',
    'settings.clearMemoriesConfirm': '确定删除所有记忆文件吗？此操作不可撤销。',

    // 设置 - 灵魂
    'settings.soul': '灵魂',
    'settings.soulHint': '定义你的智能体人格。这段文字会注入到系统提示词中。',
    'settings.soulPlaceholder': '例如：你是一个乐于助人的编程助手，讲解清晰易懂。',
    'settings.soulSaved': '人格已保存！',

    // 设置 - 技能 / 插件
    'settings.skills': '技能',
    'settings.skillsHint': '工作区技能从 SKILL.md 文件加载，并注入智能体提示词。',
    'settings.addSkill': '+ 添加技能',
    'settings.editSkill': '编辑技能',
    'settings.skillName': '技能名称',
    'settings.skillContentPlaceholder': '---\nname: code-review\ndescription: 检查代码正确性\n---\n\n# 使用说明\n...',
    'settings.noSkills': '尚未安装技能',
    'settings.plugins': '插件 / MCP',
    'settings.pluginsHint': '通过 stdio 或 HTTP 连接 MCP 服务，并将工具提供给智能体。',
    'settings.addPlugin': '+ 添加插件',
    'settings.editPlugin': '编辑插件',
    'settings.pluginName': '插件名称',
    'settings.transport': '传输方式',
    'settings.command': '命令',
    'settings.arguments': '参数（JSON 数组）',
    'settings.environment': '环境变量（JSON 对象）',
    'settings.headers': '请求头（JSON 对象）',
    'settings.noPlugins': '尚未配置插件',
    'settings.connected': '已连接',
    'settings.disconnected': '未连接',
    'settings.toolsCount': '{n} 个工具',
    'settings.inspect': '测试连接',
    'settings.deleteConfirm': '确定删除这一项吗？',
    'settings.enabled': '已启用',
    'settings.disabled': '已禁用',
    'settings.edit': '编辑',
    'settings.delete': '删除',

    // 设置 - 存储
    'settings.storage': '存储',
    'settings.storageSessions': '会话',
    'settings.storageMessages': '消息',
    'settings.storageMemory': '记忆文件',
    'settings.storageSkills': '技能',
    'settings.storageMcp': 'MCP 服务',
    'settings.storageTotal': '总占用',

    // 设置 - 日志
    'settings.logs': '日志',
    'settings.clearLogs': '清空日志',
    'settings.noLogs': '暂无日志',
    'settings.refresh': '刷新',

    // 设置 - 模型
    'settings.aiModels': 'AI 模型',
    'settings.addModel': '+ 添加模型',
    'settings.noModels': '尚未配置模型。点击「+ 添加模型」开始。',
    'settings.addModelTitle': '添加模型',
    'settings.editModelTitle': '编辑模型',
    'settings.displayName': '显示名称',
    'settings.displayNamePlaceholder': '例如：写代码用 Claude、写作用 GPT',
    'settings.provider': '服务商',
    'settings.modelId': '模型 ID',
    'settings.apiKey': 'API 密钥',
    'settings.apiKeyHint': '留空则保留已有密钥',
    'settings.baseURL': 'Base URL（可选，用于自定义接口）',
    'settings.baseURLPlaceholder': '根据服务商自动检测',
    'settings.save': '保存',
    'settings.cancel': '取消',
    'settings.testConnection': '测试连接',
    'settings.testing': '测试中...',
    'settings.connectionPassed': '连接成功',

    // 关于
    'about.title': '关于 OpenMinis PC',
    'about.desc1': 'OpenMinis PC 是 <a href="https://openminis.app" target="_blank">OpenMinis</a> iOS/Android 应用的桌面版。',
    'about.desc2': '它将主流 AI 模型带入原生桌面体验，支持真实命令行、文件系统访问和网页抓取能力。',
    'about.features': '功能特性',
    'about.feature1': '🔧 真实命令行访问（cmd.exe / bash）',
    'about.feature2': '📁 文件系统操作（读取、写入、编辑）',
    'about.feature3': '🌐 网页内容抓取',
    'about.feature4': '🧠 跨会话持久记忆',
    'about.feature5': '🤖 多模型：可配置多个 AI 配置并随时切换',
    'about.techStack': '技术栈',
    'about.builtWith': '使用 TypeScript、Node.js 和原生 Web 技术构建，通过 Electron 封装为原生桌面应用。',
    'about.license': '基于 GPLv3 开源 · <a href="https://github.com/OpenMinis/OpenMinis" target="_blank">GitHub</a>',

    // 时间
    'time.justNow': '刚刚',
    'time.minAgo': '{n} 分钟前',
    'time.hourAgo': '{n} 小时前',
    'time.dayAgo': '{n} 天前',

    // 搜索 / 会话
    'search.noResults': '未找到结果',
    'search.deleteConfirm': '确定删除这个对话吗？',

    // 模型配置
    'profile.deleteConfirm': '确定删除这个模型配置吗？',
    'profile.modelIdRequired': '模型 ID 不能为空。',
    'profile.unnamed': '未命名',
    'profile.addModelsHint': '⚙️ 在设置中添加模型',
  },
};

// ---- State ----
let currentLang = DEFAULT_LANG;
let langPreference = 'auto'; // 'auto' | 'en' | 'zh'
const langChangeCallbacks = [];

// ---- Resolve 'auto' to a concrete language from the browser/system ----
function resolveAutoLang() {
  const browserLangs = (navigator.languages || [navigator.language || 'en']);
  for (const bl of browserLangs) {
    if (bl.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

// ---- Init ----
(function initLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && LANG_OPTIONS.includes(saved)) {
    langPreference = saved;
  } else {
    langPreference = 'auto';
  }
  currentLang = langPreference === 'auto' ? resolveAutoLang() : langPreference;
})();

// ---- Public API ----
const i18n = {
  /** Get current language code (resolved, e.g. 'en' or 'zh'). */
  getLang() {
    return currentLang;
  },

  /** Get the stored preference ('auto' | 'en' | 'zh'). */
  getLangPreference() {
    return langPreference;
  },

  /** Translate a key, with optional {placeholder} interpolation. */
  t(key, params) {
    let str = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key])
      || (TRANSLATIONS[DEFAULT_LANG] && TRANSLATIONS[DEFAULT_LANG][key])
      || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      }
    }
    return str;
  },

  /** Set language preference ('auto' | 'en' | 'zh'), persist, apply, notify. */
  setLang(pref) {
    if (!LANG_OPTIONS.includes(pref)) return;
    const newLang = pref === 'auto' ? resolveAutoLang() : pref;
    langPreference = pref;
    if (newLang === currentLang && pref !== 'auto') {
      // language didn't change but preference might have (e.g. en -> auto when system is en)
      localStorage.setItem(STORAGE_KEY, pref);
      return;
    }
    currentLang = newLang;
    localStorage.setItem(STORAGE_KEY, pref);
    document.documentElement.lang = newLang === 'zh' ? 'zh-CN' : 'en';
    this.apply();
    // Notify listeners to re-render dynamic content
    for (const cb of langChangeCallbacks) {
      try { cb(newLang); } catch (e) { console.error('i18n callback error:', e); }
    }
  },

  /** Apply translations to all [data-i18n] elements in the document. */
  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      // Preserve nested HTML (e.g. <a> tags inside about text)
      el.innerHTML = this.t(key);
    });
    // Update placeholders
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = this.t(key);
    });
    // Update titles
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = this.t(key);
    });
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  },

  /** Register a callback fired on language change (for re-rendering dynamic UI). */
  onChange(cb) {
    langChangeCallbacks.push(cb);
  },

  /** List of supported language option codes. */
  supported: LANG_OPTIONS,
};

// Apply once on load
document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
