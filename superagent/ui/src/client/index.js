import { SuperagentChat, CHAT_CSS } from './superagent-chat.js'
import { SHELL_CSS, CONVERSATION_CSS, installCompiledStyles } from './styles.js'
import { USER_MESSAGE_CSS } from './user-message.js'
import { themeCss, allThemes } from './themes.js'
import { installLocale } from './i18n.js'
import { SingleConversation, SIDEBAR_CSS } from './sidebar.js'

export const inject = ['slots', 'layout']

export function apply(ctx) {
  ctx.effect(() => installLocale(ctx.get('locale')))
  ctx.effect(() => installCompiledStyles(SHELL_CSS + CONVERSATION_CSS + USER_MESSAGE_CSS
    + SIDEBAR_CSS + themeCss(allThemes().deepseek) + CHAT_CSS, 'superagent'))
  ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces', priority: -100, inject: () => ({ open: () => ctx.layout.selectPanel(null) }),
  }, SingleConversation)))
  ctx.effect(() => ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings', priority: -100,
  }, () => null)))
  ctx.effect(() => ctx.slots.inject('main.conversation', () => ctx.slots.register({
    name: 'main.conversation', priority: -100,
  }, SuperagentChat)))
}
