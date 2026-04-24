const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Твої заповнені дані
const BOT_TOKEN = '8627662314:AAFc1yCfwRs7_-hL7frWzNLSXfi7MKofGCI';
const ADMIN_ID = '941053525';
const CHANNEL_ID = '-1003968310614';
const SUPABASE_URL = 'https://vpdbpxzikdclutyvveal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V9FvFcdl8q2MU9fUPPiFYA_V6egnO6n';

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Тимчасове сховище для кроків користувача
const userState = {}; 

// Функція головного меню
const getMainMenu = () => {
  return Markup.keyboard([
    ['🚨 Повідомити про порушення'],
    [Markup.button.webApp('🏆 Дошка рейтингу', 'https://mycarpet.kesug.com/bot/index.php')]
  ]).resize();
};

// Старт: запит нікнейму
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_nickname' };
  
  await ctx.reply(
    '👋 <b>Вітаємо в системі фіксації ПДР!</b>\n\n' +
    'Введи свій <b>Нікнейм</b> (англійською або українською), щоб ми могли вести облік твоїх балів:',
    { parse_mode: 'HTML' }
  );
});

// Кнопка повідомлення про порушення
bot.hears('🚨 Повідомити про порушення', async (ctx) => {
  const userId = ctx.from.id;
  
  const { data: profile } = await supabase.from('profiles').select('nickname').eq('user_id', userId).single();
  
  if (!profile) {
    userState[userId] = { step: 'waiting_for_nickname' };
    return ctx.reply('Спочатку введи свій нікнейм:');
  }
  
  userState[userId] = { step: 'waiting_for_media', nickname: profile.nickname };
  await ctx.reply(
    '📸 <b>Крок 1/3: Фото чи Відео</b>\nНадішли докази порушення:',
    { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard() }
  );
});

// Основний обробник повідомлень
bot.on('message', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (!state) return;

  // Зберігаємо нікнейм
  if (state.step === 'waiting_for_nickname') {
    const nick = ctx.message.text;
    if (!nick) return ctx.reply('Введи нікнейм текстом.');

    await supabase.from('profiles').upsert({ user_id: userId, nickname: nick });
    userState[userId] = { step: 'idle', nickname: nick };
    return ctx.reply(`✅ Радий познайомитись, <b>${nick}</b>!`, { parse_mode: 'HTML', ...getMainMenu() });
  }

  // Отримуємо медіа
  if (state.step === 'waiting_for_media') {
    if (ctx.message.photo) {
      state.mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      state.mediaType = 'photo';
    } else if (ctx.message.video) {
      state.mediaId = ctx.message.video.file_id;
      state.mediaType = 'video';
    } else return ctx.reply('Будь ласка, надішли фото або відео.');
    
    state.step = 'waiting_for_plate';
    return ctx.reply('🚗 <b>Крок 2/3: Номер авто</b>\nВведи номер порушника:', { parse_mode: 'HTML' });
  }

  // Отримуємо номер
  if (state.step === 'waiting_for_plate') {
    state.plate = ctx.message.text ? ctx.message.text.toUpperCase() : 'НЕВКАЗАНО';
    state.step = 'waiting_for_location';
    return ctx.reply('📍 <b>Крок 3/3: Місце</b>\nНапиши адресу або надішли локацію:', { parse_mode: 'HTML' });
  }

  // Отримуємо локацію та відправляємо адміну
  if (state.step === 'waiting_for_location') {
    state.location = ctx.message.location ? `Гео: ${ctx.message.location.latitude}, ${ctx.message.location.longitude}` : ctx.message.text;
    state.step = 'idle';

    const caption = `🚨 <b>НОВЕ ПОРУШЕННЯ</b>\n\n👤 <b>Від:</b> ${state.nickname}\n🚗 <b>Номер:</b> ${state.plate}\n📍 <b>Місце:</b> ${state.location}`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Опублікувати', `pub_${userId}_${state.plate}`), Markup.button.callback('❌ Відхилити', `rej_${userId}`)]
    ]);

    if (state.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(ADMIN_ID, state.mediaId, { caption, parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.telegram.sendVideo(ADMIN_ID, state.mediaId, { caption, parse_mode: 'HTML', ...keyboard });
    }
    await ctx.reply('⏳ Дані відправлені модератору. Очікуй підтвердження!', getMainMenu());
  }
});

// Кнопка схвалення (для тебе)
bot.action(/pub_(.+)_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const plate = ctx.match[2];
  
  const msg = ctx.callbackQuery.message;
  const mediaId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.video.file_id;
  const method = msg.photo ? 'sendPhoto' : 'sendVideo';

  try {
    // Публікація в канал
    await ctx.telegram[method](CHANNEL_ID, mediaId, {
      caption: `🚗 <b>Порушення ПДР</b>\n🔢 <b>Номер:</b> ${plate}\n📍 <i>Зафіксовано спільнотою</i>`,
      parse_mode: 'HTML'
    });

    // Нарахування балів у Supabase
    const { data: profile } = await supabase.from('profiles').select('points').eq('user_id', userId).single();
    const newPoints = (profile?.points || 0) + 10;
    await supabase.from('profiles').update({ points: newPoints }).eq('user_id', userId);

    await ctx.telegram.sendMessage(userId, '🎉 Твій матеріал опубліковано! Тобі нараховано <b>+10 балів</b>.', { parse_mode: 'HTML' });
    await ctx.editMessageCaption('✅ Опубліковано в канал.');
  } catch (e) {
    await ctx.reply('Помилка. Перевір права бота в каналі.');
  }
});

bot.action(/rej_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.telegram.sendMessage(userId, '❌ На жаль, твоє фото відхилено модератором.');
  await ctx.editMessageCaption('❌ Відхилено.');
});

module.exports = async (req, res) => {
  try { await bot.handleUpdate(req.body); } finally { res.status(200).send('OK'); }
};
