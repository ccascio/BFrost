import https from 'https';
import http from 'http';
import { Telegraf } from 'telegraf';
import type { Telegram } from 'telegraf';
import { message } from 'telegraf/filters';
import { availableModels, config, findModel } from '../../../config';
import { refreshActiveLocalProviderModels } from '../../../model-discovery';

const TELEGRAM_MAX_MESSAGE_CHARS = 4000;
import { processChannelMessage } from '../../../channel';
import { transcribeAudio } from '../../../transcribe';
import { clearHistory, getSelectedModel, setSelectedModel } from '../../../conversation';
import type { ChannelAdapter } from '../../module';
import { resolveTelegramBotToken } from './credentials';

const CHANNEL_ID = 'telegram';

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function isAllowed(userId: number): boolean {
  return userId === config.allowedUserId;
}

export function createTelegramBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    ctx.reply('J.A.R.V.I.S. online. Inviami un messaggio di testo o vocale. Usa /new per iniziare una nuova conversazione.');
  });

  bot.command('new', (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    clearHistory(ctx.chat.id);
    ctx.reply('Conversazione resettata. Come posso aiutarti?');
  });

  bot.command('model', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    await refreshActiveLocalProviderModels();

    const arg = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
    const currentId = getSelectedModel(ctx.chat.id);

    if (!arg) {
      const list = availableModels
        .map((m) => {
          const marker = m.id === currentId ? '▶' : ' ';
          return `${marker} /model ${m.alias} — ${m.label}`;
        })
        .join('\n');
      ctx.reply(`Available models:\n${list}`);
      return;
    }

    const selected = findModel(arg);
    if (!selected) {
      const aliases = availableModels.map((m) => m.alias).join(', ');
      ctx.reply(`Model "${arg}" not found. Available aliases: ${aliases}.`);
      return;
    }

    setSelectedModel(ctx.chat.id, selected.id);
    ctx.reply(`Model set: ${selected.label}`);
  });

  bot.command('save', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;

    try {
      await ctx.reply('Salvo la conversazione in memoria...');
      const response = await processChannelMessage({
        channel: CHANNEL_ID,
        conversationId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        username: ctx.from.username,
        text: 'Salva un summary dettagliato di questa conversazione nella memoria a lungo termine. Includi tutti i fatti chiave, decisioni e contesto.',
      });
      await ctx.reply(response.text);
    } catch (err) {
      console.error('[TelegramChannel] Error saving memory:', err);
      await ctx.reply('Errore durante il salvataggio in memoria.');
    }
  });

  bot.on(message('text'), async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      console.log(`[TelegramChannel] Ignored message from unauthorized user ${ctx.from.id}`);
      return;
    }
    try {
      const response = await processChannelMessage({
        channel: CHANNEL_ID,
        conversationId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        username: ctx.from.username,
        text: ctx.message.text,
      });
      await ctx.reply(response.text);
    } catch (err) {
      console.error('[TelegramChannel] Error processing message:', err);
      await ctx.reply('Errore durante l\'elaborazione del messaggio.');
    }
  });

  bot.on(message('photo'), async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      console.log(`[TelegramChannel] Ignored photo from unauthorized user ${ctx.from.id}`);
      return;
    }
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const imageBuffer = await downloadFile(fileLink.href);
      const imageBase64 = imageBuffer.toString('base64');
      const caption = ctx.message.caption || 'Descrivi questa immagine.';

      const response = await processChannelMessage({
        channel: CHANNEL_ID,
        conversationId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        username: ctx.from.username,
        text: caption,
        imageBase64,
        imageMimeType: 'image/jpeg',
      });
      await ctx.reply(response.text);
    } catch (err) {
      console.error('[TelegramChannel] Error processing photo:', err);
      await ctx.reply('Errore durante l\'elaborazione dell\'immagine.');
    }
  });

  bot.on(message('voice'), async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      console.log(`[TelegramChannel] Ignored voice from unauthorized user ${ctx.from.id}`);
      return;
    }
    try {
      await ctx.reply('Trascrivo il messaggio vocale...');
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const audioBuffer = await downloadFile(fileLink.href);
      const transcription = await transcribeAudio(audioBuffer);

      if (!transcription) {
        await ctx.reply('Non sono riuscito a trascrivere l\'audio.');
        return;
      }
      await ctx.reply(`Trascrizione: ${transcription}`);

      const response = await processChannelMessage({
        channel: CHANNEL_ID,
        conversationId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        username: ctx.from.username,
        text: transcription,
      });
      await ctx.reply(response.text);
    } catch (err) {
      console.error('[TelegramChannel] Error processing voice:', err);
      await ctx.reply('Errore durante l\'elaborazione del vocale.');
    }
  });

  return bot;
}

export function createTelegramChannelAdapter(): ChannelAdapter {
  let bot: Telegraf | null = null;

  return {
    channelId: CHANNEL_ID,
    async isConfigured() {
      return Boolean((await resolveTelegramBotToken()).trim());
    },
    async start() {
      if (bot) return;
      const token = await resolveTelegramBotToken();
      if (!token) {
        console.warn('[TelegramChannel] Bot token not configured; skipping start.');
        return;
      }
      bot = createTelegramBot(token);
      console.log('[TelegramChannel] Bot in avvio...');
      // Telegraf's launch returns once long-polling starts, so we don't await it
      // beyond setup; the bot keeps running in the background.
      void bot.launch();
      console.log('[TelegramChannel] Bot attivo e in ascolto.');
    },
    async stop(reason: string) {
      if (!bot) return;
      bot.stop(reason);
      bot = null;
    },
    async notifyOperator(text: string) {
      if (!config.allowedUserId) {
        console.warn('[TelegramChannel] ALLOWED_USER_ID not set; skipping operator notification.');
        return;
      }
      const token = await resolveTelegramBotToken();
      if (!token) {
        console.warn('[TelegramChannel] Bot token not configured; skipping operator notification.');
        return;
      }
      const telegram: Telegram = bot ? bot.telegram : new Telegraf(token).telegram;
      const payload =
        text.length > TELEGRAM_MAX_MESSAGE_CHARS
          ? text.slice(0, TELEGRAM_MAX_MESSAGE_CHARS) + '\n…[troncato]'
          : text;
      await telegram.sendMessage(config.allowedUserId, payload);
    },
  };
}
