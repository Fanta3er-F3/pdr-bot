const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = '8627662314:AAFc1yCfwRs7_-hL7frWzNLSXfi7MKofGCI';
const ADMIN_ID = '941053525';
const CHANNEL_ID = '-1003968310614';
const SUPABASE_URL = 'https://vpdbpxzikdclutyvveal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V9FvFcdl8q2MU9fUPPiFYA_V6egnO6n';

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const getMainMenu = () => {
  return Markup.keyboard([
    ['🚨 Повідомити про порушення'],
    [Markup.button.webApp('🏆 Дошка рейтингу', 'https://uk.wikipedia.org/wiki/Головна_сторінка')]
  ]).resize();
};

bot.on('message', async (ctx) => {
  const userId = ctx.from.id;

  // 1. Отримуємо профіль з бази
  let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).single();

  // 2. Якщо користувач натиснув /start
  if (ctx.message?.text === '/start') {
    await supabase.from('profiles').upsert({ user_id: userId, step: 'waiting_for_nickname', points: profile?.points || 0 });
    return ctx.reply('👋 <b>Вітаємо в системі фіксації ПДР!</b>\n\nВведи свій <b>Нікнейм</b> текстом:', { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard() });
  }

  // Якщо користувача взагалі немає в базі, але він щось пише
  if (!profile) {
    await supabase.from('profiles').upsert({ user_id: userId, step: 'waiting_for_nickname', points: 0 });
    profile = { step: 'waiting_for_nickname' }; // штучно задаємо крок
  }

  const step = profile.step;

  // 3. Крок реєстрації: Чекаємо нікнейм
  if (step === 'waiting_for_nickname') {
    if (!ctx.message.text) return ctx.reply('❗️ Будь ласка, введи нікнейм текстом.');
    
    await supabase.from('profiles').update({ nickname: ctx.message.text, step: 'idle' }).eq('user_id', userId);
    return ctx.reply(`✅ Радий познайомитись, <b>${ctx.message.text}</b>!\nТисни кнопку нижче, щоб почати.`, { parse_mode: 'HTML', ...getMainMenu() });
  }

  // 4. Якщо користувач тисне кнопку "Повідомити"
  if (ctx.message?.text === '🚨 Повідомити про порушення') {
    await supabase.from('profiles').update({ step: 'waiting_for_media' }).eq('user_id', userId);
    return ctx.reply('📸 <b>Крок 1/3: Фото чи Відео</b>\nНадішли докази порушення (бажано, щоб було видно номер):', { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard() });
  }

  // 5. Крок 1: Збір медіа
  if (step === 'waiting_for_media') {
    let mediaId, mediaType;
    if (ctx.message.photo) {
      mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      mediaType = 'photo';
    } else if (ctx.message.video) {
      mediaId = ctx.message.video.file_id;
      mediaType = 'video';
    } else {
      return ctx.reply('❗️ Будь ласка, надішли саме фото або відео порушення.');
    }

    await supabase.from('profiles').update({ step: 'waiting_for_plate', temp_media: mediaId, temp_media_type: mediaType }).eq('user_id', userId);
    return ctx.reply('🚗 <b>Крок 2/3: Номер авто</b>\nВведи номер порушника (наприклад: КА1234АА):', { parse_mode: 'HTML' });
  }

  // 6. Крок 2: Збір номера
  if (step === 'waiting_for_plate') {
    if (!ctx.message.text) return ctx.reply('❗️ Будь ласка, введи номер текстом.');
    
    await supabase.from('profiles').update({ step: 'waiting_for_location', temp_plate: ctx.message.text.toUpperCase() }).eq('user_id', userId);
    return ctx.reply('📍 <b>Крок 3/3: Місце</b>\nНапиши адресу текстом або надішли геолокацію з телефону:', { parse_mode: 'HTML' });
  }

  // 7. Крок 3: Збір локації та відправка адміну
  if (step === 'waiting_for_location') {
    const location = ctx.message.location ? `Геоточка: ${ctx.message.location.latitude}, ${ctx.message.location.longitude}` : ctx.message.text;

    const caption = `🚨 <b>НОВЕ ПОРУШЕННЯ</b>\n\n` +
                    `👤 <b>Від:</b> ${profile.nickname}\n` +
                    `🚗 <b>Номер:</b> ${profile.temp_plate}\n` +
                    `📍 <b>Місце:</b> ${location}`;
                    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Опублікувати', `pub_${userId}_${profile.temp_plate.substring(0, 20)}`), 
        Markup.button.callback('❌ Відхилити', `rej_${userId}`)
      ]
    ]);

    if (profile.temp_media_type === 'photo') {
      await ctx.telegram.sendPhoto(ADMIN_ID, profile.temp_media, { caption, parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.telegram.sendVideo(ADMIN_ID, profile.temp_media, { caption, parse_mode: 'HTML', ...keyboard });
    }

    await supabase.from('profiles').update({ step: 'idle', temp_media: null, temp_plate: null, temp_media_type: null }).eq('user_id', userId);
    return ctx.reply('⏳ Звіт сформовано та відправлено модератору. Очікуй на підтвердження!', getMainMenu());
  }
});

// Кнопки Модератора (Адмінка)
bot.action(/pub_(.+)_(.+)/, async (ctx) => {
  const authorId = ctx.match[1];
  const plate = ctx.match[2];
  const msg = ctx.callbackQuery.message;
  
  const mediaId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.video.file_id;
  const method = msg.photo ? 'sendPhoto' : 'sendVideo';

  try {
    await ctx.telegram[method](CHANNEL_ID, mediaId, {
      caption: `🚗 <b>Зафіксовано порушення ПДР</b>\n🔢 <b>Номер:</b> ${plate}\n📍 <i>Зафіксовано спостерігачем спільноти</i>`,
      parse_mode: 'HTML'
    });

    const { data: profile } = await supabase.from('profiles').select('points').eq('user_id', authorId).single();
    if (profile) {
      await supabase.from('profiles').update({ points: profile.points + 10 }).eq('user_id', authorId);
    }

    await ctx.telegram.sendMessage(authorId, '🎉 Твій матеріал схвалено та опубліковано! Тобі нараховано <b>+10 балів</b>.', { parse_mode: 'HTML' });
    await ctx.editMessageCaption('✅ Опубліковано в канал.');
  } catch (error) {
    console.error("Помилка публікації:", error);
    await ctx.reply('Помилка публікації. Перевір, чи є бот адміністратором каналу.');
  }
});

bot.action(/rej_(.+)/, async (ctx) => {
  const authorId = ctx.match[1];
  try {
    await ctx.telegram.sendMessage(authorId, '❌ На жаль, модератор відхилив твоє фото (можливо, погано видно номери або немає порушення).');
    await ctx.editMessageCaption('❌ Відхилено модератором.');
  } catch (e) { console.error(e); }
});

module.exports = async (req, res) => {
  try {
    if (req.body) await bot.handleUpdate(req.body);
  } catch (e) {
    console.error(e);
  } finally {
    res.status(200).send('OK');
  }
};
